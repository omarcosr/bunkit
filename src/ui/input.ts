// Keyboard and mouse, as state you can poll rather than events you must catch.
//
// A control panel wants callbacks — a button knows when it was clicked. Anything
// that runs a loop wants the opposite: "is W held right now", asked once per
// frame, in the frame's own code. Both are here, but polling is the one this
// exists for.
//
//   const keys = input();
//
//   scene.onFrame(({ dt }) => {
//     if (keys.held("w")) camera.position.z -= speed * dt;
//     if (keys.pressed("space")) jump();
//     camera.yaw += keys.mouse.dx * 0.004;
//   });
//
// It is a single application-wide NSEvent monitor rather than an NSView
// subclass, which means it sees every key regardless of which control has focus
// — right for a game, and the reason `held()` keeps working while a slider has
// the keyboard. The monitor passes every event on untouched, so the rest of the
// UI behaves exactly as it did.

import { createBlock, objc } from "../objc.ts";
import { NIL } from "../bridge.ts";
import { frameTick } from "../runtime.ts";
import type { View } from "./view.ts";

/** NSEventMask bits, named. */
const Mask = {
  leftMouseDown: 1 << 1,
  leftMouseUp: 1 << 2,
  rightMouseDown: 1 << 3,
  rightMouseUp: 1 << 4,
  mouseMoved: 1 << 5,
  leftMouseDragged: 1 << 6,
  rightMouseDragged: 1 << 7,
  keyDown: 1 << 10,
  keyUp: 1 << 11,
  flagsChanged: 1 << 12,
  scrollWheel: 1 << 22,
  otherMouseDown: 1 << 25,
  otherMouseUp: 1 << 26,
  otherMouseDragged: 1 << 27,
} as const;

const ALL_EVENTS = Object.values(Mask).reduce((a, b) => a | b, 0);

const EventType = {
  leftMouseDown: 1, leftMouseUp: 2, rightMouseDown: 3, rightMouseUp: 4,
  mouseMoved: 5, leftMouseDragged: 6, rightMouseDragged: 7,
  keyDown: 10, keyUp: 11, flagsChanged: 12, scrollWheel: 22,
  otherMouseDown: 25, otherMouseUp: 26, otherMouseDragged: 27,
} as const;

/**
 * Hardware key codes to names, by position on the keyboard.
 *
 * Position rather than the character produced, which is what a game wants: on
 * an AZERTY keyboard the key where W sits still reports "w", so WASD stays
 * under the same fingers. `characters` on the event has the other answer when
 * you want the letter someone actually typed.
 */
const KEY_NAMES: Record<number, string> = {
  0: "a", 1: "s", 2: "d", 3: "f", 4: "h", 5: "g", 6: "z", 7: "x", 8: "c", 9: "v",
  11: "b", 12: "q", 13: "w", 14: "e", 15: "r", 16: "y", 17: "t",
  18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7",
  27: "-", 28: "8", 29: "0", 30: "]", 31: "o", 32: "u", 33: "[", 34: "i", 35: "p",
  36: "return", 37: "l", 38: "j", 39: "'", 40: "k", 41: ";", 42: "\\", 43: ",",
  44: "/", 45: "n", 46: "m", 47: ".", 48: "tab", 49: "space", 50: "`",
  51: "delete", 53: "escape",
  55: "command", 56: "shift", 57: "capslock", 58: "option", 59: "control",
  60: "shift", 61: "option", 62: "control",
  65: "numpad.", 67: "numpad*", 69: "numpad+", 71: "numclear", 75: "numpad/",
  76: "numpadenter", 78: "numpad-", 81: "numpad=",
  82: "numpad0", 83: "numpad1", 84: "numpad2", 85: "numpad3", 86: "numpad4",
  87: "numpad5", 88: "numpad6", 89: "numpad7", 91: "numpad8", 92: "numpad9",
  96: "f5", 97: "f6", 98: "f7", 99: "f3", 100: "f8", 101: "f9", 103: "f11",
  105: "f13", 107: "f14", 109: "f10", 111: "f12", 113: "f15", 114: "help",
  115: "home", 116: "pageup", 117: "forwarddelete", 118: "f4", 119: "end",
  120: "f2", 121: "pagedown", 122: "f1",
  123: "left", 124: "right", 125: "down", 126: "up",
};

/** NSEventModifierFlags, the bits worth naming. */
const MODIFIERS: Array<[number, string]> = [
  [1 << 17, "shift"],
  [1 << 18, "control"],
  [1 << 19, "option"],
  [1 << 20, "command"],
  [1 << 16, "capslock"],
];

export interface MouseState {
  /**
   * Position inside the tracked view, in points, with the origin at the top
   * left — matching the framebuffer, not AppKit's bottom-left.
   */
  x: number;
  y: number;
  /** Movement since the previous frame. Zero on a frame with no motion. */
  dx: number;
  dy: number;
  /** Scroll since the previous frame. */
  wheelX: number;
  wheelY: number;
  /** Held buttons: 0 left, 1 right, 2 and up for the rest. */
  buttons: Set<number>;
  /** Whether the pointer is over the tracked view. */
  inside: boolean;
}

export type KeyHandler = (key: string, event: any) => void;
export type ScrollHandler = (dx: number, dy: number, event: any) => void;

export class Input {
  #held = new Set<string>();
  /** Frame tick a key last changed on, for edge detection without clearing. */
  #downAt = new Map<string, number>();
  #upAt = new Map<string, number>();
  #modifiers = 0;

  #mouseX = 0;
  #mouseY = 0;
  #dx = 0;
  #dy = 0;
  #wheelX = 0;
  #wheelY = 0;
  #motionTick = -1;
  #wheelTick = -1;
  #buttons = new Set<number>();
  #inside = false;

  #view: View | null = null;
  #monitor: any = null;
  #block: ReturnType<typeof createBlock> | null = null;
  #keyDown: KeyHandler[] = [];
  #keyUp: KeyHandler[] = [];
  #scroll: ScrollHandler[] = [];

  /**
   * Report mouse position relative to this view, and set `inside`.
   *
   * Also turns on mouse-moved events for its window: AppKit does not deliver
   * them by default, and a game that never gets them looks like one where the
   * mouse is broken.
   */
  track(view: View): this {
    this.#view = view;
    const window = view.native.window();
    if (window && window.ptr !== NIL) window.setAcceptsMouseMovedEvents_(true);
    return this;
  }

  /** Is this key down right now? */
  held(key: string): boolean {
    return this.#held.has(key.toLowerCase());
  }

  /** Did it go down during this frame? True for exactly one frame. */
  pressed(key: string): boolean {
    return this.#downAt.get(key.toLowerCase()) === frameTick();
  }

  /** Did it come up during this frame? */
  released(key: string): boolean {
    return this.#upAt.get(key.toLowerCase()) === frameTick();
  }

  /** Every key currently down. */
  get keys(): ReadonlySet<string> {
    return this.#held;
  }

  get shift(): boolean { return this.held("shift"); }
  get control(): boolean { return this.held("control"); }
  get option(): boolean { return this.held("option"); }
  get command(): boolean { return this.held("command"); }

  get mouse(): MouseState {
    const current = frameTick();
    return {
      x: this.#mouseX,
      y: this.#mouseY,
      // Deltas belong to the frame they happened in, so a frame with no motion
      // reads zero rather than repeating the last movement forever.
      dx: this.#motionTick === current ? this.#dx : 0,
      dy: this.#motionTick === current ? this.#dy : 0,
      wheelX: this.#wheelTick === current ? this.#wheelX : 0,
      wheelY: this.#wheelTick === current ? this.#wheelY : 0,
      buttons: this.#buttons,
      inside: this.#inside,
    };
  }

  /** Is this mouse button down? 0 is left, 1 is right. */
  button(index = 0): boolean {
    return this.#buttons.has(index);
  }

  onKeyDown(fn: KeyHandler): this { this.#keyDown.push(fn); return this; }
  onKeyUp(fn: KeyHandler): this { this.#keyUp.push(fn); return this; }
  onScroll(fn: ScrollHandler): this { this.#scroll.push(fn); return this; }

  /** @internal Install the monitor. Called once, by input(). */
  start(): this {
    if (this.#monitor) return this;
    // Returning the event passes it on. Returning nil would swallow it, which
    // would break every control in the app, so this never does.
    this.#block = createBlock("@@?@", (event: any) => {
      try {
        this.#handle(event);
      } catch (e) {
        console.error("[input] event handler failed:", e);
      }
      return event;
    });
    this.#monitor = objc.NSEvent.addLocalMonitorForEventsMatchingMask_handler_(
      ALL_EVENTS, this.#block,
    );
    return this;
  }

  stop(): this {
    if (this.#monitor) objc.NSEvent.removeMonitor_(this.#monitor);
    this.#monitor = null;
    this.#block?.dispose();
    this.#block = null;
    return this;
  }

  #handle(event: any): void {
    const type = Number(event.type());

    switch (type) {
      case EventType.keyDown: {
        // Auto-repeat is the OS being helpful about text entry; for held-key
        // polling it would re-fire pressed() every few milliseconds.
        if (event.isARepeat()) return;
        const key = KEY_NAMES[Number(event.keyCode())] ?? "";
        if (!key) return;
        this.#held.add(key);
        this.#downAt.set(key, frameTick());
        for (const fn of this.#keyDown) fn(key, event);
        return;
      }
      case EventType.keyUp: {
        const key = KEY_NAMES[Number(event.keyCode())] ?? "";
        if (!key) return;
        this.#held.delete(key);
        this.#upAt.set(key, frameTick());
        for (const fn of this.#keyUp) fn(key, event);
        return;
      }
      case EventType.flagsChanged: {
        // Modifiers have no key-up event; the flags word says what is held now.
        const flags = Number(event.modifierFlags());
        this.#modifiers = flags;
        for (const [bit, name] of MODIFIERS) {
          const down = (flags & bit) !== 0;
          const was = this.#held.has(name);
          if (down === was) continue;
          if (down) {
            this.#held.add(name);
            this.#downAt.set(name, frameTick());
            for (const fn of this.#keyDown) fn(name, event);
          } else {
            this.#held.delete(name);
            this.#upAt.set(name, frameTick());
            for (const fn of this.#keyUp) fn(name, event);
          }
        }
        return;
      }
      case EventType.scrollWheel: {
        const current = frameTick();
        if (this.#wheelTick !== current) {
          this.#wheelTick = current;
          this.#wheelX = 0;
          this.#wheelY = 0;
        }
        const dx = Number(event.scrollingDeltaX());
        const dy = Number(event.scrollingDeltaY());
        this.#wheelX += dx;
        this.#wheelY += dy;
        for (const fn of this.#scroll) fn(dx, dy, event);
        return;
      }
      case EventType.leftMouseDown: this.#buttons.add(0); break;
      case EventType.leftMouseUp: this.#buttons.delete(0); break;
      case EventType.rightMouseDown: this.#buttons.add(1); break;
      case EventType.rightMouseUp: this.#buttons.delete(1); break;
      case EventType.otherMouseDown: this.#buttons.add(Number(event.buttonNumber())); break;
      case EventType.otherMouseUp: this.#buttons.delete(Number(event.buttonNumber())); break;
    }

    this.#updatePosition(event);
  }

  #updatePosition(event: any): void {
    const view = this.#view;
    if (!view) return;
    const window = event.window();
    if (!window || window.ptr === NIL) return;

    const inWindow = event.locationInWindow();
    const local = view.native.convertPoint_fromView_(inWindow, null);
    const bounds = view.native.bounds();
    // AppKit's origin is bottom-left; everything on the rendering side of this
    // library counts down from the top, so flip once here rather than in every
    // caller.
    const x = local.x;
    const y = view.native.isFlipped() ? local.y : bounds.height - local.y;

    const current = frameTick();
    if (this.#motionTick !== current) {
      this.#motionTick = current;
      this.#dx = 0;
      this.#dy = 0;
    }
    this.#dx += x - this.#mouseX;
    this.#dy += y - this.#mouseY;
    this.#mouseX = x;
    this.#mouseY = y;
    this.#inside = x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
  }
}

let shared: Input | null = null;

/**
 * The application's input state.
 *
 * One monitor for the process, installed the first time this is called. Call
 * `.track(view)` to get mouse coordinates in a view's own space.
 */
export function input(): Input {
  if (!shared) shared = new Input().start();
  return shared;
}
