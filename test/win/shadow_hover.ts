// shadow_hover.ts   the shadow should change on hover without a second,
// temporarily misaligned or rectangular composition.
import { Window, VStack, HStack, Button, snapshotView } from "../../src/index.ts";
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
  return {
    width, height,
    px: (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [out[i]!, out[i + 1]!, out[i + 2]!, out[i + 3]!];
    },
  };
}

function countColor(path: string, kind: "magenta" | "cyan"): number {
  const png = decodePng(path);
  let count = 0;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const [r, g, b] = png.px(x, y);
    if (kind === "magenta" ? r > 100 && r > g + 2 && b > g + 2 : g > 140 && b > 140 && r < g - 2) count++;
  }
  return count;
}

function cornerLeak(path: string, kind: "magenta" | "cyan"): number {
  const png = decodePng(path);
  let count = 0;
  for (let y = 30; y < 60; y++) for (let x = 30; x < 60; x++) {
    const [r, g, b] = png.px(x, y);
    if (x >= 40 && x < 160 && y >= 40 && y < 82) continue;
    if (kind === "magenta" ? r > 100 && r > g + 2 && b > g + 2 : g > 140 && b > 140 && r < g - 2) count++;
  }
  return count;
}

const referenceButton = new Button({
  title: "Add",
  width: 110,
  height: 42,
  backgroundColor: "#2D7DD2",
  borderRadius: 14,
  states: {
    hover: {
      backgroundColor: "#ff00ff",
      borderColor: "#ff00ff",
      textColor: "#ffffff",
    },
  },
});
const shadowButton = new Button({
  title: "Add",
  width: 110,
  height: 42,
  backgroundColor: "#2D7DD2",
  borderRadius: 14,
  shadow: "0px 0px 10px #000000",
  states: {
    hover: {
      backgroundColor: "#ff00ff",
      borderColor: "#ff00ff",
      textColor: "#ffffff",
      shadow: "0px 0px 10px #000001",
    },
  },
});
const button = new Button({
  title: "Hover",
  width: 120,
  height: 42,
  backgroundColor: "#2D7DD2",
  borderRadius: 14,
  shadow: "0 0 8px #ff00ff",
  states: { hover: { shadow: "0 0 8px #00ffff" } },
});
const win = new Window({
  title: "ShadowHover", size: { width: 440, height: 240 },
  content: new VStack(
    { padding: 40, backgroundColor: "#F4F5F7" },
    [button, new HStack({ spacing: 96 }, [referenceButton, shadowButton])],
  ),
});

const settle = async (ticks = 120) => {
  for (let i = 0; i < ticks; i++) { windowsBackend.pump(); await Bun.sleep(8); }
};

await settle();
button._setInteractionState("hover", false);
await settle(30);
button.setShadow("0 0 8px #ff00ff");
await settle();
snapshotView(win, "build/shadow-hover-base.png");
const baseMagenta = countColor("build/shadow-hover-base.png", "magenta");
console.log("base", { magenta: baseMagenta });

button._setInteractionState("hover", true);
snapshotView(win, "build/shadow-hover-enter.png");
const enterCyan = countColor("build/shadow-hover-enter.png", "cyan");
const enterMagenta = countColor("build/shadow-hover-enter.png", "magenta");
const enterCorner = cornerLeak("build/shadow-hover-enter.png", "cyan");
console.log("enter", { cyan: enterCyan, staleMagenta: enterMagenta, cornerLeak: enterCorner });

await settle();
snapshotView(win, "build/shadow-hover-settled.png");
const settledCyan = countColor("build/shadow-hover-settled.png", "cyan");
const settledMagenta = countColor("build/shadow-hover-settled.png", "magenta");
console.log("settled", { cyan: settledCyan, staleMagenta: settledMagenta });

let failures = 0;
const check = (condition: boolean, message: string) => {
  if (condition) console.log("ok:", message);
  else { failures++; console.error("FAIL:", message); }
};
check(baseMagenta > 100, "base shadow is visible");
check(enterCyan > 100, "hover shadow is visible immediately");
check(enterMagenta < 10, "hover frame has no stale base shadow");
check(enterCorner < enterCyan * 0.08, "hover shadow keeps rounded corners");
check(settledCyan > 100 && settledMagenta < 10, "settled hover keeps only the hover shadow");
const baseButtonBodies = blueComponents("build/shadow-hover-base.png")
  .filter((bounds) => bounds.y >= 80);
console.log("base surface", { boxes: baseButtonBodies });
check(baseButtonBodies.length === 2, "two unhovered comparison buttons have identifiable surfaces");
if (baseButtonBodies.length === 2) {
  const referenceOutline = whiteOutlinePixels("build/shadow-hover-base.png", baseButtonBodies[0]!);
  const shadowOutline = whiteOutlinePixels("build/shadow-hover-base.png", baseButtonBodies[1]!);
  console.log("base outlines", { referenceOutline, shadowOutline });
  check(
    shadowOutline <= referenceOutline + 1,
    "shadow does not add a second white surface around the base button",
  );
}


type Bounds = { x: number; y: number; width: number; height: number; area: number };

function magentaComponents(path: string): Bounds[] {
  const png = decodePng(path);
  const seen = new Uint8Array(png.width * png.height);
  const components: Bounds[] = [];
  const matches = (x: number, y: number) => {
    const [r, g, b] = png.px(x, y);
    return r > 220 && b > 220 && g < 45;
  };
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const first = y * png.width + x;
    if (seen[first]) continue;
    seen[first] = 1;
    if (!matches(x, y)) continue;
    const queue = [first];
    let minX = x, maxX = x, minY = y, maxY = y, area = 0;
    while (queue.length) {
      const index = queue.pop()!;
      const px = index % png.width;
      const py = Math.floor(index / png.width);
      if (!matches(px, py)) continue;
      area++;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= png.width || ny >= png.height) continue;
        const next = ny * png.width + nx;
        if (!seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (area > 300) {
      components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area });
    }
  }
  return components.sort((a, b) => a.x - b.x);
}
function blueComponents(path: string): Bounds[] {
  const png = decodePng(path);
  const seen = new Uint8Array(png.width * png.height);
  const components: Bounds[] = [];
  const matches = (x: number, y: number) => {
    const [r, g, b] = png.px(x, y);
    return r > 20 && r < 80 && g > 90 && g < 170 && b > 160 && b < 240;
  };
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const first = y * png.width + x;
    if (seen[first]) continue;
    seen[first] = 1;
    if (!matches(x, y)) continue;
    const queue = [first];
    let minX = x, maxX = x, minY = y, maxY = y, area = 0;
    while (queue.length) {
      const index = queue.pop()!;
      const px = index % png.width;
      const py = Math.floor(index / png.width);
      if (!matches(px, py)) continue;
      area++;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= png.width || ny >= png.height) continue;
        const next = ny * png.width + nx;
        if (!seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (area > 300) {
      components.push({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area });
    }
  }
  return components.sort((a, b) => a.x - b.x);
}

function whiteOutlinePixels(path: string, bounds: Bounds): number {
  const png = decodePng(path);
  let count = 0;
  for (let y = Math.max(0, bounds.y - 3); y < Math.min(png.height, bounds.y + bounds.height + 3); y++) {
    for (let x = Math.max(0, bounds.x - 3); x < Math.min(png.width, bounds.x + bounds.width + 3); x++) {
      const isEdge = x < bounds.x + 3 || x >= bounds.x + bounds.width - 3 ||
        y < bounds.y + 3 || y >= bounds.y + bounds.height - 3;
      if (!isEdge) continue;
      const [r, g, b] = png.px(x, y);
      if (r > 250 && g > 250 && b > 250) count++;
    }
  }
  return count;
}

function whiteCornerPixels(path: string, bounds: Bounds): number {
  const png = decodePng(path);
  const size = Math.min(10, Math.floor(Math.min(bounds.width, bounds.height) / 2));
  let count = 0;
  for (const [ox, oy] of [[0, 0], [bounds.width - size, 0], [0, bounds.height - size], [bounds.width - size, bounds.height - size]]) {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [r, g, b] = png.px(bounds.x + ox + x, bounds.y + oy + y);
      if (r > 250 && g > 250 && b > 250) count++;
    }
  }
  return count;
}

await settle();
referenceButton._setInteractionState("hover", true);
shadowButton._setInteractionState("hover", true);
await settle(30);
snapshotView(win, "build/shadow-hover-coherence.png");
const coherenceBoxes = magentaComponents("build/shadow-hover-coherence.png");
console.log("coherence", { boxes: coherenceBoxes });
check(coherenceBoxes.length === 2, "two hovered buttons have identifiable surfaces");
if (coherenceBoxes.length === 2) {
  const referenceWhite = whiteCornerPixels("build/shadow-hover-coherence.png", coherenceBoxes[0]!);
  const shadowWhite = whiteCornerPixels("build/shadow-hover-coherence.png", coherenceBoxes[1]!);
  console.log("coherence corners", { referenceWhite, shadowWhite });
  check(shadowWhite <= referenceWhite + 1, "shadow does not reveal a separate white backing layer at rounded corners");
}
win.close();
await Bun.sleep(300);
if (failures) throw new Error("visual shadow assertions failed");
