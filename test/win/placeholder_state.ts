// placeholder_state.ts — placeholderColor must participate in declarative
// interaction states and return to its base colour after hover leaves.
//
//   bun test/win/placeholder_state.ts
import { Window, TextField, snapshotView } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

await windowsBackend.init();

function decodePng(path: string) {
  const buf = readFileSync(path);
  let pos = 8, width = 0, height = 0;
  const idat: Buffer[] = [];
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
  const stride = width * 4;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const line = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? line[x - 4] : 0;
      const above = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upperLeft = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above
        : filter === 3 ? ((left + above) >> 1)
        : Math.max(0, Math.min(255, left + above - upperLeft));
      line[x] = (raw[src++] + predicted) & 0xFF;
    }
  }
  return { width, height, px: (x: number, y: number) => [
    out[(y * width + x) * 4], out[(y * width + x) * 4 + 1], out[(y * width + x) * 4 + 2],
  ] };
}

function count(path: string, predicate: (r: number, g: number, b: number) => boolean): number {
  const png = decodePng(path);
  let total = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const [r, g, b] = png.px(x, y);
    if (predicate(r, g, b)) total++;
  }
  return total;
}

const ok = (condition: boolean, message: string) => {
  if (!condition) { console.error("FAIL:", message); process.exit(1); }
  console.log("ok:", message);
};

const field = new TextField({
  placeholder: "PLACEHOLDER",
  placeholderColor: "#00FF00",
  cursor: "text",
  width: 220,
  states: { hover: { placeholderColor: "#FF0000" } },
});
const win = new Window({ title: "placeholder state", size: { width: 280, height: 90 } });
win.show();
win.content = field;

for (let i = 0; i < 40; i++) { windowsBackend.pump(); await Bun.sleep(10); }
snapshotView(win, "build/placeholder-state-base.png");
const green = count("build/placeholder-state-base.png", (r, g, b) => g > 150 && r < 100 && b < 100);
ok(green > 5, `base placeholderColor is green (${green} pixels)`);

field._setInteractionState("hover", true);
for (let i = 0; i < 15; i++) { windowsBackend.pump(); await Bun.sleep(10); }
snapshotView(win, "build/placeholder-state-hover.png");
const red = count("build/placeholder-state-hover.png", (r, g, b) => r > 150 && g < 100 && b < 100);
ok(red > 5, `hover placeholderColor is red (${red} pixels)`);

field._setInteractionState("hover", false);
await Bun.sleep(180);
for (let i = 0; i < 10; i++) { windowsBackend.pump(); await Bun.sleep(10); }
snapshotView(win, "build/placeholder-state-restored.png");
const restoredGreen = count("build/placeholder-state-restored.png", (r, g, b) => g > 150 && r < 100 && b < 100);
ok(restoredGreen > 5, `base placeholderColor is restored (${restoredGreen} pixels)`);

win.close();
await Bun.sleep(300);
console.log("PLACEHOLDER STATE OK");
process.exit(0);
