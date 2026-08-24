// input_borders.ts — text inputs keep the standard (default) border but never
// the blue focus/hover accent: the per-state brushes are shadowed to the
// neutral theme value. Verified via the BorderThickness property (read back
// through the bridge) and by decoding the RenderTargetBitmap snapshot pixels,
// both at rest and with programmatic focus.
//
//   bun test/win/input_borders.ts
import { Window, VStack, Label, TextField, TextArea, Select, snapshotView } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { winLib } from "../../src/platform/windows/ffi.ts";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

await windowsBackend.init();

// --- minimal PNG decoder (8-bit RGBA, all filter types) -------------------------
function decodePng(path: string): { width: number; height: number; row: (y: number) => Uint8Array } {
  const buf = readFileSync(path);
  let pos = 8, width = 0, height = 0; const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  const paeth = (a: number, b: number, c: number) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[src++];
    const line = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const v = raw[src++];
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      line[x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + paeth(a, b, c)) & 0xFF;
    }
  }
  return { width, height, row: (y: number) => out.subarray(y * stride, (y + 1) * stride) };
}

const plain = new TextField({ placeholder: "plain", width: 200 });
const bordered = new TextField({ placeholder: "bordered", width: 200, border: 2, borderColor: "#F26419", borderRadius: 6 });
const area = new TextArea({ value: "area", width: 200, height: 60 });
const combo = new Select({ items: ["Alpha", "Beta"], width: 200 });

const win = new Window({
  title: "Input Borders",
  size: { width: 320, height: 460 },
  content: new VStack({ spacing: 14, padding: 20 }, [
    new Label({ text: "plain" }),
    plain,
    new Label({ text: "bordered" }),
    bordered,
    new Label({ text: "area" }),
    area,
    new Label({ text: "select" }),
    combo,
  ]),
});
win.show();
for (let i = 0; i < 20; i++) { windowsBackend.pump(); await Bun.sleep(10); }

let failures = 0;
function check(cond: boolean, msg: string): void {
  if (cond) console.log("  ok:", msg);
  else { failures++; console.error("  FAIL:", msg); }
}

// --- BorderThickness property, read back through the bridge --------------------
function readBorder(h: bigint): [number, number, number, number] {
  const buf = Buffer.alloc(32);
  const rc = winLib.bk_control_border_thickness(h, buf as any) as number;
  if (rc !== 0) throw new Error(`bk_control_border_thickness rc=${rc}`);
  return [buf.readDoubleLE(0), buf.readDoubleLE(8), buf.readDoubleLE(16), buf.readDoubleLE(24)];
}
const fmt = (t: [number, number, number, number]) => `[${t.map((v) => v.toFixed(1)).join(", ")}]`;
const isOne = (t: [number, number, number, number]) => t.every((v) => v === 1);

check(isOne(readBorder((plain as any).handle)), `plain TextField keeps the default 1px border (${fmt(readBorder((plain as any).handle))})`);
check(isOne(readBorder((area as any).handle)), `TextArea keeps the default 1px border (${fmt(readBorder((area as any).handle))})`);
check(isOne(readBorder((combo as any).handle)), `Select keeps the default 1px border (${fmt(readBorder((combo as any).handle))})`);
const bt = readBorder((bordered as any).handle);
check(bt[0] === 2 && bt[1] === 2 && bt[2] === 2 && bt[3] === 2,
  `bordered TextField has the requested 2px border (${fmt(bt)})`);

// --- pixel checks on the snapshot ----------------------------------------------
const bytes = snapshotView(win, "build/input-borders.png");
check(bytes > 100, `snapshot wrote ${bytes} bytes`);
const png = decodePng("build/input-borders.png");
const isBlue = (r: number, g: number, b: number) => b > r + 20 && b > g + 20 && b > 100;

// White fill blocks (the control bodies) on the transparent page.
const runs: Array<[number, number]> = [];
{
  let runStart = -1;
  for (let y = 0; y < png.height; y++) {
    const row = png.row(y);
    let sum = 0, n = 0;
    for (let x = 30; x < Math.min(210, png.width); x++) { const i = x * 4; sum += (row[i] + row[i + 1] + row[i + 2]) / 3; n++; }
    const light = sum / n > 150;
    if (light && runStart < 0) runStart = y;
    if (!light && runStart >= 0) { runs.push([runStart, y - 1]); runStart = -1; }
  }
  if (runStart >= 0) runs.push([runStart, png.height - 1]);
}
check(runs.length === 4, `found 4 input fill blocks (${JSON.stringify(runs)})`);

const names = ["plain TextField", "bordered TextField", "TextArea", "Select"];

// Every input must render a visible 1px border on all four sides — a neutral
// gray line (darker than the fill) around the fill block — and no blue.
const pxAt = (y: number, x: number): [number, number, number] => {
  const row = png.row(y);
  const i = x * 4;
  return [row[i], row[i + 1], row[i + 2]];
};
const lumAt = (y: number, x: number) => {
  const [r, g, b] = pxAt(y, x);
  return (r + g + b) / 3;
};
const minLumIn = (rows: number[], x0: number, x1: number): number => {
  let min = 256;
  for (const y of rows) {
    if (y < 0 || y >= png.height) continue;
    for (let x = Math.max(0, x0); x <= Math.min(png.width - 1, x1); x++) min = Math.min(min, lumAt(y, x));
  }
  return min;
};
const blueIn = (rows: number[], x0: number, x1: number): number => {
  let n = 0;
  for (const y of rows) {
    if (y < 0 || y >= png.height) continue;
    for (let x = Math.max(0, x0); x <= Math.min(png.width - 1, x1); x++) {
      const [r, g, b] = pxAt(y, x);
      if (isBlue(r, g, b)) n++;
    }
  }
  return n;
};

for (let i = 0; i < runs.length; i++) {
  const [y0, y1] = runs[i];
  const name = names[i];
  const mid = y0 + ((y1 - y0) >> 1);
  // The field's horizontal extent at mid-height: first/last non-page column.
  let xL = -1, xR = -1;
  for (let x = 0; x < png.width; x++) {
    if (lumAt(mid, x) > 100) { if (xL < 0) xL = x; xR = x; }
  }
  const fill = lumAt(mid, (xL + xR) >> 1);
  // The 1px border ring sits just outside the fill block.
  const top = minLumIn([y0 - 1], xL, xR);
  const bottom = minLumIn([y1 + 1], xL, xR);
  const left = minLumIn(Array.from({ length: y1 - y0 - 3 }, (_, k) => y0 + 2 + k), xL, xL);
  const right = minLumIn(Array.from({ length: y1 - y0 - 3 }, (_, k) => y0 + 2 + k), xR, xR);
  const blue = blueIn([y0 - 1, y0, y1, y1 + 1], xL - 1, xR + 1);
  check(top < fill - 25, `${name}: top border visible (top=${top.toFixed(0)} vs fill=${fill.toFixed(0)})`);
  check(bottom < fill - 25, `${name}: bottom border visible (bottom=${bottom.toFixed(0)} vs fill=${fill.toFixed(0)})`);
  check(left < fill - 25, `${name}: left border visible (left=${left.toFixed(0)} vs fill=${fill.toFixed(0)})`);
  check(right < fill - 25, `${name}: right border visible (right=${right.toFixed(0)} vs fill=${fill.toFixed(0)})`);
  check(blue === 0, `${name}: no blue border pixels (blue=${blue})`);
}

// --- focused: the border must stay visible and neutral (no blue accent) --------
// Focus changes the fill (WinUI's focused background), so reuse the rest
// snapshot's geometry — the layout does not shift.
check((winLib.bk_control_focus((plain as any).handle) as number) === 0, "bk_control_focus returns OK");
for (let i = 0; i < 20; i++) { windowsBackend.pump(); await Bun.sleep(10); }
const bytesF = snapshotView(win, "build/input-borders-focused.png");
check(bytesF > 100, `focused snapshot wrote ${bytesF} bytes`);
const pngF = decodePng("build/input-borders-focused.png");
{
  const [y0, y1] = runs[0];
  const mid = y0 + ((y1 - y0) >> 1);
  let xL = -1, xR = -1;
  for (let x = 0; x < pngF.width; x++) {
    const row = pngF.row(mid);
    const i = x * 4;
    const l = (row[i] + row[i + 1] + row[i + 2]) / 3;
    if (l > 100) { if (xL < 0) xL = x; xR = x; }
  }
  const lumF = (y: number, x: number) => {
    const row = pngF.row(y);
    const i = x * 4;
    return (row[i] + row[i + 1] + row[i + 2]) / 3;
  };
  const minF = (rows: number[], x0: number, x1: number) => {
    let min = 256;
    for (const y of rows) {
      if (y < 0 || y >= pngF.height) continue;
      for (let x = Math.max(0, x0); x <= Math.min(pngF.width - 1, x1); x++) min = Math.min(min, lumF(y, x));
    }
    return min;
  };
  const blueF = (rows: number[], x0: number, x1: number) => {
    let n = 0;
    for (const y of rows) {
      if (y < 0 || y >= pngF.height) continue;
      for (let x = Math.max(0, x0); x <= Math.min(pngF.width - 1, x1); x++) {
        const row = pngF.row(y);
        const i = x * 4;
        if (isBlue(row[i], row[i + 1], row[i + 2])) n++;
      }
    }
    return n;
  };
const fill = lumF(mid, (xL + xR) >> 1);
  const top = minF([y0 - 1], xL, xR);
  const bottom = minF([y1 + 1], xL, xR);
  const blue = blueF([y0 - 1, y0, y1, y1 + 1], xL - 1, xR + 1);
  check(blue === 0, `focused plain TextField: no blue focus accent (blue=${blue})`);
  check(top < fill - 25 || top > fill + 25,
    `focused top border visible (top=${top.toFixed(0)} vs fill=${fill.toFixed(0)})`);
  check(bottom < fill - 25 || bottom > fill + 25,
    `focused bottom border visible (bottom=${bottom.toFixed(0)} vs fill=${fill.toFixed(0)})`);
}

win.close();
await Bun.sleep(300);
console.log(failures === 0 ? "INPUT BORDERS OK" : `INPUT BORDERS FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
