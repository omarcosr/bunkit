// Scene3D: a Metal-rendered 3D view that sits in a layout like any other.
//
// It is an NSView backed by a CAMetalLayer rather than an MTKView. MTKView
// would bring in MetalKit and its own delegate-driven draw loop; a layer needs
// nothing but QuartzCore, which the bridge already links, and leaves the timing
// to BunKit's run loop where the rest of the app already is.

import { objc, withPool } from "../objc.ts";
import { NIL, ptr } from "../bridge.ts";
import { onFrame } from "../runtime.ts";
import { BitmapImageFileType } from "../ui/appkit.ts";
import { View, type ViewOptions } from "../ui/view.ts";
import {
  buildPipeline,
  makeBuffer,
  makeDepthTexture,
  metalDevice,
  MTL,
  UNIFORM_FLOATS,
  type MTLObject,
  type Pipeline,
} from "./device.ts";
import { boxGeometry, planeGeometry, sphereGeometry, type Geometry } from "./geometry.ts";
import {
  compose,
  lookAt,
  multiply,
  normalMatrix,
  perspective,
  radians,
  toVec3,
  v3normalize,
  type Mat4,
  type Vec3,
} from "./math.ts";

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type Color = string | { r: number; g: number; b: number; a?: number };

/** "#rgb", "#rrggbb", "#rrggbbaa" or {r,g,b,a} in 0..1, to four floats. */
export function parseColor(c: Color, fallback: [number, number, number, number] = [1, 1, 1, 1]) {
  if (typeof c !== "string") return [c.r, c.g, c.b, c.a ?? 1] as [number, number, number, number];
  const hex = c.replace(/^#/, "");
  const n = (i: number, len: number) =>
    parseInt(len === 1 ? hex[i]! + hex[i]! : hex.substr(i, 2), 16) / 255;
  if (hex.length === 3) return [n(0, 1), n(1, 1), n(2, 1), 1] as [number, number, number, number];
  if (hex.length === 6) return [n(0, 2), n(2, 2), n(4, 2), 1] as [number, number, number, number];
  if (hex.length === 8) return [n(0, 2), n(2, 2), n(4, 2), n(6, 2)] as [number, number, number, number];
  return fallback;
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export interface NodeOptions {
  position?: Vec3 | readonly [number, number, number];
  rotation?: Vec3 | readonly [number, number, number];
  scale?: Vec3 | readonly [number, number, number] | number;
  color?: Color;
  visible?: boolean;
}

/**
 * One drawable object. Its transform fields are plain mutable objects, so
 * animating is `node.rotation.y += dt` rather than a setter call — which is the
 * whole point of not diffing anything.
 */
export class Node {
  readonly geometry: Geometry;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: [number, number, number, number];
  visible: boolean;

  /** @internal Scratch, so a frame allocates no matrices. */
  readonly _model: Mat4 = new Float32Array(16);
  /** @internal */
  readonly _normal: Mat4 = new Float32Array(16);
  /** @internal */
  readonly _mvp: Mat4 = new Float32Array(16);

  constructor(geometry: Geometry, options: NodeOptions = {}) {
    this.geometry = geometry;
    this.position = toVec3(options.position ?? [0, 0, 0]);
    this.rotation = toVec3(options.rotation ?? [0, 0, 0]);
    this.scale = toVec3(options.scale ?? 1);
    this.color = parseColor(options.color ?? "#cccccc");
    this.visible = options.visible ?? true;
  }

  setColor(c: Color): this {
    this.color = parseColor(c);
    return this;
  }
}

export const box = (o: NodeOptions & { size?: number | readonly [number, number, number] } = {}) =>
  new Node(boxGeometry({ size: o.size }), o);

export const sphere = (
  o: NodeOptions & { radius?: number; segments?: number; rings?: number } = {},
) => new Node(sphereGeometry(o), o);

export const plane = (
  o: NodeOptions & { size?: number | readonly [number, number]; segments?: number } = {},
) => new Node(planeGeometry(o), o);

/** A node from your own vertex data. */
export const mesh = (geometry: Geometry, o: NodeOptions = {}) => new Node(geometry, o);

// ---------------------------------------------------------------------------
// Camera and light
// ---------------------------------------------------------------------------

export interface CameraOptions {
  position?: Vec3 | readonly [number, number, number];
  target?: Vec3 | readonly [number, number, number];
  up?: Vec3 | readonly [number, number, number];
  /** Vertical field of view in degrees. */
  fov?: number;
  near?: number;
  far?: number;
}

export class Camera {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  near: number;
  far: number;

  constructor(o: CameraOptions = {}) {
    this.position = toVec3(o.position ?? [0, 2, 6]);
    this.target = toVec3(o.target ?? [0, 0, 0]);
    this.up = toVec3(o.up ?? [0, 1, 0]);
    this.fov = o.fov ?? 55;
    this.near = o.near ?? 0.1;
    this.far = o.far ?? 200;
  }

  /** Orbit the camera around its target. Convenient for a demo scene. */
  orbit(angleRadians: number, radius: number, height = this.position.y): this {
    this.position = {
      x: this.target.x + Math.cos(angleRadians) * radius,
      y: height,
      z: this.target.z + Math.sin(angleRadians) * radius,
    };
    return this;
  }
}

export interface LightOptions {
  /** Direction the light travels *from*, i.e. towards the scene. */
  direction?: Vec3 | readonly [number, number, number];
  color?: Color;
  intensity?: number;
  ambient?: Color;
  ambientIntensity?: number;
}

export class Light {
  direction: Vec3;
  color: [number, number, number, number];
  intensity: number;
  ambient: [number, number, number, number];
  ambientIntensity: number;

  constructor(o: LightOptions = {}) {
    this.direction = v3normalize(toVec3(o.direction ?? [0.4, 0.9, 0.5]));
    this.color = parseColor(o.color ?? "#ffffff");
    this.intensity = o.intensity ?? 1;
    this.ambient = parseColor(o.ambient ?? "#5d6478");
    this.ambientIntensity = o.ambientIntensity ?? 0.35;
  }
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface Scene3DOptions extends ViewOptions {
  background?: Color;
  camera?: CameraOptions | Camera;
  light?: LightOptions | Light;
  /** Frames per second to aim for. The run loop is the upper bound. */
  fps?: number;
  /** Start drawing immediately. Default true. */
  animate?: boolean;
  onFrame?: (frame: FrameInfo) => void;
}

export interface FrameInfo {
  /** Seconds since the scene was created. */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  frame: number;
  scene: Scene3D;
}

interface Buffers {
  vertex: MTLObject;
  index: MTLObject;
  count: number;
}

export class Scene3D extends View {
  readonly camera: Camera;
  readonly light: Light;
  readonly layer: any;
  readonly device: MTLObject;
  background: [number, number, number, number];

  #queue: MTLObject;
  #pipeline: Pipeline;
  #depth: MTLObject | null = null;
  #depthSize = { width: 0, height: 0 };
  #nodes: Node[] = [];
  #buffers = new Map<Geometry, Buffers>();
  #uniforms = new Float32Array(UNIFORM_FLOATS);
  #clear = new Float64Array(4);
  #view: Mat4 = new Float32Array(16);
  #projection: Mat4 = new Float32Array(16);
  #viewProjection: Mat4 = new Float32Array(16);
  #handlers: ((f: FrameInfo) => void)[] = [];
  #stop: (() => void) | null = null;
  #start = 0;
  #last = 0;
  #frame = 0;
  #interval: number;
  #disposed = false;

  constructor(options: Scene3DOptions = {}) {
    const device = metalDevice();
    if (!device) {
      throw new Error(
        "no Metal device. Scene3D needs a GPU; check metalAvailable() first if that is in doubt.",
      );
    }

    const native = objc.NSView.alloc().init();
    const layer = objc.CAMetalLayer.layer();
    layer.setDevice_(device);
    layer.setPixelFormat_(MTL.PixelFormatBGRA8Unorm);
    // The order matters: AppKit replaces the layer if wantsLayer is set first.
    native.setLayer_(layer);
    native.setWantsLayer_(true);

    super(native, options);

    this.device = device;
    this.layer = layer;
    this.camera = options.camera instanceof Camera ? options.camera : new Camera(options.camera);
    this.light = options.light instanceof Light ? options.light : new Light(options.light);
    this.background = parseColor(options.background ?? "#0b0b0f");
    this.#queue = device.newCommandQueue();
    this.#pipeline = buildPipeline(device);
    this.#interval = 1 / (options.fps ?? 60);

    // A 3D view has no intrinsic size, so without a floor it collapses to
    // nothing in a stack that hugs its content.
    if (options.height === undefined && options.minHeight === undefined) {
      this.constrain("height", ">=", 180);
    }

    if (options.onFrame) this.#handlers.push(options.onFrame);
    if (options.animate !== false) this.start();
  }

  // --- scene graph ---------------------------------------------------------

  /**
   * Add a node to the scene, or a plain View as an overlay on top of it.
   *
   * The two share a name because a Scene3D is a View: the base class already
   * has add(View), and shadowing it with an incompatible signature would make
   * Scene3D unusable anywhere a View is expected.
   */
  add<T extends Node>(node: T): T;
  add(child: View): this;
  add(item: Node | View): any {
    if (item instanceof Node) {
      this.#nodes.push(item);
      return item;
    }
    return super.add(item);
  }

  remove(node: Node): this {
    const i = this.#nodes.indexOf(node);
    if (i >= 0) this.#nodes.splice(i, 1);
    return this;
  }

  clear(): this {
    this.#nodes = [];
    return this;
  }

  get nodes(): readonly Node[] {
    return this.#nodes;
  }

  /** Run `fn` before each frame is drawn. */
  onFrame(fn: (frame: FrameInfo) => void): this {
    this.#handlers.push(fn);
    return this;
  }

  // --- the loop ------------------------------------------------------------

  start(): this {
    if (this.#stop || this.#disposed) return this;
    this.#start = 0;
    this.#stop = onFrame((now) => this.#tick(now));
    return this;
  }

  stop(): this {
    this.#stop?.();
    this.#stop = null;
    return this;
  }

  get running(): boolean {
    return this.#stop !== null;
  }

  #tick(now: number): void {
    if (this.#start === 0) {
      this.#start = now;
      this.#last = now;
    }
    // The run loop ticks faster than the target frame rate, so most calls do
    // nothing. Skipping here rather than drawing every iteration is what keeps
    // an idle 3D view off the CPU.
    if (now - this.#last < this.#interval) return;
    const dt = now - this.#last;
    this.#last = now;

    const info: FrameInfo = { time: now - this.#start, dt, frame: this.#frame++, scene: this };
    for (const fn of this.#handlers) {
      try {
        fn(info);
      } catch (e) {
        console.error("[Scene3D] frame handler failed:", e);
      }
    }
    this.draw();
  }

  // --- rendering -----------------------------------------------------------

  /** Size the drawable to the view's backing store. Returns the pixel size. */
  #syncSize(): { width: number; height: number } {
    const bounds = this.native.bounds();
    const window = this.native.window();
    const scale = window ? Number(window.backingScaleFactor()) : 2;
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    if (width !== this.#depthSize.width || height !== this.#depthSize.height) {
      this.layer.setContentsScale_(scale);
      this.layer.setDrawableSize_({ width, height });
      this.#depth = makeDepthTexture(this.device, width, height);
      this.#depthSize = { width, height };
    }
    return { width, height };
  }

  #buffersFor(geometry: Geometry): Buffers {
    let b = this.#buffers.get(geometry);
    if (!b) {
      b = {
        vertex: makeBuffer(this.device, geometry.vertices),
        index: makeBuffer(this.device, geometry.indices),
        count: geometry.indices.length,
      };
      this.#buffers.set(geometry, b);
    }
    return b;
  }

  /** Draw one frame. Called by the loop; call it directly for a still. */
  draw(): void {
    if (this.#disposed) return;
    // A frame makes several autoreleased objects — the pass descriptor, the
    // command buffer, the encoder, the drawable. Draining here rather than
    // leaving them to the run loop's pool means draw() can be called in a tight
    // loop (a capture sequence, a test) without memory climbing.
    withPool(() => {
      const { width, height } = this.#syncSize();
      if (width < 2 || height < 2) return;

      const drawable = this.layer.nextDrawable();
      // nil when the layer is off-screen or the drawable pool is exhausted.
      // Skip; the next frame gets another chance.
      if (!drawable || drawable.ptr === NIL) return;

      const commands = this.#queue.commandBuffer();
      this.#encode(commands, drawable.texture(), this.#depth, width, height);
      commands.presentDrawable_(drawable);
      commands.commit();
    });
  }

  /**
   * Record the scene into a command buffer against the given attachments.
   *
   * Shared by the on-screen path and capture(), so a screenshot is the same
   * drawing code rather than a second implementation that can drift from it.
   */
  #encode(
    commands: MTLObject,
    colorTexture: MTLObject,
    depthTexture: MTLObject | null,
    width: number,
    height: number,
  ): void {
    const pass = objc.MTLRenderPassDescriptor.renderPassDescriptor();
    const color = pass.colorAttachments().objectAtIndexedSubscript_(0);
    color.setTexture_(colorTexture);
    color.setLoadAction_(MTL.LoadActionClear);
    color.setStoreAction_(MTL.StoreActionStore);
    this.#clear.set(this.background);
    color.setClearColor_(this.#clear);

    if (depthTexture) {
      const depth = pass.depthAttachment();
      depth.setTexture_(depthTexture);
      depth.setLoadAction_(MTL.LoadActionClear);
      depth.setStoreAction_(0); // DontCare: nothing reads it after the pass
      depth.setClearDepth_(1.0);
    }

    const encoder = commands.renderCommandEncoderWithDescriptor_(pass);
    encoder.setRenderPipelineState_(this.#pipeline.state);
    encoder.setDepthStencilState_(this.#pipeline.depthState);
    encoder.setFrontFacingWinding_(MTL.WindingCounterClockwise);
    encoder.setCullMode_(MTL.CullModeBack);

    lookAt(this.camera.position, this.camera.target, this.camera.up, this.#view);
    perspective(
      radians(this.camera.fov),
      width / height,
      this.camera.near,
      this.camera.far,
      this.#projection,
    );
    multiply(this.#projection, this.#view, this.#viewProjection);

    const u = this.#uniforms;
    for (const node of this.#nodes) {
      if (!node.visible) continue;
      compose(node.position, node.rotation, node.scale, node._model);
      normalMatrix(node._model, node._normal);
      multiply(this.#viewProjection, node._model, node._mvp);

      u.set(node._mvp, 0);
      u.set(node._model, 16);
      u.set(node._normal, 32);
      u.set(node.color, 48);
      u[52] = this.light.direction.x;
      u[53] = this.light.direction.y;
      u[54] = this.light.direction.z;
      u[55] = 0;
      u.set(this.light.color.slice(0, 3), 56);
      u[59] = this.light.intensity;
      u.set(this.light.ambient.slice(0, 3), 60);
      u[63] = this.light.ambientIntensity;
      u[64] = this.camera.position.x;
      u[65] = this.camera.position.y;
      u[66] = this.camera.position.z;
      u[67] = 1;

      const b = this.#buffersFor(node.geometry);
      encoder.setVertexBuffer_offset_atIndex_(b.vertex, 0, 0);
      encoder.setVertexBytes_length_atIndex_(ptr(u), u.byteLength, 1);
      encoder.setFragmentBytes_length_atIndex_(ptr(u), u.byteLength, 1);
      encoder.drawIndexedPrimitives_indexCount_indexType_indexBuffer_indexBufferOffset_(
        MTL.PrimitiveTypeTriangle, b.count, MTL.IndexTypeUInt32, b.index, 0,
      );
    }
    encoder.endEncoding();
  }

  /**
   * Render off-screen and read the pixels back, as RGBA bytes, top row first.
   *
   * This is how the scene is tested without a human looking at it, and it does
   * not need the view to be in a window.
   */
  capture(width = 320, height = 240): { width: number; height: number; pixels: Uint8Array } {
    const descriptor =
      objc.MTLTextureDescriptor.texture2DDescriptorWithPixelFormat_width_height_mipmapped_(
        MTL.PixelFormatBGRA8Unorm, width, height, false,
      );
    descriptor.setUsage_(MTL.TextureUsageShaderRead | MTL.TextureUsageRenderTarget);
    descriptor.setStorageMode_(MTL.StorageModeShared);
    const target = this.device.newTextureWithDescriptor_(descriptor);
    const depth = makeDepthTexture(this.device, width, height);

    const commands = this.#queue.commandBuffer();
    this.#encode(commands, target, depth, width, height);
    commands.commit();
    commands.waitUntilCompleted();

    const error = commands.error();
    if (error && error.ptr !== NIL) {
      throw new Error(`Metal capture failed: ${String(error.localizedDescription())}`);
    }

    const bgra = new Uint8Array(width * height * 4);
    const region = new BigUint64Array([0n, 0n, 0n, BigInt(width), BigInt(height), 1n]);
    target.getBytes_bytesPerRow_fromRegion_mipmapLevel_(ptr(bgra), width * 4, region, 0);

    // The texture is BGRA; callers and NSBitmapImageRep both want RGBA.
    const pixels = new Uint8Array(bgra.length);
    for (let i = 0; i < bgra.length; i += 4) {
      pixels[i] = bgra[i + 2]!;
      pixels[i + 1] = bgra[i + 1]!;
      pixels[i + 2] = bgra[i]!;
      pixels[i + 3] = bgra[i + 3]!;
    }
    return { width, height, pixels };
  }

  /** Render off-screen and write a PNG. Returns the file size in bytes. */
  snapshot(path: string, width = 640, height = 480): number {
    const { pixels } = this.capture(width, height);

    // Hand the rep our own buffer rather than passing NULL planes: a rep
    // created with NULL does not allocate until it is drawn into, so
    // -bitmapData comes back nil and there is nowhere to put the pixels.
    // Passing the address of our buffer makes the rep reference it directly,
    // which is fine because it is encoded before this function returns.
    const planes = new BigUint64Array([BigInt(ptr(pixels))]);
    const rep = objc.NSBitmapImageRep.alloc()
      .initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        ptr(planes), width, height, 8, 4, true, false, "NSDeviceRGBColorSpace", width * 4, 32,
      );
    if (!rep || rep.ptr === NIL) throw new Error("could not wrap the capture in an NSBitmapImageRep");

    const data = rep.representationUsingType_properties_(
      BitmapImageFileType.PNG,
      objc.NSDictionary.dictionary(),
    );
    if (!data || data.ptr === NIL) throw new Error("could not encode the capture as PNG");
    if (!data.writeToFile_atomically_(path, true)) throw new Error(`could not write ${path}`);
    return Number(data.length());
  }

  /** Stop the loop and drop the GPU resources this view holds. */
  dispose(): void {
    this.stop();
    this.#disposed = true;
    this.#buffers.clear();
    this.#depth = null;
  }
}
