// Does the generated d.ts actually describe the runtime?
//
// Every call below is checked twice: by tsc against src/generated/appkit.d.ts,
// and by Bun against the real Obj-C runtime. A signature that only type-checks
// is worth nothing, so this file has to run as well as compile.
//
//   bun run test/types-check.ts   # the runtime half
//   bunx tsc -p .                 # the compile half (tsconfig.json at the root)
//
// The `@ts-expect-error` lines at the bottom are the other half of the compile
// check: if the declarations ever went slack, tsc would report them as unused.

import { objc as untyped, createDelegate as createDelegateUntyped } from "../src/objc.ts";
import { initApp } from "../src/runtime.ts";
import type {
  ObjCNamespace,
  CreateDelegate,
  DelegateHandlers,
  NSWindow,
  NSNotification,
  NSWindowDelegateHandlers,
  CGRect,
} from "../src/generated/appkit.d.ts";

const objc = untyped as unknown as ObjCNamespace;
const createDelegate = createDelegateUntyped as unknown as CreateDelegate;

let failures = 0;
function check(name: string, cond: unknown, extra?: unknown) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

// --- plain values: the return type is the JS type, not a wrapper ------------
const len: number = objc.NSString.stringWithUTF8String_("héllo").length();
check("NSString length is a number", len === 5, len);

const upper = String(objc.NSString.stringWithUTF8String_("abc").uppercaseString());
check("uppercaseString", upper === "ABC", upper);

const three: number = objc.NSNumber.numberWithDouble_(3.5).doubleValue();
check("NSNumber doubleValue", three === 3.5, three);

// --- an argument the marshaller boxes for us (ObjCArg) ----------------------
const arr = objc.NSMutableArray.array();
arr.addObject_("a");
arr.addObject_(42);
check("NSArray count", Number(arr.count()) === 2, arr.count());

// --- alloc() + the init family: `this` is what makes this chain work --------
initApp();
const NSWindowStyleMaskTitled = 1 << 0;
const NSWindowStyleMaskClosable = 1 << 1;
const NSBackingStoreBuffered = 2;

// `win` is NSWindow, inferred — no cast anywhere on this line.
const win = objc.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
  { x: 40, y: 60, width: 320, height: 200 },
  NSWindowStyleMaskTitled | NSWindowStyleMaskClosable,
  NSBackingStoreBuffered,
  false,
);
const typedWin: NSWindow = win; // fails to compile if the chain lost its type

// --- structs by value ------------------------------------------------------
const frame: CGRect = typedWin.frame();
check("frame is a CGRect", frame.width === 320 && frame.x === 40, JSON.stringify(frame));

typedWin.setFrame_display_({ x: 40, y: 60, width: 400, height: 240 }, false);
check("setFrame:display:", typedWin.frame().width === 400, typedWin.frame().width);

typedWin.setTitle_("types-check");
check("title roundtrip", String(typedWin.title()) === "types-check", String(typedWin.title()));

// --- BOOL ------------------------------------------------------------------
typedWin.setReleasedWhenClosed_(false);
const released: boolean = typedWin.isReleasedWhenClosed();
check("BOOL is a boolean", released === false, released);

// --- class methods ---------------------------------------------------------
const screenFrame: CGRect = objc.NSScreen.mainScreen().visibleFrame();
check("NSScreen visibleFrame", screenFrame.width > 0, JSON.stringify(screenFrame));

// --- NSRange --------------------------------------------------------------
const r = objc.NSString.stringWithUTF8String_("hello world").rangeOfString_("world");
check("NSRange return", r.location === 6 && r.length === 5, JSON.stringify(r));

// --- 64-bit returns: a number until the value needs a BigInt ----------------
// NSNotFound is NSIntegerMax, so this is the ordinary case, not a corner one.
const missing: number | bigint = objc.NSMutableArray.array().indexOfObject_("absent");
check("NSNotFound comes back as a BigInt", missing === 9223372036854775807n, missing);

const rowCount: number | bigint = objc.NSMutableArray.array().count();
check("a small count comes back as a number", rowCount === 0, rowCount);

// --- SEL returns are nullable ----------------------------------------------
const item = objc.NSMenuItem.alloc().init();
const noAction: string | null = item.action();
check("an unset SEL reads as null", noAction === null, noAction);

item.setAction_("terminate:");
check("a set SEL reads as its name", item.action() === "terminate:", item.action());

// --- delegate handlers ------------------------------------------------------
let closing = 0;
let sawNotificationName = "";

// `satisfies` checks each handler against the protocol without widening the
// object, so createDelegate still receives plain functions.
const handlers = {
  windowWillClose_(notification: NSNotification) {
    closing++;
    sawNotificationName = String(notification.name());
  },
  windowShouldClose_(w: NSWindow) {
    return w.isReleasedWhenClosed() === false;
  },
} satisfies NSWindowDelegateHandlers;

const delegate = createDelegate(handlers, { protocols: ["NSWindowDelegate"], name: "TypesCheck" });
typedWin.setDelegate_(delegate);
check("windowShouldClose: through the typed handler", delegate.windowShouldClose_(typedWin) === true);

// The wider table: DelegateHandlers merges every protocol createDelegate
// searches by default, so an NSApplicationDelegate method belongs here too.
const _wide = {
  applicationDidFinishLaunching_(_notification: NSNotification) {},
  windowDidMove_(_notification: NSNotification) {},
} satisfies DelegateHandlers;

// --- the types are exact, not a catch-all ----------------------------------
// Never called: this exists so tsc proves a typo is still an error. If the
// declarations went slack, tsc reports the unused @ts-expect-error instead.
function _typosMustNotCompile(w: NSWindow) {
  // @ts-expect-error - no such selector on NSWindow
  w.thisMethodDoesNotExist();
  // @ts-expect-error - setFrame:display: takes a rect and a flag
  w.setFrame_display_("not a rect", false);
  // @ts-expect-error - a 64-bit return may not fit in a number
  const _n: number = w.windowNumber();
  // @ts-expect-error - -[NSMenuItem action] returns null when unset
  const _s: string = objc.NSMenuItem.alloc().init().action();
  const _bad = {
    // @ts-expect-error - windowWillClose: has no `d`
    windowWilClose_() {},
  } satisfies NSWindowDelegateHandlers;
}

typedWin.close();
check("windowWillClose: reached the typed handler", closing === 1, closing);
check(
  "the handler's argument really is an NSNotification",
  sawNotificationName === "NSWindowWillCloseNotification",
  sawNotificationName,
);
console.log(failures === 0 ? "\nTYPES CHECK PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
