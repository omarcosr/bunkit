// parity.ts — macOS-API parity of the Windows backend: the composite controls
// (GroupBox / Segmented / Table), menu, beep and the tolerant escape-hatch
// proxies that keep the example sources identical across platforms.
//
//   bun test/win/parity.ts
import {
  Window, VStack, HStack, Label, Button, GroupBox, Segmented, Table,
  TextArea, beep, objc,
} from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log("  ok:", msg);
  else { failures++; console.error("  FAIL:", msg); }
}

await windowsBackend.init();

// --- composite controls --------------------------------------------------------

let selected = -1;
const table = new Table<{ name: string; score: number }>({
  columns: [
    { id: "name", title: "Name", width: 120 },
    { id: "score", title: "Score", width: 60, align: "right" },
  ],
  rows: [
    { name: "Ada", score: 98 },
    { name: "Alan", score: 97 },
  ],
  rowHeight: 26,
  onSelect: (_row, i) => { selected = i; },
});

let doubled = -1;
const seg = new Segmented({
  items: ["List", "Grid", "Cards"],
  onChange: (i) => { doubled = i; },
});

const box = new GroupBox({ title: "Details", padding: 10 }, [
  new VStack({ spacing: 8 }, [table, seg]),
]);

const log = new TextArea({ value: "", editable: false, font: { monospace: true, size: 11 } });
const title = new Label({ text: "Title", font: { style: "title", weight: "semibold" } });
const secondary = new Label({ text: "secondary", color: "secondaryLabel" });

const win = new Window({
  title: "Parity",
  size: { width: 480, height: 320 },
  minSize: { width: 360, height: 240 },
  content: new VStack({ spacing: 10, padding: 12 }, [title, secondary, box, log]),
});

windowsBackend.setMenu(win.handle, "File\x1fNew Task|cmd+n|1\x1f|0|0\x1ePreferences\x1fSettings...|cmd+,|2",
  (itemId) => { log.value += `menu ${itemId}\n`; });

await Bun.sleep(600);

// --- table roundtrip -----------------------------------------------------------

table.select(1);
for (let i = 0; i < 20; i++) { windowsBackend.pump(); await Bun.sleep(5); }
check(table.selectedIndex === 1, "table.select -> selectedIndex");
check(selected === 1, "table onSelect fired with row index");

table.append({ name: "Grace", score: 96 });
check(table.rows.length === 3 && table.selectedIndex === 1, "append keeps selection");
table.removeAt(0);
check(table.rows.length === 2 && table.rows[0]!.name === "Alan", "removeAt splices rows");
table.rows = [{ name: "X", score: 1 }];
check(table.rows.length === 1, "rows setter reloads");

// --- segmented roundtrip -------------------------------------------------------

seg.selectedIndex = 2;
for (let i = 0; i < 20; i++) { windowsBackend.pump(); await Bun.sleep(5); }
check(seg.selectedIndex === 2, "segmented set/get selected");
// No user interaction here, so onChange must not have fired spuriously.
check(doubled === -1, "programmatic segment set is silent");

// --- escape hatches -------------------------------------------------------------

let survived = true;
try {
  (win as any).native.setTitlebarAppearsTransparent_(true);
  (log as any).textView.scrollRangeToVisible_({ location: 0, length: 0 });
  objc.NSProcessInfo.processInfo().processName();
} catch (err) {
  survived = false;
  console.error(err);
}
check(survived, "tolerant proxies swallow AppKit escape hatches");

beep();
check(true, "beep does not throw");

// --- teardown -------------------------------------------------------------------

win.close();
await Bun.sleep(400);
console.log(failures === 0 ? "PARITY OK" : `PARITY FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
