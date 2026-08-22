// Windows entry — re-exports the WinUI 3 implementation.
export * from "./ui.ts";
export { windowsBackend } from "./backend.ts";
export { winLib, winBridgePath } from "./ffi.ts";
export type { NativeHandle } from "./ffi.ts";
