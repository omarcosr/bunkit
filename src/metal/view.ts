// GPUView: a Metal surface that is also a BunKit view.
//
// Pacing, which is the whole design question here:
//
// The temptation is to let the GPU run free of JavaScript. It is the wrong
// instinct. Presenting faster than the display refreshes changes nothing a
// person can see, and CAMetalLayer's vsync makes nextDrawable block anyway, so
// "faster than Bun" mostly means re-presenting identical pixels. What is
// actually visible is *jitter* — a frame that misses its vsync deadline — and
// decoupling does not fix that; it just presents staler state, which for
// anything synced to music or input is worse than a lower frame rate.
//
// So: pace to the display, and make the per-frame JavaScript cheap enough that
// it is never the limit. Measured on an M2 Pro, a draw call costs 1.2 us from
// JS while writing 20,000 instance structs into a shared buffer costs 0.05 ms
// in total. A scene built out of instanced draws spends microseconds in JS per
// frame, so there is nothing to decouple from.
//
// Frames are gated on GPU completion rather than a timer: the view keeps at
// most `maxInFlight` command buffers outstanding and skips a tick when the GPU
// has not caught up. That paces to the display without ever blocking the run
// loop, which a blocking nextDrawable would.
//
// Completion is *polled*, not delivered by a handler block, and that is not a
// shortcut. Metal invokes addCompletedHandler: on its own thread; a JS callback
// entered from there deadlocks Bun, because the interpreter it needs is the
// thread that is waiting. Reading commandBuffer.status() at the top of the next
// tick asks the same question from the thread that is allowed to ask it.

import { objc, withPool } from "../objc.ts";
import { NIL } from "../bridge.ts";
import { onFrame, setAnimating } from "../runtime.ts";
import { View, type ViewOptions } from "../ui/view.ts";
import { input, type Input } from "../ui/input.ts";
import {
  CommandBufferStatus, gpu, PixelFormat, Texture,
  type GPU, type MTLObject, type PixelFormatName,
} from "./gpu.ts";
import { Frame } from "./frame.ts";

export interface GPUViewOptions extends ViewOptions {
  format?: PixelFormatName;
  /** Create and manage a depth texture matching the drawable. Default true. */
  depth?: boolean | PixelFormatName;
  /** Multisample count. 1, 2 or 4; 4 is the usual choice for clean edges. */
  sampleCount?: number;
  /** Frames the GPU may be working on at once. 2 is smooth and low-latency. */
  maxInFlight?: number;
  /** Cap the frame rate. Omit to run at the display's refresh. */
  fps?: number;
  animate?: boolean;
  onFrame?: (frame: Frame, view: GPUView) => void;
}

export interface GPUViewStats {
  /** Frames presented in the last second. */
  fps: number;
  /** Milliseconds of JavaScript per frame, encoding included. */
  cpuMs: number;
  /** Milliseconds the GPU spent, from its own timestamps. */
  gpuMs: number;
  /** Ticks skipped because the GPU had not caught up. */
  skipped: number;
  frame: number;
  drawableSize: { width: number; height: number };
}

export class GPUView extends View {
  readonly gpu: GPU;
  readonly layer: MTLObject;
  readonly format: number;
  readonly sampleCount: number;
  /** Multisample colour target, when sampleCount > 1. */
  msaaTexture: Texture | null = null;
  depthTexture: Texture | null = null;

  #depthFormat: PixelFormatName | null;
  #handlers: ((frame: Frame, view: GPUView) => void)[] = [];
  #stop: (() => void) | null = null;
  /** Command buffers the GPU has not finished. Drained by polling status(). */
  #inFlight: MTLObject[] = [];
  #maxInFlight: number;
  #minInterval: number;
  #size = { width: 0, height: 0 };
  #start = 0;
  #last = 0;
  #frame = 0;
  #skipped = 0;
  #cpuMs = 0;
  #gpuMs = 0;
  #fps = 0;
  #fpsFrames = 0;
  #fpsMark = 0;
  #disposed = false;

  constructor(options: GPUViewOptions = {}) {
    const g = gpu();
    const native = objc.NSView.alloc().init();
    const layer = objc.CAMetalLayer.layer();
    layer.setDevice_(g.device);
    layer.setPixelFormat_(PixelFormat[options.format ?? "bgra8unorm"]);
    // Two or three lets the GPU work on the next frame while one is on screen.
    layer.setMaximumDrawableCount_(Math.max(2, Math.min(3, (options.maxInFlight ?? 2) + 1)));
    // Order matters: setting wantsLayer first makes AppKit install its own.
    native.setLayer_(layer);
    native.setWantsLayer_(true);

    super(native, options);

    this.gpu = g;
    this.layer = layer;
    this.format = PixelFormat[options.format ?? "bgra8unorm"];
    this.sampleCount = options.sampleCount ?? 1;
    this.#depthFormat =
      options.depth === false ? null
      : typeof options.depth === "string" ? options.depth
      : "depth32float";
    this.#maxInFlight = Math.max(1, options.maxInFlight ?? 2);
    this.#minInterval = options.fps ? 1 / options.fps : 0;

    if (options.height === undefined && options.minHeight === undefined) {
      this.constrain("height", ">=", 160);
    }
    if (options.onFrame) this.#handlers.push(options.onFrame);
    if (options.animate !== false) this.start();
  }

  onFrame(fn: (frame: Frame, view: GPUView) => void): this {
    this.#handlers.push(fn);
    return this;
  }

  /**
   * Keyboard and mouse, with the pointer reported in this view's coordinates.
   *
   *   if (view.input.held("w")) camera.position.z -= speed * frame.dt;
   */
  get input(): Input {
    return input().track(this);
  }

  start(): this {
    if (this.#stop || this.#disposed) return this;
    this.#start = 0;
    // Ask the run loop for its fast cadence while we are animating, so a 120 Hz
    // display is not capped by the idle 100 Hz tick.
    setAnimating(true);
    this.#stop = onFrame((now) => this.#tick(now));
    return this;
  }

  stop(): this {
    if (!this.#stop) return this;
    this.#stop();
    this.#stop = null;
    setAnimating(false);
    return this;
  }

  get running(): boolean {
    return this.#stop !== null;
  }

  get stats(): GPUViewStats {
    return {
      fps: this.#fps,
      cpuMs: this.#cpuMs,
      gpuMs: this.#gpuMs,
      skipped: this.#skipped,
      frame: this.#frame,
      drawableSize: { ...this.#size },
    };
  }

  /** Retire finished command buffers, and take the GPU's own timing off them. */
  #reap(): number {
    let i = 0;
    while (i < this.#inFlight.length) {
      const buffer = this.#inFlight[i]!;
      if (Number(buffer.status()) >= CommandBufferStatus.completed) {
        const start = Number(buffer.GPUStartTime());
        const end = Number(buffer.GPUEndTime());
        if (end > start) this.#gpuMs = (end - start) * 1000;
        this.#inFlight.splice(i, 1);
      } else {
        i++;
      }
    }
    return this.#inFlight.length;
  }

  #tick(now: number): void {
    if (this.#start === 0) {
      this.#start = now;
      this.#last = now;
    }
    if (this.#minInterval && now - this.#last < this.#minInterval) return;
    // The GPU has not finished enough of the previous work: skip rather than
    // queue more, and rather than block the run loop waiting for a drawable.
    if (this.#reap() >= this.#maxInFlight) {
      this.#skipped++;
      return;
    }
    const dt = now - this.#last;
    this.#last = now;
    this.draw(now - this.#start, dt);
  }

  /** Size the drawable and the attachments to the view's backing store. */
  #syncSize(): { width: number; height: number } {
    const bounds = this.native.bounds();
    const window = this.native.window();
    const scale = window ? Number(window.backingScaleFactor()) : 2;
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    if (width !== this.#size.width || height !== this.#size.height) {
      this.layer.setContentsScale_(scale);
      this.layer.setDrawableSize_({ width, height });
      this.#size = { width, height };
      if (this.#depthFormat) {
        this.depthTexture = this.gpu.texture({
          width, height, format: this.#depthFormat, usage: ["renderTarget"],
          sampleCount: this.sampleCount, label: "depth",
        });
      }
      this.msaaTexture = this.sampleCount > 1
        ? this.gpu.texture({
            width, height, format: this.formatName, usage: ["renderTarget"],
            sampleCount: this.sampleCount, label: "msaa",
          })
        : null;
    }
    return this.#size;
  }

  /** The pixel format as a name, for building a pipeline that matches. */
  get formatName(): PixelFormatName {
    for (const [name, value] of Object.entries(PixelFormat)) {
      if (value === this.format) return name as PixelFormatName;
    }
    return "bgra8unorm";
  }

  /**
   * Encode and present one frame.
   *
   * Call it directly for a single still; the loop calls it otherwise.
   */
  draw(time = 0, dt = 0): void {
    if (this.#disposed || this.#handlers.length === 0) return;
    const cpuStart = performance.now();

    withPool(() => {
      const { width, height } = this.#syncSize();
      if (width < 2 || height < 2) return;

      const drawable = this.layer.nextDrawable();
      if (!drawable || drawable.ptr === NIL) return;

      const commands = this.gpu.queue.commandBuffer();
      commands.setLabel_(`frame ${this.#frame}`);

      const frame = new Frame(commands, {
        time, dt, index: this.#frame, width, height,
      });
      frame.drawable = drawable;
      frame.colorTexture = this.msaaTexture ? this.msaaTexture.native : drawable.texture();
      frame.resolveTexture = this.msaaTexture ? drawable.texture() : undefined;
      frame.depthTexture = this.depthTexture?.native;

      for (const fn of this.#handlers) {
        try {
          fn(frame, this);
        } catch (e) {
          console.error("[GPUView] frame handler failed:", e);
        }
      }

      commands.presentDrawable_(drawable);
      commands.commit();
      // Retained past the pool: #reap polls its status on a later tick.
      this.#inFlight.push(commands.retain());
      this.#frame++;
    });

    this.#cpuMs = performance.now() - cpuStart;
    this.#fpsFrames++;
    if (time - this.#fpsMark >= 1) {
      this.#fps = Math.round(this.#fpsFrames / Math.max(1e-6, time - this.#fpsMark));
      this.#fpsFrames = 0;
      this.#fpsMark = time;
    }
  }

  /**
   * Render one frame into an off-screen texture and read it back as RGBA.
   *
   * The same handlers run, so a capture is the same frame the view would have
   * drawn — which is how this is tested with nobody watching.
   */
  capture(width = 512, height = 384): { width: number; height: number; pixels: Uint8Array } {
    const color = this.gpu.texture({
      width, height, format: this.formatName,
      usage: ["renderTarget", "shaderRead"], storage: "shared", label: "capture",
    });
    const depth = this.#depthFormat
      ? this.gpu.texture({ width, height, format: this.#depthFormat, usage: ["renderTarget"], label: "captureDepth" })
      : null;

    this.gpu.submit((commands) => {
      const frame = new Frame(commands, {
        time: this.#last - this.#start, dt: 1 / 60, index: this.#frame, width, height,
      });
      frame.colorTexture = color.native;
      frame.depthTexture = depth?.native;
      for (const fn of this.#handlers) fn(frame, this);
    });

    const bgra = color.read();
    // BGRA on the GPU, RGBA for everyone else.
    const pixels = new Uint8Array(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) {
      pixels[i] = bgra[i + 2]!;
      pixels[i + 1] = bgra[i + 1]!;
      pixels[i + 2] = bgra[i]!;
      pixels[i + 3] = bgra[i + 3]!;
    }
    return { width, height, pixels };
  }

  dispose(): void {
    this.stop();
    this.#disposed = true;
    for (const buffer of this.#inFlight) buffer.release();
    this.#inFlight = [];
    this.depthTexture = null;
    this.msaaTexture = null;
  }
}

