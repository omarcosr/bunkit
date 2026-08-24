// stack_layout.ts — Stack.insert/remove must not overlap the remaining
// children: the Grid positions elements by their Grid.Row/Column attached
// property, which insert/remove leave stale unless re-numbered.
//
//   bun test/win/stack_layout.ts
import { Window, VStack, Container, snapshotView } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

await windowsBackend.init();

function decodePng(path: string): { width: number; height: number; px: (x: number, y: number) => number[] } {
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
  return {
    width, height,
    px: (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}

const H = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const lum = (c: number[]) => (c[0] + c[1] + c[2]) / 3;

function colorBands(png: ReturnType<typeof decodePng>, x: number): Array<{ y0: number; y1: number; color: string }> {
  const bands: Array<{ y0: number; y1: number; color: string }> = [];
  for (let y = 0; y < png.height; y++) {
    const c = png.px(x, y);
    if (lum(c) < 10) continue;
    const color = H(c);
    const last = bands[bands.length - 1];
    if (last && last.color === color && y === last.y1 + 1) last.y1 = y;
    else bands.push({ y0: y, y1: y, color });
  }
  return bands;
}

const win = new Window({ title: "StackLayout", size: { width: 200, height: 260 } });
win.show();
for (let i = 0; i < 60; i++) { windowsBackend.pump(); await Bun.sleep(10); }

async function snapshotStack(stack: InstanceType<typeof VStack>, label: string): Promise<ReturnType<typeof decodePng>> {
  win.content = new VStack({ padding: 10 }, [stack]);
  for (let i = 0; i < 60; i++) { windowsBackend.pump(); await Bun.sleep(10); }
  let bytes = 0;
  for (let attempt = 0; attempt < 5 && bytes <= 0; attempt++) {
    bytes = snapshotView(win, `build/stack-${label}.png`);
    if (bytes <= 0) await Bun.sleep(200);
  }
  return decodePng(`build/stack-${label}.png`);
}

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log("  ok:", msg);
  else { failures++; console.error("  FAIL:", msg); }
}
function assertOrder(png: ReturnType<typeof decodePng>, expected: string[], label: string) {
  const bands = colorBands(png, 50);
  check(bands.length === expected.length, `${label}: ${bands.length} colour bands (${bands.map((b) => b.color).join(",")})`);
  for (let i = 0; i < expected.length; i++) {
    check(bands[i]?.color === expected[i], `${label}: band ${i} is ${expected[i]} (${bands[i]?.color})`);
  }
  for (let i = 1; i < bands.length; i++) {
    check(bands[i].y0 > bands[i - 1].y1, `${label}: band ${i} does not overlap band ${i - 1}`);
  }
}

// --- insert: red, [magenta], green, blue ─────────────────────────────────────
{
  const stack = new VStack({ spacing: 4 });
  const a = new Container({ backgroundColor: "#FF0000", height: 20, width: 100 });
  const b = new Container({ backgroundColor: "#00FF00", height: 20, width: 100 });
  const c = new Container({ backgroundColor: "#0000FF", height: 20, width: 100 });
  const x = new Container({ backgroundColor: "#FF00FF", height: 20, width: 100 });
  stack.add(a); stack.add(b); stack.add(c);
  stack.insert(x, 1);
  assertOrder(await snapshotStack(stack, "insert"), ["#ff0000", "#ff00ff", "#00ff00", "#0000ff"], "insert");
}

// --- remove: red, [green removed], blue stays put ────────────────────────────
{
  const stack = new VStack({ spacing: 4 });
  const a = new Container({ backgroundColor: "#FF0000", height: 20, width: 100 });
  const b = new Container({ backgroundColor: "#00FF00", height: 20, width: 100 });
  const c = new Container({ backgroundColor: "#0000FF", height: 20, width: 100 });
  stack.add(a); stack.add(b); stack.add(c);
  stack.remove(b); // remove the middle child
  assertOrder(await snapshotStack(stack, "remove"), ["#ff0000", "#0000ff"], "remove middle");
}

// --- remove first, then append ───────────────────────────────────────────────
{
  const stack = new VStack({ spacing: 4 });
  const a = new Container({ backgroundColor: "#FF0000", height: 20, width: 100 });
  const b = new Container({ backgroundColor: "#00FF00", height: 20, width: 100 });
  const c = new Container({ backgroundColor: "#0000FF", height: 20, width: 100 });
  stack.add(a); stack.add(b); stack.add(c);
  stack.remove(a);
  stack.add(new Container({ backgroundColor: "#FFFF00", height: 20, width: 100 }));
  assertOrder(await snapshotStack(stack, "remove-append"), ["#00ff00", "#0000ff", "#ffff00"], "remove-first + append");
}

win.close();
await Bun.sleep(200);
console.log(failures === 0 ? "STACK LAYOUT OK" : `STACK LAYOUT FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
