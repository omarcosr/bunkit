// src/platform/windows/strings.ts — UTF-8 helpers for the C ABI.
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toCStr(s: string): { ptr: Buffer; len: number } {
  const bytes = enc.encode(s);
  const buf = Buffer.alloc(bytes.length);
  Buffer.from(bytes).copy(buf);
  return { ptr: buf, len: bytes.length };
}

export function fromBytes(buf: Buffer, len: number): string {
  return dec.decode(buf.subarray(0, len));
}

export function readString(handle: bigint, lengthFn: (h: bigint) => number, copyFn: (h: bigint, buf: Buffer, cap: number) => number): string {
  const len = lengthFn(handle);
  if (len === 0) return "";
  const buf = Buffer.alloc(len + 1);
  copyFn(handle, buf, len + 1);
  return dec.decode(buf.subarray(0, len));
}
