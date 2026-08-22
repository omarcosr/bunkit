// src/index.ts — platform dispatch, preserves the public API on both OSes.
// Uses dynamic import so the Darwin UI code is never evaluated on Windows
// (its top-level `cfunction` calls would otherwise throw at import time).
export type * from "./ui/index.ts";

const isWin = process.platform === "win32";
const mod: any = isWin ? await import("./platform/windows/index.ts") : await import("./ui/index.ts");

export const Application = mod.Application;
export const Window = mod.Window;
export const Label = mod.Label;
export const Button = mod.Button;
export const TextField = mod.TextField;
export const VStack = mod.VStack;
export const HStack = mod.HStack;

export const Container = mod.Container;
export const Stack = mod.Stack;
export const View = mod.View;
export const ScrollView = mod.ScrollView;
export const GroupBox = mod.GroupBox;
export const BlurView = mod.BlurView;
export const SplitView = mod.SplitView;
export const Spacer = mod.Spacer;
export const Separator = mod.Separator;
export const ImageView = mod.ImageView;
export const Checkbox = mod.Checkbox;
export const Switch = mod.Switch;
export const Slider = mod.Slider;
export const Select = mod.Select;
export const Segmented = mod.Segmented;
export const Progress = mod.Progress;
export const Table = mod.Table;
export const TextArea = mod.TextArea;
export const alert = mod.alert;
export const confirm = mod.confirm;
export const prompt = mod.prompt;
export const openFile = mod.openFile;
export const beep = mod.beep;
export const objc = mod.objc;

// Metal layer. Present on macOS; undefined on Windows where the examples
// that use them exit early with a "requires macOS" message instead of a
// module-resolution crash.
export const GPUView = mod.GPUView;
export const Scene3D = mod.Scene3D;
export const gpu = mod.gpu;
export const gpuAvailable = mod.gpuAvailable;
export const struct = mod.struct;
export const msl = mod.msl;
export const vec4f = mod.vec4f;
export const f32 = mod.f32;
export const u32 = mod.u32;
export const box = mod.box;
export const plane = mod.plane;
export const sphere = mod.sphere;
