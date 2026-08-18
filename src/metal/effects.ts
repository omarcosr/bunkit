// Full-screen effects, and somewhere to render before the screen.
//
// Almost every interesting frame is more than one pass: render the scene to a
// texture, pull the bright parts out, blur them, add them back. That is three
// full-screen passes, and in raw Metal each one is a vertex function, a
// pipeline, an encoder and a triangle you have to remember to draw.
//
// Here it is a string:
//
//   const invert = gpu().effect(`return float4(1.0 - src.sample(smp, uv).rgb, 1.0);`);
//   frame.effect(invert, { to: screen, bind: { src: sceneTexture } });
//
// `src`, `smp` and `uv` are already in scope, the sampler is bound for you, and
// the triangle is drawn for you. When one expression is not enough, pass a whole
// fragment function instead and declare whatever bindings you like — the effect
// is an ordinary pipeline and `bind()` finds them by name.

import type { MTLObject, PixelFormatName, RenderPipeline, Texture } from "./gpu.ts";
import type { BlendMode, GPU } from "./gpu.ts";
import type { BindValue } from "./frame.ts";
import type { BindingTable } from "./reflect.ts";

/**
 * The vertex half of every effect.
 *
 * One triangle covering the screen, not two making a quad: the quad's diagonal
 * splits the screen into two halves whose fragments are rasterised in separate
 * batches, and the seam costs measurable fill rate for nothing.
 */
export const FULLSCREEN_PRELUDE = `#include <metal_stdlib>
using namespace metal;

struct Varying {
  float4 position [[position]];
  float2 uv;
};

vertex Varying bunkit_fullscreen(uint vid [[vertex_id]]) {
  // (0,0) (2,0) (0,2) in UV, which is (-1,-1) (3,-1) (-1,3) in clip space.
  float2 p = float2((vid << 1) & 2, vid & 2);
  Varying out;
  out.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = float2(p.x, 1.0 - p.y);
  return out;
}
`;

export interface EffectOptions {
  /**
   * Either a whole `fragment` function, or the body of one.
   *
   * A body has `uv`, `src` (texture2d<float>) and `smp` (sampler) in scope and
   * must return a float4.
   */
  fragment: string;
  /** Declarations to put above the fragment function: helpers, structs, constants. */
  header?: string;
  format?: PixelFormatName;
  blend?: BlendMode;
  label?: string;
}

export class Effect {
  readonly pipeline: RenderPipeline;
  readonly source: string;
  readonly label: string;

  constructor(gpu: GPU, o: EffectOptions | string) {
    const options: EffectOptions = typeof o === "string" ? { fragment: o } : o;
    this.label = options.label ?? "effect";
    this.source = buildSource(options);
    this.pipeline = gpu.renderPipeline({
      shader: this.source,
      vertex: "bunkit_fullscreen",
      format: options.format,
      blend: options.blend,
      // A full-screen triangle has no depth to test against, and asking for a
      // depth attachment the pass will not provide is a pipeline mismatch.
      depthFormat: null,
      cull: "none",
      label: this.label,
    });
  }

  /** What this effect can be bound with. Print it when a name will not take. */
  get bindings(): BindingTable {
    return this.pipeline.bindings;
  }
}

function buildSource(o: EffectOptions): string {
  const header = o.header ? `${o.header}\n` : "";
  // A source that declares its own fragment function is used as written; a bare
  // body gets the usual parameters wrapped around it.
  const body = /\bfragment\b/.test(o.fragment)
    ? o.fragment
    : `fragment float4 bunkit_effect(
  Varying vary [[stage_in]],
  texture2d<float> src [[texture(0)]],
  sampler smp [[sampler(0)]]
) {
  float2 uv = vary.uv;
${o.fragment.split("\n").map((l) => (l.trim() ? `  ${l}` : l)).join("\n")}
}`;
  return `${FULLSCREEN_PRELUDE}\n${header}\n${body}\n`;
}

export interface EffectPassOptions {
  /** Where to render. Omit inside a view's frame to mean the drawable. */
  to?: Texture | MTLObject;
  bind?: Record<string, BindValue>;
  /** Clear first, or draw over what is there. Default is to clear to black. */
  clear?: readonly number[] | false;
  label?: string;
}

// ---------------------------------------------------------------------------
// Render targets
// ---------------------------------------------------------------------------

export interface RenderTargetOptions {
  width: number;
  height: number;
  format?: PixelFormatName;
  /** Attach a depth texture too. Default false: most targets are 2D passes. */
  depth?: boolean | PixelFormatName;
  sampleCount?: number;
  label?: string;
}

/**
 * A texture to render into, and the depth buffer that goes with it.
 *
 * Half-resolution targets are the standard trick for blur: a bloom chain at
 * quarter resolution costs a sixteenth of the fill rate and, because it is
 * being blurred anyway, looks the same.
 */
export class RenderTarget {
  color: Texture;
  depth: Texture | null;
  width: number;
  height: number;
  readonly format: PixelFormatName;

  #gpu: GPU;
  #depthFormat: PixelFormatName | null;
  #sampleCount: number;
  #label: string;

  constructor(gpu: GPU, o: RenderTargetOptions) {
    this.#gpu = gpu;
    this.format = o.format ?? "rgba16float";
    this.#depthFormat =
      o.depth === true ? "depth32float" : typeof o.depth === "string" ? o.depth : null;
    this.#sampleCount = o.sampleCount ?? 1;
    this.#label = o.label ?? "target";
    this.width = 0;
    this.height = 0;
    this.color = null as unknown as Texture;
    this.depth = null;
    this.resize(o.width, o.height);
  }

  /** Reallocate if the size changed. Cheap to call every frame. */
  resize(width: number, height: number): this {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.width && h === this.height) return this;
    this.width = w;
    this.height = h;
    this.color = this.#gpu.texture({
      width: w, height: h, format: this.format,
      usage: ["renderTarget", "shaderRead"],
      sampleCount: this.#sampleCount,
      label: this.#label,
    });
    this.depth = this.#depthFormat
      ? this.#gpu.texture({
          width: w, height: h, format: this.#depthFormat,
          usage: ["renderTarget"], sampleCount: this.#sampleCount,
          label: `${this.#label} depth`,
        })
      : null;
    return this;
  }

  /** Scale another size down, for a half- or quarter-resolution chain. */
  static scaled(gpu: GPU, width: number, height: number, factor: number, o: Partial<RenderTargetOptions> = {}) {
    return new RenderTarget(gpu, {
      ...o,
      width: Math.max(1, Math.round(width * factor)),
      height: Math.max(1, Math.round(height * factor)),
    });
  }
}

/**
 * Two targets you alternate between.
 *
 * A separable blur reads one and writes the other, then swaps and does it
 * again in the other axis. Reading and writing the same texture in one pass is
 * undefined, so the pair is not a convenience — it is the correct structure.
 */
export class PingPong {
  front: RenderTarget;
  back: RenderTarget;

  constructor(gpu: GPU, o: RenderTargetOptions) {
    this.front = new RenderTarget(gpu, { ...o, label: `${o.label ?? "pingpong"} a` });
    this.back = new RenderTarget(gpu, { ...o, label: `${o.label ?? "pingpong"} b` });
  }

  swap(): this {
    const t = this.front;
    this.front = this.back;
    this.back = t;
    return this;
  }

  resize(width: number, height: number): this {
    this.front.resize(width, height);
    this.back.resize(width, height);
    return this;
  }
}
