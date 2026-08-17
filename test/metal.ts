// Metal: the maths, the geometry, and what actually lands in the framebuffer.
//
// Rendering is checked by reading pixels back from an off-screen target, so
// every claim here is about what the GPU produced rather than what the API was
// asked to do. Scene3D.capture() is the same code path the on-screen view uses.

import {
  Scene3D,
  box,
  boxGeometry,
  geometry,
  identity,
  invert,
  lookAt,
  mat4,
  metalAvailable,
  multiply,
  normalMatrix,
  perspective,
  plane,
  planeGeometry,
  radians,
  sphere,
  sphereGeometry,
  v3normalize,
} from "../src/metal/index.ts";
import { HStack, VStack, Window } from "../src/ui/index.ts";
import { initApp, pumpOnce } from "../src/runtime.ts";

let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}
const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) < eps;

initApp();

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------
{
  const i = mat4();
  check("identity is identity", i[0] === 1 && i[5] === 1 && i[10] === 1 && i[15] === 1 && i[1] === 0);

  const a = new Float32Array([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 2, 3, 1]);
  const viaIdentity = multiply(a, mat4());
  check("m * I === m", [...viaIdentity].every((v, k) => close(v, a[k]!)));

  // multiply(out === a) must not read its own partial results.
  const aliased = new Float32Array(a);
  multiply(aliased, aliased, aliased);
  const expected = multiply(a, a);
  check("multiply is alias-safe", [...aliased].every((v, k) => close(v, expected[k]!)));

  const inv = invert(a);
  const round = multiply(a, inv);
  check("m * m^-1 === I", [...round].every((v, k) => close(v, mat4()[k]!, 1e-3)), [...round]);
  check("a singular matrix inverts to identity, not NaN",
    [...invert(new Float32Array(16))].every((v, k) => v === identity(new Float32Array(16))[k]));

  // A point on the near plane must land at z = 0 in Metal's clip space, not -1.
  const p = perspective(radians(60), 1, 0.1, 100);
  const near = [0, 0, -0.1, 1];
  const z = p[2]! * near[0]! + p[6]! * near[1]! + p[10]! * near[2]! + p[14]! * near[3]!;
  const w = p[3]! * near[0]! + p[7]! * near[1]! + p[11]! * near[2]! + p[15]! * near[3]!;
  check("near plane maps to z=0 (Metal clip space, not GL)", close(z / w, 0, 1e-3), z / w);

  // Looking down -Z from the origin puts the target straight ahead.
  const v = lookAt({ x: 0, y: 0, z: 5 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const tz = v[2]! * 0 + v[6]! * 0 + v[10]! * 0 + v[14]!;
  check("lookAt puts the target 5 in front", close(tz, -5, 1e-3), tz);

  // Under non-uniform scale the model matrix alone bends normals; the normal
  // matrix is what keeps them perpendicular to the surface.
  const squash = new Float32Array([1, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const n = normalMatrix(squash);
  const tilted = v3normalize({ x: 1, y: 1, z: 0 });
  const byModel = v3normalize({
    x: squash[0]! * tilted.x, y: squash[5]! * tilted.y, z: squash[10]! * tilted.z,
  });
  const byNormal = v3normalize({
    x: n[0]! * tilted.x, y: n[5]! * tilted.y, z: n[10]! * tilted.z,
  });
  check("normal matrix differs from the model matrix under squash",
    Math.abs(byModel.y - byNormal.y) > 0.2, `${byModel.y} vs ${byNormal.y}`);
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
{
  const g = boxGeometry({ size: [2, 4, 6] });
  check("box has 24 vertices and 36 indices", g.vertices.length / 6 === 24 && g.indices.length === 36);

  let min = [9, 9, 9], max = [-9, -9, -9];
  for (let i = 0; i < g.vertices.length; i += 6) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, g.vertices[i + k]!);
      max[k] = Math.max(max[k]!, g.vertices[i + k]!);
    }
  }
  check("box is centred and correctly sized",
    close(min[0]!, -1) && close(max[1]!, 2) && close(max[2]!, 3), `${min} ${max}`);

  const unit = (gg: { vertices: Float32Array }) => {
    for (let i = 3; i < gg.vertices.length; i += 6) {
      if (Math.abs(Math.hypot(gg.vertices[i]!, gg.vertices[i + 1]!, gg.vertices[i + 2]!) - 1) > 1e-4) {
        return false;
      }
    }
    return true;
  };
  check("box normals are unit length", unit(g));
  check("sphere normals are unit length", unit(sphereGeometry({ segments: 12, rings: 8 })));
  check("plane normals are unit length", unit(planeGeometry({ segments: 3 })));

  const inRange = (gg: { vertices: Float32Array; indices: Uint32Array }) =>
    [...gg.indices].every((i) => i < gg.vertices.length / 6);
  check("every index is in range", inRange(g) && inRange(sphereGeometry()) && inRange(planeGeometry()));

  // Normals derived from the winding of a single triangle facing +Z.
  const derived = geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] });
  check("normals are computed when not supplied",
    close(derived.vertices[5]!, 1), [...derived.vertices.slice(3, 6)]);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
if (!metalAvailable()) {
  console.log("\n  (no Metal device here — skipping the rendering checks)");
} else {
  const pixel = (c: { width: number; pixels: Uint8Array }, x: number, y: number) => {
    const i = (y * c.width + x) * 4;
    return [c.pixels[i]!, c.pixels[i + 1]!, c.pixels[i + 2]!] as [number, number, number];
  };

  // The clear colour reaches the framebuffer untouched.
  {
    const s = new Scene3D({ background: "#123456", animate: false });
    const c = s.capture(64, 64);
    check("capture returns the requested size", c.width === 64 && c.pixels.length === 64 * 64 * 4);
    check("background is the clear colour", pixel(c, 2, 2).join(",") === "18,52,86", pixel(c, 2, 2));
    s.dispose();
  }

  // A white sphere lit head-on with no ambient must come back white. This is
  // the check that catches inverted winding: culled front faces leave the
  // inside of the sphere facing away from the light, and it renders black.
  {
    const s = new Scene3D({
      background: "#000000", animate: false,
      camera: { position: [0, 0, 3], target: [0, 0, 0], fov: 50 },
      light: { direction: [0, 0, 1], intensity: 1, ambientIntensity: 0 },
    });
    s.add(sphere({ radius: 1, color: "#ffffff" }));
    const c = s.capture(96, 96);
    check("sphere winding faces outward", pixel(c, 48, 48)[0] > 200, pixel(c, 48, 48));
    s.dispose();
  }

  for (const [name, node] of [
    ["box", box({ size: 2, color: "#ffffff" })],
    ["plane", plane({ size: 8, color: "#ffffff" })],
  ] as const) {
    const s = new Scene3D({
      background: "#000000", animate: false,
      camera: { position: [0, 3, 0.001], target: [0, 0, 0], fov: 50 },
      light: { direction: [0, 1, 0], intensity: 1, ambientIntensity: 0 },
    });
    s.add(node);
    const c = s.capture(64, 64);
    check(`${name} winding faces outward`, pixel(c, 32, 32)[0] > 200, pixel(c, 32, 32));
    s.dispose();
  }

  // Depth: a near red box must hide a far white one directly behind it.
  {
    const s = new Scene3D({
      background: "#000000", animate: false,
      camera: { position: [0, 0, 6], target: [0, 0, 0], fov: 50 },
      light: { direction: [0, 0, 1], ambientIntensity: 0 },
    });
    s.add(box({ size: 2, position: [0, 0, -3], color: "#ffffff" }));
    s.add(box({ size: 2, position: [0, 0, 0], color: "#ff0000" }));
    const c = s.capture(64, 64);
    const [r, g, b] = pixel(c, 32, 32);
    // Red-dominant rather than pure red: a face pointing straight at both the
    // light and the camera picks up the full specular term, which is white and
    // lifts every channel by about a quarter.
    check("the near object occludes the far one", r > 200 && r > g * 2 && r > b * 2, [r, g, b]);
    s.dispose();
  }

  // Node colour and visibility.
  {
    const s = new Scene3D({
      background: "#000000", animate: false,
      camera: { position: [0, 0, 4], target: [0, 0, 0], fov: 50 },
      light: { direction: [0, 0, 1], ambientIntensity: 0 },
    });
    const b = s.add(box({ size: 2, color: "#00ff00" }));
    check("node colour reaches the shader", pixel(s.capture(64, 64), 32, 32)[1] > 200);
    b.visible = false;
    check("visible=false removes it", pixel(s.capture(64, 64), 32, 32).join(",") === "0,0,0");
    b.visible = true;
    b.setColor("#0000ff");
    check("setColor takes effect", pixel(s.capture(64, 64), 32, 32)[2] > 200);
    s.dispose();
  }

  // The scene is a View: it lays out in a stack and drives its own frames.
  {
    const s = new Scene3D({ height: 200, animate: false });
    s.add(box({ color: "#aa091b" }));
    const stack = new VStack({ spacing: 8, padding: 12 }, [new HStack({}, []), s]);
    const win = new Window({ title: "metal", size: { width: 420, height: 320 }, content: stack, show: true });
    for (let i = 0; i < 25; i++) pumpOnce(0.004);
    win.native.contentView().layoutSubtreeIfNeeded();

    check("Scene3D lays out like any other view",
      s.frame.width > 300 && Math.abs(s.frame.height - 200) < 1,
      `${s.frame.width}x${s.frame.height}`);

    s.draw(); // on-screen path: nextDrawable, present, commit
    const size = s.layer.drawableSize();
    check("the layer sized itself to the backing store", size.width >= s.frame.width, JSON.stringify(size));

    let frames = 0;
    s.onFrame(() => frames++);
    s.start();
    for (let i = 0; i < 40; i++) pumpOnce(0.006);
    check("the run loop drives frames", frames > 3, frames);
    s.stop();
    const stopped = frames;
    for (let i = 0; i < 20; i++) pumpOnce(0.004);
    check("stop() stops them", frames === stopped, `${stopped} -> ${frames}`);

    s.dispose();
    win.close();
  }
}

console.log(failures === 0 ? "\nALL METAL TESTS PASSED" : `\n${failures} METAL FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
