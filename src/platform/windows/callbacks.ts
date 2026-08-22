// src/platform/windows/callbacks.ts — JS callback registry, ids cross the ABI.
let nextId = 1n;
const map = new Map<bigint, (...args: any[]) => void>();

export function register(fn: (...args: any[]) => void): bigint {
  const id = nextId++;
  map.set(id, fn);
  return id;
}

export function unregister(id: bigint): void {
  map.delete(id);
}

export function get(id: bigint): ((...args: any[]) => void) | undefined {
  return map.get(id);
}

export function clear(): void {
  map.clear();
}
