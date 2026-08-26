// A standard library for the fragment shaders you actually end up writing.
//
// Every export is a Snippet: interpolate it into an `msl` template and its
// source lands in the shader, once, with anything it depends on ahead of it.
//
//   import { msl, aces, fbm3, kelvin } from "@omarcos/bunkit/metal";
//
//   const grade = gpu().effect(msl`
//     ${aces}
//     ${kelvin}
//     float3 c = src.sample(smp, uv).rgb * kelvin(3200.0);
//     return float4(aces(c), 1.0);
//   `);
//
// The bias is towards what stage and screen work needs — colour temperature,
// tone mapping, dithering, cone falloff — rather than a general maths dump.

import { snippet, type Snippet } from "./gpu.ts";

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export const hsv2rgb: Snippet = snippet(
  "hsv2rgb",
  `
float3 hsv2rgb(float3 c) {
  float3 p = abs(fract(c.xxx + float3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(float3(1.0), saturate(p - 1.0), c.y);
}`,
);

export const rgb2hsv: Snippet = snippet(
  "rgb2hsv",
  `
float3 rgb2hsv(float3 c) {
  float4 K = float4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  float4 p = mix(float4(c.bg, K.wz), float4(c.gb, K.xy), step(c.b, c.g));
  float4 q = mix(float4(p.xyw, c.r), float4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return float3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}`,
);

export const luminance: Snippet = snippet(
  "luminance",
  `
// Rec. 709 weights: what the eye actually reads as brightness.
float luminance(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }`,
);

export const srgb: Snippet = snippet(
  "srgb",
  `
float3 toSRGB(float3 c) { return pow(max(c, 0.0), float3(1.0 / 2.2)); }
float3 toLinear(float3 c) { return pow(max(c, 0.0), float3(2.2)); }`,
);

/**
 * ACES filmic tone mapping.
 *
 * The reason a bloom pass does not turn white: HDR values above 1 have to come
 * back into range somehow, and clamping flattens every highlight to the same
 * flat white. This rolls them off instead.
 */
export const aces: Snippet = snippet(
  "aces",
  `
float3 aces(float3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}`,
);

/**
 * Colour temperature in kelvin as linear RGB, normalised to 1.0 at the peak.
 *
 * Stage fixtures are specified this way — a 3200 K tungsten wash against a
 * 6500 K white — and mixing the gels by hand never quite looks right.
 */
export const kelvin: Snippet = snippet(
  "kelvin",
  `
float3 kelvin(float t) {
  t = clamp(t, 1000.0, 40000.0) / 100.0;
  float r = t <= 66.0 ? 255.0 : 329.698727446 * pow(t - 60.0, -0.1332047592);
  float g = t <= 66.0 ? 99.4708025861 * log(t) - 161.1195681661
                      : 288.1221695283 * pow(t - 60.0, -0.0755148492);
  float b = t >= 66.0 ? 255.0 : (t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 305.0447927307);
  return saturate(float3(r, g, b) / 255.0);
}`,
);

/**
 * Ordered dither, ±1/255 of noise on an 8-bit output.
 *
 * A dark gradient across a large area bands visibly on any 8-bit display. This
 * costs nothing and removes it; apply just before writing the final colour.
 */
export const dither: Snippet = snippet(
  "dither",
  `
float bayer4(float2 pixel) {
  const float m[16] = { 0.0,  8.0,  2.0, 10.0,
                       12.0,  4.0, 14.0,  6.0,
                        3.0, 11.0,  1.0,  9.0,
                       15.0,  7.0, 13.0,  5.0 };
  uint2 p = uint2(pixel) & 3;
  return m[p.y * 4 + p.x] / 16.0 - 0.5;
}
float3 dither(float3 c, float2 pixel) { return c + bayer4(pixel) / 255.0; }`,
);

// ---------------------------------------------------------------------------
// Hashing and noise
// ---------------------------------------------------------------------------

export const hash: Snippet = snippet(
  "hash",
  `
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}
float hash21(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash31(float3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}`,
);

export const noise2: Snippet = snippet(
  "noise2",
  `
float noise2(float2 p) {
  float2 i = floor(p), f = fract(p);
  // Smoothstep the interpolant, or the lattice shows through as a grid.
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + float2(1, 0)), u.x),
             mix(hash21(i + float2(0, 1)), hash21(i + float2(1, 1)), u.x), u.y);
}`,
  [hash],
);

export const noise3: Snippet = snippet(
  "noise3",
  `
float noise3(float3 p) {
  float3 i = floor(p), f = fract(p);
  float3 u = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i), n100 = hash31(i + float3(1, 0, 0));
  float n010 = hash31(i + float3(0, 1, 0)), n110 = hash31(i + float3(1, 1, 0));
  float n001 = hash31(i + float3(0, 0, 1)), n101 = hash31(i + float3(1, 0, 1));
  float n011 = hash31(i + float3(0, 1, 1)), n111 = hash31(i + float3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}`,
  [hash],
);

/** Fractal noise: octaves at doubling frequency and halving amplitude. */
export const fbm2: Snippet = snippet(
  "fbm2",
  `
float fbm2(float2 p, int octaves) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < octaves; i++) { sum += amp * noise2(p); p *= 2.02; amp *= 0.5; }
  return sum;
}`,
  [noise2],
);

export const fbm3: Snippet = snippet(
  "fbm3",
  `
float fbm3(float3 p, int octaves) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < octaves; i++) { sum += amp * noise3(p); p *= 2.02; amp *= 0.5; }
  return sum;
}`,
  [noise3],
);

// ---------------------------------------------------------------------------
// Shapes and space
// ---------------------------------------------------------------------------

/** Signed distance functions, for raymarching and for soft masks in 2D. */
export const sdf: Snippet = snippet(
  "sdf",
  `
float sdSphere(float3 p, float r) { return length(p) - r; }
float sdBox(float3 p, float3 b) {
  float3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}
float sdCapsule(float3 p, float3 a, float3 b, float r) {
  float3 pa = p - a, ba = b - a;
  float h = saturate(dot(pa, ba) / dot(ba, ba));
  return length(pa - ba * h) - r;
}
float sdPlane(float3 p, float3 n, float h) { return dot(p, n) + h; }
float opUnion(float a, float b) { return min(a, b); }
float opSubtract(float a, float b) { return max(-a, b); }
float opIntersect(float a, float b) { return max(a, b); }
float opSmoothUnion(float a, float b, float k) {
  float h = saturate(0.5 + 0.5 * (b - a) / k);
  return mix(b, a, h) - k * h * (1.0 - h);
}`,
);

export const rotate: Snippet = snippet(
  "rotate",
  `
float2x2 rot2(float a) { float s = sin(a), c = cos(a); return float2x2(c, s, -s, c); }
// Rodrigues: rotate v about a unit axis by an angle, without building a matrix.
float3 rotateAxis(float3 v, float3 axis, float angle) {
  float s = sin(angle), c = cos(angle);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}`,
);

export const remap: Snippet = snippet(
  "remap",
  `
float remap(float x, float a, float b, float c, float d) {
  return c + (saturate((x - a) / (b - a))) * (d - c);
}
float3 saturate3(float3 c) { return clamp(c, 0.0, 1.0); }`,
);

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

export const lighting: Snippet = snippet(
  "lighting",
  `
float lambert(float3 n, float3 l) { return max(dot(n, l), 0.0); }
float blinnPhong(float3 n, float3 l, float3 v, float shininess) {
  float3 h = normalize(l + v);
  return pow(max(dot(n, h), 0.0), shininess) * step(0.0001, dot(n, l));
}
// Schlick: the rim brightening that makes a surface read as a surface.
float fresnel(float3 n, float3 v, float power) {
  return pow(1.0 - saturate(dot(n, v)), power);
}
// Inverse-square with a soft floor, so a fixture at distance 0 is not infinite.
float attenuate(float distance, float radius) {
  float d = distance / max(radius, 1e-4);
  return 1.0 / (1.0 + d * d);
}`,
);

/**
 * How much a spotlight cone contributes along a view ray.
 *
 * `coneMask` is the hard question — is this point inside the cone, and how
 * close to the edge — and `beam` is the volumetric one: how much haze the ray
 * lit on its way past. Together they are a stage light with a visible shaft.
 */
export const beam: Snippet = snippet(
  "beam",
  `
float coneMask(float3 p, float3 apex, float3 dir, float cosAngle, float softness) {
  float3 toPoint = p - apex;
  float d = length(toPoint);
  if (d < 1e-5) return 1.0;
  float alignment = dot(toPoint / d, dir);
  return smoothstep(cosAngle, mix(cosAngle, 1.0, softness), alignment);
}

// March the ray and accumulate haze inside the cone. Steps are cheap; this is
// the one place where more of them visibly buys quality.
float beamScatter(float3 origin, float3 ray, float maxDistance,
                  float3 apex, float3 dir, float cosAngle, float softness,
                  float radius, int steps, float jitter) {
  float sum = 0.0;
  float dt = maxDistance / float(steps);
  // Offsetting each ray's start by a fraction of a step turns the banding you
  // would otherwise get into noise, which reads as haze.
  float t = dt * jitter;
  for (int i = 0; i < steps; i++, t += dt) {
    float3 p = origin + ray * t;
    sum += coneMask(p, apex, dir, cosAngle, softness) * attenuate(length(p - apex), radius);
  }
  return sum * dt;
}`,
  [lighting],
);

// ---------------------------------------------------------------------------
// Ready-made effects
// ---------------------------------------------------------------------------

/**
 * Everything above, for a shader that would rather not list what it uses.
 *
 * Interpolating this compiles roughly 200 lines of MSL that the optimiser then
 * throws away unused, which costs compile time once and nothing per frame.
 */
export const stdlib: Snippet = snippet("stdlib", "// bunkit stdlib", [
  hsv2rgb,
  rgb2hsv,
  luminance,
  srgb,
  aces,
  kelvin,
  dither,
  hash,
  noise2,
  noise3,
  fbm2,
  fbm3,
  sdf,
  rotate,
  remap,
  lighting,
  beam,
]);

/** A separable Gaussian blur in one axis. Run it twice, once per axis. */
export const BLUR_FRAGMENT = `
constant float WEIGHTS[5] = { 0.227027, 0.194594, 0.121621, 0.054054, 0.016216 };

fragment float4 bunkit_blur(
  Varying vary [[stage_in]],
  texture2d<float> src [[texture(0)]],
  sampler smp [[sampler(0)]],
  constant float2 &direction [[buffer(0)]]
) {
  float2 texel = direction / float2(src.get_width(), src.get_height());
  float3 sum = src.sample(smp, vary.uv).rgb * WEIGHTS[0];
  for (int i = 1; i < 5; i++) {
    sum += src.sample(smp, vary.uv + texel * float(i)).rgb * WEIGHTS[i];
    sum += src.sample(smp, vary.uv - texel * float(i)).rgb * WEIGHTS[i];
  }
  return float4(sum, 1.0);
}`;

/** Keep only what is brighter than a threshold, for the bloom chain's first pass. */
export const BRIGHT_PASS_FRAGMENT = `
fragment float4 bunkit_bright(
  Varying vary [[stage_in]],
  texture2d<float> src [[texture(0)]],
  sampler smp [[sampler(0)]],
  constant float2 &params [[buffer(0)]]   // threshold, knee
) {
  float3 c = src.sample(smp, vary.uv).rgb;
  float l = luminance(c);
  // A soft knee, so a surface drifting past the threshold fades in rather than
  // popping. Hard thresholds flicker on anything that moves.
  float contribution = smoothstep(params.x, params.x + max(params.y, 1e-4), l);
  return float4(c * contribution, 1.0);
}`;
