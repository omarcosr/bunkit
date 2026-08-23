// A tour of the rest of the API: panes, images, rich text, input state,
// screenshots and file pickers.
//
//   bun run examples/gallery.ts

import {
    Application,
    BlurView,
    Button,
    Checkbox,
    Container,
    GroupBox,
    HStack,
    ImageView,
    Label,
    ScrollView,
    Segmented,
    Select,
    Separator,
    Spacer,
    SplitView,
    Table, TextArea, TextField,
    VStack,
    Window,
    beep,
    describeViewTree,
    getClipboardText,
    input, popUpMenu, saveFile, setClipboardText,
    setTheme, snapshotView,
} from "bunkit";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// A tiny solid-colour PNG encoder, so the cover art needs no assets on disk.
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
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
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

interface Album { title: string; artist: string; year: number; rating: number; }

const albums: Album[] = [
  { title: "Blue", artist: "Joni Mitchell", year: 1971, rating: 10 },
  { title: "In Rainbows", artist: "Radiohead", year: 2007, rating: 9 },
  { title: "Kind of Blue", artist: "Miles Davis", year: 1959, rating: 10 },
  { title: "Dummy", artist: "Portishead", year: 1994, rating: 9 },
  { title: "Vulnicura", artist: "Björk", year: 2015, rating: 8 },
];

const app = new Application({ name: "Gallery", theme: "light" });

// --- log pane ---------------------------------------------------------------

const log = new TextArea({
  value: "",
  editable: false,
  font: { monospace: true, size: 11 },
  height: 90,
});
function say(msg: string): void {
  log.value += `[${new Date().toLocaleTimeString()}] ${msg} ${detailIndex}\n`;
}

// --- covers: generated on the fly, loaded through ImageView -------------------

const hue = (i: number, x: number, y: number, w: number, h: number): [number, number, number] => {
  const t = (x / w + y / h + i) / 3;
  return [Math.round(40 + 120 * t), Math.round(60 + 90 * (1 - t)), Math.round(90 + 120 * t)];
};
const covers = albums.map((a, i) =>
  join(tmpdir(), `bunkit-cover-${i}.png`));
covers.forEach((path, i) =>
  writeFileSync(path, makePng(96, 96, (x, y) => hue(i, x, y, 96, 96))));

// --- the collection table: render cells, multi-select, alternating rows -------

let detailIndex = 0;
const table = new Table<Album>({
  columns: [
    { id: "title", title: "Album", flex: true },
    { id: "artist", title: "Artist", flex: true },
    { id: "year", title: "Year", width: 56, align: "right" },
    {
      id: "rating", title: "", width: 64, align: "center",
      // A whole view per cell, not just text: render wins over value.
      render: (a) => new Button({
        title: "★".repeat(a.rating),
        onClick: () => { beep(); say(`${a.title} — ${a.rating}/10`); },
      }),
    },
  ],
  rows: albums,
  rowHeight: 30,
  multiSelect: true,
  alternatingRows: true,
  onSelect: (row) => {
    if (row) {
      detailIndex = albums.indexOf(row);
    } },
});
function selectedTitles(): string {
  const titles = table.selectedIndexes.map((i) => albums[i]!.title);
  return titles.length ? titles.join(", ") : "nothing selected";
}

// --- right pane: scrollable detail with generated cover art -------------------

const notes = new TextArea({
  value: `${albums[0]!.artist} — ${albums[0]!.title} (${albums[0]!.year})\n\nRich text, editable: the notes field is a real text editor.`,
  richText: true,
  font: { size: 12 },
  minHeight: 120,
});

// GroupBox: a titled, padded, bordered panel around whatever you give it.
const notesBox = new GroupBox({ title: "Notes", padding: 10, spacing: 8 }, [notes]);

// Styling: background-color, border, border-color and rounded corners, all
// through the plain view options and View.setBorder.
function swatch(label: string, view: any): any {
  return new VStack({ spacing: 4 }, [
    view,
    new Label({ text: label, font: { size: 11 }, color: "secondaryLabel", align: "center" }),
  ]);
}
const styleBox = new GroupBox({ title: "Palette", padding: 10, spacing: 8 }, [
  new HStack({ spacing: 14 }, [
    // background-color + rounded corners, straight from the options.
    swatch("fill", new Container({
      backgroundColor: "#2D7DD2", borderRadius: 14, width: 72, height: 56,
    })),
    // border + border-color + radius + dashed, all as options.
    swatch("dashed", new Container({
      border: 2, borderColor: "#F26419", borderRadius: 12,
      borderStyle: "dashed", width: 72, height: 56,
    })),
    // dotted, via setBorder's style argument.
    swatch("dotted", new Container({ width: 72, height: 56 })
      .setBorder("#1F3B4D", 2, 12, "dotted")),
    // everything at once.
    swatch("both", new Container({
      backgroundColor: "#97D8B2", borderRadius: 16,
      border: 2, borderColor: "#1F3B4D", width: 72, height: 56,
    })),
  ]),
  // per-side widths: named sides (CSS border-width vocabulary)…
  new HStack({ spacing: 14 }, [
    swatch("top + left", new Container({
      border: { top: 4, left: 2 }, borderColor: "#F26419",
      borderRadius: 8, width: 72, height: 56,
    })),
    // …or a [top, right, bottom, left] tuple, like CSS shorthand.
    swatch("sides", new Container({
      border: [1, 4, 1, 4], borderColor: "#1F3B4D", width: 72, height: 56,
    })),
    // per-side works imperatively too.
    swatch("bottom", new Container({ width: 72, height: 56 })
      .setBorder("#F26419", { bottom: 3 }, 8)),
  ]),
]);

// The same styling applies to real controls, not just containers: options at
// construction, setBorder after, or both.
const styledControls = new GroupBox({ title: "Styled controls", padding: 10, spacing: 8 }, [
  // scroll: the row scrolls horizontally on small windows instead of
  // clipping its tail off.
  new HStack({ spacing: 10, scroll: true }, [
    new Button({
      title: "Go", background: "#2D7DD2", cornerRadius: 10,
    }).setBorder("#1F3B4D", 2),
    new TextField({
      placeholder: "tinted field", background: "#fdcc05",
      cornerRadius: 8, grow: 1,
    }),
    new Select({
      items: ["Alpha", "Beta"], background: "#FDE2E2",
      cornerRadius: 8, width: 110,
    }),
  ]),
  new ScrollView(
    { background: "#E2F3E8", cornerRadius: 10, height: 56, border: true },
    new Label({ text: "a tinted, rounded, bordered scroll view", font: { size: 11 } }),
  ),
  new TextArea({
    value: "…and a tinted text area.", background: "#E8F0FE",
    cornerRadius: 8, height: 40, editable: false,
  }),
]);

const detail = new ScrollView({ border: false }, new VStack({ spacing: 12, padding: 12 }, [
  new HStack({ spacing: 12, align: "center" }, [
    new ImageView({ src: covers[0]!, width: 96, height: 96 }),
    new VStack({ spacing: 6 }, [
      new Label({ text: albums[0]!.title, font: { style: "title", weight: "semibold" } }),
      new Label({ text: albums[0]!.artist, color: "secondaryLabel" }),
      new Label({ text: String(albums[0]!.year), color: "secondaryLabel" }),
    ]),
  ]),
  new Separator(),
  notesBox,
  styleBox,
  styledControls,
]));

// --- left pane: a vibrancy sidebar ---------------------------------------------

const mode = new Segmented({
  items: ["Detail", "Collection"],
  selected: 1,
  onChange: (i) => say(`mode -> ${i === 0 ? "detail" : "collection"}`),
});

// Dark/light: one source of truth so the checkbox and the actual theme can
// never drift apart. The app starts in light (matching `checked: false`);
// without an explicit startup apply the window would follow the SYSTEM
// theme instead — which is why it used to boot dark.
const THEME = {
  dark: { page: "#14141F", sidebar: "#202020" },
  light: { page: "#FAFAFA", sidebar: "#F0F0F0" },
};
function applyAppTheme(dark: boolean): void {
  const t = dark ? THEME.dark : THEME.light;
  setTheme(dark ? "dark" : "light", { background: t.page });
  sidebar.setBackground(t.sidebar);
}
const darkMode = new Checkbox({
  title: "Dark mode",
  checked: false,
  onChange: (on) => {
    applyAppTheme(on);
    say(`theme -> ${on ? "dark" : "light"}`);
  },
});

const sidebar = new BlurView({
  // background: "#2D7DD2",
  background: "#bf2dd2",
  border: true,
  borderColor: "#0000ff",
  borderRadius: 8,
  cornerRadius: 8,
}, new VStack({ spacing: 10, padding: 12 }, [
  new Label({ text: "Gallery", font: { style: "title", weight: "semibold" } }),
  new Label({ text: "5 albums", color: "secondaryLabel", font: { size: 11 } }),
  new Separator(),
  mode,
  darkMode,
  new Spacer(),
  new Button({
    title: "Library ▾",
    onClick: () =>
      // A context menu at the pointer, exactly like a right-click menu.
      popUpMenu([
        { title: "Select All", onClick: () => say("select all") },
        { title: "Clear", onClick: () => say("clear") },
        { separator: true, title: "" },
        { title: "Check Layout", onClick: () => say("layout checked") },
      ]),
  }),
]));
// ])).setBackground("#ff00ff").setBorder("#C6C6C8", 1, 4);

// --- footer: input state, snapshot, export --------------------------------------

const keys = input();

const clock = new Label({ text: "", font: { monospace: true, size: 11 }, color: "secondaryLabel" });

const win = new Window({
  title: "BunKit Gallery",
  size: { width: 860, height: 560 },
  minSize: { width: 640, height: 420 },
  content: new VStack({ spacing: 10, padding: 12 }, [
    new SplitView({ vertical: false, position: 190, grow: 1 }, [
      sidebar,
      new VStack({ spacing: 10, scroll: true }, [
        table,
        detail,
      ]),
    ]),
    new HStack({ spacing: 10, align: "fill" }, [
      clock,
      new Spacer(),
      new Button({
        title: "Snapshot…",
        onClick: () => {
          const path = join(tmpdir(), "bunkit-gallery.png");
          say(`snapshot -> ${snapshotView(win, path)} bytes`);
        },
      }),
      new Button({
        title: "Export…",
        onClick: async () => {
          const path = await saveFile({ title: "Export the log", defaultName: "gallery-log.txt", window: win });
          say(`export -> ${path ?? "cancelled"}`);
        },
      }),
      new Button({
        title: "Debug…",
        onClick: () => console.log(describeViewTree(win)),
      }),
      new Button({ title: "Selection", onClick: () => say(selectedTitles()) }),
      // Clipboard: plain text in and out, synchronously.
      new Button({
        title: "Copy",
        onClick: () => {
          setClipboardText(log.value);
          say(`clipboard -> ${getClipboardText().length} chars read back`);
        },
      }),
    ]),
    log,
  ]),
});
win.quitOnClose();

// Keyboard and mouse as polled state — hold an arrow key and watch the clock.
keys.track(table);
setInterval(() => {
  const m = keys.mouse;
  const arrows = ["left", "right", "up", "down"].filter((k) => keys.held(k));
  clock.text = `${m.x.toFixed(0)},${m.y.toFixed(0)}${m.inside ? "" : " outside"}${arrows.length ? "  " + arrows.join("+") : ""}`;
}, 100);

say("ready — covers generated in pure JS, no assets on disk");
await app.run();
