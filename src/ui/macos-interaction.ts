import { createBlock, objc } from "../objc.ts";
import { NIL } from "../bridge.ts";
import type { InteractionState } from "./states.ts";
import type { CursorValue } from "./cursor.ts";

export interface MacInteractionTarget {
  native: any;
  _hasInteractionState(state: InteractionState): boolean;
  _isInteractionDisabled(): boolean;
  _setInteractionState(state: InteractionState, active: boolean): void;
  _getInteractionCursor?(): CursorValue | undefined;
}

const Mask = {
  leftMouseDown: 1 << 1,
  leftMouseUp: 1 << 2,
  mouseMoved: 1 << 5,
  leftMouseDragged: 1 << 6,
  rightMouseDragged: 1 << 7,
  keyDown: 1 << 10,
  keyUp: 1 << 11,
  flagsChanged: 1 << 12,
} as const;

const ALL_EVENTS = Object.values(Mask).reduce((a, b) => a | b, 0);
const EventType = {
  leftMouseDown: 1,
  leftMouseUp: 2,
  mouseMoved: 5,
  leftMouseDragged: 6,
  rightMouseDragged: 7,
  keyDown: 10,
  keyUp: 11,
  flagsChanged: 12,
} as const;

const targets = new Set<MacInteractionTarget>();
let monitor: any = null;
let cursorHidden = false;
let cursorManaged = false;

const MAC_CURSOR_SELECTORS: Partial<Record<CursorValue, string>> = {
  auto: "arrowCursor",
  default: "arrowCursor",
  pointer: "pointingHandCursor",
  text: "IBeamCursor",
  "vertical-text": "IBeamCursor",
  crosshair: "crosshairCursor",
  move: "openHandCursor",
  "all-scroll": "closedHandCursor",
  grab: "openHandCursor",
  grabbing: "closedHandCursor",
  "not-allowed": "operationNotAllowedCursor",
  "no-drop": "operationNotAllowedCursor",
  wait: "busyButClickableCursor",
  progress: "busyButClickableCursor",
  "e-resize": "resizeLeftRightCursor",
  "w-resize": "resizeLeftRightCursor",
  "ew-resize": "resizeLeftRightCursor",
  "col-resize": "resizeLeftRightCursor",
  "n-resize": "resizeUpDownCursor",
  "s-resize": "resizeUpDownCursor",
  "ns-resize": "resizeUpDownCursor",
  "row-resize": "resizeUpDownCursor",
  "ne-resize": "resizeUpCursor",
  "sw-resize": "resizeUpCursor",
  "nesw-resize": "resizeUpCursor",
  "nw-resize": "resizeUpCursor",
  "se-resize": "resizeUpCursor",
  "nwse-resize": "resizeUpCursor",
};

function setMacCursor(value: CursorValue | undefined): void {
  try {
    if (value === undefined && !cursorManaged) return;
    if (value === "none") {
      if (!cursorHidden) {
        objc.NSCursor.hide();
        cursorHidden = true;
      }
      cursorManaged = true;
      return;
    }
    if (cursorHidden) {
      objc.NSCursor.unhide();
      cursorHidden = false;
    }
    const selector = MAC_CURSOR_SELECTORS[value ?? "default"] ?? "arrowCursor";
    const cursor = (objc.NSCursor as any)[selector]?.() ?? objc.NSCursor.arrowCursor();
    cursor.set();
    cursorManaged = true;
  } catch {
    // Cursor changes are cosmetic; a missing selector must not break input.
  }
}

let block: any = null;

/** AppKit does not deliver mouseMoved events to a window by default. */
export function enableMacMouseMovedEvents(target: Pick<MacInteractionTarget, "native">): void {
  const window = target.native.window?.();
  if (window && window.ptr !== NIL) window.setAcceptsMouseMovedEvents_(true);
}

function sameObject(a: any, b: any): boolean {
  if (!a || !b || a === NIL || b === NIL) return false;
  if (a === b) return true;
  return a.ptr !== undefined && b.ptr !== undefined && a.ptr === b.ptr;
}

function contains(target: MacInteractionTarget, eventWindow: any, event: any): boolean {
  enableMacMouseMovedEvents(target);
  const window = target.native.window?.();
  if (!window || !sameObject(window, eventWindow)) return false;
  if (target.native.isHidden?.()) return false;
  const point = event.locationInWindow();
  const local = target.native.convertPoint_fromView_(point, null);
  const bounds = target.native.bounds();
  const x = bounds.x ?? 0;
  const y = bounds.y ?? 0;
  return local.x >= x && local.y >= y && local.x <= x + bounds.width && local.y <= y + bounds.height;
}

function syncFocus(eventWindow: any): void {
  if (!eventWindow || eventWindow === NIL) return;
  const first = eventWindow.firstResponder?.();
  for (const target of targets) {
    if (!target._hasInteractionState("focus")) continue;
    const window = target.native.window?.();
    target._setInteractionState("focus", sameObject(window, eventWindow) && sameObject(first, target.native));
  }
}

function handle(event: any): void {
  const type = Number(event.type());
  const eventWindow = event.window?.();
  const insideEvent = type === EventType.mouseMoved || type === EventType.leftMouseDown ||
    type === EventType.leftMouseUp || type === EventType.leftMouseDragged || type === EventType.rightMouseDragged;

  if (insideEvent) {
    let cursor: CursorValue | undefined;
    for (const target of targets) {
      const inside = contains(target, eventWindow, event);
      if (inside && !target._isInteractionDisabled()) {
        const candidate = target._getInteractionCursor?.();
        if (candidate !== undefined) cursor = candidate;
      }
      if (target._isInteractionDisabled()) {
        if (target._hasInteractionState("hover")) target._setInteractionState("hover", false);
        if (target._hasInteractionState("pressed")) target._setInteractionState("pressed", false);
        continue;
      }
      if (target._hasInteractionState("hover")) target._setInteractionState("hover", inside);
      if (target._hasInteractionState("pressed")) {
        if (type === EventType.leftMouseDown) target._setInteractionState("pressed", inside);
        else if (type === EventType.leftMouseUp) target._setInteractionState("pressed", false);
      }
    }
    setMacCursor(cursor);
  }

  if (type === EventType.leftMouseDown || type === EventType.leftMouseUp ||
      type === EventType.keyDown || type === EventType.keyUp || type === EventType.flagsChanged) {
    queueMicrotask(() => syncFocus(eventWindow));
  }
}

export function registerMacInteractionTarget(target: MacInteractionTarget): void {
  targets.add(target);
  enableMacMouseMovedEvents(target);
  // Controls are commonly registered before being inserted into a window.
  // Retry after the current construction/layout turn so the attached window is
  // also configured without requiring users to call input().track().
  queueMicrotask(() => enableMacMouseMovedEvents(target));
  if (monitor) return;
  block = createBlock("@@?@", (event: any) => {
    try { handle(event); } catch (error) { console.error("[BunKit] interaction state failed:", error); }
    return event;
  });
  monitor = objc.NSEvent.addLocalMonitorForEventsMatchingMask_handler_(ALL_EVENTS, block);
}
