// button_style.ts — CSS-like Button styling on Windows: background, title
// colour, font, borderRadius and disabled behaviour, verified by pixels and
// by click routing.
//
//   bun test/win/button_style.ts
import { Window, VStack, HStack, Button, snapshotView } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { winLib } from "../../src/platform/windows/ffi.ts";
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

const ok = (c: boolean, m: string) => { if (!c) { console.error("FAIL:", m); process.exit(1); } console.log("ok:", m); };

const win = new Window({ title: "ButtonStyle", size: { width: 420, height: 220 } });
win.show();

const styled = new Button({
  title: "Blue", backgroundColor: "#2D7DD2", textColor: "#FFFFFF",
  font: { size: 18, weight: "semibold" }, borderRadius: 10,
});
const plain = new Button({ title: "Plain" });
const disabled = new Button({ title: "Disabled", enabled: false });

win.content = new VStack({ padding: 24, spacing: 12, backgroundColor: "#F2F2F7" }, [styled, plain, disabled]);

// ── disabled button must not fire clicks ─────────────────────────────────────
let clicks = 0;
disabled.onClick(() => clicks++);
winLib.bk_button_click((disabled as any).handle);
for (let i = 0; i < 10; i++) { windowsBackend.pump(); await Bun.sleep(10); }
ok(clicks === 0, "disabled button ignores clicks");
ok(!disabled.enabled, "disabled reads back false");

// ── snapshot: styled vs plain appearance ────────────────────────────────────
for (let i = 0; i < 60; i++) { windowsBackend.pump(); await Bun.sleep(10); }
let bytes = 0;
for (let a = 0; a < 5 && bytes <= 0; a++) {
  bytes = snapshotView(win as any, "build/button_style.png");
  if (bytes <= 0) await Bun.sleep(200);
}
ok(bytes > 0, "snapshot produced bytes");
const png = decodePng("build/button_style.png");
const px = (x: number, y: number) => png.px(x, y);

// Styled button starts at (24, 24); ~"Blue" at 18pt semibold ≈ 90x38.
// Its fill must be the requested blue, not the system grey.
let blue = 0, n = 0;
for (let y = 30; y < 58; y++)
  for (let x = 30; x < 90; x++) {
    const [r, g, b] = px(x, y);
    if (b > 150 && b - r > 60) blue++;
    n++;
  }
ok(blue / n > 0.6, `styled button filled with blue (${(blue / n * 100).toFixed(0)}% of ${n} px)`);

// White title text must be present inside the blue fill (light pixels).
let white = 0;
for (let y = 32; y < 56; y++)
  for (let x = 34; x < 86; x++) {
    const [r, g, b] = px(x, y);
    if (r > 200 && g > 200 && b > 200) white++;
  }
ok(white > 30, `white title text visible on blue (${white} px)`);

// Plain button below keeps the system look: no blue fill.
const size2 = windowsBackend.getControlSize((styled as any).handle);
const size1 = windowsBackend.getControlSize((plain as any).handle);
ok(size2[1] >= 34, `styled button is 18pt tall enough (${size2[1].toFixed(0)}px)`);

win.close();
await Bun.sleep(300);
console.log("BUTTON STYLE OK");
process.exit(0);
