// Geometry: interleaved position and normal, plus an index buffer.
//
// The vertex stride is 24 bytes, six floats, because MSL's `packed_float3` is
// 12 bytes where a plain `float3` is 16. The shader declares packed_float3 for
// exactly this reason: a plain float3 would silently read every vertex from the
// wrong offset.

import { v3cross, v3normalize, v3sub, type Vec3 } from "./math.ts";

export interface Geometry {
  /** Interleaved [px, py, pz, nx, ny, nz] per vertex. */
  vertices: Float32Array;
  indices: Uint32Array;
}

export const VERTEX_STRIDE = 24;

interface Builder {
  push(p: Vec3, n: Vec3): number;
  tri(a: number, b: number, c: number): void;
  done(): Geometry;
}

function builder(): Builder {
  const v: number[] = [];
  const i: number[] = [];
  return {
    push(p, n) {
      v.push(p.x, p.y, p.z, n.x, n.y, n.z);
      return v.length / 6 - 1;
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
export function boxGeometry(options: BoxGeometryOptions = {}): Geometry {
  const s = options.size ?? 1;
  const [sx, sy, sz] = typeof s === "number" ? [s, s, s] : s;
  const [hx, hy, hz] = [sx / 2, sy / 2, sz / 2];
  const b = builder();

  // Each face gets its own four vertices so the normals stay flat; sharing
  // corners would average them and round the edges off.
  const face = (
    origin: Vec3, right: Vec3, up: Vec3, normal: Vec3,
  ) => {
    const p = (u: number, w: number): Vec3 => ({
      x: origin.x + right.x * u + up.x * w,
      y: origin.y + right.y * u + up.y * w,
      z: origin.z + right.z * u + up.z * w,
    });
    const a = b.push(p(-1, -1), normal);
    const c = b.push(p(1, -1), normal);
    const d = b.push(p(1, 1), normal);
    const e = b.push(p(-1, 1), normal);
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
export function sphereGeometry(options: SphereGeometryOptions = {}): Geometry {
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
      b.push({ x: n.x * r, y: n.y * r, z: n.z * r }, n);
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
export function planeGeometry(options: PlaneGeometryOptions = {}): Geometry {
  const s = options.size ?? 1;
  const [sx, sz] = typeof s === "number" ? [s, s] : s;
  const n = Math.max(1, options.segments ?? 1);
  const b = builder();
  const up = { x: 0, y: 1, z: 0 };

  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      b.push({ x: (x / n - 0.5) * sx, y: 0, z: (z / n - 0.5) * sz }, up);
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

/**
 * Build geometry from raw triangles. Normals are computed per face when they
 * are not supplied, which is what makes a hand-written mesh light correctly
 * without the caller working them out.
 */
export function geometry(input: {
  positions: ArrayLike<number>;
  indices?: ArrayLike<number>;
  normals?: ArrayLike<number>;
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

  const vertices = new Float32Array(count * 6);
  for (let i = 0; i < count; i++) {
    vertices[i * 6] = positions[i * 3]!;
    vertices[i * 6 + 1] = positions[i * 3 + 1]!;
    vertices[i * 6 + 2] = positions[i * 3 + 2]!;
    vertices[i * 6 + 3] = normals[i * 3] ?? 0;
    vertices[i * 6 + 4] = normals[i * 3 + 1] ?? 1;
    vertices[i * 6 + 5] = normals[i * 3 + 2] ?? 0;
  }
  return { vertices, indices };
}
