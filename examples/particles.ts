// A quarter of a million particles, simulated on the GPU.
//
//   bun run examples/particles.ts
//
// The point of this one is where the work happens. Per frame, JavaScript writes
// two uniform structs — 128 bytes between them — and issues a compute dispatch,
// one draw, and the bloom chain. The compute pass and the draw share a command
// buffer, so the draw reads what the kernel just wrote without a CPU wait.
//
// Measured on an M2 Pro at 2000x1384: 0.5ms of JavaScript and 3.2ms of GPU.
// Nothing is read back, nothing is uploaded, and the particle count does not
// appear anywhere in the per-frame JavaScript — turning 250,000 into 1,000,000
// is a number in the constructor and costs the GPU, not the loop.

// Metal is macOS-only; fail fast with a clear message elsewhere.
if (process.platform !== "darwin") {
  console.error("bunkit: this example uses Metal and requires macOS.");
  process.exit(1);
}

import {
  Application, Checkbox, HStack, Label, Segmented, Slider, Spacer, VStack, Window,
  GPUView, gpu, gpuAvailable, msl, struct, f32, u32, vec4f,
} from "@omarcos/bunkit";

const app = new Application({ name: "Particles" });

if (!gpuAvailable()) {
  console.error("no Metal device on this machine");
  process.exit(1);
}

const COUNT = 250_000;
const g = gpu();

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** One declaration, used by the buffer, the kernel and the vertex shader. */
const Particle = struct("Particle", {
  /** xyz position, w age in seconds. */
  position: vec4f,
  /** xyz velocity, w lifespan. */
  velocity: vec4f,
  /** rgb tint, a unused. */
  color: vec4f,
});

const Sim = struct("Sim", {
  /** x seconds, y delta, zw unused. */
  time: vec4f,
  /** xyz attractor position, w its strength. */
  attractor: vec4f,
  count: u32,
  turbulence: f32,
  drag: f32,
  gravity: f32,
});

const particles = g.array(Particle, COUNT, { label: "particles" });
const sim = g.buffer(Sim, { label: "sim" });

// Seeded once, on the CPU, straight into shared memory. 250,000 structs takes
// about 40ms here — the only time this data is touched from JavaScript.
{
  const start = performance.now();
  for (let i = 0; i < COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.cbrt(Math.random()) * 6;
    const y = (Math.random() - 0.5) * 2;
    const hue = i / COUNT;
    particles.set(i, {
      position: [Math.cos(a) * r, y, Math.sin(a) * r, Math.random() * 6],
      velocity: [0, 0, 0, 4 + Math.random() * 5],
      color: [
        0.5 + 0.5 * Math.cos(hue * 6.28),
        0.5 + 0.5 * Math.cos(hue * 6.28 + 2.1),
        0.5 + 0.5 * Math.cos(hue * 6.28 + 4.2),
        1,
      ],
    });
  }
  particles.count = COUNT;
  console.log(`seeded ${COUNT} particles in ${(performance.now() - start).toFixed(0)}ms`);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

const simulate = g.kernel(msl`
#include <metal_stdlib>
using namespace metal;

${Particle}

${Sim}

// Cheap 3D hash, enough to look like curl noise without costing like it.
static float3 hash3(float3 p) {
  p = float3(dot(p, float3(127.1, 311.7, 74.7)),
             dot(p, float3(269.5, 183.3, 246.1)),
             dot(p, float3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
}

static float3 curl(float3 p) {
  float3 a = hash3(floor(p));
  float3 b = hash3(floor(p) + 1.0);
  float3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return normalize(mix(a, b, f) + 1e-6);
}

kernel void simulate(
  device Particle *particles [[buffer(0)]],
  constant Sim &sim [[buffer(1)]],
  uint i [[thread_position_in_grid]]
) {
  // The last threadgroup runs past the end of the buffer; this is what keeps
  // it from writing outside it.
  if (i >= sim.count) return;

  Particle p = particles[i];
  float dt = sim.time.y;

  float3 position = p.position.xyz;
  float3 velocity = p.velocity.xyz;

  // Pulled towards the attractor, but never harder than a cap — inverse square
  // goes to infinity at zero distance and throws particles off the screen.
  float3 toCentre = sim.attractor.xyz - position;
  float distance = max(length(toCentre), 0.35);
  velocity += (toCentre / distance) * (sim.attractor.w / (distance * distance)) * dt;

  velocity += curl(position * 0.35 + sim.time.x * 0.12) * sim.turbulence * dt;
  velocity.y -= sim.gravity * dt;
  velocity *= 1.0 - saturate(sim.drag * dt);

  position += velocity * dt;

  // Age out and respawn, so the field keeps its shape instead of dispersing.
  float age = p.position.w + dt;
  if (age > p.velocity.w) {
    float3 seed = hash3(float3(float(i), sim.time.x, 1.0));
    float angle = seed.x * 3.14159 * 2.0;
    float radius = (seed.y * 0.5 + 0.5) * 6.0;
    position = float3(cos(angle) * radius, seed.z * 1.5, sin(angle) * radius);
    velocity = float3(0.0);
    age = 0.0;
  }

  particles[i].position = float4(position, age);
  particles[i].velocity = float4(velocity, p.velocity.w);
}`);

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// The view-projection matrix is built on the CPU and passed as four columns.
// A mat4x4f schema would do the same thing; four float4s keeps this example's
// uniform block readable next to the shader that reads it.
const View = struct("View", {
  c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f,
  /** x point size in pixels, y brightness. */
  style: vec4f,
});
const view = g.buffer(View, { label: "view" });

const pipeline = g.renderPipeline({
  shader: msl`
#include <metal_stdlib>
using namespace metal;

${Particle}

${View}

struct Fragment {
  float4 position [[position]];
  float size [[point_size]];
  float4 color;
};

vertex Fragment particle_vertex(
  uint vid [[vertex_id]],
  device const Particle *particles [[buffer(0)]],
  constant View &view [[buffer(1)]]
) {
  Particle p = particles[vid];
  float4x4 viewProjection = float4x4(view.c0, view.c1, view.c2, view.c3);

  Fragment out;
  out.position = viewProjection * float4(p.position.xyz, 1.0);
  // Nearer particles are bigger, and the perspective divide is already in w.
  out.size = clamp(view.style.x / max(out.position.w, 0.1), 1.0, 24.0);

  // Fade in at birth and out at death, so respawns do not pop.
  float life = p.position.w / max(p.velocity.w, 0.001);
  float fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.75, 1.0, life));
  out.color = float4(p.color.rgb * view.style.y * fade, 1.0);
  return out;
}

fragment float4 particle_fragment(Fragment in [[stage_in]], float2 uv [[point_coord]]) {
  // A round, soft dot. Additive blending makes the overlaps do the work.
  float d = length(uv - 0.5) * 2.0;
  float falloff = pow(saturate(1.0 - d), 2.5);
  if (falloff <= 0.0) discard_fragment();
  return float4(in.color.rgb * falloff, 1.0);
}`,
  format: "rgba16float",
  depthFormat: null,
  blend: "additive",
  cull: "none",
  label: "particles",
});

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

const surface = new GPUView({ grow: 1, minHeight: 380, depth: false });
const keys = surface.input;
const bloom = g.bloom({ threshold: 0.7, knee: 0.4, intensity: 0.9, passes: 3, exposure: 1.0 });

let turbulence = 2.2;
let strength = 26;
let gravity = 0;
let pointSize = 320;
let brightness = 0.55;
let orbiting = true;
let angle = 0.6;

/** Column-major view-projection, rebuilt each frame. */
function viewProjection(aspect: number, time: number): number[][] {
  const eye = orbiting
    ? [Math.cos(angle) * 15, 5.5 + Math.sin(time * 0.21) * 2.4, Math.sin(angle) * 15]
    : [0, 4, 15];

  const f = normalise([-eye[0]!, -eye[1]!, -eye[2]!]);
  const s = normalise(cross(f, [0, 1, 0]));
  const u = cross(s, f);

  const near = 0.1;
  const far = 120;
  const fov = (58 * Math.PI) / 180;
  const t = 1 / Math.tan(fov / 2);

  // projection * view, multiplied out. Metal's clip space runs 0..1 in depth,
  // not -1..1, which is the -far/(far-near) rather than the GL form.
  const p = [t / aspect, t, far / (near - far), (far * near) / (near - far)];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

  return [
    [s[0]! * p[0]!, u[0]! * p[1]!, -f[0]! * p[2]!, -f[0]!],
    [s[1]! * p[0]!, u[1]! * p[1]!, -f[1]! * p[2]!, -f[1]!],
    [s[2]! * p[0]!, u[2]! * p[1]!, -f[2]! * p[2]!, -f[2]!],
    [-dot(s, eye) * p[0]!, -dot(u, eye) * p[1]!, dot(f, eye) * p[2]! + p[3]!, dot(f, eye)],
  ];
}

const normalise = (v: number[]) => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
};
const cross = (a: number[], b: number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

surface.onFrame((frame) => {
  const dt = Math.min(frame.dt, 1 / 30);
  if (orbiting) angle += dt * 0.16;

  // The attractor follows the pointer across the ground plane while a button is
  // held, and sits at the origin otherwise.
  const { x, y, inside } = keys.mouse;
  const dragging = keys.button(0) && inside;
  const attractor = dragging
    ? [
        ((x / Math.max(1, surface.frame.width)) - 0.5) * 16,
        (0.5 - y / Math.max(1, surface.frame.height)) * 10,
        0,
      ]
    : [0, 0, 0];

  sim.write({
    time: [frame.time, dt, 0, 0],
    attractor: [attractor[0]!, attractor[1]!, attractor[2]!, strength],
    count: COUNT,
    turbulence,
    drag: 0.85,
    gravity,
  });

  const columns = viewProjection(frame.width / Math.max(1, frame.height), frame.time);
  view.write({
    c0: columns[0]!, c1: columns[1]!, c2: columns[2]!, c3: columns[3]!,
    style: [pointSize, brightness, 0, 0],
  });

  bloom.resize(frame.width, frame.height);

  // Both in one command buffer: the draw reads what the compute pass wrote, and
  // the GPU orders them. No fence, no readback, no wait on the CPU.
  frame.dispatch(simulate, COUNT, { particles, sim });
  frame.render({ target: bloom.scene, clear: [0.01, 0.01, 0.03, 1], label: "particles" }, (pass) => {
    pass.pipeline(pipeline).bind({ particles, view }).draw(COUNT, { primitive: "point" });
  });
  bloom.apply(frame);
});

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const readout = new Label({ text: "", font: { monospace: true, size: 11 }, textColor: "secondaryLabel" });
let mark = 0;
surface.onFrame((frame) => {
  if (frame.time - mark < 0.5) return;
  mark = frame.time;
  const s = surface.stats;
  readout.text =
    `${s.fps} fps · ${(COUNT / 1000).toFixed(0)}k particles · ` +
    `cpu ${s.cpuMs.toFixed(2)}ms · gpu ${s.gpuMs.toFixed(2)}ms`;
});

const win = new Window({
  title: "Particles",
  size: { width: 1060, height: 720 },
  minSize: { width: 760, height: 520 },
  content: new VStack({ spacing: 12, padding: 16 }, [
    new HStack({ spacing: 10, alignItems: "center" }, [
      new Label({ text: "Compute", font: { style: "title", weight: "semibold" } }),
      new Label({ text: "drag inside the view to pull them around", textColor: "tertiaryLabel" }),
      new Spacer(),
      readout,
    ]),

    surface,

    new HStack({ spacing: 14, alignItems: "center" }, [
      new Label({ text: "Pull", width: 32 }),
      new Slider({ min: -40, max: 90, value: strength, width: 130, onChange: (v) => { strength = v; } }),
      new Label({ text: "Swirl", width: 40 }),
      new Slider({ min: 0, max: 8, value: turbulence, width: 110, onChange: (v) => { turbulence = v; } }),
      new Label({ text: "Glow", width: 38 }),
      new Slider({ min: 0.05, max: 1.6, value: brightness, grow: 1, onChange: (v) => { brightness = v; } }),
      new Segmented({
        items: ["Float", "Fall"],
        selected: 0,
        onChange: (i) => { gravity = i === 0 ? 0 : 6; },
      }),
      new Checkbox({ title: "Orbit", checked: true, onChange: (on) => { orbiting = on; } }),
    ]),
  ]),
});
win.quitOnClose();

await app.run();
