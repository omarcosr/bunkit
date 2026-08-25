// shadow_resize.ts — the rounded DropShadow follows a control when its
// layout size changes, as it does when the containing window is resized.
import { Window, VStack, HStack, Button, TextField, snapshotView } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

await windowsBackend.init();

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
  const stride = width * 4, out = Buffer.alloc(height * stride); let src = 0;
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]; const line = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const value = raw[src++], a = x >= 4 ? line[x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      line[x] = (filter === 0 ? value : filter === 1 ? value + a : filter === 2 ? value + b : filter === 3 ? value + ((a + b) >> 1) : value + paeth(a, b, c)) & 0xFF;
    }
  }
  return { width, height, row: (y) => out.subarray(y * stride, (y + 1) * stride) };
}

function pinkBounds(path: string) {
  const png = decodePng(path); let left = png.width, top = png.height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < png.height; y++) {
    const row = png.row(y);
    for (let x = 0; x < png.width; x++) {
      const i = x * 4, r = row[i]!, g = row[i + 1]!, b = row[i + 2]!, a = row[i + 3]!;
      if (a > 0 && r > 180 && b > 120 && g < 120) {
        count++; left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  return { count, left, top, right, bottom };
}

const button = new Button({ title: "Add", width: 72, height: 34, background: "#2D7DD2", borderRadius: 14, shadow: "2px 2px 2px #ff00ff" });
const win = new Window({
  title: "ShadowResize",
  size: { width: 320, height: 110 },
  content: new VStack({ padding: 18 }, [
    new HStack({ spacing: 10 }, [new TextField({ placeholder: "Add", grow: 1 }), button]),
  ]),
});
const settle = async () => { for (let i = 0; i < 90; i++) { windowsBackend.pump(); await Bun.sleep(8); } };
await settle();
snapshotView(win, "build/shadow-resize-before.png");
windowsBackend.setControlSize((button as any).handle, 150, 34);
await settle();
snapshotView(win, "build/shadow-resize-after.png");

const before = pinkBounds("build/shadow-resize-before.png");
const after = pinkBounds("build/shadow-resize-after.png");
let failures = 0;
const check = (condition: boolean, message: string) => {
  if (condition) console.log("  ok:", message);
  else { failures++; console.error("  FAIL:", message); }
};
check(before.count > 100, `initial shadow is visible (${before.count} pixels)`);
check(after.count > before.count * 1.4, `shadow grows with the resized button (${before.count} -> ${after.count})`);
check(after.left < before.left - 30, `shadow follows the button's shifted left edge (${before.left} -> ${after.left})`);
check(Math.abs(after.right - before.right) <= 2, `shadow keeps the right edge aligned (${before.right} -> ${after.right})`);
check(Math.abs(after.top - before.top) <= 2, `shadow keeps the top edge aligned (${before.top} -> ${after.top})`);
win.close();
await Bun.sleep(300);
console.log(failures === 0 ? "SHADOW RESIZE OK" : `SHADOW RESIZE FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
