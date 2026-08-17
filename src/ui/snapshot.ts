// Rendering a view to a PNG.
//
// Useful for docs and screenshots, and indispensable for testing: it asks the
// view to draw itself, so unlike screencapture it needs no screen-recording
// permission and works headlessly.

import { objc, str } from "../objc.ts";
import { nativeOf, type View } from "./view.ts";
import type { Window } from "./window.ts";

import { BitmapImageFileType } from "./appkit.ts";

/** Render an NSView (or a Layer 3 View) to a PNG file. Returns the byte count. */
export function snapshotView(view: View | any, path: string): number {
  const native = nativeOf(view);
  const bounds = native.bounds();
  if (bounds.width < 1 || bounds.height < 1) {
    throw new Error(`cannot snapshot a zero-sized view (${JSON.stringify(bounds)})`);
  }
  const rep = native.bitmapImageRepForCachingDisplayInRect_(bounds);
  if (!rep) throw new Error("bitmapImageRepForCachingDisplayInRect: returned nil");
  native.cacheDisplayInRect_toBitmapImageRep_(bounds, rep);
  const data = rep.representationUsingType_properties_(
    BitmapImageFileType.PNG,
    objc.NSDictionary.dictionary(),
  );
  if (!data) throw new Error("could not encode PNG");
  const ok = data.writeToFile_atomically_(path, true);
  if (!ok) throw new Error(`could not write ${path}`);
  return Number(data.length());
}

/** Render a window's content (without the titlebar) to a PNG file. */
export function snapshotWindow(window: Window | any, path: string): number {
  const native = nativeOf(window);
  return snapshotView(native.contentView(), path);
}

/**
 * Dump the view tree as indented text. The fastest way to see why a layout is
 * wrong without opening Xcode's view debugger.
 */
export function describeViewTree(root: View | any, depth = 0): string {
  const native = nativeOf(root);
  const f = native.frame();
  const cls = native.className ?? String(native.class?.() ?? "?");
  const extra =
    native.respondsTo?.("stringValue") && native.respondsTo("isEditable")
      ? ` "${str(native.stringValue())}"`
      : native.respondsTo?.("title")
        ? ` "${str(native.title())}"`
        : "";
  let out =
    "  ".repeat(depth) +
    `${cls} (${f.x.toFixed(0)},${f.y.toFixed(0)} ${f.width.toFixed(0)}x${f.height.toFixed(0)})${extra}\n`;
  const subs = native.subviews();
  const n = subs ? Number(subs.count()) : 0;
  for (let i = 0; i < n; i++) out += describeViewTree(subs.objectAtIndex_(i), depth + 1);
  return out;
}
