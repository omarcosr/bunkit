// Milestone 2 proof: window lifecycle through the C ABI.
// Run: bun run test/win/m2-window.ts   (a real window flashes on screen)
import { dlopen } from "bun:ffi";

const lib = dlopen(new URL("../../build/winbridge.dll", import.meta.url).pathname.slice(1), {
  bk_runtime_init: { args: [], returns: "i32" },
  bk_runtime_shutdown: { args: [], returns: "i32" },
  bk_runtime_running: { args: [], returns: "i32" },
  bk_window_create: { args: ["ptr", "u32", "f64", "f64"], returns: "u64" },
  bk_window_set_title: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_window_show: { args: ["u64"], returns: "i32" },
  bk_window_close: { args: ["u64"], returns: "i32" },
  bk_object_destroy: { args: ["u64"], returns: "i32" },
  bk_event_next_size: { args: [], returns: "u32" },
  bk_event_pop: { args: ["ptr", "u32"], returns: "i32" },
  bk_last_error_length: { args: [], returns: "u32" },
  bk_copy_last_error: { args: ["ptr", "u32"], returns: "i32" },
});

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) {
    console.error("FAIL:", msg);
    const len = lib.symbols.bk_last_error_length();
    if (len > 0) {
      const buf = Buffer.alloc(len + 1);
      lib.symbols.bk_copy_last_error(buf, len + 1);
      console.error("last_error:", buf.toString("utf8"));
    }
    process.exit(1);
  }
}

const enc = new TextEncoder();
function cstr(s: string): Buffer {
  const bytes = enc.encode(s);
  const out = Buffer.alloc(bytes.length + 1);
  Buffer.from(bytes).copy(out);
  return out;
}

const EVT_WINDOW_CLOSED = 4;
interface BkEvent {
  type: number;
  target: bigint;
}
function popEvent(): BkEvent | null {
  const size = lib.symbols.bk_event_next_size();
  if (size === 0) return null;
  const buf = Buffer.alloc(size);
  const n = lib.symbols.bk_event_pop(buf, size);
  assert(n > 0 && n === size, `event pop expected ${size}, got ${n}`);
  // header: u32 size, u16 type, u16 flags @4..8, then u64 target @8
  return { type: buf.readUInt16LE(4), target: buf.readBigUInt64LE(8) };
}

async function waitFor(pred: () => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) return false;
    await Bun.sleep(10);
  }
  return true;
}

// --- the actual test ---------------------------------------------------------

assert(lib.symbols.bk_runtime_init() === 0, "runtime init");

const titleBuf = cstr("Milestone Two");
const win = lib.symbols.bk_window_create(titleBuf, titleBuf.length - 1, 480, 320);
assert(win !== 0n, `window created, got ${win}`);

assert(
  lib.symbols.bk_window_set_title(win, cstr("Renamed"), 7) === 0,
  "set title",
);
assert(lib.symbols.bk_window_show(win) === 0, "show");

let closed = false;
const poll = setInterval(() => {
  let e: BkEvent | null;
  while ((e = popEvent()) !== null) {
    if (e.type === EVT_WINDOW_CLOSED && e.target === win) closed = true;
  }
}, 5);

await Bun.sleep(600);
lib.symbols.bk_window_close(win);
assert(await waitFor(() => closed, 5000), "WINDOW_CLOSED event arrived for the right handle");

assert(lib.symbols.bk_object_destroy(win) === 0, "destroy");
assert(lib.symbols.bk_object_destroy(win) !== 0, "double destroy reports invalid handle");

clearInterval(poll);
assert(lib.symbols.bk_runtime_shutdown() === 0, "shutdown");
console.log("MILESTONE 2 OK");
process.exit(0);
