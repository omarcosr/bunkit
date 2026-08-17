// Metal: 3D scenes rendered by the GPU, inside an ordinary BunKit view.
//
//   const scene = new Scene3D({ height: 320 });
//   const cube = scene.add(box({ color: "#aa091b" }));
//   scene.onFrame(({ time }) => { cube.rotation.y = time; });
//
// Scene3D is a View, so it goes into a VStack next to labels and buttons like
// anything else. For a renderer of your own, `scene.device`, `scene.layer` and
// the helpers in ./device.ts are the way down to raw Metal.

export * from "./math.ts";
export * from "./geometry.ts";
export * from "./scene.ts";
export {
  metalDevice,
  metalAvailable,
  compileLibrary,
  makeBuffer,
  makeDepthTexture,
  buildPipeline,
  outError,
  SCENE_SHADER,
  MTL,
} from "./device.ts";
