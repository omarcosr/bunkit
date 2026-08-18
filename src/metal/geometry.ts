// Geometry: interleaved position, normal and texture coordinate, plus indices.
//
// The vertex stride is 32 bytes, eight floats, and the shader must declare it
// with `packed_float3` rather than `float3`. A plain float3 is 16-byte aligned,
// which would make MSL read a 40-byte stride and pull every vertex after the
// first from the wrong offset — for a geometry buffer that is the difference
// between a mesh and a cloud of noise.

import { packed2f, packed3f, struct } from "./types.ts";
import { v3cross, v3normalize, v3sub, type Vec3 } from "./math.ts";

export interface Geometry {
  /** Interleaved [px, py, pz, nx, ny, nz, u, v] per vertex. */
  vertices: Float32Array;
  indices: Uint32Array;
}

/** The vertex layout, for a shader that wants to declare it from the schema. */
export const Vertex = struct("Vertex", {
  position: packed3f,
  normal: packed3f,
  uv: packed2f,
});

export const VERTEX_STRIDE = 32;
const FLOATS = 8;

type UV = readonly [number, number];

/**
 * Identical parameters give back the identical object.
 *
 * This is load-bearing rather than a micro-optimisation. Scene3D batches by
 * geometry identity, so without it `box({ size: 0.2 })` called two hundred
 * times would produce two hundred distinct meshes and two hundred draw calls
 * for what is one instanced draw. Geometry is treated as immutable throughout;
 * build your own with `geometry()` if you need to own the arrays.
 */
function memo<O extends object>(build: (options: O) => Geometry): (options?: O) => Geometry {
  const cache = new Map<string, Geometry>();
  return (options = {} as O) => {
    const key = JSON.stringify(options, Object.keys(options).sort());
    let g = cache.get(key);
    if (!g) {
      g = build(options);
      cache.set(key, g);
    }
    return g;
  };
}

interface Builder {
  push(p: Vec3, n: Vec3, uv?: UV): number;
  tri(a: number, b: number, c: number): void;
  done(): Geometry;
}

function builder(): Builder {
  const v: number[] = [];
  const i: number[] = [];
  return {
    push(p, n, uv = [0, 0]) {
      v.push(p.x, p.y, p.z, n.x, n.y, n.z, uv[0], uv[1]);
      return v.length / FLOATS - 1;
    },
    tri(a, b, c) {
      i.push(a, b, c);
    },
    done: () => ({ vertices: new Float32Array(v), indices: new Uint32Array(i) }),
  };
}

export interface BoxGeometryOptions {
  /** Uniform size, or per-axis [x, y, z]. */
  size?: number | readonly [number, number, number];
}

/** An axis-aligned box centred on the origin, with flat per-face normals. */
function buildBoxGeometry(options: BoxGeometryOptions): Geometry {
  const s = options.size ?? 1;
  const [sx, sy, sz] = typeof s === "number" ? [s, s, s] : s;
  const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
  const b = builder();

  // Each face gets its own four vertices so the normals stay flat; sharing
  // corners would average them and round the edges off.
  const face = (origin: Vec3, right: Vec3, up: Vec3, normal: Vec3) => {
    const p = (u: number, w: number): Vec3 => ({
      x: origin.x + right.x * u + up.x * w,
      y: origin.y + right.y * u + up.y * w,
      z: origin.z + right.z * u + up.z * w,
    });
    const a = b.push(p(-1, -1), normal, [0, 1]);
    const c = b.push(p(1, -1), normal, [1, 1]);
    const d = b.push(p(1, 1), normal, [1, 0]);
    const e = b.push(p(-1, 1), normal, [0, 0]);
    b.tri(a, c, d);
    b.tri(a, d, e);
  };

  face({ x: 0, y: 0, z: hz }, { x: hx, y: 0, z: 0 }, { x: 0, y: hy, z: 0 }, { x: 0, y: 0, z: 1 });
  face({ x: 0, y: 0, z: -hz }, { x: -hx, y: 0, z: 0 }, { x: 0, y: hy, z: 0 }, { x: 0, y: 0, z: -1 });
  face({ x: hx, y: 0, z: 0 }, { x: 0, y: 0, z: -hz }, { x: 0, y: hy, z: 0 }, { x: 1, y: 0, z: 0 });
  face({ x: -hx, y: 0, z: 0 }, { x: 0, y: 0, z: hz }, { x: 0, y: hy, z: 0 }, { x: -1, y: 0, z: 0 });
  face({ x: 0, y: hy, z: 0 }, { x: hx, y: 0, z: 0 }, { x: 0, y: 0, z: -hz }, { x: 0, y: 1, z: 0 });
  face({ x: 0, y: -hy, z: 0 }, { x: hx, y: 0, z: 0 }, { x: 0, y: 0, z: hz }, { x: 0, y: -1, z: 0 });
  return b.done();
}

export interface SphereGeometryOptions {
  radius?: number;
  /** Longitude and latitude divisions. */
  segments?: number;
  rings?: number;
}

/** A UV sphere. Its normals are the unit position, so it lights smoothly. */
function buildSphereGeometry(options: SphereGeometryOptions): Geometry {
  const r = options.radius ?? 0.5;
  const seg = Math.max(3, options.segments ?? 32);
  const rings = Math.max(2, options.rings ?? 16);
  const b = builder();

  for (let y = 0; y <= rings; y++) {
    const v = y / rings;
    const phi = v * Math.PI;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg;
      const theta = u * Math.PI * 2;
      const n = {
        x: Math.sin(phi) * Math.cos(theta),
        y: Math.cos(phi),
        z: Math.sin(phi) * Math.sin(theta),
      };
      b.push({ x: n.x * r, y: n.y * r, z: n.z * r }, n, [u, v]);
    }
  }
  const row = seg + 1;
  for (let y = 0; y < rings; y++) {
    for (let x = 0; x < seg; x++) {
      // Counter-clockwise seen from outside, which is what the pipeline's
      // front-facing winding expects; the mirror image renders the inside of
      // the sphere and is lit by nothing.
      const a = y * row + x;
      const c = a + row;
      b.tri(a, a + 1, c);
      b.tri(a + 1, c + 1, c);
    }
  }
  return b.done();
}

export interface PlaneGeometryOptions {
  size?: number | readonly [number, number];
  /** Subdivisions per axis. More than 1 only matters if you displace it. */
  segments?: number;
}

/** A flat plane in the XZ ground plane, facing up. */
function buildPlaneGeometry(options: PlaneGeometryOptions): Geometry {
  const s = options.size ?? 1;
  const [sx, sz] = typeof s === "number" ? [s, s] : s;
  const n = Math.max(1, options.segments ?? 1);
  const b = builder();
  const up = { x: 0, y: 1, z: 0 };

  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      b.push({ x: (x / n - 0.5) * sx, y: 0, z: (z / n - 0.5) * sz }, up, [x / n, z / n]);
    }
  }
  const row = n + 1;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * row + x;
      b.tri(a, a + row, a + 1);
      b.tri(a + 1, a + row, a + row + 1);
    }
  }
  return b.done();
}

export interface CylinderGeometryOptions {
  /** Radius at the base and at the top. Set `top` to 0 for a cone. */
  radius?: number;
  top?: number;
  height?: number;
  segments?: number;
  /** Cap the ends. A beam wants them open so you can see up the inside. */
  caps?: boolean;
}

/**
 * A cylinder or truncated cone along +Y, centred on the origin.
 *
 * `v` runs 0 at the base to 1 at the top, which is what a beam shader fades
 * along, and the side normals are perpendicular to the slope rather than to the
 * axis — on a cone those are not the same, and using the axis makes the shading
 * look like a cylinder that happens to be pointy.
 */
function buildCylinderGeometry(options: CylinderGeometryOptions): Geometry {
  const base = options.radius ?? 0.5;
  const top = options.top ?? base;
  const height = options.height ?? 1;
  const seg = Math.max(3, options.segments ?? 24);
  const caps = options.caps ?? true;
  const b = builder();
  const hy = height / 2;

  // Slope of the side, for the normal: (dy, -dr) normalised in the r-y plane.
  const slope = Math.hypot(height, base - top);
  const ny = slope > 1e-6 ? (base - top) / slope : 0;
  const nr = slope > 1e-6 ? height / slope : 1;

  for (let y = 0; y <= 1; y++) {
    const r = y === 0 ? base : top;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg;
      const theta = u * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      b.push(
        { x: cos * r, y: y === 0 ? -hy : hy, z: sin * r },
        v3normalize({ x: cos * nr, y: ny, z: sin * nr }),
        [u, y],
      );
    }
  }
  const row = seg + 1;
  for (let x = 0; x < seg; x++) {
    const a = x;
    const c = a + row;
    b.tri(a, a + 1, c);
    b.tri(a + 1, c + 1, c);
  }

  if (caps) {
    for (const [r, y, normal] of [
      [base, -hy, { x: 0, y: -1, z: 0 }],
      [top, hy, { x: 0, y: 1, z: 0 }],
    ] as const) {
      if (r <= 1e-6) continue;
      const centre = b.push({ x: 0, y, z: 0 }, normal, [0.5, 0.5]);
      const first = b.push({ x: r, y, z: 0 }, normal, [1, 0.5]);
      let previous = first;
      for (let x = 1; x <= seg; x++) {
        const theta = (x / seg) * Math.PI * 2;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        const next = x === seg
          ? first
          : b.push({ x: cos * r, y, z: sin * r }, normal, [cos * 0.5 + 0.5, sin * 0.5 + 0.5]);
        if (y > 0) b.tri(centre, previous, next);
        else b.tri(centre, next, previous);
        previous = next;
      }
    }
  }
  return b.done();
}

export interface ConeGeometryOptions {
  radius?: number;
  height?: number;
  segments?: number;
  caps?: boolean;
}

/**
 * A cone with its point at the origin, opening downward along -Y.
 *
 * Oriented that way because that is what a light beam is: the apex is the
 * fixture and the mouth is where it lands. Rotate it to aim.
 */
function buildConeGeometry(options: ConeGeometryOptions): Geometry {
  const height = options.height ?? 1;
  const source = cylinderGeometry({
    radius: options.radius ?? 0.5,
    top: 0,
    height,
    segments: options.segments,
    caps: options.caps ?? false,
  });
  // cylinderGeometry puts the point at +y = height/2 and the open end at
  // -height/2. Sliding the whole thing down by height/2 leaves the apex at the
  // origin and the mouth at -height: a beam that starts at the fixture. A
  // translation only, so the winding and the normals are untouched.
  const g: Geometry = { vertices: new Float32Array(source.vertices), indices: source.indices };
  for (let i = 1; i < g.vertices.length; i += FLOATS) g.vertices[i]! -= height / 2;
  return g;
}

/**
 * Build geometry from raw triangles. Normals are computed per face when they
 * are not supplied, which is what makes a hand-written mesh light correctly
 * without the caller working them out.
 */
export function geometry(input: {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
  normals?: ArrayLike<number>;
  uvs?: ArrayLike<number>;
}): Geometry {
  const positions = Float32Array.from(input.positions);
  const count = positions.length / 3;
  const indices = input.indices
    ? Uint32Array.from(input.indices)
    : Uint32Array.from({ length: count }, (_, i) => i);

  let normals: Float32Array;
  if (input.normals) {
    normals = Float32Array.from(input.normals);
  } else {
    normals = new Float32Array(count * 3);
    for (let i = 0; i < indices.length; i += 3) {
      const [ia, ib, ic] = [indices[i]! * 3, indices[i + 1]! * 3, indices[i + 2]! * 3];
      const pa = { x: positions[ia]!, y: positions[ia + 1]!, z: positions[ia + 2]! };
      const pb = { x: positions[ib]!, y: positions[ib + 1]!, z: positions[ib + 2]! };
      const pc = { x: positions[ic]!, y: positions[ic + 1]!, z: positions[ic + 2]! };
      const n = v3normalize(v3cross(v3sub(pb, pa), v3sub(pc, pa)));
      for (const base of [ia, ib, ic]) {
        normals[base] = (normals[base] ?? 0) + n.x;
        normals[base + 1] = (normals[base + 1] ?? 0) + n.y;
        normals[base + 2] = (normals[base + 2] ?? 0) + n.z;
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const n = v3normalize({ x: normals[i]!, y: normals[i + 1]!, z: normals[i + 2]! });
      normals[i] = n.x;
      normals[i + 1] = n.y;
      normals[i + 2] = n.z;
    }
  }

  const uvs = input.uvs ? Float32Array.from(input.uvs) : null;
  const vertices = new Float32Array(count * FLOATS);
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS;
    vertices[o] = positions[i * 3]!;
    vertices[o + 1] = positions[i * 3 + 1]!;
    vertices[o + 2] = positions[i * 3 + 2]!;
    vertices[o + 3] = normals[i * 3] ?? 0;
    vertices[o + 4] = normals[i * 3 + 1] ?? 1;
    vertices[o + 5] = normals[i * 3 + 2] ?? 0;
    vertices[o + 6] = uvs?.[i * 2] ?? 0;
    vertices[o + 7] = uvs?.[i * 2 + 1] ?? 0;
  }
  return { vertices, indices };
}

// Every built-in shape is memoised on its parameters; see memo() above for why.
export const boxGeometry = memo(buildBoxGeometry);
export const sphereGeometry = memo(buildSphereGeometry);
export const planeGeometry = memo(buildPlaneGeometry);
export const cylinderGeometry = memo(buildCylinderGeometry);
export const coneGeometry = memo(buildConeGeometry);
