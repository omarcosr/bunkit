// Struct marshalling.
//
// Objective-C type encodings carry a struct's *name* and its field types, but
// not its field names ("{CGRect={CGPoint=dd}{CGSize=dd}}"). So the shim computes
// sizes and offsets, and this table supplies the names. Anything not listed here
// still round-trips as raw bytes.

export interface StructDef {
  name: string;
  size: number;
  read(dv: DataView, off: number): any;
  write(dv: DataView, off: number, v: any): void;
}

const le = true; // all Apple platforms we target are little-endian

function d(dv: DataView, o: number) {
  return dv.getFloat64(o, le);
}
function sd(dv: DataView, o: number, v: number) {
  dv.setFloat64(o, Number(v) || 0, le);
}
function u64(dv: DataView, o: number) {
  const v = dv.getBigUint64(o, le);
  return v <= 9007199254740991n ? Number(v) : v;
}
function su64(dv: DataView, o: number, v: any) {
  dv.setBigUint64(o, BigInt(Math.trunc(Number(v)) || 0), le);
}

export const STRUCTS: Record<string, StructDef> = {
  CGPoint: {
    name: "CGPoint",
    size: 16,
    read: (dv, o) => ({ x: d(dv, o), y: d(dv, o + 8) }),
    write: (dv, o, v) => {
      sd(dv, o, v?.x ?? 0);
      sd(dv, o + 8, v?.y ?? 0);
    },
  },
  CGSize: {
    name: "CGSize",
    size: 16,
    read: (dv, o) => ({ width: d(dv, o), height: d(dv, o + 8) }),
    write: (dv, o, v) => {
      sd(dv, o, v?.width ?? v?.w ?? 0);
      sd(dv, o + 8, v?.height ?? v?.h ?? 0);
    },
  },
  CGRect: {
    name: "CGRect",
    size: 32,
    // Flattened on the JS side — {x, y, width, height} is what anyone actually
    // wants to type. Nested {origin, size} is accepted on write too.
    read: (dv, o) => ({
      x: d(dv, o),
      y: d(dv, o + 8),
      width: d(dv, o + 16),
      height: d(dv, o + 24),
    }),
    write: (dv, o, v) => {
      const x = v?.x ?? v?.origin?.x ?? 0;
      const y = v?.y ?? v?.origin?.y ?? 0;
      const w = v?.width ?? v?.w ?? v?.size?.width ?? 0;
      const h = v?.height ?? v?.h ?? v?.size?.height ?? 0;
      sd(dv, o, x);
      sd(dv, o + 8, y);
      sd(dv, o + 16, w);
      sd(dv, o + 24, h);
    },
  },
  CGVector: {
    name: "CGVector",
    size: 16,
    read: (dv, o) => ({ dx: d(dv, o), dy: d(dv, o + 8) }),
    write: (dv, o, v) => {
      sd(dv, o, v?.dx ?? 0);
      sd(dv, o + 8, v?.dy ?? 0);
    },
  },
  _NSRange: {
    name: "_NSRange",
    size: 16,
    read: (dv, o) => ({ location: u64(dv, o), length: u64(dv, o + 8) }),
    write: (dv, o, v) => {
      su64(dv, o, v?.location ?? 0);
      su64(dv, o + 8, v?.length ?? 0);
    },
  },
  NSEdgeInsets: {
    name: "NSEdgeInsets",
    size: 32,
    read: (dv, o) => ({
      top: d(dv, o),
      left: d(dv, o + 8),
      bottom: d(dv, o + 16),
      right: d(dv, o + 24),
    }),
    write: (dv, o, v) => {
      sd(dv, o, v?.top ?? 0);
      sd(dv, o + 8, v?.left ?? 0);
      sd(dv, o + 16, v?.bottom ?? 0);
      sd(dv, o + 24, v?.right ?? 0);
    },
  },
  CGAffineTransform: {
    name: "CGAffineTransform",
    size: 48,
    read: (dv, o) => ({
      a: d(dv, o), b: d(dv, o + 8), c: d(dv, o + 16),
      d: d(dv, o + 24), tx: d(dv, o + 32), ty: d(dv, o + 40),
    }),
    write: (dv, o, v) => {
      sd(dv, o, v?.a ?? 1); sd(dv, o + 8, v?.b ?? 0); sd(dv, o + 16, v?.c ?? 0);
      sd(dv, o + 24, v?.d ?? 1); sd(dv, o + 32, v?.tx ?? 0); sd(dv, o + 40, v?.ty ?? 0);
    },
  },
};

// Encoding aliases: NSRect and friends are typedefs of the CG structs, so the
// runtime only ever emits the CG names. These are here for completeness.
STRUCTS.NSPoint = STRUCTS.CGPoint;
STRUCTS.NSSize = STRUCTS.CGSize;
STRUCTS.NSRect = STRUCTS.CGRect;
STRUCTS.NSRange = STRUCTS._NSRange;

/** Extract "CGRect" from "{CGRect={CGPoint=dd}{CGSize=dd}}". */
export function structName(encoding: string): string | null {
  if (encoding.length < 2) return null;
  const open = encoding[0];
  if (open !== "{" && open !== "(") return null;
  let i = 1;
  while (i < encoding.length && encoding[i] !== "=" && encoding[i] !== "}" && encoding[i] !== ")") i++;
  const n = encoding.slice(1, i);
  return n === "?" || n === "" ? null : n;
}

export function structDef(encoding: string): StructDef | null {
  const n = structName(encoding);
  return n ? (STRUCTS[n] ?? null) : null;
}

// --- convenience constructors ---------------------------------------------
export const Rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
export const Point = (x: number, y: number) => ({ x, y });
export const Size = (width: number, height: number) => ({ width, height });
export const Range = (location: number, length: number) => ({ location, length });
export const Insets = (top: number, left: number, bottom: number, right: number) => ({ top, left, bottom, right });

export type CGRect = { x: number; y: number; width: number; height: number };
export type CGPoint = { x: number; y: number };
export type CGSize = { width: number; height: number };
export type NSRange = { location: number; length: number };
export type NSEdgeInsets = { top: number; left: number; bottom: number; right: number };
