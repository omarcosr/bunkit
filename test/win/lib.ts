// Shared FFI bindings + helpers for Windows milestone tests.
import { dlopen } from "bun:ffi";

export interface BkEvent {
  type: number;
  target: bigint;
  callback: bigint;
  text: string;
}

const symbols = {
  bk_runtime_init: { args: [], returns: "i32" },
  bk_runtime_shutdown: { args: [], returns: "i32" },
  bk_runtime_running: { args: [], returns: "i32" },
  bk_last_error_length: { args: [], returns: "u32" },
  bk_copy_last_error: { args: ["ptr", "u32"], returns: "i32" },

  bk_window_create: { args: ["ptr", "u32", "f64", "f64"], returns: "u64" },
  bk_window_set_title: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_window_show: { args: ["u64"], returns: "i32" },
  bk_window_close: { args: ["u64"], returns: "i32" },
  bk_window_set_content: { args: ["u64", "u64"], returns: "i32" },

  bk_stack_create: {
    args: ["i32", "f64", "f64", "f64", "f64", "f64"],
    returns: "u64",
  },
  bk_stack_add_child: { args: ["u64", "u64", "f64"], returns: "i32" },

  bk_label_create: { args: ["ptr", "u32"], returns: "u64" },
  bk_label_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_label_text_length: { args: ["u64"], returns: "u32" },
  bk_label_copy_text: { args: ["u64", "ptr", "u32"], returns: "i32" },

  bk_button_create: { args: ["ptr", "u32"], returns: "u64" },
  bk_button_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_button_set_click_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_button_click: { args: ["u64"], returns: "i32" },

  bk_textbox_create: { args: ["i32", "ptr", "u32"], returns: "u64" },
  bk_textbox_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textbox_set_placeholder: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textbox_set_change_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_textbox_value_length: { args: ["u64"], returns: "u32" },
  bk_textbox_copy_value: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textbox_insert_text: { args: ["u64", "ptr", "u32"], returns: "i32" },

  bk_control_get_size: { args: ["u64", "ptr", "ptr"], returns: "i32" },
  bk_object_destroy: { args: ["u64"], returns: "i32" },

  bk_event_next_size: { args: [], returns: "u32" },
  bk_event_pop: { args: ["ptr", "u32"], returns: "i32" },
} as const;

const EVT_CLICK = 1;
const EVT_TEXT_CHANGED = 2;
const EVT_WINDOW_CLOSED = 4;

export function load() {
  const path = new URL("../../build/winbridge.dll", import.meta.url).pathname.slice(1);
  const lib = dlopen(path, symbols);

  const enc = new TextEncoder();
  const cstr = (s: string): Buffer => Buffer.from(enc.encode(s));

  function lastError(): string {
    const len = lib.symbols.bk_last_error_length();
    if (!len) return "";
    const buf = Buffer.alloc(len + 1);
    lib.symbols.bk_copy_last_error(buf, len + 1);
    return buf.toString("utf8");
  }

  function fail(msg: string): never {
    console.error("FAIL:", msg);
    const e = lastError();
    if (e) console.error("last_error:", e);
    process.exit(1);
  }

  function assert(cond: boolean, msg: string): asserts cond {
    if (!cond) fail(msg);
  }

  // Pops every queued event; payload decoded per bunkit.h pack(1) layout.
  function drain(): BkEvent[] {
    const out: BkEvent[] = [];
    for (;;) {
      const size = lib.symbols.bk_event_next_size();
      if (!size) break;
      const buf = Buffer.alloc(size);
      const n = lib.symbols.bk_event_pop(buf, size);
      if (n <= 0) break;
      const plen = buf.readUInt32LE(40);
      out.push({
        type: buf.readUInt16LE(4),
        target: buf.readBigUInt64LE(8),
        callback: buf.readBigUInt64LE(16),
        text: buf.subarray(44, 44 + plen).toString("utf8"),
      });
    }
    return out;
  }

  async function waitForEvent(
    match: (e: BkEvent) => boolean,
    ms: number,
  ): Promise<BkEvent | null> {
    const deadline = Date.now() + ms;
    let found: BkEvent | null = null;
    while (!found && Date.now() < deadline) {
      for (const e of drain()) if (!found && match(e)) found = e;
      if (!found) await Bun.sleep(10);
    }
    return found;
  }

  function getSize(handle: bigint): [number, number] {
    const w = Buffer.alloc(8);
    const h = Buffer.alloc(8);
    lib.symbols.bk_control_get_size(handle, w, h);
    return [w.readDoubleLE(0), h.readDoubleLE(0)];
  }

  return {
    lib,
    cstr,
    assert,
    fail,
    lastError,
    drain,
    waitForEvent,
    getSize,
    EVT_CLICK,
    EVT_TEXT_CHANGED,
    EVT_WINDOW_CLOSED,
  };
}
