// Bloom, and the HDR scene buffer it needs, as one object.
//
// Bloom is the difference between a light that is a bright shape and a light
// that looks like it is emitting. Doing it properly is five passes and three
// render targets, which is enough bookkeeping that people skip it:
//
//   const post = gpu().bloom({ intensity: 0.9 });
//
//   view.onFrame((frame) => {
//     post.resize(frame.width, frame.height);
//     frame.render({ target: post.scene, clear: background }, (pass) => { ... });
//     post.apply(frame);
//   });
//
// `post.scene` is 16-bit float, so a fixture can be emissive at 8.0 and stay
// 8.0 all the way to the tone mapper instead of clipping to white in the first
// pass. That headroom is what bloom is reading.

import type { GPU, MTLObject, Texture } from "./gpu.ts";
import type { Effect, RenderTarget, PingPong } from "./effects.ts";
import type { Frame } from "./frame.ts";
import { BLUR_FRAGMENT, BRIGHT_PASS_FRAGMENT, aces, dither, luminance } from "./shaders.ts";
import { msl } from "./gpu.ts";

export interface BloomOptions {
  /** Luminance a pixel must pass to bloom at all. Above 1.0 with HDR input. */
  threshold?: number;
  /** Width of the fade in around the threshold. Hard edges flicker. */
  knee?: number;
  /** How much of the blurred result is added back. */
  intensity?: number;
  /** Resolution of the blur chain, as a fraction. 0.5 is the usual choice. */
  scale?: number;
  /** Horizontal+vertical blur rounds. More is wider and softer, not brighter. */
  passes?: number;
  /** Exposure applied before tone mapping. */
  exposure?: number;
  /** Pixel format of the final output. Match what you are drawing into. */
  outputFormat?: "bgra8unorm" | "rgba8unorm" | "rgba16float";
  /** Tone map and dither on composite. Off if you are grading downstream. */
  tonemap?: boolean;
}

export class Bloom {
  /** Render your frame into this. 16-bit float, with depth. */
  readonly scene: RenderTarget;
  threshold: number;
  knee: number;
  intensity: number;
  exposure: number;

  #gpu: GPU;
  #chain: PingPong;
  #scale: number;
  #passes: number;
  #bright: Effect;
  #blur: Effect;
  #composite: Effect;

  constructor(gpu: GPU, o: BloomOptions = {}) {
    this.#gpu = gpu;
    this.threshold = o.threshold ?? 1;
    this.knee = o.knee ?? 0.5;
    this.intensity = o.intensity ?? 0.8;
    this.exposure = o.exposure ?? 1;
    this.#scale = o.scale ?? 0.5;
    this.#passes = Math.max(1, o.passes ?? 2);

    this.scene = gpu.target({ width: 16, height: 16, format: "rgba16float", depth: true, label: "hdr scene" });
    this.#chain = gpu.pingPong({ width: 8, height: 8, format: "rgba16float", label: "bloom" });

    this.#bright = gpu.effect({
      fragment: msl`${luminance}\n${BRIGHT_PASS_FRAGMENT}`,
      format: "rgba16float",
      label: "bloom bright",
    });
    this.#blur = gpu.effect({
      fragment: BLUR_FRAGMENT,
      format: "rgba16float",
      label: "bloom blur",
    });

    const tonemap = o.tonemap ?? true;
    this.#composite = gpu.effect({
      fragment: msl`
${aces}
${dither}

fragment float4 bunkit_composite(
  Varying vary [[stage_in]],
  texture2d<float> src [[texture(0)]],
  texture2d<float> bloomTexture [[texture(1)]],
  sampler smp [[sampler(0)]],
  constant float2 &params [[buffer(0)]]   // intensity, exposure
) {
  float3 colour = src.sample(smp, vary.uv).rgb;
  colour += bloomTexture.sample(smp, vary.uv).rgb * params.x;
  colour *= params.y;
${tonemap ? "  colour = aces(colour);\n  colour = dither(colour, vary.position.xy);" : ""}
  return float4(colour, 1.0);
}`,
      format: o.outputFormat ?? "bgra8unorm",
      label: "bloom composite",
    });
  }

  /** Size every target to the frame. Cheap when nothing changed. */
  resize(width: number, height: number): this {
    this.scene.resize(width, height);
    this.#chain.resize(Math.max(1, width * this.#scale), Math.max(1, height * this.#scale));
    return this;
  }

  /**
   * Extract, blur and composite onto `to`.
   *
   * With no `to`, it writes to whatever the view gave the frame — which is the
   * drawable, and is what you want at the end of a frame.
   */
  apply(frame: Frame, to?: Texture | MTLObject): this {
    frame.effect(this.#bright, {
      to: this.#chain.front.color,
      bind: { src: this.scene.color, params: [this.threshold, this.knee] },
    });

    for (let i = 0; i < this.#passes; i++) {
      // Horizontal then vertical: two 1D blurs cost 2n samples where one 2D
      // blur of the same radius costs n².
      for (const direction of [[1, 0], [0, 1]]) {
        this.#chain.swap();
        frame.effect(this.#blur, {
          to: this.#chain.front.color,
          bind: { src: this.#chain.back.color, direction },
        });
      }
    }

    const target = to ?? (frame as unknown as { colorTexture?: MTLObject }).colorTexture;
    if (!target) throw new Error("bloom.apply needs somewhere to composite: pass a texture");
    frame.effect(this.#composite, {
      to: target,
      bind: {
        src: this.scene.color,
        bloomTexture: this.#chain.front.color,
        params: [this.intensity, this.exposure],
      },
    });
    return this;
  }

  /** The blurred highlights, if you want to look at what bloom is seeing. */
  get bloomTexture(): Texture {
    return this.#chain.front.color;
  }
}
