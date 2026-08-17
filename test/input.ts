// Synthetic input: post real NSEvents into the app and check they come out the
// other side as JS callbacks. This is the end-to-end proof that the UI is not
// just drawn but actually usable.

import { objc } from "../src/objc.ts";
import { initApp, pumpOnce } from "../src/runtime.ts";
import {
  Button,
  Checkbox,
  HStack,
  Label,
  Table,
  TextField,
  VStack,
  Window,
} from "../src/ui/index.ts";
import { constants as C } from "../src/ui/appkit.ts";

let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

function settle(n = 10, s = 0.004) {
  for (let i = 0; i < n; i++) pumpOnce(s);
}

initApp();

const EventType = {
  LeftMouseDown: Number(C.NSEventTypeLeftMouseDown),
  LeftMouseUp: Number(C.NSEventTypeLeftMouseUp),
  KeyDown: Number(C.NSEventTypeKeyDown),
  KeyUp: Number(C.NSEventTypeKeyUp),
};

/**
 * Post a full click.
 *
 * Both events must be queued *before* pumping: -[NSCell trackMouse:...] spins
 * its own nested run loop on mouse-down and does not return until it sees the
 * matching mouse-up. Posting the up afterwards would deadlock, because the
 * pump that would deliver it never returns. This is the nested-run-loop
 * behaviour documented in the README, reproduced deliberately.
 */
function click(win: any, view: any, at?: { x: number; y: number }) {
  postMouse(win, view, EventType.LeftMouseDown, at);
  postMouse(win, view, EventType.LeftMouseUp, at);
  settle(16);
}

/** A point in a view's own coordinates, converted to its window's space. */
function inWindow(view: any, at?: { x: number; y: number }): { x: number; y: number } {
  const b = view.bounds();
  const local = at ?? { x: b.width / 2, y: b.height / 2 };
  const p = view.convertPoint_toView_(local, null);
  return { x: p.x, y: p.y };
}

function postMouse(win: any, view: any, type: number, at?: { x: number; y: number }) {
  const loc = inWindow(view, at);
  const e = objc.NSEvent.mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure_(
    type, loc, 0, objc.NSProcessInfo.processInfo().systemUptime(),
    win.windowNumber(), null, 0, 1, type === EventType.LeftMouseDown ? 1.0 : 0.0,
  );
  objc.NSApplication.sharedApplication().postEvent_atStart_(e, false);
}

function postKey(win: any, chars: string, keyCode: number, type: number) {
  const e = objc.NSEvent.keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode_(
    type, { x: 0, y: 0 }, 0, objc.NSProcessInfo.processInfo().systemUptime(),
    win.windowNumber(), null, chars, chars, false, keyCode,
  );
  objc.NSApplication.sharedApplication().postEvent_atStart_(e, false);
}

// ---------------------------------------------------------------------------
// 1. A real click on a real button
// ---------------------------------------------------------------------------
{
  let clicks = 0;
  const button = new Button({ title: "Press me", onClick: () => clicks++ });
  const win = new Window({
    title: "input",
    size: { width: 360, height: 220 },
    content: new VStack({ padding: 24 }, [button]),
    show: true,
  });
  settle(20);

  click(win.native, button.native);
  check("a posted mouse click reached the JS handler", clicks === 1, clicks);
  win.close();
}

// ---------------------------------------------------------------------------
// 2. Typing into a text field
// ---------------------------------------------------------------------------
{
  const changes: string[] = [];
  let submits = 0;
  const field = new TextField({
    placeholder: "type here",
    width: 220,
    onChange: (v) => changes.push(v),
    onSubmit: () => submits++,
  });
  const win = new Window({
    title: "typing",
    size: { width: 360, height: 200 },
    content: new VStack({ padding: 24 }, [field]),
    show: true,
  });
  settle(20);

  field.focus();
  settle(6);
  check("the field became first responder", win.native.firstResponder() !== null);

  // Key codes: h=4, i=34.
  for (const [ch, code] of [["h", 4], ["i", 34]] as Array<[string, number]>) {
    postKey(win.native, ch, code, EventType.KeyDown);
    settle(4);
    postKey(win.native, ch, code, EventType.KeyUp);
    settle(4);
  }

  check("typed characters landed in the field", field.value === "hi", JSON.stringify(field.value));
  check("onChange fired per keystroke", changes.length >= 2, changes);

  // Return key (code 36) commits the field.
  postKey(win.native, "\r", 36, EventType.KeyDown);
  settle(8);
  postKey(win.native, "\r", 36, EventType.KeyUp);
  settle(8);
  check("Return fired onSubmit", submits >= 1, submits);
  win.close();
}

// ---------------------------------------------------------------------------
// 3. Clicking a checkbox toggles it and notifies JS
// ---------------------------------------------------------------------------
{
  const seen: boolean[] = [];
  const box = new Checkbox({ title: "Enabled", checked: false, onChange: (c) => seen.push(c) });
  const win = new Window({
    title: "checkbox",
    size: { width: 320, height: 160 },
    content: new VStack({ padding: 24 }, [box]),
    show: true,
  });
  settle(20);

  // A vertical stack stretches its rows to full width, so the checkbox's frame
  // is far wider than the box-and-label it actually draws. Aim at the box.
  const b = box.native.bounds();
  click(win.native, box.native, { x: 10, y: b.height / 2 });
  check("checkbox toggled on click", box.checked === true, box.checked);
  check("checkbox reported the new state", seen.length === 1 && seen[0] === true, seen);
  win.close();
}

// ---------------------------------------------------------------------------
// 4. Selecting a table row calls back with the right object
// ---------------------------------------------------------------------------
{
  const picked: any[] = [];
  const rows = [
    { name: "first", n: 1 },
    { name: "second", n: 2 },
    { name: "third", n: 3 },
  ];
  const table = new Table({
    columns: [{ id: "name", title: "Name" }, { id: "n", title: "N", width: 50 }],
    rows,
    onSelect: (row, i) => picked.push([i, row]),
    grow: 1,
  });
  const win = new Window({
    title: "table input",
    size: { width: 420, height: 260 },
    content: new VStack({ padding: 12 }, [table]),
    show: true,
  });
  settle(20);

  // Click the middle row through the table view's own hit geometry.
  const rowRect = table.tableView.rectOfRow_(1);
  const p = table.tableView.convertPoint_toView_(
    { x: rowRect.x + 20, y: rowRect.y + rowRect.height / 2 }, null,
  );
  const mk = (type: number) =>
    objc.NSEvent.mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure_(
      type, p, 0, objc.NSProcessInfo.processInfo().systemUptime(),
      win.native.windowNumber(), null, 0, 1, type === EventType.LeftMouseDown ? 1.0 : 0.0,
    );
  const app = objc.NSApplication.sharedApplication();
  app.postEvent_atStart_(mk(EventType.LeftMouseDown), false);
  app.postEvent_atStart_(mk(EventType.LeftMouseUp), false);
  settle(16);

  check("clicking a row selected it", table.selectedIndex === 1, table.selectedIndex);
  check("onSelect got the right row object", picked.some(([i, r]) => i === 1 && r?.name === "second"),
    JSON.stringify(picked));
  win.close();
}

// ---------------------------------------------------------------------------
// 5. Menu key equivalents
// ---------------------------------------------------------------------------
{
  const { standardMenu } = await import("../src/ui/menu.ts");
  let fired = 0;
  standardMenu({
    appName: "InputTest",
    file: [{ title: "Do Thing", shortcut: "cmd+d", onClick: () => fired++ }],
  });
  const win = new Window({ title: "menu", size: { width: 300, height: 150 }, show: true });
  settle(20);

  const e = objc.NSEvent.keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode_(
    EventType.KeyDown, { x: 0, y: 0 }, Number(C.NSEventModifierFlagCommand),
    objc.NSProcessInfo.processInfo().systemUptime(), win.native.windowNumber(), null,
    "d", "d", false, 2,
  );
  const handled = objc.NSApplication.sharedApplication().mainMenu().performKeyEquivalent_(e);
  settle(10);
  check("cmd+D was routed by the menu", handled === true, handled);
  check("the menu item's JS handler ran", fired === 1, fired);
  win.close();
}

console.log(failures === 0 ? "\nALL INPUT TESTS PASSED" : `\n${failures} INPUT FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
