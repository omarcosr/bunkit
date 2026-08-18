// Typed GPU data: one schema describes the bytes and the MSL declaration.
//
// The idea is TypeGPU's, and it exists because the single most expensive bug in
// GPU work is a CPU struct that does not match the shader's. Declare the struct
// once here and both sides are generated from it: `.write()` packs the bytes at
// the offsets Metal expects, and `.declare()` emits the MSL the shader includes.
// They cannot drift, because there is only one of them.
//
// The layout rules are Metal's, and they are not C's:
//
//   float          size  4, align  4
//   float2         size  8, align  8
//   float3         size 16, align 16   <- padded; this is the classic trap
//   float4         size 16, align 16
//   packed_float3  size 12, align  4   <- use for tightly packed vertex data
//   float4x4       size 64, align 16   (four float4 columns)
//   float3x3       size 48, align 16   (three padded float3 columns)
//   struct         align = max member align; size rounded up to that
//   array<T, N>    stride = sizeof(T) rounded up to align(T)
//
// These match WGSL's rules closely enough that a schema ported from a WebGPU
// project keeps its layout, which is the point.

export interface DataType<T = unknown> {
  /** Bytes this type occupies, before array stride rounding. */
  readonly size: number;
  readonly alignment: number;
  /** The MSL spelling, e.g. "float3" or a struct's name. */
  readonly msl: string;
  /** A label used in error messages. */
  readonly kind: string;
  write(view: DataView, offset: number, value: T): void;
  read(view: DataView, offset: number): T;
  /** MSL type declarations this type needs, innermost first. Structs only. */
  declarations?(): string[];
}

const LE = true;

function roundUp(value: number, multiple: number): number {
  return multiple <= 1 ? value : Math.ceil(value / multiple) * multiple;
}

/** Stride between elements of an array of this type. */
export function strideOf(type: DataType): number {
  return roundUp(type.size, type.alignment);
}

export function sizeOf(type: DataType): number {
  return type.size;
}

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

function scalar(
  msl: string,
  size: number,
  set: (v: DataView, o: number, x: number) => void,
  get: (v: DataView, o: number) => number,
): DataType<number> {
  return {
    size,
    alignment: size,
    msl,
    kind: msl,
    write: (view, offset, value) => set(view, offset, value ?? 0),
    read: (view, offset) => get(view, offset),
  };
}

export const f32 = scalar("float", 4, (v, o, x) => v.setFloat32(o, x, LE), (v, o) => v.getFloat32(o, LE));
export const u32 = scalar("uint", 4, (v, o, x) => v.setUint32(o, x >>> 0, LE), (v, o) => v.getUint32(o, LE));
export const i32 = scalar("int", 4, (v, o, x) => v.setInt32(o, x | 0, LE), (v, o) => v.getInt32(o, LE));
export const u16 = scalar("ushort", 2, (v, o, x) => v.setUint16(o, x & 0xffff, LE), (v, o) => v.getUint16(o, LE));
export const boolean32: DataType<boolean> = {
  size: 4,
  alignment: 4,
  msl: "uint",
  kind: "bool",
  write: (v, o, x) => v.setUint32(o, x ? 1 : 0, LE),
  read: (v, o) => v.getUint32(o, LE) !== 0,
};

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

/** Vectors accept a tuple, an object, or a Vec3-like — whatever reads best. */
export type VecInput =
  | readonly number[]
  | { x: number; y: number; z?: number; w?: number }
  | { r: number; g: number; b: number; a?: number }
  | number;

function components(value: VecInput, n: number): number[] {
  if (typeof value === "number") return Array(n).fill(value);
  if (Array.isArray(value)) return value as number[];
  const v = value as Record<string, number>;
  if ("x" in v) return [v.x!, v.y ?? 0, v.z ?? 0, v.w ?? 0].slice(0, n);
  if ("r" in v) return [v.r!, v.g ?? 0, v.b ?? 0, v.a ?? 1].slice(0, n);
  return Array(n).fill(0);
}

function vector(
  msl: string,
  element: DataType<number>,
  count: number,
  /** Metal pads a 3-component vector to 4 unless it is `packed_`. */
  padded: boolean,
): DataType<VecInput> {
  const slots = padded && count === 3 ? 4 : count;
  return {
    size: element.size * slots,
    alignment: padded ? element.size * (count === 3 ? 4 : count) : element.size,
    msl,
    kind: msl,
    write(view, offset, value) {
      const c = components(value, count);
      for (let i = 0; i < count; i++) element.write(view, offset + i * element.size, c[i] ?? 0);
    },
    read(view, offset) {
      const out: number[] = [];
      for (let i = 0; i < count; i++) out.push(element.read(view, offset + i * element.size));
      return out;
    },
  };
}

export const vec2f = vector("float2", f32, 2, true);
export const vec3f = vector("float3", f32, 3, true);
export const vec4f = vector("float4", f32, 4, true);
export const vec2u = vector("uint2", u32, 2, true);
export const vec3u = vector("uint3", u32, 3, true);
export const vec4u = vector("uint4", u32, 4, true);
export const vec2i = vector("int2", i32, 2, true);
export const vec3i = vector("int3", i32, 3, true);
export const vec4i = vector("int4", i32, 4, true);

/** Tightly packed, for vertex buffers where every byte of stride counts. */
export const packed3f = vector("packed_float3", f32, 3, false);
export const packed2f = vector("packed_float2", f32, 2, false);

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

function matrix(msl: string, columns: number, rows: number): DataType<ArrayLike<number>> {
  // Each column is a padded vector, so a float3x3 is three float4s worth.
  const columnStride = rows === 3 ? 16 : rows * 4;
  return {
    size: columnStride * columns,
    alignment: 16,
    msl,
    kind: msl,
    write(view, offset, value) {
      // Input is column-major and dense (9 or 16 floats), which is what the
      // math module produces; the padding is inserted here.
      for (let c = 0; c < columns; c++) {
        for (let r = 0; r < rows; r++) {
          view.setFloat32(offset + c * columnStride + r * 4, Number(value[c * rows + r] ?? 0), LE);
        }
      }
    },
    read(view, offset) {
      const out: number[] = [];
      for (let c = 0; c < columns; c++) {
        for (let r = 0; r < rows; r++) out.push(view.getFloat32(offset + c * columnStride + r * 4, LE));
      }
      return out;
    },
  };
}

export const mat2x2f = matrix("float2x2", 2, 2);
export const mat3x3f = matrix("float3x3", 3, 3);
export const mat4x4f = matrix("float4x4", 4, 4);

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

export interface StructField {
  name: string;
  type: DataType;
  offset: number;
}

export interface StructType<T extends Record<string, any> = Record<string, any>> extends DataType<T> {
  readonly fields: readonly StructField[];
  readonly name: string;
  /** Byte offset of one field, for writing a single member in place. */
  offsetOf(field: keyof T & string): number;
  /** The MSL `struct { ... };` for this type and anything it contains. */
  declare(): string;
  declarations(): string[];
}

let anonymousStructs = 0;

/**
 * Declare a struct once, use it on both sides.
 *
 *   const Fixture = struct("Fixture", {
 *     transform: mat4x4f,
 *     color: vec4f,
 *     intensity: f32,
 *   });
 *
 * Field order is preserved, and padding is inserted exactly where Metal expects
 * it — so writing a field the shader does not expect is a type error rather
 * than a silently corrupt frame.
 */
export function struct<T extends Record<string, DataType<any>>>(
  name: string,
  fields: T,
): StructType<{ [K in keyof T]?: T[K] extends DataType<infer V> ? V : never }> {
  const entries = Object.entries(fields) as Array<[string, DataType]>;
  if (entries.length === 0) throw new Error(`struct ${name} has no fields`);

  let offset = 0;
  let alignment = 1;
  const laid: StructField[] = [];
  for (const [fieldName, type] of entries) {
    offset = roundUp(offset, type.alignment);
    laid.push({ name: fieldName, type, offset });
    offset += type.size;
    alignment = Math.max(alignment, type.alignment);
  }
  return structWithLayout(name, laid, roundUp(offset, alignment), alignment);
}

/**
 * A struct whose offsets are given rather than computed.
 *
 * `struct()` derives the layout from Metal's rules, which is what you want when
 * the schema is the source of truth. This is the other direction: the shader is
 * the source of truth and the layout came back from the compiler's reflection,
 * so nothing here is inferred and nothing can disagree.
 */
export function structWithLayout(
  name: string,
  laid: StructField[],
  size: number,
  alignment: number,
): StructType<any> {
  const byName = new Map(laid.map((f) => [f.name, f]));

  const self: StructType<any> = {
    size,
    alignment,
    msl: name,
    kind: `struct ${name}`,
    fields: laid,
    name,

    offsetOf(field: string) {
      const f = byName.get(field);
      if (!f) throw new Error(`struct ${name} has no field "${field}"`);
      return f.offset;
    },

    write(view, base, value) {
      if (value === undefined || value === null) return;
      for (const f of laid) {
        const v = (value as Record<string, unknown>)[f.name];
        if (v !== undefined) f.type.write(view, base + f.offset, v as never);
      }
    },

    read(view, base) {
      const out: Record<string, unknown> = {};
      for (const f of laid) out[f.name] = f.type.read(view, base + f.offset);
      return out;
    },

    declarations() {
      // Nested structs must be declared before this one.
      const out: string[] = [];
      for (const f of laid) {
        for (const d of f.type.declarations?.() ?? []) if (!out.includes(d)) out.push(d);
      }
      const body = laid
        .map((f) => `  ${f.type.msl} ${f.name};  // offset ${f.offset}`)
        .join("\n");
      const decl = `struct ${name} {\n${body}\n};`;
      if (!out.includes(decl)) out.push(decl);
      return out;
    },

    declare() {
      return self.declarations().join("\n\n");
    },
  };
  return self;
}

/** A struct whose name does not matter, for one-off uniform blocks. */
export function anonStruct<T extends Record<string, DataType<any>>>(fields: T) {
  return struct(`Anon${anonymousStructs++}`, fields);
}

// ---------------------------------------------------------------------------
// Arrays
// ---------------------------------------------------------------------------

export interface ArrayType<T> extends DataType<readonly T[]> {
  readonly element: DataType<T>;
  readonly length: number;
  readonly stride: number;
  /** Byte offset of one element. */
  offsetAt(index: number): number;
  declarations(): string[];
}

export function arrayOf<T>(element: DataType<T>, length: number): ArrayType<T> {
  const stride = strideOf(element);
  return {
    size: stride * length,
    alignment: element.alignment,
    msl: `${element.msl}[${length}]`,
    kind: `array<${element.kind}, ${length}>`,
    element,
    length,
    stride,
    offsetAt: (index) => index * stride,
    write(view, base, value) {
      const n = Math.min(length, value?.length ?? 0);
      for (let i = 0; i < n; i++) element.write(view, base + i * stride, value![i]!);
    },
    read(view, base) {
      const out: T[] = [];
      for (let i = 0; i < length; i++) out.push(element.read(view, base + i * stride));
      return out;
    },
    declarations: () => element.declarations?.() ?? [],
  };
}

// ---------------------------------------------------------------------------
// Introspection, for error messages and tests
// ---------------------------------------------------------------------------

/** A human-readable layout table. Printing this beats guessing at padding. */
export function describeLayout(type: DataType): string {
  const rows: string[] = [`${type.kind}  size ${type.size}  align ${type.alignment}`];
  const s = type as Partial<StructType>;
  if (s.fields) {
    for (const f of s.fields) {
      rows.push(
        `  +${String(f.offset).padStart(4)}  ${f.name.padEnd(18)} ${f.type.msl.padEnd(14)}` +
          ` size ${f.type.size}`,
      );
    }
    const used = s.fields.reduce((n, f) => n + f.type.size, 0);
    if (used < type.size) rows.push(`  (${type.size - used} bytes of padding)`);
  }
  return rows.join("\n");
}
