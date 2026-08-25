// Type MSL on the left, watch it on the right.
//
//   bun run examples/shader-playground.ts
//
// The interesting part is how little there is. A shader here is a string and an
// effect is one call, so a live editor is a text view, a GPUView, and a
// recompile on a debounce — no build step to wait on and no pipeline to rebuild
// by hand.
//
// Compile errors are caught and shown with the offending line underneath, which
// is what `gpu().effect()` throws. The last shader that worked keeps rendering
// while you fix the one that does not, because a shader is broken for most of
// the time you spend typing it.

// Metal is macOS-only; fail fast with a clear message elsewhere.
if (process.platform !== "darwin") {
  console.error("bunkit: this example uses Metal and requires macOS.");
  process.exit(1);
}

import {
  Application, GPUView, HStack, Label, Segmented, Spacer, TextArea, VStack, Window,
  gpu, gpuAvailable, struct, vec4f,
} from "bunkit";
import type { Effect } from "bunkit/metal";

const app = new Application({ name: "Shader Playground" });

if (!gpuAvailable()) {
  console.error("no Metal device on this machine");
  process.exit(1);
}

/** What every shader in here gets, whether it uses it or not. */
const Play = struct("Play", {
  /** x seconds, y frame number. */
  time: vec4f,
  /** xy drawable size in pixels, zw its reciprocal. */
  resolution: vec4f,
  /** xy pointer in pixels, z 1 while a button is down. */
  mouse: vec4f,
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: Array<[string, string]> = [
  ["Plasma", `// uv is 0..1 across the view. u.time.x is seconds.
float2 p = (uv - 0.5) * 6.0;
float v = sin(p.x + u.time.x)
        + sin(p.y + u.time.x * 0.7)
        + sin(length(p) * 1.5 - u.time.x * 2.0);
float3 c = 0.5 + 0.5 * cos(float3(0.0, 2.1, 4.2) + v * 1.4);
return float4(c, 1.0);`],

  ["Rings", `float aspect = u.resolution.x / u.resolution.y;
float2 p = (uv - 0.5) * float2(aspect, 1.0) * 2.0;

// Follow the pointer while a button is down.
float2 centre = mix(float2(0.0), (u.mouse.xy / u.resolution.xy - 0.5)
                * float2(aspect, 1.0) * 2.0, u.mouse.z);
float d = length(p - centre);

// fwidth keeps the ring a pixel wide however far the rings are apart.
float ring = abs(fract(d * 6.0 - u.time.x * 0.5) - 0.5);
float line = smoothstep(fwidth(ring) * 1.5, 0.0, ring - 0.06);
float3 tint = 0.5 + 0.5 * cos(float3(0.0, 1.6, 3.2) + d * 3.0 - u.time.x);
return float4(tint * line, 1.0);`],

  ["Raymarch", `// A bouncing sphere over a plane, marched.
float aspect = u.resolution.x / u.resolution.y;
float3 ro = float3(0.0, 1.3, 4.0);
float3 rd = normalize(float3((uv - 0.5) * float2(aspect, -1.0) * 2.0, -1.6));
float3 centre = float3(sin(u.time.x) * 1.3, 1.0 + abs(sin(u.time.x * 1.7)) * 0.5, 0.0);

float t = 0.0;
float3 hit = ro;
bool onSphere = false;
for (int i = 0; i < 96; i++) {
  hit = ro + rd * t;
  float ds = length(hit - centre) - 0.8;
  float dp = hit.y;
  float d = min(ds, dp);
  onSphere = ds < dp;
  if (d < 0.001 || t > 40.0) break;
  t += d;
}
if (t > 40.0) return float4(0.02, 0.02, 0.05, 1.0);

float3 n = onSphere ? normalize(hit - centre) : float3(0.0, 1.0, 0.0);
float3 l = normalize(float3(0.6, 0.8, 0.3));
float light = max(dot(n, l), 0.0);

// A hard shadow: march from the surface towards the light and see what stops.
float shade = 1.0;
if (!onSphere) {
  float3 toLight = hit + n * 0.01;
  for (int i = 0; i < 32; i++) {
    float d = length(toLight - centre) - 0.8;
    if (d < 0.001) { shade = 0.25; break; }
    toLight += l * d;
    if (length(toLight - hit) > 20.0) break;
  }
}

float3 base = onSphere ? float3(0.95, 0.35, 0.2) : float3(0.28, 0.3, 0.38);
return float4(base * (0.12 + light * shade), 1.0);`],

  ["Noise", `// Value noise, four octaves, scrolling.
float2 p = uv * 8.0 + float2(u.time.x * 0.3, u.time.x * 0.1);
float sum = 0.0;
float amp = 0.5;
for (int i = 0; i < 4; i++) {
  float2 f = fract(p);
  float2 c = floor(p);
  float2 s = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(c, float2(12.9898, 78.233))) * 43758.5453);
  float b = fract(sin(dot(c + float2(1, 0), float2(12.9898, 78.233))) * 43758.5453);
  float d = fract(sin(dot(c + float2(0, 1), float2(12.9898, 78.233))) * 43758.5453);
  float e = fract(sin(dot(c + float2(1, 1), float2(12.9898, 78.233))) * 43758.5453);
  sum += amp * mix(mix(a, b, s.x), mix(d, e, s.x), s.y);
  p *= 2.03;
  amp *= 0.5;
}
return float4(float3(0.35, 0.55, 0.95) * sum + sum * sum * 0.5, 1.0);`],
];

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

const preview = new GPUView({ grow: 1, minWidth: 340, depth: false });
const keys = preview.input;

let effect: Effect | null = null;
let compiled = "";

const status = new Label({
  text: "", font: { monospace: true, size: 11 }, textColor: "secondaryLabel", lines: 5,
});

function compile(body: string): void {
  if (body === compiled) return;
  compiled = body;
  try {
    effect = gpu().effect({ uniforms: Play, fragment: body, label: "playground" });
    status.text = "compiled";
    status.textColor = "secondaryLabel";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    status.text = message.split("\n").slice(0, 7).join("\n");
    status.textColor = "systemRed";
  }
}

// Recompile after typing stops. Compiling on every keystroke would mostly be
// compiling half a line and reporting errors about it.
let pending: ReturnType<typeof setTimeout> | null = null;

const editor = new TextArea({
  value: PRESETS[0]![1],
  font: { monospace: true, size: 12 },
  grow: 1,
  minWidth: 360,
  onChange: (value) => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => compile(value), 200);
  },
});

compile(editor.value);

preview.onFrame((frame) => {
  if (!effect) return;
  const { x, y } = keys.mouse;
  const scale = frame.width / Math.max(1, preview.frame.width);
  frame.effect(effect, {
    bind: {
      u: {
        time: [frame.time, frame.index, 0, 0],
        resolution: [frame.width, frame.height, 1 / frame.width, 1 / frame.height],
        // Pointer in drawable pixels, with y already counting from the top.
        mouse: [x * scale, y * scale, keys.button(0) ? 1 : 0, 0],
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const readout = new Label({ text: "", font: { monospace: true, size: 11 }, textColor: "tertiaryLabel" });
let mark = 0;
preview.onFrame((frame) => {
  if (frame.time - mark < 0.5) return;
  mark = frame.time;
  const s = preview.stats;
  readout.text = `${s.fps} fps · ${s.cpuMs.toFixed(2)}ms cpu · ${s.gpuMs.toFixed(2)}ms gpu`;
});

const win = new Window({
  title: "Shader playground",
  size: { width: 1160, height: 700 },
  minSize: { width: 840, height: 500 },
  content: new VStack({ spacing: 10, padding: 14 }, [
    new HStack({ spacing: 10, alignItems: "center" }, [
      new Label({ text: "MSL", font: { style: "title", weight: "semibold" } }),
      new Segmented({
        items: PRESETS.map(([name]) => name),
        selected: 0,
        onChange: (i) => {
          editor.value = PRESETS[i]![1];
          compile(editor.value);
        },
      }),
      new Spacer(),
      readout,
    ]),

    new HStack({ spacing: 12 }, [
      new VStack({ spacing: 8, grow: 1 }, [editor, status]),
      preview,
    ]),
  ]),
});
win.quitOnClose();

await app.run();
