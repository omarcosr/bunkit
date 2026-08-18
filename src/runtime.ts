// Application lifecycle and the cooperative run loop.
//
// AppKit's run loop and Bun's event loop both want to own the main thread. We
// give the thread to AppKit in short slices and hand it back to Bun in between.

import { lib } from "./bridge.ts";
import { objc, createDelegate, withPool, type ObjCObject } from "./objc.ts";

export const ActivationPolicy = {
  Regular: 0,
  Accessory: 1,
  Prohibited: 2,
} as const;

export interface RunOptions {
  /**
   * How long a single pump blocks in the kernel while the app is being used.
   * This bounds input latency. Lower = snappier, more wakeups.
   */
  pumpSeconds?: number;
  /**
   * Pump budget once the app has gone quiet. The rest of each idle iteration is
   * spent asleep in *Bun* instead, which is what keeps JS timers accurate: time
   * blocked inside AppKit is time Bun's event loop cannot run.
   */
  idlePumpSeconds?: number;
  /** How long to sleep in Bun per idle iteration, in milliseconds. */
  idleSleepMs?: number;
  /**
   * Sleep once the app has been quiet for a very long time. Off by default:
   * measured on an M-series Mac it saves ~0.3 points of idle CPU but costs a
   * 16ms animation timer about 9 points of accuracy, which is the wrong trade
   * unless you know the app never animates while idle. Enable by also setting
   * `deepIdleAfter`.
   */
  deepIdleSleepMs?: number;
  /** Consecutive event-free pumps before switching to the idle cadence. */
  idleAfter?: number;
  /** Consecutive event-free pumps before backing off further. Default: never. */
  deepIdleAfter?: number;
  /** Dock/menu-bar behaviour. */
  activationPolicy?: number;
  /** Quit once the last window closes. Default true. */
  quitAfterLastWindow?: boolean;
}

let initialised = false;
let running = false;
let stopRequested = false;
let stopResolve: (() => void) | null = null;
const quitHandlers: Array<() => void | Promise<void>> = [];

/** Initialise NSApplication. Safe to call more than once. */
export function initApp(policy: number = ActivationPolicy.Regular): void {
  if (initialised) return;
  initialised = true;
  lib.br_app_init(policy);
  // A pool for everything that happens before the first pump.
  lib.br_autorelease_pool_push();
}

/*
 * Per-frame callbacks.
 *
 * AppKit has no equivalent of requestAnimationFrame, and a CVDisplayLink fires
 * on its own thread, which is the wrong place to re-enter JavaScript from. So
 * anything that animates is driven from the run loop itself: one call per
 * iteration, on the main thread, in the same slice as everything else.
 */
const frameCallbacks = new Set<(now: number) => void>();

/*
 * Animation cadence.
 *
 * The idle loop ticks at about 100 Hz, which caps a 120 Hz display. While
 * anything is animating the loop shortens its sleep so vsync is reachable; the
 * count is a refcount because several views may animate at once.
 */
let animators = 0;

export function setAnimating(on: boolean): void {
  animators = Math.max(0, animators + (on ? 1 : -1));
}

export function isAnimating(): boolean {
  return animators > 0;
}

/** Run `fn` once per run-loop iteration. Returns a function that stops it. */
export function onFrame(fn: (now: number) => void): () => void {
  frameCallbacks.add(fn);
  return () => frameCallbacks.delete(fn);
}

/** Invoke the frame callbacks. Called by the run loop and by pumpOnce. */
export function tickFrames(): void {
  if (frameCallbacks.size === 0) return;
  const now = lib.br_now();
  for (const fn of [...frameCallbacks]) {
    try {
      fn(now);
    } catch (e) {
      console.error("[runtime] frame callback failed:", e);
    }
  }
}

export function onQuit(fn: () => void | Promise<void>): void {
  quitHandlers.push(fn);
}

export function quit(): void {
  stopRequested = true;
  lib.br_stop();
  lib.br_post_empty_event(); // wake a pump that is blocked in mach_msg
  if (stopResolve) {
    const r = stopResolve;
    stopResolve = null;
    r();
  }
}

export function isRunning(): boolean {
  return running;
}

/**
 * Process pending AppKit events once, without entering the loop.
 *
 * Also recycles the base autorelease pool, so a script that drives the app by
 * calling pumpOnce in a loop of its own does not accumulate every temporary
 * AppKit handed back since startup.
 */
export function pumpOnce(seconds = 0): number {
  lib.br_autorelease_pool_recycle();
  const handled = lib.br_pump(seconds);
  tickFrames();
  return handled;
}

/**
 * Own the main thread until quit() is called.
 *
 * Each iteration: block in AppKit for up to `pumpSeconds`, drain the rest of the
 * queue, then yield a turn to Bun so timers, promises and I/O make progress.
 */
export async function run(options: RunOptions = {}): Promise<void> {
  const activePump = options.pumpSeconds ?? 0.004;
  const idlePump = options.idlePumpSeconds ?? 0.002;
  const idleSleep = options.idleSleepMs ?? 8;
  const deepIdleSleep = options.deepIdleSleepMs ?? 16;
  const idleAfter = options.idleAfter ?? 20;
  const deepIdleAfter = options.deepIdleAfter ?? Number.POSITIVE_INFINITY;

  initApp(options.activationPolicy ?? ActivationPolicy.Regular);
  lib.br_set_terminate_after_last_window(options.quitAfterLastWindow === false ? 0 : 1);

  running = true;
  stopRequested = false;
  let quiet = 0;

  try {
    while (!stopRequested && !lib.br_should_stop()) {
      // An animating view needs the fast cadence even with no input events,
      // or the run loop's idle sleep becomes the frame rate ceiling.
      const idle = quiet >= idleAfter && animators === 0;
      const deep = quiet >= deepIdleAfter && animators === 0;
      // Recycle the base pool (pushed by initApp) before nesting this
      // iteration's pool inside it, so work done outside run() drains too.
      lib.br_autorelease_pool_recycle();
      lib.br_autorelease_pool_push();
      try {
        const handled = lib.br_pump(idle ? idlePump : activePump);
        quiet = handled > 0 ? 0 : quiet + 1;
        tickFrames();
      } finally {
        // Yield to Bun. Anything Bun runs here is still inside the pool, so
        // JS-created temporaries drain on the same tick. While idle we do the
        // waiting *here* rather than inside AppKit, which roughly halves idle
        // CPU and keeps setTimeout/setInterval close to their nominal period.
        await Bun.sleep(deep ? deepIdleSleep : idle ? idleSleep : 0);
        lib.br_autorelease_pool_pop();
      }
    }
  } finally {
    running = false;
  }

  for (const h of quitHandlers) {
    try {
      await h();
    } catch (e) {
      console.error("[runtime] quit handler failed:", e);
    }
  }
  lib.br_autorelease_pool_pop(); // the pool pushed by initApp
}

/** Run `fn` on the next pump iteration (useful from inside a delegate). */
export function nextTick(fn: () => void): void {
  queueMicrotask(() => {
    try {
      fn();
    } catch (e) {
      console.error("[runtime]", e);
    }
  });
}

export { withPool };

// --- shared NSApplication access -------------------------------------------

let sharedApp: ObjCObject | null = null;
export function NSApp(): ObjCObject {
  if (!sharedApp) {
    initApp();
    sharedApp = objc.NSApplication.sharedApplication();
  }
  return sharedApp!;
}
