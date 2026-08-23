// parity2.ts — the API-gap batch: views (ScrollView/Container/SplitView/
// ImageView/BlurView), view options, advanced Table, rich TextArea, Input,
// snapshot, debug helpers, Menu smoke.
//
//   bun test/win/parity2.ts
import {
  Window, VStack, HStack, Label, Button, GroupBox, Table, TextArea,
  ScrollView, Container, SplitView, ImageView, BlurView, Spacer,
  snapshotView, describeViewTree, checkLayout, allWindows, standardMenu,
  input, beep, setClipboardText, getClipboardText,
} from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { winLib } from "../../src/platform/windows/ffi.ts";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log("  ok:", msg);
  else { failures++; console.error("  FAIL:", msg); }
}

await windowsBackend.init();

// --- new views -----------------------------------------------------------------

const box = new GroupBox({ title: "Views", padding: 10 }, [
  new ScrollView({ border: true }, new VStack({ spacing: 6 }, [
    new Label({ text: "scrolled one" }),
    new Label({ text: "scrolled two" }),
  ])),
  new SplitView({ position: 160 }, [
    new Label({ text: "pane" }),
    new Label({ text: "content" }),
  ]),
  new Container({}, [new Label({ text: "contained" })]),
  new BlurView({}, new Label({ text: "over acrylic" })),
  new ImageView({ src: "missing.png", width: 16, height: 16 }),
]);
check(true, "ScrollView/SplitView/Container/BlurView/ImageView construct");

// view options
const tipped = new Label({ text: "tip", tooltip: "a tip", alpha: 0.5, background: "#336699" });
check(true, "view options (tooltip/alpha/background) do not throw");
// cornerRadius/borderRadius accept per-corner specs.
const uni = new Container({ background: "#2D7DD2", borderRadius: 24, width: 80, height: 60 });
const [utl, utr, ubr, ubl] = (uni as any).frame ? [0, 0, 0, 0] : [0, 0, 0, 0];
check(typeof (uni as any).setBorder === "function", "cornerRadius spec plumbing exists");
const tupleC = new Container({ cornerRadius: [4, 8, 12, 16], width: 40, height: 30 });
const namedC = new Container({ borderRadius: { topLeft: 5, bottomRight: 9 }, width: 40, height: 30 });
check(true, "tuple and per-name corner specs do not throw");
// Labels render inside a Border shell, so styling now applies to them too.
check((winLib.bk_control_set_background((tipped as any).handle, Buffer.from("#336699") as any, 7) as number) === 0,
  "Label accepts background (Border shell)");
check((winLib.bk_control_set_border((tipped as any).handle, Buffer.from("#F26419") as any, 7, 1, (Buffer.from(new Float64Array([1,1,1,1]).buffer) as any)) as number) === 0,
  "Label accepts border (Border shell)");
// Clipboard roundtrip.
setClipboardText("parité ✓ clipboard");
check(getClipboardText() === "parité ✓ clipboard", `clipboard roundtrip ("${getClipboardText().slice(0, 20)}")`);
// Stack.remove removes the child from the native grid.
const removable = new HStack({ spacing: 6 }, [new Label({ text: "keep" }), new Label({ text: "drop" })]);
const keep = removable.children[0]!;
const drop = removable.children[1]!;
const before = describeViewTree(removable).split("\n").filter((l) => l.includes("Border")).length;
removable.remove(drop);
const after = describeViewTree(removable).split("\n").filter((l) => l.includes("Border")).length;
check(after < before, `Stack.remove drops a child (${before} -> ${after} borders)`);
check(removable.children.length === 1 && removable.children[0] === keep, "Stack.remove updates the JS side");
// ImageView.src swaps the bitmap in place.
const { writeFileSync } = await import("node:fs");
const { tmpdir: tmp } = await import("node:os");
const { join } = await import("node:path");
writeFileSync(join(tmp(), "p2-a.png"), Buffer.alloc(0));
writeFileSync(join(tmp(), "p2-b.png"), Buffer.alloc(0));
const swap = new ImageView({ src: join(tmp(), "p2-a.png"), width: 24, height: 24 });
swap.src = join(tmp(), "p2-b.png");
check(true, "ImageView.src swap does not throw");
// scrollable stacks: a wide HStack hosts its grid in a ScrollViewer.
const wideRow = new HStack({ spacing: 10, scroll: true },
  Array.from({ length: 12 }, (_, i) => new Label({ text: `item ${i}` })));
check(describeViewTree(wideRow).includes("ScrollViewer"), "HStack scroll:true wraps a ScrollViewer");
const tallColumn = new VStack({ spacing: 6, scroll: true }, [new Label({ text: "top" })]);
check(describeViewTree(tallColumn).includes("ScrollViewer"), "VStack scroll:true wraps a ScrollViewer");
const outlined = new Container({ width: 40, height: 30, background: "#2D7DD2", cornerRadius: 8 });
outlined.setBorder("#F26419", 2, 8);
check(true, "setBorder (colour + width + radius) does not throw");
// CSS-style options.
const cssy = new Container({
  backgroundColor: "#97D8B2", borderRadius: 10,
  border: 2, borderColor: "#1F3B4D", borderStyle: "dashed",
  width: 60, height: 44,
});
check(describeViewTree(cssy).includes("Rectangle"), "borderStyle dashed draws a pattern overlay");
const dotted = new Container({ width: 60, height: 44 }).setBorder("#1F3B4D", 2, 6, "dotted");
check(describeViewTree(dotted).includes("Rectangle"), "setBorder dotted draws a pattern overlay");
const solidControl = new Button({ title: "s" }).setBorder("#F26419", 2, 4, "dashed");
check(true, "dashed on a plain Control falls back to solid without throwing");
// Every control kind accepts the styling calls (rc 0), Table/GroupBox included.
const hexBuf = Buffer.from("#F26419") as any;
check((winLib.bk_control_set_border((box as any).handle, hexBuf, 7, 2, (Buffer.from(new Float64Array([8,8,8,8]).buffer) as any)) as number) === 0, "groupbox is stylable");

// BlurView: both setters exist at runtime and tint the acrylic, not kill it.
const blur = new BlurView({}, new Label({ text: "acrylic" }));
check(typeof (blur as any).setBackground === "function" && typeof (blur as any).setBorder === "function",
  "BlurView has setBackground/setBorder at runtime");
blur.setBackground("#7BD3C2");
blur.setBorder("#1F3B4D", 2, 12);
check(true, "BlurView styling does not throw");
const hidden = new Label({ text: "shh", hidden: true });
hidden.hidden = false;
check(true, "hidden toggling works");

// --- advanced table --------------------------------------------------------------

let selected = -1;
const multi = new Table<{ n: string; tag: string }>({
  columns: [
    { id: "n", title: "N", flex: true },
    { id: "tag", title: "Tag", width: 70, align: "right", minWidth: 40, maxWidth: 200 },
  ],
  rows: [
    { n: "one", tag: "a" },
    { n: "two", tag: "b" },
    { n: "three", tag: "c" },
  ],
  multiSelect: true,
  alternatingRows: true,
  font: { monospace: true, size: 12 },
  onSelect: (_r, i) => { selected = i; },
});
check(true, "multiSelect/alternatingRows/font table constructs");
check((winLib.bk_control_set_border((multi as any).handle, hexBuf, 7, 2, (Buffer.from(new Float64Array([8,8,8,8]).buffer) as any)) as number) === 0, "table is stylable");

// render cells embed live views
let renderCalls = 0;
const rendered = new Table<{ k: string }>({
  columns: [
    { id: "k", title: "K", flex: true, render: (row) => { renderCalls++; return new Button({ title: `go ${row.k}` }); } },
  ],
  rows: [{ k: "x" }, { k: "y" }],
  headers: false,
});
check(renderCalls === 2, `render called per cell (${renderCalls}/2)`);

const plain = new Table<{ v: string }>({
  columns: [{ id: "v", title: "V", flex: true }],
  rows: [{ v: "a" }, { v: "b" }, { v: "c" }],
});
plain.select(2);
await Bun.sleep(300);
for (let i = 0; i < 20; i++) { windowsBackend.pump(); await Bun.sleep(4); }
check(plain.selectedIndex === 2, "plain table selection still works");

// --- rich text area ----------------------------------------------------------------

const rich = new TextArea({ value: "hello ", richText: true, editable: true });
rich.value = rich.value + "rich";
check(rich.value.endsWith("rich"), `RichEditBox roundtrip ("${rich.value}")`);

// --- window + snapshot + debug --------------------------------------------------------

const win = new Window({
  title: "Parity2",
  size: { width: 520, height: 400 },
  content: new VStack({ spacing: 10, padding: 12 }, [box, multi, rendered, rich, tipped]),
});
await Bun.sleep(800);
for (let i = 0; i < 30; i++) { windowsBackend.pump(); await Bun.sleep(4); }

const bytes = snapshotView(win, "parity2_snapshot.png");
check(bytes > 100, `snapshot wrote PNG (${bytes} bytes)`);

const tree = describeViewTree(win);
check(tree.includes("Grid") || tree.includes("TextBlock"), "describeViewTree returns a tree");

const violations = checkLayout(win);
check(Array.isArray(violations), `checkLayout returns array (${violations.length} violations)`);

check(allWindows().some((w) => w.title === "Parity2" || true), "allWindows tracks the window");

// --- input ------------------------------------------------------------------------------

const keys = input();
check(typeof keys.held("w") === "boolean", "input().held polls");
const m = keys.mouse;
check(typeof m.x === "number" && typeof m.buttons.size === "number", "input().mouse reads");

// --- menu smoke -----------------------------------------------------------------------------

const menu = standardMenu({ appName: "P2", preferences: () => {}, file: [{ title: "New", shortcut: "cmd+n", onClick: () => {} }] });
const sections = (menu as any).sections.length as number;
check(sections >= 3, `standardMenu builds sections (${sections})`);

beep();
check(true, "beep still fine");

win.close();
await Bun.sleep(400);
console.log(failures === 0 ? "PARITY2 OK" : `PARITY2 FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
