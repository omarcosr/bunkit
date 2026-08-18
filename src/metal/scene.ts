// Scene3D: nodes, a camera and a light, drawn with one instanced call per mesh.
//
// This is the easy layer, and it sits on top of GPUView and the typed buffers
// rather than beside them, so the performance work is not something you opt
// into. Nodes sharing geometry are batched into a single instanced draw and
// their transforms are written straight into shared memory: a thousand cubes
// cost one draw call and roughly 150 microseconds of JavaScript, where a
// thousand individual draws would cost 1.2 milliseconds before doing any work.
//
// When it stops being enough, drop to GPUView and write the passes yourself.

import { objc } from "../objc.ts";
import { NIL, ptr } from "../bridge.ts";
import { BitmapImageFileType } from "../ui/appkit.ts";
import type { View } from "../ui/view.ts";
import {
  gpu, msl,
  type GPUArrayBuffer, type GPUBuffer, type MTLObject, type RenderPipeline, type Shader,
} from "./gpu.ts";
import { targets, GPUView, type GPUViewOptions } from "./view.ts";
import type { Frame, RenderPass } from "./frame.ts";
import { mat4x4f, struct, vec4f } from "./types.ts";
import { boxGeometry, planeGeometry, sphereGeometry, type Geometry } from "./geometry.ts";
import {
  compose, lookAt, multiply, normalMatrix, perspective, radians, toVec3, v3normalize,
  type Mat4, type Vec3,
} from "./math.ts";

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export type Color = string | { r: number; g: number; b: number; a?: number } | readonly number[];

/** "#rgb", "#rrggbb", "#rrggbbaa", {r,g,b,a} or [r,g,b,a] in 0..1. */
export function parseColor(c: Color): [number, number, number, number] {
  if (Array.isArray(c)) return [c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, c[3] ?? 1];
  if (typeof c !== "string") {
    const o = c as { r: number; g: number; b: number; a?: number };
    return [o.r, o.g, o.b, o.a ?? 1];
  }
  const hex = c.replace(/^#/, "");
  const n = (i: number, len: number) =>
    parseInt(len === 1 ? hex[i]! + hex[i]! : hex.substr(i, 2), 16) / 255;
  if (hex.length === 3) return [n(0, 1), n(1, 1), n(2, 1), 1];
  if (hex.length === 6) return [n(0, 2), n(2, 2), n(4, 2), 1];
  if (hex.length === 8) return [n(0, 2), n(2, 2), n(4, 2), n(6, 2)];
  return [1, 1, 1, 1];
}

// ---------------------------------------------------------------------------
// Schemas, shared by the CPU writer and the shader below
// ---------------------------------------------------------------------------

export const SceneUniforms = struct("SceneUniforms", {
  viewProjection: mat4x4f,
  lightDirection: vec4f,
  lightColor: vec4f,
  ambient: vec4f,
  eye: vec4f,
});

export const InstanceData = struct("InstanceData", {
  model: mat4x4f,
  normalMatrix: mat4x4f,
  color: vec4f,
});

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

export class Node {
  readonly geometry: Geometry;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  color: [number, number, number, number];
  visible: boolean;

  /** @internal Reused every frame, so animating allocates nothing. */
  readonly _model: Mat4 = new Float32Array(16);
  /** @internal */
  readonly _normal: Mat4 = new Float32Array(16);

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
export const sphere = (o: NodeOptions & { radius?: number; segments?: number; rings?: number } = {}) =>
  new Node(sphereGeometry(o), o);
export const plane = (o: NodeOptions & { size?: number | readonly [number, number]; segments?: number } = {}) =>
  new Node(planeGeometry(o), o);
export const mesh = (geometry: Geometry, o: NodeOptions = {}) => new Node(geometry, o);

// ---------------------------------------------------------------------------
// Camera and light
// ---------------------------------------------------------------------------

export interface CameraOptions {
  position?: Vec3 | readonly [number, number, number];
  target?: Vec3 | readonly [number, number, number];
  up?: Vec3 | readonly [number, number, number];
  fov?: number;
  near?: number;
  far?: number;
}

export class Camera {
  position: Vec3; target: Vec3; up: Vec3;
  fov: number; near: number; far: number;

  constructor(o: CameraOptions = {}) {
    this.position = toVec3(o.position ?? [0, 2, 6]);
    this.target = toVec3(o.target ?? [0, 0, 0]);
    this.up = toVec3(o.up ?? [0, 1, 0]);
    this.fov = o.fov ?? 55;
    this.near = o.near ?? 0.1;
    this.far = o.far ?? 200;
  }

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
// The shader
// ---------------------------------------------------------------------------

/**
 * Lambert diffuse, hemisphere ambient, and a narrow Blinn-Phong highlight.
 *
 * `packed_float3` for the vertex data is load-bearing: a plain float3 is
 * 16-byte aligned, which would make the stride 32 rather than the 24 the buffer
 * is packed with, and every vertex after the first would be read wrong.
 */
export const SCENE_SHADER = msl`
#include <metal_stdlib>
using namespace metal;

${SceneUniforms}

${InstanceData}

struct Vertex {
  packed_float3 position;
  packed_float3 normal;
};

struct Fragment {
  float4 position [[position]];
  float3 worldNormal;
  float3 worldPosition;
  float4 color;
};

vertex Fragment scene_vertex(
  uint vid [[vertex_id]],
  uint iid [[instance_id]],
  device const Vertex *vertices [[buffer(0)]],
  constant SceneUniforms &u [[buffer(1)]],
  device const InstanceData *instances [[buffer(2)]]
) {
  Vertex v = vertices[vid];
  InstanceData inst = instances[iid];
  float4 world = inst.model * float4(v.position, 1.0);

  Fragment out;
  out.position = u.viewProjection * world;
  out.worldNormal = normalize((inst.normalMatrix * float4(v.normal, 0.0)).xyz);
  out.worldPosition = world.xyz;
  out.color = inst.color;
  return out;
}

fragment float4 scene_fragment(Fragment in [[stage_in]], constant SceneUniforms &u [[buffer(1)]]) {
  float3 n = normalize(in.worldNormal);
  float3 l = normalize(u.lightDirection.xyz);
  float diffuse = max(dot(n, l), 0.0);

  // Hemisphere ambient: full strength facing the sky, half facing the ground.
  // Flat ambient makes everything read as a silhouette.
  float sky = n.y * 0.5 + 0.5;
  float3 ambient = u.ambient.rgb * u.ambient.w * mix(0.5, 1.0, sky);

  float3 viewDir = normalize(u.eye.xyz - in.worldPosition);
  // Not "half": that is MSL's 16-bit float type, and shadowing it is an error.
  float3 halfway = normalize(l + viewDir);
  float specular = pow(max(dot(n, halfway), 0.0), 48.0) * step(0.001, diffuse) * 0.25;

  float3 lit = in.color.rgb * (ambient + u.lightColor.rgb * u.lightColor.w * diffuse);
  return float4(lit + specular, in.color.a);
}
`;

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface Scene3DOptions extends Omit<GPUViewOptions, "onFrame"> {
  background?: Color;
  camera?: CameraOptions | Camera;
  light?: LightOptions | Light;
  /** Nodes per geometry the instance buffers are sized for. Default 4096. */
  maxInstances?: number;
  onFrame?: SceneHandler;
}

/** The frame a scene handler sees: an ordinary Frame, plus its scene. */
export interface SceneFrame extends Frame {
  readonly scene: Scene3D;
}

export type SceneHandler = (frame: SceneFrame, scene: Scene3D) => void;

interface Batch {
  vertices: MTLObject;
  indices: MTLObject;
  indexCount: number;
  instances: GPUArrayBuffer<any>;
  nodes: Node[];
}

export class Scene3D extends GPUView {
  readonly camera: Camera;
  readonly light: Light;
  background: [number, number, number, number];

  #uniforms: GPUBuffer<any>;
  #pipeline: RenderPipeline;
  #shader: Shader;
  #batches = new Map<Geometry, Batch>();
  #nodes: Node[] = [];
  #handlers: SceneHandler[] = [];
  #maxInstances: number;
  #view: Mat4 = new Float32Array(16);
  #projection: Mat4 = new Float32Array(16);
  #viewProjection: Mat4 = new Float32Array(16);

  constructor(options: Scene3DOptions = {}) {
    super({ ...options, animate: false, onFrame: undefined });
    const g = gpu();

    this.camera = options.camera instanceof Camera ? options.camera : new Camera(options.camera);
    this.light = options.light instanceof Light ? options.light : new Light(options.light);
    this.background = parseColor(options.background ?? "#0b0b0f");
    this.#maxInstances = options.maxInstances ?? 4096;

    this.#uniforms = g.buffer(SceneUniforms, { label: "scene uniforms" });
    this.#shader = g.shader(SCENE_SHADER, { label: "scene" });
    this.#pipeline = g.renderPipeline({
      shader: this.#shader,
      vertex: "scene_vertex",
      fragment: "scene_fragment",
      sampleCount: this.sampleCount,
      label: "scene",
    });

    super.onFrame((frame) => this.#render(frame));
    if (options.onFrame) this.#handlers.push(options.onFrame);
    if (options.animate !== false) this.start();
  }

  // --- scene graph ---------------------------------------------------------

  add<T extends Node>(node: T): T;
  add(child: View): this;
  add(item: any): any {
    if (item instanceof Node) {
      this.#nodes.push(item);
      this.#batchFor(item.geometry).nodes.push(item);
      return item;
    }
    return super.add(item);
  }

  remove(node: Node): this {
    const i = this.#nodes.indexOf(node);
    if (i >= 0) this.#nodes.splice(i, 1);
    const batch = this.#batches.get(node.geometry);
    if (batch) {
      const j = batch.nodes.indexOf(node);
      if (j >= 0) batch.nodes.splice(j, 1);
    }
    return this;
  }

  clear(): this {
    this.#nodes = [];
    for (const b of this.#batches.values()) b.nodes = [];
    return this;
  }

  get nodes(): readonly Node[] {
    return this.#nodes;
  }

  /** Draw calls the next frame will take: one per distinct geometry in use. */
  get batchCount(): number {
    let n = 0;
    for (const b of this.#batches.values()) if (b.nodes.some((x) => x.visible)) n++;
    return n;
  }

  /** Run before each frame is encoded, so what it changes lands this frame. */
  onFrame(fn: SceneHandler): this {
    this.#handlers.push(fn);
    return this;
  }

  /** The compiled scene shader, if you want to build another pipeline on it. */
  get shader(): Shader {
    return this.#shader;
  }

  #batchFor(geometry: Geometry): Batch {
    let batch = this.#batches.get(geometry);
    if (!batch) {
      const g = gpu();
      batch = {
        vertices: g.data(geometry.vertices, { label: "vertices" }),
        indices: g.data(geometry.indices, { label: "indices" }),
        indexCount: geometry.indices.length,
        instances: g.array(InstanceData, this.#maxInstances, { label: "instances" }),
        nodes: [],
      };
      this.#batches.set(geometry, batch);
    }
    return batch;
  }

  // --- rendering -----------------------------------------------------------

  #render(frame: Frame): void {
    const scene = frame as SceneFrame;
    (scene as { scene: Scene3D }).scene = this;
    for (const fn of this.#handlers) {
      try {
        fn(scene, this);
      } catch (e) {
        console.error("[Scene3D] frame handler failed:", e);
      }
    }

    lookAt(this.camera.position, this.camera.target, this.camera.up, this.#view);
    perspective(
      radians(this.camera.fov),
      frame.width / Math.max(1, frame.height),
      this.camera.near, this.camera.far, this.#projection,
    );
    multiply(this.#projection, this.#view, this.#viewProjection);

    this.#uniforms.write({
      viewProjection: this.#viewProjection,
      lightDirection: [this.light.direction.x, this.light.direction.y, this.light.direction.z, 0],
      lightColor: [this.light.color[0], this.light.color[1], this.light.color[2], this.light.intensity],
      ambient: [this.light.ambient[0], this.light.ambient[1], this.light.ambient[2], this.light.ambientIntensity],
      eye: [this.camera.position.x, this.camera.position.y, this.camera.position.z, 1],
    });

    // One instance-buffer fill and one draw per distinct geometry.
    for (const batch of this.#batches.values()) {
      let n = 0;
      for (const node of batch.nodes) {
        if (!node.visible || n >= batch.instances.capacity) continue;
        compose(node.position, node.rotation, node.scale, node._model);
        normalMatrix(node._model, node._normal);
        batch.instances.set(n++, {
          model: node._model, normalMatrix: node._normal, color: node.color,
        });
      }
      batch.instances.count = n;
    }

    const t = targets(frame);
    frame.render(
      {
        color: { texture: t.colorTexture, clear: this.background, resolve: t.resolveTexture },
        depth: t.depthTexture,
        label: "scene",
      },
      (pass: RenderPass) => {
        pass.pipeline(this.#pipeline);
        pass.uniforms(1, this.#uniforms);
        for (const batch of this.#batches.values()) {
          if (batch.instances.count === 0) continue;
          pass.vertex(0, batch.vertices);
          pass.vertex(2, batch.instances);
          pass.drawIndexed(batch.indices, batch.indexCount, { instances: batch.instances.count });
        }
      },
    );
  }

  /** Render off-screen and write a PNG. Returns the file size in bytes. */
  snapshot(path: string, width = 640, height = 480): number {
    const { pixels } = this.capture(width, height);
    // The rep references our buffer: created with NULL planes it does not
    // allocate until drawn into, so bitmapData would come back nil.
    const planes = new BigUint64Array([BigInt(ptr(pixels))]);
    const rep = objc.NSBitmapImageRep.alloc()
      .initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel_(
        ptr(planes), width, height, 8, 4, true, false, "NSDeviceRGBColorSpace", width * 4, 32,
      );
    if (!rep || rep.ptr === NIL) throw new Error("could not wrap the capture");
    const data = rep.representationUsingType_properties_(
      BitmapImageFileType.PNG, objc.NSDictionary.dictionary(),
    );
    if (!data || data.ptr === NIL) throw new Error("could not encode PNG");
    if (!data.writeToFile_atomically_(path, true)) throw new Error(`could not write ${path}`);
    return Number(data.length());
  }
}
