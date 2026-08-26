// A 3D scene occupying one section of an ordinary window.
//
//   bun run examples/scene3d.ts
//
// The Scene3D is a View: it sits in the VStack between a header and a row of
// controls, and the controls mutate the scene directly from their callbacks.

// Metal is macOS-only; fail fast with a clear message elsewhere.
if (process.platform !== "darwin") {
  console.error("bunkit: this example uses Metal and requires macOS.");
  process.exit(1);
}

import {
  Application,
  Checkbox,
  HStack,
  Label,
  Segmented,
  Slider,
  Spacer,
  VStack,
  Window,
  box,
  plane,
  sphere,
  Scene3D,
  gpuAvailable,
} from "@omarcos/bunkit";

const app = new Application({ name: "Scene3D" });

if (!gpuAvailable()) {
  console.error("no Metal device on this machine");
  process.exit(1);
}

// --- the scene --------------------------------------------------------------

const scene = new Scene3D({
  grow: 1,
  minHeight: 320,
  background: "#0b0b12",
  camera: { position: [4, 2.6, 5], target: [0, 0.6, 0], fov: 50 },
  light: { direction: [0.5, 0.85, 0.35], ambient: "#5d6478", ambientIntensity: 0.35 },
});

scene.add(plane({ size: 40, color: "#20202a" }));

// Everything rests on y = 0: a box's y is half its height, a sphere's is its
// radius. Getting that wrong sinks the object through the ground.
const cube = scene.add(box({ size: 1.1, position: [-1.5, 0.55, 0.2], color: "#aa091b" }));

const PLINTH = 0.18;
const plinth = scene.add(
  box({ size: [1.9, PLINTH, 1.9], position: [1.5, PLINTH / 2, -0.2], color: "#6e0511" }),
);
const BALL_REST = PLINTH + 0.62;
const ball = scene.add(
  sphere({ radius: 0.62, position: [1.5, BALL_REST, -0.2], color: "#ededea" }),
);

// A ring of small cubes, to show a few dozen nodes animating at once.
const ring = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2;
  return scene.add(
    box({ size: 0.22, position: [Math.cos(a) * 3.1, 0.2, Math.sin(a) * 3.1], color: "#3a3a4a" }),
  );
});

// --- animation --------------------------------------------------------------

let spin = 0.8;
let orbiting = true;
let angle = 0.9;

scene.onFrame(({ time, dt }) => {
  cube.rotation.y += dt * spin;
  cube.rotation.x = Math.sin(time * 0.7) * 0.25;
  ball.position.y = BALL_REST + Math.abs(Math.sin(time * 1.6)) * 0.9;
  plinth.rotation.y = Math.sin(time * 0.3) * 0.4;

  ring.forEach((node, i) => {
    node.position.y = 0.2 + Math.sin(time * 2 + i * 0.5) * 0.35;
    node.rotation.y = time + i;
  });

  if (orbiting) {
    angle += dt * 0.25;
    scene.camera.orbit(angle, 6.2, 2.6);
  }
});

// --- chrome -----------------------------------------------------------------

const fps = new Label({ text: "…", font: { monospace: true, size: 11 }, textColor: "secondaryLabel" });
let frames = 0;
let mark = 0;
scene.onFrame(({ time }) => {
  frames++;
  if (time - mark >= 1) {
    fps.text = `${Math.round(frames / (time - mark))} fps · ${scene.nodes.length} nodes`;
    frames = 0;
    mark = time;
  }
});

const win = new Window({
  title: "Scene3D — Metal in a BunKit window",
  size: { width: 900, height: 620 },
  minSize: { width: 640, height: 460 },
  content: new VStack({ spacing: 12, padding: 16 }, [
    new HStack({ spacing: 8, alignItems: "center" }, [
      new Label({ text: "Metal", font: { style: "title", weight: "semibold" } }),
      new Spacer(),
      fps,
    ]),

    scene,

    new HStack({ spacing: 14, alignItems: "center" }, [
      new Label({ text: "Spin", width: 34 }),
      new Slider({
        min: 0, max: 4, value: spin, grow: 1,
        onChange: (v) => { spin = v; },
      }),
      new Checkbox({
        title: "Orbit camera",
        checked: true,
        onChange: (on) => { orbiting = on; },
      }),
      new Segmented({
        items: ["Dark", "Slate", "Ink"],
        selected: 0,
        onChange: (i) => {
          scene.background = [
            [0.04, 0.04, 0.07, 1],
            [0.10, 0.11, 0.14, 1],
            [0.02, 0.02, 0.03, 1],
          ][i] as [number, number, number, number];
        },
      }),
    ]),
  ]),
});
win.quitOnClose();

await app.run();
