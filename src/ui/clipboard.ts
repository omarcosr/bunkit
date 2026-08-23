// Clipboard — plain text in and out, synchronously.
//
// NSPasteboard is the obvious route and needs no async ceremony for the plain
// text case: declare the types, write the string, done.

import { objc } from "../objc.ts";

/** Plain text onto the system clipboard (or a specific pasteboard). */
export function setClipboardText(text: string, pasteboard?: any): void {
  const board = pasteboard ?? objc.NSPasteboard.generalPasteboard();
  board.clearContents();
  board.setString_forType_(text, "public.utf8-plain-text");
}

/** Plain text from the system clipboard ("" when empty or non-text). */
export function getClipboardText(pasteboard?: any): string {
  const board = pasteboard ?? objc.NSPasteboard.generalPasteboard();
  const types = board.types();
  const n = Number(types.count());
  for (let i = 0; i < n; i++) {
    const t = String(types.objectAtIndex_(i));
    if (t === "public.utf8-plain-text" || t === "NSStringPboardType") {
      const s = board.stringForType_(t);
      if (s) return String(s);
    }
  }
  return "";
}
