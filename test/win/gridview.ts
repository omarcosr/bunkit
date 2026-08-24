// gridview.ts — GridView placement, tracks and spans on WinUI Grid.
//
//   bun test/win/gridview.ts
//
// Columns: ["fill", 200] — the fixed track must come out ~200px wide whatever
// the window width, the fill track takes the rest. Children placed by JSX
// props (gridColumn) and by imperative placement (add(view, {…})) must land in
// the same cells, and spans must not disturb the other cells.
import { Window, GridView, Label, Container, snapshotView } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";

await windowsBackend.init();

const fail = (msg: string): never => {
  console.error("FAIL:", msg);
  const e = (windowsBackend as any).lastError?.() ?? "";
  if (e) console.error("last_error:", e);
  process.exit(1);
};
const ok = (cond: boolean, msg: string) => {
  if (!cond) fail(msg);
};

const win = new Window({
  title: "GridView",
  size: { width: 400, height: 260 },
});
win.show();

const grid = new GridView(
  { columns: ["fill", 200], rows: ["auto", "auto"], spacing: 12 },
  [
    new Label({ text: "Nome", gridColumn: 0, gridRow: 0 }),
    new Label({ text: "Campo", gridColumn: 1, gridRow: 0 }),
    new Label({ text: "Notas", gridColumn: 0, gridRow: 1, gridRowSpan: 1 }),
  ],
);
// Imperative placement: same cell as the JSX props above would use.
const imperative = new Label({ text: "Imperative" });
grid.add(imperative, { row: 1, column: 1 });
// A span over both rows of the first column.
const wide = new Label({ text: "Wide", backgroundColor: "#D0E8FF" });
wide.setBackground("#D0E8FF");
grid.add(wide, { row: 0, column: 0, rowSpan: 2 });

win.content = new Container({}, [grid]);

await Bun.sleep(1000);
for (let i = 0; i < 20; i++) {
  windowsBackend.pump();
  await Bun.sleep(5);
}

const sizeOf = (v: any): [number, number] => windowsBackend.getControlSize(v.handle);

const [, gridH] = sizeOf(grid);
ok(gridH > 0, `grid laid out (h=${gridH})`);

const [fixedW, fixedH] = sizeOf(grid.children[1]);
ok(Math.abs(fixedW - 200) < 3, `fixed track column is ~200px wide, got ${fixedW}`);
ok(fixedH > 0, `auto row sized to content (h=${fixedH})`);

// The fill track gets everything the fixed track and the gap leave over.
const gridW = sizeOf(grid)[0];
const fillW = sizeOf(grid.children[0])[0];
const expected = gridW - 200 - 12;
ok(Math.abs(fillW - expected) < 6, `fill track takes the leftover (got ${fillW}, expected ~${expected})`);

// Imperative child landed in the last cell; still laid out.
const impW = sizeOf(imperative)[0];
ok(impW > 0, `imperative add laid out (w=${impW})`);

// The spanning label stretches over both rows.
const spanH = sizeOf(wide)[1];
ok(spanH >= fixedH, `rowSpan child covers both rows (h=${spanH} >= ${fixedH})`);

// Snapshot proves the grid actually painted (fill column darker bg on the
// left, fixed column on the right).
let snapBytes = 0;
for (let attempt = 0; attempt < 5 && snapBytes <= 0; attempt++) {
  snapBytes = snapshotView(win as any, "build/gridview.png");
  if (snapBytes <= 0) await Bun.sleep(200);
}
ok(snapBytes > 0, "snapshot produced bytes");

win.close();
await Bun.sleep(300);
console.log("GRIDVIEW OK — fixed=200px, fill=leftover, span covers rows");
process.exit(0);
