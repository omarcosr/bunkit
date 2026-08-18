// Polled input: held keys, single-frame edges, modifiers, mouse and scroll.
//
// Every event here goes through NSApplication's queue rather than being handed
// to the handler directly, so what is tested is the whole path — the monitor,
// the block returning through libffi, the key-code table and the frame-tick
// edge detection — rather than a function called with a fake.

import { objc } from "../src/objc.ts";
import { NIL } from "../src/bridge.ts";
import { initApp, onFrame, pumpOnce } from "../src/runtime.ts";
import { input } from "../src/ui/input.ts";
import { View } from "../src/ui/view.ts";
import { Window } from "../src/ui/window.ts";

let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

initApp();

const view = new View(objc.NSView.alloc().init(), { width: 400, height: 300 });
const win = new Window({
  title: "input", size: { width: 400, height: 300 }, content: view, show: true,
});
for (let i = 0; i < 20; i++) pumpOnce(0.004);

const keys = input().track(view);
const app = objc.NSApplication.sharedApplication();
const windowNumber = Number(win.native.windowNumber());

/**
 * Post an event and let the run loop deliver it.
 *
 * atStart: false, so events arrive in the order they were posted. Pushing to
 * the front of the queue delivers a down/up pair backwards and leaves the key
 * stuck down, which looks like a library bug and is not one.
 */
function post(event: any, ticks = 3): void {
  if (!event || event.ptr === NIL) throw new Error("could not build the event");
  app.postEvent_atStart_(event, false);
  for (let i = 0; i < ticks; i++) pumpOnce(0.003);
}

function key(type: number, code: number, characters: string, repeat = false, flags = 0) {
  return objc.NSEvent.keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode_(
    type, { x: 10, y: 10 }, flags, 0, windowNumber, null, characters, characters, repeat, code,
  );
}

function mouse(type: number, x: number, y: number) {
  return objc.NSEvent.mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure_(
    type, { x, y }, 0, 0, windowNumber, null, 0, 1, 1,
  );
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

post(key(10, 13, "w"));
check("a key press registers as held", keys.held("w"));
check("the key code maps by position, not character", !keys.held("z"));
check("case does not matter", keys.held("W"));
check("keys that were never pressed are not held", !keys.held("a"));

// pressed() must be true for exactly the frame the key went down on. The post
// above already advanced several ticks, so it has to have gone false again.
check("pressed() does not stay true after its frame", !keys.pressed("w"));
check("but held() does", keys.held("w"));

{
  // Edges are only visible from inside a frame callback, which is where game
  // code reads them. After pumpOnce returns, the frame they belonged to is over.
  let sawPressed = 0;
  let sawHeld = 0;
  const stop = onFrame(() => {
    if (keys.pressed("a")) sawPressed++;
    if (keys.held("a")) sawHeld++;
  });
  app.postEvent_atStart_(key(10, 0, "a"), false);
  for (let i = 0; i < 6; i++) pumpOnce(0.003);
  stop();
  check("pressed() is true on exactly one frame", sawPressed === 1, sawPressed);
  check("held() stays true across frames", sawHeld >= 3, sawHeld);
}

post(key(11, 0, "a"));
check("key up clears held", !keys.held("a"));

{
  let sawReleased = 0;
  const stop = onFrame(() => {
    if (keys.released("w")) sawReleased++;
  });
  app.postEvent_atStart_(key(11, 13, "w"), false);
  for (let i = 0; i < 6; i++) pumpOnce(0.003);
  stop();
  check("released() is true on exactly one frame", sawReleased === 1, sawReleased);
  check("and the key is no longer held", !keys.held("w"));
}

{
  // Auto-repeat would otherwise re-fire pressed() every few milliseconds.
  post(key(10, 15, "r"));
  let repeats = 0;
  const stop = onFrame(() => {
    if (keys.pressed("r")) repeats++;
  });
  for (let i = 0; i < 4; i++) {
    app.postEvent_atStart_(key(10, 15, "r", true), false);
    pumpOnce(0.003);
  }
  stop();
  check("auto-repeat does not re-fire pressed()", repeats === 0, repeats);
  post(key(11, 15, "r"));
}

{
  const seen: string[] = [];
  keys.onKeyDown((k) => seen.push(k));
  post(key(10, 49, " "));
  check("the callback fires with a name", seen.includes("space"), seen);
  check("space is held", keys.held("space"));
  post(key(11, 49, " "));
}

// ---------------------------------------------------------------------------
// Modifiers
// ---------------------------------------------------------------------------

{
  const SHIFT = 1 << 17;
  post(key(12, 56, "", false, SHIFT));
  check("shift registers from a flags-changed event", keys.held("shift") && keys.shift);
  check("other modifiers stay clear", !keys.command && !keys.control);

  // Modifiers have no key-up; the flags word going empty is the release.
  post(key(12, 56, "", false, 0));
  check("clearing the flags releases it", !keys.shift);
}

// ---------------------------------------------------------------------------
// Mouse
// ---------------------------------------------------------------------------

{
  // The view fills the window's content, so window coordinates are view
  // coordinates apart from the y flip.
  post(mouse(5, 100, 220));
  const m = keys.mouse;
  check("the pointer lands in view coordinates", Math.abs(m.x - 100) < 2, m.x);
  check("y counts down from the top, not up from the bottom",
    m.y > 0 && Math.abs(m.y - (view.frame.height - 220)) < 3, `${m.y} of ${view.frame.height}`);
  check("and it is inside the view", m.inside);

  post(mouse(5, 900, 220));
  check("a pointer past the edge reads as outside", !keys.mouse.inside);
  post(mouse(5, 100, 220));
}

{
  // Deltas belong to the frame they happened in.
  let moved = 0;
  let total = 0;
  const stop = onFrame(() => {
    const { dx } = keys.mouse;
    if (dx !== 0) {
      moved++;
      total += dx;
    }
  });
  app.postEvent_atStart_(mouse(5, 140, 220), false);
  for (let i = 0; i < 6; i++) pumpOnce(0.003);
  stop();
  check("a movement delta is reported on one frame", moved === 1, moved);
  check("and it is the distance moved", Math.abs(total - 40) < 2, total);
  check("a frame with no motion reads zero", keys.mouse.dx === 0);
}

{
  post(mouse(1, 100, 220));
  check("a left press registers", keys.button(0) && keys.mouse.buttons.has(0));
  check("the right button is separate", !keys.button(1));
  post(mouse(2, 100, 220));
  check("and clears on release", !keys.button(0));
}

{
  post(mouse(3, 100, 220));
  check("the right button registers", keys.button(1));
  post(mouse(4, 100, 220));
  check("and clears", !keys.button(1));
}

// ---------------------------------------------------------------------------
// The monitor must not eat anything
// ---------------------------------------------------------------------------

{
  // Returning nil from the handler would swallow the event and break every
  // control in the app. Returning it passes it on, so the responder chain still
  // sees it — a window that is still key after a few hundred events is the
  // cheap version of that check.
  for (let i = 0; i < 40; i++) {
    app.postEvent_atStart_(key(10, 12, "q"), false);
    app.postEvent_atStart_(key(11, 12, "q"), false);
    pumpOnce(0.002);
  }
  check("the app survives a flood of monitored events", !!win.native.isVisible());
  check("and no key is left stuck down", !keys.held("q"), [...keys.keys]);
}

win.close();
console.log(failures === 0 ? "\nALL INPUT-STATE TESTS PASSED" : `\n${failures} INPUT-STATE FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
