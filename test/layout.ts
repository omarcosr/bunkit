// Layout harness — renders a set of layouts, dumps their view trees, and
// asserts the geometry. Run with BUNKIT_SHOTS=<dir> to also write PNGs.

import {
  Button,
  Checkbox,
  GroupBox,
  HStack,
  Label,
  Progress,
  Segmented,
  Select,
  Separator,
  Slider,
  Spacer,
  Switch,
  Table,
  TextArea,
  TextField,
  VStack,
  View,
  Window,
  describeViewTree,
  snapshotWindow,
} from "../src/ui/index.ts";
import { pumpOnce } from "../src/runtime.ts";

const SHOTS = process.env.BUNKIT_SHOTS;
let failures = 0;

function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

function settle(w: Window, n = 12) {
  // Auto Layout resolves on the next display pass, so give AppKit a few turns.
  w.native.layoutIfNeeded();
  for (let i = 0; i < n; i++) pumpOnce(0.004);
  w.native.contentView().layoutSubtreeIfNeeded();
}

function show(name: string, w: Window, root: View) {
  settle(w);
  if (SHOTS) {
    try {
      snapshotWindow(w, `${SHOTS}/${name}.png`);
    } catch (e: any) {
      console.log(`  (snapshot failed: ${e.message})`);
    }
  }
  if (process.env.BUNKIT_TREE) console.log(describeViewTree(root));
}

const W = 800;
const H = 500;

// ---------------------------------------------------------------------------
// 1. A vertical stack should fill the window's width
// ---------------------------------------------------------------------------
{
  const a = new Label({ text: "top" });
  const b = new Label({ text: "bottom" });
  const stack = new VStack({ spacing: 10, padding: 20 }, [a, b, new Spacer()]);
  const w = new Window({ title: "vstack", size: { width: W, height: H }, content: stack, show: false });
  show("01-vstack", w, stack);
  check("vstack fills width", stack.frame.width === W, stack.frame.width);
  check("vstack fills height", stack.frame.height === H, stack.frame.height);
  check("child inside padding", Math.abs(a.alignmentRect.x - 20) < 0.5, a.alignmentRect.x);
  check(
    "child stretches to padded width",
    Math.abs(a.alignmentRect.width - (W - 40)) < 1,
    a.alignmentRect.width,
  );
  w.close();
}

// ---------------------------------------------------------------------------
// 2. A horizontal stack should share width and fill height
// ---------------------------------------------------------------------------
{
  const leftLabel = new Label({ text: "L" });
  const left = new GroupBox({ title: "left", padding: 10 }, [leftLabel]);
  const right = new GroupBox({ title: "right", padding: 10 }, [new Label({ text: "R" })]);
  const row = new HStack({ spacing: 12 }, [left, right]);
  const stack = new VStack({ spacing: 10, padding: 16 }, [row]);
  const w = new Window({ title: "hstack", size: { width: W, height: H }, content: stack, show: false });
  show("02-hstack", w, stack);

  check("row fills width", Math.abs(row.frame.width - (W - 32)) < 1, row.frame.width);
  check("left starts at 0 within the row", left.frame.x === 0, left.frame.x);
  check(
    "right is inside the row",
    right.frame.x + right.frame.width <= row.frame.width + 0.5,
    `${right.frame.x} + ${right.frame.width} vs ${row.frame.width}`,
  );
  check("boxes do not overlap", left.frame.x + left.frame.width <= right.frame.x + 0.5,
    `${left.frame.x + left.frame.width} vs ${right.frame.x}`);
  check("left box has content", left.contentStack.frame.width > 0, left.contentStack.frame.width);
  check(
    "group box padding is applied to its children",
    Math.abs(leftLabel.alignmentRect.x - 10) < 0.5,
    leftLabel.alignmentRect.x,
  );
  check(
    "group box title sits above the body",
    !!left.titleLabel && left.titleLabel!.frame.y > left.contentStack.frame.y,
    `${left.titleLabel?.frame.y} vs ${left.contentStack.frame.y}`,
  );
  w.close();
}

// ---------------------------------------------------------------------------
// 3. Fixed-width children keep their width; spacer absorbs the rest
// ---------------------------------------------------------------------------
{
  const label = new Label({ text: "Name", width: 60 });
  const field = new TextField({ placeholder: "value", grow: 1 });
  const btn = new Button({ title: "Go" });
  const row = new HStack({ spacing: 8, align: "center" }, [label, field, btn]);
  const stack = new VStack({ spacing: 10, padding: 16 }, [row, new Spacer()]);
  const w = new Window({ title: "form", size: { width: W, height: H }, content: stack, show: false });
  show("03-form", w, stack);

  check("fixed label width honoured", Math.abs(label.alignmentRect.width - 60) < 0.5, label.alignmentRect.width);
  check("field grew", field.frame.width > 300, field.frame.width);
  check("button kept intrinsic width", btn.frame.width > 20 && btn.frame.width < 120, btn.frame.width);
  check(
    "row items are in order",
    label.frame.x < field.frame.x && field.frame.x < btn.frame.x,
    `${label.frame.x} ${field.frame.x} ${btn.frame.x}`,
  );
  w.close();
}

// ---------------------------------------------------------------------------
// 4. Table sizing and column widths
// ---------------------------------------------------------------------------
{
  const table = new Table({
    columns: [
      { id: "a", title: "A", width: 200 },
      { id: "b", title: "B", width: 120 },
      { id: "c", title: "C", width: 80, align: "right" },
    ],
    rows: [
      { a: "one", b: "uno", c: 1 },
      { a: "two", b: "dos", c: 2 },
    ],
    grow: 1,
  });
  const stack = new VStack({ spacing: 10, padding: 16 }, [table]);
  const w = new Window({ title: "table", size: { width: W, height: H }, content: stack, show: false });
  show("04-table", w, stack);

  const cols = table.tableView.tableColumns();
  const widths = [0, 1, 2].map((i) => Number(cols.objectAtIndex_(i).width()));
  check("explicit column widths preserved", widths[0] === 200 && widths[1] === 120, widths);
  check("last column absorbed the slack", widths[2]! > 80, widths);
  check("table fills the stack", Math.abs(table.frame.width - (W - 32)) < 1, table.frame.width);
  check("table has rows", Number(table.tableView.numberOfRows()) === 2, table.tableView.numberOfRows());
  w.close();
}

// ---------------------------------------------------------------------------
// 5. The full demo layout, in miniature
// ---------------------------------------------------------------------------
{
  const nameField = new TextField({ placeholder: "Name", width: 200 });
  const detail = new GroupBox({ title: "Details", padding: 12 }, [
    new HStack({ spacing: 8, align: "center" }, [new Label({ text: "Name", width: 52 }), nameField]),
    new HStack({ spacing: 8, align: "center" }, [
      new Label({ text: "Score", width: 52 }),
      new Slider({ min: 0, max: 100, value: 50, width: 180 }),
      new Label({ text: "50", width: 34, align: "right" }),
    ]),
  ]);
  const showcase = new GroupBox({ title: "Controls", padding: 12 }, [
    new HStack({ spacing: 10, align: "center" }, [
      new Checkbox({ title: "Check", checked: true }),
      new Switch({ on: true }),
      new Select({ items: ["A", "B"], width: 90 }),
    ]),
    new HStack({ spacing: 10, align: "center" }, [
      new Progress({ max: 100, value: 40, width: 140 }),
      new Spacer(),
      new Button({ title: "Go" }),
    ]),
  ]);
  const row = new HStack({ spacing: 12, align: "fill" }, [detail, showcase]);
  const log = new TextArea({ value: "log line\n", editable: false, height: 80 });
  const stack = new VStack({ spacing: 12, padding: 16 }, [
    new HStack({ spacing: 8, align: "center" }, [
      new Label({ text: "Header", font: { style: "title" } }),
      new Spacer(),
      new Button({ title: "Add" }),
    ]),
    new Separator(),
    row,
    log,
  ]);
  const w = new Window({ title: "composite", size: { width: 900, height: 520 }, content: stack, show: false });
  show("05-composite", w, stack);

  const inside = (v: View) =>
    v.frame.x >= -0.5 && v.frame.x + v.frame.width <= (v.parent?.frame.width ?? 1e9) + 0.5;

  check("detail inside its row", inside(detail), `${detail.frame.x}+${detail.frame.width} in ${row.frame.width}`);
  check("showcase inside its row", inside(showcase), `${showcase.frame.x}+${showcase.frame.width} in ${row.frame.width}`);
  check(
    "detail and showcase do not overlap",
    detail.frame.x + detail.frame.width <= showcase.frame.x + 0.5,
    `${detail.frame.x + detail.frame.width} vs ${showcase.frame.x}`,
  );
  check("row within window", row.frame.width <= 900 - 32 + 0.5, row.frame.width);
  check("log is visible", log.frame.height >= 60, log.frame.height);
  check("nothing has zero size", stack.children.every((c) => c.frame.width > 0 && c.frame.height > 0),
    stack.children.map((c) => `${c.frame.width}x${c.frame.height}`).join(" "));

  // Vertical stacking: arranged subviews must not overlap and must stay inside
  // the stack. AppKit's y axis grows upward, so later children have smaller y.
  const kids = [...stack.children];
  let ok = true;
  for (let i = 1; i < kids.length; i++) {
    const above = kids[i - 1]!, below = kids[i]!;
    if (below.frame.y + below.frame.height > above.frame.y + 0.5) ok = false;
  }
  check("vstack children do not overlap", ok,
    kids.map((c) => `y=${c.frame.y.toFixed(0)}+${c.frame.height.toFixed(0)}`).join(" "));
  check("all children inside the stack",
    kids.every((c) => c.frame.y >= -0.5 && c.frame.y + c.frame.height <= stack.frame.height + 0.5),
    kids.map((c) => `${c.frame.y.toFixed(0)}..${(c.frame.y + c.frame.height).toFixed(0)}`).join(" "));
  check("group boxes have real height", detail.frame.height > 60 && showcase.frame.height > 60,
    `${detail.frame.height} ${showcase.frame.height}`);
  check("detail content is inside the group box",
    detail.contentStack.frame.height > 0 && detail.contentStack.frame.height <= detail.frame.height,
    `${detail.contentStack.frame.height} vs ${detail.frame.height}`);
  check("log did not swallow the window", log.frame.height < 200, log.frame.height);
  w.close();
}

console.log(failures === 0 ? "\nALL LAYOUT TESTS PASSED" : `\n${failures} LAYOUT FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
