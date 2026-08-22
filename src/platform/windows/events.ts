// src/platform/windows/events.ts — drains the native EventQueue into JS callbacks.
import { winLib } from "./ffi.ts";
import * as callbacks from "./callbacks.ts";

const EVT_CLICK = 1;
const EVT_TEXT_CHANGED = 2;
const EVT_WINDOW_CLOSED = 4;
const EVT_VALUE_CHANGED = 5;
const EVT_SELECTION_CHANGED = 6;
const EVT_TABLE_DOUBLE_CLICK = 7;
const EVT_TEXT_SUBMIT = 8;
const EVT_DIALOG_RESULT = 9;
const EVT_MENU_CLICK = 10;
const EVT_FILE_RESULT = 11;

// Dialog results and menu clicks are matched by id, not by callback registry.
export const dialogResolvers = new Map<number, (e: NativeEvent) => void>();
export const menuHandlers = new Map<bigint, (itemId: number, label: string) => void>();

export interface NativeEvent {
  type: number;
  target: bigint;
  callback: bigint;
  value1: number;
  value2: number;
  text: string;
}

function popOne(): NativeEvent | null {
  const size = winLib.bk_event_next_size() as number;
  if (!size) return null;
  const buf = Buffer.alloc(size);
  const n = winLib.bk_event_pop(buf as any, size) as number;
  if (n <= 0) return null;
  const plen = buf.readUInt32LE(40);
  return {
    type: buf.readUInt16LE(4),
    target: buf.readBigUInt64LE(8),
    callback: buf.readBigUInt64LE(16),
    value1: Number(buf.readBigInt64LE(24)),
    value2: Number(buf.readBigInt64LE(32)),
    text: buf.subarray(44, 44 + plen).toString("utf8"),
  };
}

export function drain(): NativeEvent[] {
  const out: NativeEvent[] = [];
  let e: NativeEvent | null;
  while ((e = popOne()) !== null) out.push(e);
  return out;
}

// Called once per pump iteration; invokes the registered JS callbacks.
export function dispatch(): void {
  for (const e of drain()) {
    if (e.type === EVT_DIALOG_RESULT || e.type === EVT_FILE_RESULT) {
      dialogResolvers.get(Number(e.target))?.(e);
      continue;
    }
    if (e.type === EVT_MENU_CLICK) {
      try {
        menuHandlers.get(e.target)?.(e.value1, e.text);
      } catch (err) {
        console.error("[BunKit] menu handler threw:", err);
      }
      continue;
    }
    if (e.type === EVT_WINDOW_CLOSED) {
      const fn = callbacks.get(e.callback);
      if (fn) fn(e);
      // Window close is also handled by the backend's onClose map; still dispatch
      // so that backend can see the target handle.
      const winCb = (globalThis as any).__bk_onWindowClosed as Map<bigint, () => void> | undefined;
      winCb?.get(e.target)?.();
      continue;
    }
    const fn = callbacks.get(e.callback);
    if (fn) {
      try {
        if (e.type === EVT_TEXT_CHANGED || e.type === EVT_TEXT_SUBMIT) fn(e.text, e);
        else if (e.type === EVT_VALUE_CHANGED) fn(e.text ? Number(e.text) : e.value1, e);
        else if (e.type === EVT_SELECTION_CHANGED) fn(e.value1, e.text, e);
        else if (e.type === EVT_TABLE_DOUBLE_CLICK) fn(e.value1, e);
        else fn(e);
      } catch (err) {
        console.error("[BunKit] callback threw:", err);
      }
    }
  }
}
