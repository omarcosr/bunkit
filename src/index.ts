// src/index.ts — platform dispatch, preserves the public API on both OSes.
// Uses dynamic import so the Darwin UI code is never evaluated on Windows
// (its top-level `cfunction` calls would otherwise throw at import time).
//
// Everything is typed against the Darwin layer: it is the superset API, and
// the Windows layer mirrors it. The cast at the import is the one place the
// shapes are trusted rather than checked — without it `mod.X` collapses to
// `any`, and `new Table<Row>(…)` / `onChange: (i) => …` lose their types.
export type * from "./ui/index.ts";

type Ui = typeof import("./ui/index.ts");

const isWin = process.platform === "win32";
const mod: Ui = isWin
  ? (await import("./platform/windows/index.ts")) as unknown as Ui
  : await import("./ui/index.ts");

export const Application: Ui["Application"] = mod.Application;
export const Window: Ui["Window"] = mod.Window;
export const Label: Ui["Label"] = mod.Label;
export const Button: Ui["Button"] = mod.Button;
export const TextField: Ui["TextField"] = mod.TextField;
export const VStack: Ui["VStack"] = mod.VStack;
export const HStack: Ui["HStack"] = mod.HStack;

export const Container: Ui["Container"] = mod.Container;
export const Stack: Ui["Stack"] = mod.Stack;
export const View: Ui["View"] = mod.View;
export const ScrollView: Ui["ScrollView"] = mod.ScrollView;
export const GroupBox: Ui["GroupBox"] = mod.GroupBox;
export const BlurView: Ui["BlurView"] = mod.BlurView;
export const SplitView: Ui["SplitView"] = mod.SplitView;
export const Spacer: Ui["Spacer"] = mod.Spacer;
export const Separator: Ui["Separator"] = mod.Separator;
export const ImageView: Ui["ImageView"] = mod.ImageView;
export const loadImage: Ui["loadImage"] = mod.loadImage;
export const saveFile: Ui["saveFile"] = mod.saveFile;
export const notify: Ui["notify"] = mod.notify;
export const Menu: Ui["Menu"] = mod.Menu;
export const standardMenu: Ui["standardMenu"] = mod.standardMenu;
export const popUpMenu: Ui["popUpMenu"] = mod.popUpMenu;
export const Input: Ui["Input"] = mod.Input;
export const input: Ui["input"] = mod.input;
export const snapshotView: Ui["snapshotView"] = mod.snapshotView;
export const snapshotWindow: Ui["snapshotWindow"] = mod.snapshotWindow;
export const describeViewTree: Ui["describeViewTree"] = mod.describeViewTree;
export const checkLayout: Ui["checkLayout"] = mod.checkLayout;
export const actionTarget: Ui["actionTarget"] = mod.actionTarget;
export const makeFont: Ui["makeFont"] = mod.makeFont;
export const toNSColor: Ui["toNSColor"] = mod.toNSColor;
export const allWindows: Ui["allWindows"] = mod.allWindows;

export const Checkbox: Ui["Checkbox"] = mod.Checkbox;
export const Switch: Ui["Switch"] = mod.Switch;
export const Slider: Ui["Slider"] = mod.Slider;
export const Select: Ui["Select"] = mod.Select;
export const Segmented: Ui["Segmented"] = mod.Segmented;
export const Progress: Ui["Progress"] = mod.Progress;
export const Table: Ui["Table"] = mod.Table;
export const TextArea: Ui["TextArea"] = mod.TextArea;
export const alert: Ui["alert"] = mod.alert;
export const confirm: Ui["confirm"] = mod.confirm;
export const prompt: Ui["prompt"] = mod.prompt;
export const openFile: Ui["openFile"] = mod.openFile;
export const setClipboardText: Ui["setClipboardText"] = mod.setClipboardText;
export const getClipboardText: Ui["getClipboardText"] = mod.getClipboardText;
export const beep: Ui["beep"] = mod.beep;
export const objc: Ui["objc"] = mod.objc;

// Metal layer. Present on macOS; undefined on Windows where the examples
// that use them exit early with a "requires macOS" message instead of a
// module-resolution crash.
export const GPUView: Ui["GPUView"] = mod.GPUView;
export const Scene3D: Ui["Scene3D"] = mod.Scene3D;
export const gpu: Ui["gpu"] = mod.gpu;
export const gpuAvailable: Ui["gpuAvailable"] = mod.gpuAvailable;
export const struct: Ui["struct"] = mod.struct;
export const msl: Ui["msl"] = mod.msl;
export const vec4f: Ui["vec4f"] = mod.vec4f;
export const f32: Ui["f32"] = mod.f32;
export const u32: Ui["u32"] = mod.u32;
export const box: Ui["box"] = mod.box;
export const plane: Ui["plane"] = mod.plane;
export const sphere: Ui["sphere"] = mod.sphere;
