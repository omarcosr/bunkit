// textcolor.ts — TextField textColor: constructor, imperative setter, signal.
//
//   bun test/win/textcolor.ts
//
// Three windows are created at once (avoiding the quit-after-last-window race
// that WinUI's exit-on-last-close causes when creating a window after closing).
import { Window, VStack, TextField, snapshotView, signal } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

await windowsBackend.init();

function decodePng(path: string) {
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
  const stride = width * 4; const out = Buffer.alloc(height * stride); let src = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[src++]; const line = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const v = raw[src++]; const a = x >= 4 ? line[x - 4] : 0; const b = y > 0 ? out[(y - 1) * stride + x] : 0; const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      line[x] = (f === 0 ? v : f === 1 ? v + a : f === 2 ? v + b : f === 3 ? v + ((a + b) >> 1) : v + Math.max(0, Math.min(255, a + b - c))) & 0xFF;
    }
  }
  return { width, height, px: (x: number, y: number) => [out[(y * width + x) * 4], out[(y * width + x) * 4 + 1], out[(y * width + x) * 4 + 2]] };
}

function countPx(path: string, pred: (r: number, g: number, b: number) => boolean): number {
  const png = decodePng(path);
  let n = 0;
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const [r, g, b] = png.px(x, y);
      if (pred(r, g, b)) n++;
    }
  return n;
}

const ok = (c: boolean, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok:", m); };

// ── 1. Constructor textColor ────────────────────────────────────────────────
const win1 = new Window({ title: "TC1", size: { width: 300, height: 120 } });
win1.show();
win1.content = new VStack({ padding: 16 }, [new TextField({ value: "RED RED", textColor: "#FF0000" })]);

// ── 2. Imperative setter ────────────────────────────────────────────────────
const blueField = new TextField({ value: "BLUE BLUE" });
blueField.textColor = "#0000FF";
const win2 = new Window({ title: "TC2", size: { width: 300, height: 120 } });
win2.show();
win2.content = new VStack({ padding: 16 }, [blueField]);

// ── 3. Signal binding ───────────────────────────────────────────────────────
const colorSig = signal("#000000");
const sigField = new TextField({ value: "SIGNAL", textColor: colorSig as any });
const win3 = new Window({ title: "TC3", size: { width: 300, height: 120 } });
win3.show();
win3.content = new VStack({ padding: 16 }, [sigField]);

// ── 4. textColor inside style={{ … }} ───────────────────────────────────────
const styledField = new TextField({ value: "STYLED", style: { textColor: "#00FF00" } });
const win4 = new Window({ title: "TC4", size: { width: 300, height: 120 } });
win4.show();
win4.content = new VStack({ padding: 16 }, [styledField]);

// ── Pump all three ──────────────────────────────────────────────────────────
for (let i = 0; i < 60; i++) { windowsBackend.pump(); await Bun.sleep(10); }

async function snap(win: any, path: string): Promise<number> {
  let bytes = 0;
  for (let a = 0; a < 5 && bytes <= 0; a++) {
    bytes = snapshotView(win, path);
    if (bytes <= 0) await Bun.sleep(200);
  }
  return bytes;
}

ok((await snap(win1, "build/tc1.png")) > 0, "snap 1");
ok(countPx("build/tc1.png", (r, g, b) => r > 180 && g < 100 && b < 100) > 20, "constructor textColor paints red");

ok((await snap(win2, "build/tc2.png")) > 0, "snap 2");
ok(countPx("build/tc2.png", (r, g, b) => b > 180 && r < 100 && g < 100) > 20, "imperative setter paints blue");

ok((await snap(win3, "build/tc3a.png")) > 0, "snap 3a");
ok(countPx("build/tc3a.png", (r, g, b) => (r > 180 && g < 100 && b < 100) || (b > 180 && r < 100 && g < 100)) < 10, "signal initial: no red/blue");
colorSig.set("#FF0000");
for (let i = 0; i < 30; i++) { windowsBackend.pump(); await Bun.sleep(10); }
ok((await snap(win3, "build/tc3b.png")) > 0, "snap 3b");
ok(countPx("build/tc3b.png", (r, g, b) => r > 180 && g < 100 && b < 100) > 20, "signal set updates textColor");

// 4. style={{ textColor }} applies at construction.
ok((await snap(win4, "build/tc4.png")) > 0, "snap 4");
ok(countPx("build/tc4.png", (r, g, b) => g > 180 && r < 100 && b < 100) > 20, "style={{ textColor }} paints green");

win1.close(); win2.close(); win3.close(); win4.close();
await Bun.sleep(300);
console.log("TEXTCOLOR OK");
process.exit(0);