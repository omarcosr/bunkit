// The full gallery — identical to gallery.ts, with the tree written in JSX.
//
//   bun run examples/gallery.tsx
//
// Controls that are referenced imperatively (log, table, sidebar, clock,
// win, the signal fields) are constructed with `new X(...)`, exactly like
// gallery.ts does; everything else is JSX. This keeps the code typed and
// working whether the editor resolves JSX through bunkit's runtime or
// (without a tsconfig) through React's.
import {
  Application, beep,
  BlurView,
  Button,
  Checkbox,
  Container,
  describeViewTree, getClipboardText,
  GroupBox,
  HStack,
  ImageView,
  input,
  Label,
  popUpMenu, saveFile,
  ScrollView,
  Segmented,
  Select,
  Separator,
  setClipboardText, setTheme, signal, snapshotView,
  Spacer,
  SplitView,
  Table,
  TextArea,
  TextField,
  VStack,
  Window
} from "bunkit";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ─ helper: tiny solid-colour PNG encoder ──────────────────────────────────
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function makePng(width: number, height: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgb(x, y);
      raw[p++] = r; raw[p++] = g; raw[p++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─ data ──────────────────────────────────────────────────────────────────
interface Album { title: string; artist: string; year: number; rating: number; }
const albums: Album[] = [
  { title: "Blue", artist: "Joni Mitchell", year: 1971, rating: 10 },
  { title: "In Rainbows", artist: "Radiohead", year: 2007, rating: 9 },
  { title: "Kind of Blue", artist: "Miles Davis", year: 1959, rating: 10 },
  { title: "Dummy", artist: "Portishead", year: 1994, rating: 9 },
  { title: "Vulnicura", artist: "Björk", year: 2015, rating: 8 },
];

const app = new Application({ name: "Gallery", theme: "light" });

// ─ log pane ──────────────────────────────────────────────────────────────
const log = new TextArea({
  value: "",
  editable: false,
  font: { monospace: true, size: 11 },
  height: 90,
});
let detailIndex = 0;
function say(msg: string): void {
  log.value += `[${new Date().toLocaleTimeString()}] ${msg} ${detailIndex}\n`;
}

// ─ covers: generated on the fly ──────────────────────────────────────────
const hue = (i: number, x: number, y: number, w: number, h: number): [number, number, number] => {
  const t = (x / w + y / h + i) / 3;
  return [Math.round(40 + 120 * t), Math.round(60 + 90 * (1 - t)), Math.round(90 + 120 * t)];
};
const covers = albums.map((a, i) => join(tmpdir(), `bunkit-cover-${i}.png`));
covers.forEach((path, i) =>
  writeFileSync(path, makePng(96, 96, (x, y) => hue(i, x, y, 96, 96))));

// ─ collection table ──────────────────────────────────────────────────────
const table = new Table<Album>({
  columns: [
    { id: "title", title: "Album", flex: true },
    { id: "artist", title: "Artist", flex: true },
    { id: "year", title: "Year", width: 56, textAlign: "right" },
    {
      id: "rating", title: "", width: 64, textAlign: "center",
      // A whole view per cell, not just text: render wins over value.
      render: (a) => (
        <Button title={"★".repeat(a.rating)} onClick={() => { beep(); say(`${a.title} — ${a.rating}/10`); }} />
      ),
    },
  ],
  rows: albums,
  rowHeight: 30,
  multiSelect: true,
  alternatingRows: true,
  onSelect: (row) => { if (row) detailIndex = albums.indexOf(row); },
});
function selectedTitles(): string {
  const titles = table.selectedIndexes.map((i) => albums[i]!.title);
  return titles.length ? titles.join(", ") : "nothing selected";
}

// ─ right pane: detail with cover art ─────────────────────────────────────
const notesBox = (
  <GroupBox title="Notes" padding={10} spacing={8}>
    <TextArea
      value={`${albums[0]!.artist} — ${albums[0]!.title} (${albums[0]!.year})\n\nRich text, editable: the notes field is a real text editor.`}
      richText font={{ size: 12 }} minHeight={120}
      borderRadius={4}
    />
  </GroupBox>
);

// Styling swatches
function swatch(label: string, view: any): any {
  return (
    <VStack spacing={4}>
      {view}
      <Label text={label} font={{ size: 11 }} textColor="textBackground" textAlign="center" />
    </VStack>
  );
}

const styleBox = (
  <GroupBox title="Palette" padding={10} spacing={8}>
    <VStack spacing={10}>
      <HStack spacing={14}>
        {swatch("fill", <Container backgroundColor="#2D7DD2" borderRadius={14} width={72} height={56} />)}
        {swatch("dashed", <Container border={2} borderColor="#F26419" borderRadius={12} borderStyle="dashed" width={72} height={56} />)}
        {swatch("dotted", <Container border={2} borderColor="#1F3B4D" borderRadius={12} borderStyle="dotted" width={72} height={56} />)}
        {swatch("both", <Container backgroundColor="#97D8B2" borderRadius={16} border={2} borderColor="#1F3B4D" width={72} height={56} />)}
      </HStack>
      <HStack spacing={14}>
        {swatch("top + left", <Container border={{ top: 4, left: 2 }} borderColor="#F26419" borderRadius={8} width={72} height={56} />)}
        {swatch("sides", <Container border={[1, 4, 1, 4]} borderColor="#1F3B4D" width={72} height={56} />)}
        {swatch("bottom", <Container border={{ bottom: 3 }} borderColor="#F26419" borderRadius={8} width={72} height={56} />)}
      </HStack>
      {/* The `style` prop: an inline styling object, merged at construction. */}
      <HStack spacing={14}>
        {swatch("style={{…}}", <Container style={{ backgroundColor: "#2D7DD2", borderRadius: 14, width: 72, height: 56 }} />)}
        {swatch("style+inline", <Container style={{ backgroundColor: "#2D7DD2", borderRadius: 14 }} background="#F26419" width={72} height={56} />)}
      </HStack>
    </VStack>
  </GroupBox>
);

const styledControls = (
  <GroupBox title="Styled controls" padding={10} spacing={8}>
    <VStack spacing={10}>
      <HStack spacing={10} scroll>
        <Button title="Go" background="#2D7DD2" borderRadius={10} border={2} borderColor="#1F3B4D" />
        <TextField placeholder="tinted field" background="#fdcc05" borderRadius={8} grow={1} textColor="#143C8C" placeholderColor="#7A2E00" />
        <Select selected={0} items={["Alpha", "Beta"]} background="#FDE2E2" borderRadius={8} width={110} />
      </HStack>
      <ScrollView background="#E2F3E8" borderRadius={10} height={56} border>
        <Label text="a tinted, rounded, bordered scroll view" font={{ size: 11 }} textColor="#1F3B4D" textAlign="center" />
      </ScrollView>
      <TextArea value="…and a tinted text area." background="#E8F0FE" borderRadius={8} height={40} editable={false} />
    </VStack>
  </GroupBox>
);

// ─ theme-adaptive colours: `{ light, dark }` resolves against the current
// theme and re-applies when setTheme switches it (the "Dark mode" checkbox
// below drives it). Works for color, background/backgroundColor, borderColor,
// textColor and placeholderColor. ───────────────────────────────────────────
const adaptiveBox = (
  <GroupBox title="Adaptive colours" padding={10} spacing={8}>
    <HStack spacing={14}>
      {swatch("fill", <Container backgroundColor={{ light: "#DFF3FF", dark: "#143C5C" }} borderRadius={14} width={72} height={56} />)}
      {swatch("border", <Container border={2} borderColor={{ light: "#F26419", dark: "#FFB088" }} borderRadius={12} width={72} height={56} />)}
      {swatch("text", <Label text="Aa" font={{ style: "title", weight: "semibold" }} textColor={{ light: "#143C8C", dark: "#9CC8FF" }} />)}
    </HStack>
  </GroupBox>
);

// ─ signals: passing a signal in the options binds it (two-way for
// value/checked/on/selected, one-way for text/title) ──────────────────────
const name = signal("");
const nameField = new TextField({
  placeholder: "type a name",
  value: name,
  grow: 1,
  onSubmit: () => say(`hello, ${name.value || "stranger"}!`),
});
const nameEcho = new Label({ text: name, textColor: "#7A2E00", font: { size: 11 } });

const flag = signal(false);
const flagBox = new Checkbox({ title: "Signal flag", checked: flag });
const flagLabel = new Label({ text: "off", textColor: "#7A2E00", font: { size: 11 } });
flag.subscribe((on) => {
  console.log(`flag -> ${on ? "on" : "off"}`);
  flagLabel.text = on ? "on" : "off";
});

const signalsBox = (
  <GroupBox title="Signals" padding={10} spacing={8}>
    <HStack spacing={8} alignItems="center">{nameField}{flagBox}</HStack>
    <HStack spacing={8} alignItems="center">{nameEcho}{flagLabel}</HStack>
  </GroupBox>
);

// ─ right pane: detail ────────────────────────────────────────────────────
const detail = (
  <ScrollView border={false}>
    <VStack spacing={12} padding={12}>
      <HStack spacing={12} alignItems="center">
        <ImageView src={covers[0]!} width={96} height={96} />
        <VStack spacing={6}>
          <Label text={albums[0]!.title} font={{ style: "title", weight: "semibold" }} />
          <Label text={albums[0]!.artist} textColor="#7A2E00" />
          <Label text={String(albums[0]!.year)} textColor="#7A2E00" />
        </VStack>
      </HStack>
      <Separator />
      {notesBox}
      {styleBox}
      {styledControls}
      {adaptiveBox}
      {signalsBox}
    </VStack>
  </ScrollView>
);

// ─ left pane: sidebar ────────────────────────────────────────────────────
const THEME = {
  dark: { page: "#14141F", sidebar: "#202020" },
  light: { page: "#FAFAFA", sidebar: "#F0F0F0" },
};
// The content slot accepts a JSX expression directly.
const sidebar = new BlurView({
  // background: "#ff00ff",
  border: true,
  borderColor: "#0000ff",
  borderRadius: 8,
}, (
  <VStack spacing={10} padding={12}>
    <Label text="Gallery" font={{ style: "title", weight: "semibold" }} />
    <Label text="5 albums" textColor="#7A2E00" font={{ size: 11 }} />
    <Separator />
    <Segmented items={["Detail", "Collection"]} selected={1} onChange={(i) => say(`mode -> ${i === 0 ? "detail" : "collection"}`)} />
    <Checkbox title="Dark mode" checked={false} onChange={(on) => { applyAppTheme(on); say(`theme -> ${on ? "dark" : "light"}`); }} />
    <Spacer />
    <Button title="Library ▾" onClick={() => popUpMenu([
      { title: "Select All", onClick: () => say("select all") },
      { title: "Clear", onClick: () => say("clear") },
      { separator: true, title: "" },
      { title: "Check Layout", onClick: () => say("layout checked") },
    ])} />
  </VStack>
));

function applyAppTheme(dark: boolean): void {
  const t = dark ? THEME.dark : THEME.light;
  setTheme(dark ? "dark" : "light", { background: t.page });
  sidebar.setBackground(t.sidebar);
}

// ─ footer: clock, snapshot, export, debug, selection, clipboard ──────────
const keys = input();
const clock = new Label({
  text: "", font: { monospace: true, size: 11 }, textColor: "#7A2E00",
});

const win = new Window({
  title: "BunKit Gallery",
  size: { width: 860, height: 560 },
  minSize: { width: 640, height: 420 },
  content: (
    <VStack spacing={10} padding={12}>
      <SplitView vertical={false} position={190} grow={1}>
        {sidebar}
        <VStack spacing={10} scroll>
          {table}
          {detail}
        </VStack>
      </SplitView>
      <HStack spacing={10} alignItems="fill">
        {clock}
        <Spacer />
        <Button title="Snapshot…" onClick={() => {
          const path = join(tmpdir(), "bunkit-gallery.png");
          say(`snapshot -> ${snapshotView(win, path)} bytes`);
        }} />
        <Button title="Export…" onClick={async () => {
          const path = await saveFile({ title: "Export the log", defaultName: "gallery-log.txt", window: win });
          say(`export -> ${path ?? "cancelled"}`);
        }} />
        <Button title="Debug…" onClick={() => console.log(describeViewTree(win))} />
        <Button title="Selection" onClick={() => say(selectedTitles())} />
        <Button title="Copy" onClick={() => {
          setClipboardText(log.value);
          say(`clipboard -> ${getClipboardText().length} chars read back`);
        }} />
      </HStack>
      {log}
    </VStack>
  ),
});
win.quitOnClose();

// ─ input tracking ────────────────────────────────────────────────────────
keys.track(table);
setInterval(() => {
  const m = keys.mouse;
  const arrows = ["left", "right", "up", "down"].filter((k) => keys.held(k));
  clock.text = `${m.x.toFixed(0)},${m.y.toFixed(0)}${m.inside ? "" : " outside"}${arrows.length ? "  " + arrows.join("+") : ""}`;
}, 100);

say("ready — covers generated in pure JS, no assets on disk");
await app.run();