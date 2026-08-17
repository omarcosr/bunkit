// The Metal objects a scene needs, and the one shader it draws with.
//
// Everything here goes through Layer 2: Metal is Objective-C like the rest of
// the system, so the bridge needs no special support for it. The only wrinkle
// is that some Metal structs are anonymous in the type encoding —
// MTLClearColor encodes as "{?=dddd}" with no name to look up — so those are
// passed as typed arrays of raw bytes.

import { cfunction, objc, wrap } from "../objc.ts";
import { NIL, ptr } from "../bridge.ts";

/**
 * A Metal object reached through the objc proxy.
 *
 * `any`, deliberately and for the same reason View.native is: these are
 * protocol types (MTLDevice, MTLCommandQueue) whose concrete classes are
 * private, and every selector on them is resolved at run time. The generated
 * AppKit declarations do not cover Metal, so there is nothing truer to say.
 */
export type MTLObject = any;

/** Metal enum values. Metal is not in the generated constants dump. */
export const MTL = {
  PixelFormatBGRA8Unorm: 80,
  PixelFormatDepth32Float: 252,
  LoadActionClear: 2,
  StoreActionStore: 1,
  StorageModeShared: 0,
  StorageModePrivate: 2,
  TextureUsageShaderRead: 0x1,
  TextureUsageRenderTarget: 0x4,
  PrimitiveTypeTriangle: 3,
  IndexTypeUInt32: 1,
  CompareFunctionLess: 1,
  CullModeBack: 2,
  WindingCounterClockwise: 1,
  ResourceStorageModeShared: 0,
} as const;

let cachedDevice: MTLObject | null | undefined;

/**
 * The system default GPU, or null where there is none.
 *
 * MTLCreateSystemDefaultDevice is a plain C function rather than a class
 * method, so it is reached with cfunction rather than through the objc proxy.
 */
export function metalDevice(): MTLObject | null {
  if (cachedDevice === undefined) {
    const create = cfunction("MTLCreateSystemDefaultDevice", "@");
    cachedDevice = create?.() ?? null;
  }
  return cachedDevice;
}

export function metalAvailable(): boolean {
  return metalDevice() !== null;
}

/** Reads an NSError** out-parameter, which several Metal calls report through. */
export function outError(): { slot: BigUint64Array; ptr: number; message(): string | null } {
  const slot = new BigUint64Array(1);
  return {
    slot,
    ptr: ptr(slot),
    message() {
      if (slot[0] === 0n) return null;
      const err = wrap(slot[0]!, false);
      return err ? String(err.localizedDescription()) : "unknown error";
    },
  };
}

/** Compile MSL source into a library. Throws with the compiler's own message. */
export function compileLibrary(device: MTLObject, source: string): MTLObject {
  const err = outError();
  const library = device.newLibraryWithSource_options_error_(source, null, err.ptr);
  if (!library || library.ptr === NIL) {
    throw new Error(`Metal shader failed to compile:\n${err.message() ?? "no error given"}`);
  }
  return library;
}

/** An MTLBuffer holding a copy of `data`. */
export function makeBuffer(device: MTLObject, data: ArrayBufferView): MTLObject {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const buffer = device.newBufferWithBytes_length_options_(
    ptr(bytes), bytes.byteLength, MTL.ResourceStorageModeShared,
  );
  if (!buffer || buffer.ptr === NIL) throw new Error("could not allocate an MTLBuffer");
  return buffer;
}

// ---------------------------------------------------------------------------
// The shader
// ---------------------------------------------------------------------------

/**
 * One pipeline draws everything: Lambert diffuse from a single directional
 * light, plus a hemisphere ambient term so faces pointing away from the light
 * are tinted by the sky rather than flat black.
 *
 * `packed_float3` is load-bearing. A plain `float3` is 16-byte aligned, which
 * would make the vertex stride 32 rather than the 24 the buffer is packed with,
 * and every vertex after the first would be read from the wrong offset.
 */
export const SCENE_SHADER = `
#include <metal_stdlib>
using namespace metal;

struct Vertex {
  packed_float3 position;
  packed_float3 normal;
};

struct Uniforms {
  float4x4 modelViewProjection;
  float4x4 model;
  float4x4 normalMatrix;
  float4 color;        // rgb + alpha
  float4 lightDirection; // xyz, normalised, pointing from the surface to the light
  float4 lightColor;   // rgb + intensity in w
  float4 ambient;      // rgb + strength in w
  float4 eye;          // xyz camera position
};

struct Fragment {
  float4 position [[position]];
  float3 worldNormal;
  float3 worldPosition;
};

vertex Fragment scene_vertex(
  uint vid [[vertex_id]],
  device const Vertex *vertices [[buffer(0)]],
  constant Uniforms &u [[buffer(1)]]
) {
  Vertex v = vertices[vid];
  float4 world = u.model * float4(v.position, 1.0);
  Fragment out;
  out.position = u.modelViewProjection * float4(v.position, 1.0);
  out.worldNormal = normalize((u.normalMatrix * float4(v.normal, 0.0)).xyz);
  out.worldPosition = world.xyz;
  return out;
}

fragment float4 scene_fragment(Fragment in [[stage_in]], constant Uniforms &u [[buffer(1)]]) {
  float3 n = normalize(in.worldNormal);
  float3 l = normalize(u.lightDirection.xyz);

  float diffuse = max(dot(n, l), 0.0);

  // Hemisphere ambient: full strength where the normal points at the sky,
  // half where it points at the ground. Flat ambient makes everything read as
  // a silhouette.
  float sky = n.y * 0.5 + 0.5;
  float3 ambient = u.ambient.rgb * u.ambient.w * mix(0.5, 1.0, sky);

  // Blinn-Phong highlight, narrow enough to read as a sheen rather than a blob.
  float3 viewDir = normalize(u.eye.xyz - in.worldPosition);
  // Not "half": that is MSL's 16-bit float type, and shadowing it is an error.
  float3 halfway = normalize(l + viewDir);
  float specular = pow(max(dot(n, halfway), 0.0), 48.0) * step(0.001, diffuse) * 0.25;

  float3 lit = u.color.rgb * (ambient + u.lightColor.rgb * u.lightColor.w * diffuse);
  return float4(lit + specular, u.color.a);
}
`;

/** Floats in the Uniforms struct above: 5 matrices' worth of 4-float rows. */
export const UNIFORM_FLOATS = 16 * 3 + 4 * 5;

export interface Pipeline {
  state: MTLObject;
  depthState: MTLObject;
}

/** Build the render pipeline and depth state for a given colour format. */
export function buildPipeline(
  device: MTLObject,
  colorFormat: number = MTL.PixelFormatBGRA8Unorm,
  depthFormat: number = MTL.PixelFormatDepth32Float,
): Pipeline {
  const library = compileLibrary(device, SCENE_SHADER);

  const descriptor = objc.MTLRenderPipelineDescriptor.alloc().init();
  descriptor.setVertexFunction_(library.newFunctionWithName_("scene_vertex"));
  descriptor.setFragmentFunction_(library.newFunctionWithName_("scene_fragment"));
  descriptor.colorAttachments().objectAtIndexedSubscript_(0).setPixelFormat_(colorFormat);
  descriptor.setDepthAttachmentPixelFormat_(depthFormat);

  const err = outError();
  const state = device.newRenderPipelineStateWithDescriptor_error_(descriptor, err.ptr);
  if (!state || state.ptr === NIL) {
    throw new Error(`Metal pipeline failed: ${err.message() ?? "no error given"}`);
  }

  const depth = objc.MTLDepthStencilDescriptor.alloc().init();
  depth.setDepthCompareFunction_(MTL.CompareFunctionLess);
  depth.setDepthWriteEnabled_(true);
  const depthState = device.newDepthStencilStateWithDescriptor_(depth);

  return { state, depthState };
}

/** A depth texture sized to the drawable. Recreated whenever the view resizes. */
export function makeDepthTexture(device: MTLObject, width: number, height: number): MTLObject {
  const d = objc.MTLTextureDescriptor.texture2DDescriptorWithPixelFormat_width_height_mipmapped_(
    MTL.PixelFormatDepth32Float, Math.max(1, width), Math.max(1, height), false,
  );
  d.setUsage_(MTL.TextureUsageRenderTarget);
  // Private: the CPU never reads the depth buffer, and private is the only
  // storage mode a depth texture may use on this hardware.
  d.setStorageMode_(MTL.StorageModePrivate);
  return device.newTextureWithDescriptor_(d);
}
