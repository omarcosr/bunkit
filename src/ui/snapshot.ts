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

export interface LayoutViolation {
  view: string;
  parent: string;
  detail: string;
}

/**
 * Find views drawing outside their parent.
 *
 * Auto Layout resolves an over-constrained layout by breaking a constraint, and
 * the visible result is a view quietly spilling past its container rather than
 * an error — so this is the check that catches it. Walk a window after layout
 * and assert the result is empty.
 */
export function checkLayout(
  root: View | Window | any,
  options: { tolerance?: number; includePrivate?: boolean } = {},
): LayoutViolation[] {
  const tolerance = options.tolerance ?? 0.5;
  const out: LayoutViolation[] = [];

  // AppKit's own internals overdraw on purpose — NSScrollPocket's blur and mask
  // in macOS 26 sit 28pt outside their parent so the scroll edge can fade. They
  // are not yours to fix, so they are not reported unless asked for.
  // Overlay scrollers legitimately hang outside the clip view too.
  const isFrameworkInternal = (name: string) =>
    name.startsWith("_") || name.includes("_TtC") || name === "NSScroller" ||
    name.startsWith("NSScrollPocket");
  const walk = (view: any, insideInternal: boolean) => {
    const bounds = view.bounds();
    const subs = view.subviews();
    const n = subs ? Number(subs.count()) : 0;
    for (let i = 0; i < n; i++) {
      const child = subs.objectAtIndex_(i);
      // Compare alignment rects, not frames. Controls like NSTextField and
      // NSButton deliberately draw a couple of points outside the rectangle
      // Auto Layout positions, so frames would report every label as a
      // violation.
      const f = child.alignmentRectForFrame_(child.frame());
      const over = [
        f.x < -tolerance ? `${(-f.x).toFixed(1)}pt past the left` : "",
        f.y < -tolerance ? `${(-f.y).toFixed(1)}pt past the bottom` : "",
        f.x + f.width > bounds.width + tolerance
          ? `${(f.x + f.width - bounds.width).toFixed(1)}pt past the right` : "",
        f.y + f.height > bounds.height + tolerance
          ? `${(f.y + f.height - bounds.height).toFixed(1)}pt past the top` : "",
      ].filter(Boolean);
      const name = String(child.className);
      const internal = insideInternal || isFrameworkInternal(name);
      if (over.length && (options.includePrivate || !internal)) {
        out.push({ view: name, parent: String(view.className), detail: over.join(", ") });
      }
      // Everything below a framework-internal view is framework-internal too.
      walk(child, internal);
    }
  };
  walk(viewOf(root), false);
  return out;
}

/** Accept a Window, a Layer 3 View, or a bare NSView/NSWindow. */
function viewOf(root: any): any {
  const native = nativeOf(root);
  // NSWindow answers -contentView; NSView does not, and only NSView has -bounds.
  return native.respondsTo?.("contentView") && !native.respondsTo("bounds")
    ? native.contentView()
    : native;
}
