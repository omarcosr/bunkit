// A stage lighting rig, animated live, in a resizable macOS window.
//
//   bun run examples/lighting-rig.ts
//
// Twenty-four moving-head fixtures on two trusses. Each one is a yoke, a head,
// a volumetric beam and a pool of light on the floor, all following a set of
// cues that advance on a musical beat. It runs at the display's refresh with
// the whole rig re-aimed from JavaScript every frame.
//
// Hold the right mouse button to look around and fly with WASD, which is the
// part that makes this feel like something you could build a game in: the
// camera is read from held keys inside the frame callback, not from events.
//
// What makes that affordable is that the number of draw calls does not depend
// on the number of fixtures. Everything is instanced: 24 heads are one draw,
// 24 beams are one draw, 24 pools are one draw. Adding a hundred more fixtures
// changes the per-frame cost by the memory bandwidth of writing a hundred more
// 160-byte structs, which is nothing, and by no draw calls at all.

import {
  Application, Checkbox, HStack, Label, Segmented, Slider, Spacer, VStack, Window,
} from "bunkit";
import {
  Scene3D, box, cone, cylinder, plane, sphere, material, emissive,
  gpuAvailable, kelvin, noise2, type Node,
} from "bunkit/metal";

const app = new Application({ name: "Lighting Rig" });

if (!gpuAvailable()) {
  console.error("no Metal device on this machine");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

const scene = new Scene3D({
  grow: 1,
  minHeight: 360,
  background: "#04040a",
  sampleCount: 4,
  camera: { position: [0, 9.5, 18], target: [0, 2.2, -0.5], fov: 52 },
  light: { direction: [0, 1, 0.2], intensity: 0.12, ambient: "#243044", ambientIntensity: 0.22 },
  // HDR, so a beam can sit at 6.0 and still have somewhere to go.
  bloom: { threshold: 0.85, knee: 0.5, intensity: 0.85, passes: 3, exposure: 1.05 },
});

// --- materials ---------------------------------------------------------------

/**
 * The beam. A cone, drawn additively, fading out along its length and towards
 * its centre so the silhouette is an edge rather than a wall.
 *
 * `in.uv.y` runs 0 at the apex to 1 at the mouth — that is what cylinderGeometry
 * lays down — and `params.x` is the fixture's dimmer.
 */
const beamMaterial = material({
  label: "beam",
  blend: "additive",
  depthWrite: false,
  cull: "none",
  use: [noise2],
  fragment: `
    float dimmer = params.x;
    if (dimmer <= 0.001) discard_fragment();

    // Bright at the fixture, gone by the floor.
    float along = 1.0 - in.uv.y;
    float fade = along * along;

    // Facing away from the viewer means looking through more of the cone, so
    // the rim reads brighter than the middle. Without this it looks like a
    // solid cone rather than a volume.
    float3 viewDir = normalize(u.eye.xyz - in.worldPosition);
    float rim = 1.0 - abs(dot(normalize(in.worldNormal), viewDir));
    rim = pow(rim, 1.6);

    // Haze drifting through the beam.
    float haze = 0.82 + 0.18 * noise2(float2(in.uv.x * 6.0, in.uv.y * 3.0 - u.time.x * 0.55));

    float strength = fade * rim * haze * dimmer * 2.4;
    return float4(in.color.rgb * strength, 1.0);
  `,
});

/** The pool the beam lands in: a soft-edged disc that fades from the centre. */
const poolMaterial = material({
  label: "pool",
  blend: "additive",
  depthWrite: false,
  cull: "none",
  fragment: `
    float d = distance(in.uv, float2(0.5)) * 2.0;
    float falloff = pow(saturate(1.0 - d), 2.2);
    return float4(in.color.rgb * falloff * params.x * 1.7, 1.0);
  `,
});

/** The lens: bright enough that bloom finds it, dimmed by the fixture's level. */
const lensMaterial = emissive({ intensity: 7 });

/** Warm practicals along the back wall, so the stage is not lit only by beams. */
const practicalMaterial = material({
  label: "practical",
  blend: "additive",
  depthWrite: false,
  use: [kelvin],
  fragment: `
    return float4(kelvin(2700.0) * params.x * 2.6, 1.0);
  `,
});

const bodyMaterial = material({
  label: "fixture body",
  fragment: `
    // Slightly metallic: a tighter, brighter specular than the default.
    float3 n = normalize(in.worldNormal);
    float3 v = normalize(u.eye.xyz - in.worldPosition);
    float3 l = normalize(u.lightDirection.xyz);
    float spec = pow(max(dot(n, normalize(l + v)), 0.0), 96.0) * 0.5;
    float rim = pow(1.0 - saturate(dot(n, v)), 3.0) * 0.14;
    float diffuse = max(dot(n, l), 0.0) * 0.5 + 0.5;
    return float4(in.color.rgb * diffuse * u.ambient.rgb * 3.0 + spec + rim, 1.0);
  `,
});

// --- the room ----------------------------------------------------------------

scene.add(plane({ size: 60, color: "#0a0a10" }));

// Two trusses. Segments are shared geometry, so the whole rig is one draw.
const TRUSS_Y = 8.4;
for (const z of [-3.4, 3.4]) {
  for (let i = -7; i <= 7; i++) {
    scene.add(cylinder({
      radius: 0.09, height: 1.9, segments: 8,
      position: [i * 1.9, TRUSS_Y, z], rotation: [0, 0, Math.PI / 2],
      color: "#3a3f4a", material: bodyMaterial,
    }));
  }
  for (const y of [TRUSS_Y - 0.42, TRUSS_Y + 0.42]) {
    for (let i = -7; i <= 7; i++) {
      scene.add(cylinder({
        radius: 0.05, height: 1.9, segments: 6,
        position: [i * 1.9, y, z], rotation: [0, 0, Math.PI / 2],
        color: "#2e323c", material: bodyMaterial,
      }));
    }
  }
}

// Warm practicals on the back wall.
const practicals = Array.from({ length: 9 }, (_, i) =>
  scene.add(sphere({
    radius: 0.16, segments: 10, rings: 6,
    position: [(i - 4) * 3.0, 1.2, -9.6],
    color: "#ffffff", material: practicalMaterial,
  })),
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BEAM_LENGTH = 13;

interface Fixture {
  index: number;
  home: { x: number; y: number; z: number };
  yoke: Node;
  head: Node;
  lens: Node;
  beam: Node;
  pool: Node;
  /** Where the beam is aimed, in world space. Interpolated towards the cue. */
  aim: { x: number; y: number; z: number };
  hue: number;
  dimmer: number;
}

const fixtures: Fixture[] = [];
let index = 0;
for (const z of [-3.4, 3.4]) {
  for (let i = 0; i < 12; i++) {
    const x = (i - 5.5) * 2.28;
    const home = { x, y: TRUSS_Y - 0.55, z };

    const yoke = scene.add(box({
      size: [0.42, 0.34, 0.42], position: [home.x, home.y + 0.28, home.z],
      color: "#414652", material: bodyMaterial,
    }));
    const head = scene.add(cylinder({
      radius: 0.23, top: 0.19, height: 0.62, segments: 14,
      position: [home.x, home.y, home.z], color: "#4a505d", material: bodyMaterial,
    }));
    const lens = scene.add(cylinder({
      radius: 0.19, height: 0.06, segments: 14,
      position: [home.x, home.y - 0.3, home.z], color: "#ffffff", material: lensMaterial,
    }));
    // The cone's apex is at the node's position, which is the lens.
    const beam = scene.add(cone({
      radius: 1.15, height: BEAM_LENGTH, segments: 22, caps: false,
      position: [home.x, home.y - 0.32, home.z], color: "#ffffff", material: beamMaterial,
    }));
    const pool = scene.add(plane({
      size: 2.6, position: [x, 0.02, 0], color: "#ffffff", material: poolMaterial,
    }));

    fixtures.push({
      index: index++, home, yoke, head, lens, beam, pool,
      aim: { x, y: 0, z: 0 }, hue: 0, dimmer: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Cues
// ---------------------------------------------------------------------------

type Cue = (f: Fixture, time: number, beat: number) => { x: number; y: number; z: number };

const CUES: Record<string, Cue> = {
  // Every head sweeping in step, the pools crossing the stage together.
  sweep: (f, time) => ({
    x: Math.sin(time * 0.9 + f.home.z * 0.35) * 7.5,
    y: 0,
    z: Math.cos(time * 0.62) * 3.2,
  }),
  // A travelling wave down the truss.
  wave: (f, time) => ({
    x: f.home.x * 0.55 + Math.sin(time * 1.5 - f.index * 0.42) * 3.6,
    y: 0,
    z: Math.sin(time * 0.8 - f.index * 0.3) * 4.0,
  }),
  // Everything converging on one point that drifts.
  focus: (_f, time) => ({
    x: Math.sin(time * 0.55) * 4.2,
    y: 0,
    z: Math.cos(time * 0.42) * 2.4,
  }),
  // Fanned out and static, pools evenly across the floor.
  wash: (f) => ({ x: f.home.x * 0.82, y: 0, z: f.home.z * 0.5 }),
};

let cueName: keyof typeof CUES = "sweep";
let bpm = 124;
let strobe = false;
let hazeLevel = 1;
let master = 1;

// ---------------------------------------------------------------------------
// Flying the camera
// ---------------------------------------------------------------------------

const keys = scene.input;

/** Where the camera is and which way it faces, in the usual yaw/pitch pair. */
const eye = { x: 0, y: 9.2, z: 17.5 };
let yaw = Math.PI;
let pitch = -0.28;
/** True while the viewer is driving; the automatic drift stops until they stop. */
let flying = false;
let driftFrom = 0;

function fly(dt: number): void {
  const looking = keys.button(1);
  if (looking) {
    yaw -= keys.mouse.dx * 0.005;
    // Stop just short of straight up or down: at exactly vertical the forward
    // vector is parallel to up and lookAt has no way to orient the horizon.
    pitch = Math.max(-1.45, Math.min(1.45, pitch - keys.mouse.dy * 0.005));
  }

  const speed = (keys.shift ? 24 : 9) * dt;
  const forward = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
  const right = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };

  let moved = false;
  const step = (v: { x: number; y: number; z: number }, amount: number) => {
    eye.x += v.x * amount;
    eye.y += v.y * amount;
    eye.z += v.z * amount;
    moved = true;
  };
  if (keys.held("w")) step(forward, speed);
  if (keys.held("s")) step(forward, -speed);
  if (keys.held("d")) step(right, speed);
  if (keys.held("a")) step(right, -speed);
  if (keys.held("e") || keys.held("space")) step({ x: 0, y: 1, z: 0 }, speed);
  if (keys.held("q")) step({ x: 0, y: 1, z: 0 }, -speed);
  // Under the floor is never where you meant to be.
  eye.y = Math.max(0.6, eye.y);

  flying = looking || moved;
  scene.camera.position = { ...eye };
  scene.camera.target = { x: eye.x + forward.x, y: eye.y + forward.y, z: eye.z + forward.z };
}

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

const hue = (i: number, beat: number) => ((i * 0.055 + beat * 0.06) % 1 + 1) % 1;

// Hue to RGB, matching the shader's, so the pool and the beam agree.
function hsv(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

scene.onFrame(({ time, dt }) => {
  const beat = (time * bpm) / 60;
  const bar = Math.floor(beat / 4);
  const cue = CUES[cueName]!;

  for (const f of fixtures) {
    const target = cue(f, time, beat);
    // Ease towards the cue rather than snapping: a moving head has mass, and
    // the lag is most of what makes a rig read as physical.
    const ease = 1 - Math.pow(0.001, dt);
    f.aim.x += (target.x - f.aim.x) * ease;
    f.aim.y += (target.y - f.aim.y) * ease;
    f.aim.z += (target.z - f.aim.z) * ease;

    // Level: a chase on the beat, with a strobe option on top.
    const phase = (beat + f.index * 0.5) % 4;
    const chase = cueName === "wash" ? 1 : Math.max(0.18, 1 - phase * 0.3);
    const flash = strobe ? (Math.floor(beat * 4) % 2 === 0 ? 1 : 0.05) : 1;
    f.dimmer = chase * flash * master;

    f.hue = hue(f.index, bar);
    const rgb = hsv(f.hue, 0.85, 1);

    // Aim the head and the beam at the same point.
    f.head.aimAt(f.aim);
    f.beam.aimAt(f.aim);
    f.lens.position = {
      x: f.home.x + (f.aim.x - f.home.x) * 0.022,
      y: f.home.y - 0.3,
      z: f.home.z + (f.aim.z - f.home.z) * 0.022,
    };
    f.lens.rotation = f.head.rotation;

    // Beam length follows the distance to the floor, so the cone lands on it.
    const reach = Math.hypot(f.aim.x - f.home.x, f.home.y, f.aim.z - f.home.z);
    f.beam.scale = { x: 1, y: reach / BEAM_LENGTH, z: 1 };

    f.beam.color = [rgb[0], rgb[1], rgb[2], 1];
    f.lens.color = [rgb[0], rgb[1], rgb[2], 1];
    f.pool.color = [rgb[0], rgb[1], rgb[2], 1];

    f.beam.params[0] = f.dimmer * hazeLevel;
    f.lens.params[0] = f.dimmer;

    // The pool sits where the beam meets the floor, scaled by the throw.
    f.pool.position = { x: f.aim.x, y: 0.02, z: f.aim.z };
    const spread = 0.55 + (reach / BEAM_LENGTH) * 0.85;
    f.pool.scale = { x: spread, y: 1, z: spread };
    f.pool.params[0] = f.dimmer;
  }

  practicals.forEach((p, i) => {
    p.params[0] = 0.5 + Math.sin(time * 0.7 + i) * 0.12;
  });

  fly(dt);
  if (flying) {
    driftFrom = time;
  } else {
    // Nobody is driving: drift, from wherever they left the camera, so taking
    // your hands off does not teleport the view.
    const t = time - driftFrom;
    scene.camera.position = {
      x: eye.x + Math.sin(t * 0.09) * 5.2,
      y: eye.y + Math.sin(t * 0.13) * 1.4,
      z: eye.z,
    };
    scene.camera.target = { x: 0, y: 2.2, z: -0.5 };
  }
});

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

const readout = new Label({
  text: "…", font: { monospace: true, size: 11 }, color: "secondaryLabel",
});
let mark = 0;
scene.onFrame(({ time }) => {
  if (time - mark < 0.5) return;
  mark = time;
  const s = scene.stats;
  readout.text =
    `${s.fps} fps · ${scene.nodes.length} nodes · ${scene.batchCount} draws · ` +
    `cpu ${s.cpuMs.toFixed(2)}ms · gpu ${s.gpuMs.toFixed(2)}ms`;
});

const win = new Window({
  title: "Lighting rig",
  size: { width: 1080, height: 720 },
  minSize: { width: 780, height: 520 },
  content: new VStack({ spacing: 12, padding: 16 }, [
    new HStack({ spacing: 8, align: "center" }, [
      new Label({ text: "Rig", font: { style: "title", weight: "semibold" } }),
      new Label({
        text: "right-drag to look · wasd to fly · shift for speed",
        color: "tertiaryLabel",
      }),
      new Spacer(),
      readout,
    ]),

    scene,

    new HStack({ spacing: 14, align: "center" }, [
      new Segmented({
        items: ["Sweep", "Wave", "Focus", "Wash"],
        selected: 0,
        onChange: (i) => {
          cueName = (["sweep", "wave", "focus", "wash"] as const)[i]!;
        },
      }),
      new Label({ text: "BPM", width: 34 }),
      new Slider({ min: 60, max: 190, value: bpm, width: 140, onChange: (v) => { bpm = v; } }),
      new Label({ text: "Haze", width: 38 }),
      new Slider({ min: 0, max: 1.6, value: hazeLevel, width: 110, onChange: (v) => { hazeLevel = v; } }),
      new Label({ text: "Master", width: 52 }),
      new Slider({ min: 0, max: 1, value: master, grow: 1, onChange: (v) => { master = v; } }),
      new Checkbox({ title: "Strobe", checked: false, onChange: (on) => { strobe = on; } }),
    ]),
  ]),
});
win.quitOnClose();

await app.run();
