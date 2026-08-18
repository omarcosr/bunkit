// What the compiler knows about a shader, handed back to JavaScript.
//
// Metal will tell you the name, stage, index and full byte layout of every
// argument a pipeline takes. That turns two of the most tedious parts of GPU
// programming into nothing:
//
//   - Binding by index becomes binding by name. `bind({ globals, albedo })`
//     looks each one up and sets it on the right stage at the right slot, so
//     renumbering a shader's buffers cannot silently break the CPU side.
//
//   - Packing a uniform struct becomes optional. The layout below is built from
//     the compiler's own member offsets, so a plain JavaScript object can be
//     written into a `constant Globals&` with nothing declared twice.
//
// The typed schemas in types.ts go the other way — declare once, generate the
// MSL — and both directions are worth having. Use a schema when you want the
// TypeScript types; use this when the shader already exists and you just want
// it to work.

import { NIL } from "../bridge.ts";
import type { MTLObject } from "./gpu.ts";
import {
  f32, i32, u32,
  mat2x2f, mat3x3f, mat4x4f,
  structWithLayout,
  vec2f, vec3f, vec4f, vec2i, vec3i, vec4i, vec2u, vec3u, vec4u,
  type DataType, type StructField, type StructType,
} from "./types.ts";

/** MTLBindingType, which is also the older MTLArgumentType. */
export const BindingType = { buffer: 0, threadgroupMemory: 1, texture: 2, sampler: 3 } as const;

/** MTLDataType, for the members a reflected struct reports. */
const DATA_TYPES: Record<number, DataType> = {
  3: f32, 4: vec2f, 5: vec3f, 6: vec4f,
  7: mat2x2f, 11: mat3x3f, 15: mat4x4f,
  29: i32, 30: vec2i, 31: vec3i, 32: vec4i,
  33: u32, 34: vec2u, 35: vec3u, 36: vec4u,
  // Bool is a byte in MSL, but only ever appears padded inside a struct, and
  // writing 0/1 into the low byte is correct either way.
  53: { ...u32, size: 1, alignment: 1, msl: "bool", kind: "bool" },
};

export type Stage = "vertex" | "fragment" | "compute";

export interface Binding {
  readonly name: string;
  readonly kind: keyof typeof BindingType;
  /** The slot this binding occupies, per stage. A name may differ between them. */
  readonly slots: Partial<Record<Stage, number>>;
  /** Bytes the shader expects, for buffer bindings. */
  readonly size: number;
  /**
   * The layout the compiler reported for this buffer.
   *
   * A struct type when the shader takes one, and a plain vector or scalar type
   * when it takes `constant float2&`. Null for a `device T*` pointer, where
   * there is no single value to pack — that binding wants a real buffer.
   */
  readonly layout: DataType | null;
  /** The same layout when it is a struct, for field-level access. */
  readonly struct: StructType | null;
}

/**
 * Every argument a pipeline takes, addressable by name.
 *
 * Names come from the shader's parameter list, not from the struct type — a
 * `constant Globals &g` is called "g" here, because that is what the compiler
 * reports and what the binding actually is.
 */
export class BindingTable {
  #byName = new Map<string, Binding>();

  /** Merge one stage's reflected arguments in. */
  add(stage: Stage, args: MTLObject): void {
    if (!args || args.ptr === NIL) return;
    const count = Number(args.count());
    for (let i = 0; i < count; i++) {
      const arg = args.objectAtIndex_(i);
      const name = String(arg.name());
      const type = Number(arg.type());
      const index = Number(arg.index());

      const existing = this.#byName.get(name);
      if (existing) {
        (existing.slots as Record<string, number>)[stage] = index;
        continue;
      }

      let struct: StructType | null = null;
      let layout: DataType | null = null;
      let size = 0;
      if (type === BindingType.buffer) {
        size = Number(arg.bufferDataSize());
        struct = structFrom(name, arg.bufferStructType(), size);
        // Not a struct: `constant float2 &direction` reports its own data type,
        // and packing [1, 0] into it should just work.
        layout = struct ?? DATA_TYPES[Number(arg.bufferDataType())] ?? null;
      }
      this.#byName.set(name, {
        name,
        kind: (Object.keys(BindingType) as Array<keyof typeof BindingType>)
          .find((k) => BindingType[k] === type) ?? "buffer",
        slots: { [stage]: index },
        size,
        layout,
        struct,
      });
    }
  }

  get(name: string): Binding | undefined {
    return this.#byName.get(name);
  }

  has(name: string): boolean {
    return this.#byName.has(name);
  }

  get names(): string[] {
    return [...this.#byName.keys()];
  }

  get all(): Binding[] {
    return [...this.#byName.values()];
  }

  /** What to print when a name does not exist. */
  describe(): string {
    if (this.#byName.size === 0) return "(the pipeline reports no bindings)";
    return this.all
      .map((b) => {
        const where = Object.entries(b.slots).map(([s, i]) => `${s} ${i}`).join(", ");
        const shape = b.struct
          ? ` {${b.struct.fields.map((f) => f.name).join(", ")}}`
          : b.layout ? ` ${b.layout.msl}`
          : b.size ? ` ${b.size} bytes` : "";
        return `  ${b.name}  ${b.kind} [${where}]${shape}`;
      })
      .join("\n");
  }
}

/** Turn an MTLStructType into a schema, using the compiler's own offsets. */
function structFrom(name: string, mtl: MTLObject, size: number): StructType | null {
  if (!mtl || mtl.ptr === NIL) return null;
  const members = mtl.members();
  if (!members || members.ptr === NIL) return null;

  const count = Number(members.count());
  const fields: StructField[] = [];
  let alignment = 1;
  for (let i = 0; i < count; i++) {
    const member = members.objectAtIndex_(i);
    const dataType = Number(member.dataType());
    const type = DATA_TYPES[dataType];
    // An unmapped member (a nested struct, an array, a half) leaves a hole
    // rather than a wrong offset for everything after it: the fields we do
    // understand keep their real offsets, and writing the rest needs a schema.
    if (!type) continue;
    fields.push({ name: String(member.name()), type, offset: Number(member.offset()) });
    alignment = Math.max(alignment, type.alignment);
  }
  if (fields.length === 0) return null;
  return structWithLayout(name, fields, size || 16, alignment);
}

/** Pull both stages off an MTLRenderPipelineReflection. */
export function renderBindings(reflection: MTLObject): BindingTable {
  const table = new BindingTable();
  if (!reflection || reflection.ptr === NIL) return table;
  table.add("vertex", stageArguments(reflection, "vertex"));
  table.add("fragment", stageArguments(reflection, "fragment"));
  return table;
}

export function computeBindings(reflection: MTLObject): BindingTable {
  const table = new BindingTable();
  if (!reflection || reflection.ptr === NIL) return table;
  table.add("compute", stageArguments(reflection, ""));
  return table;
}

/**
 * `bindings` since macOS 13, `arguments` before it, and the old name still
 * works on current systems — so try the new one and fall back rather than
 * gating on a version number.
 */
function stageArguments(reflection: MTLObject, stage: string): MTLObject {
  const prefix = stage;
  for (const suffix of ["Bindings", "Arguments"]) {
    const selector = prefix ? prefix + suffix : suffix[0]!.toLowerCase() + suffix.slice(1);
    try {
      const args = reflection[selector]();
      if (args && args.ptr !== NIL) return args;
    } catch {
      // Not present on this SDK; try the other spelling.
    }
  }
  return null;
}
