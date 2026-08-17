// Generated-constants test.
//
// Four kinds of check. The SDK pin, against the SDK installed right now rather
// than a literal, because the dump agreeing with itself proves nothing. A table
// of values taken from Apple's headers and documentation, which catches a
// generator that silently emits the wrong number. The BigInt masks and the
// mask() idiom that makes them usable. And finally the constants handed to
// AppKit and read back, the only way to catch a value that is self-consistently
// wrong.

import { objc } from "../src/objc.ts";
import { initApp } from "../src/runtime.ts";
import * as C from "../src/generated/constants.ts";

let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

function eq(name: string, actual: any, expected: any) {
  check(`${name} === ${expected}`, actual === expected, `got ${actual}`);
}

// SDK_VERSION, checkSDK and mask are exported alongside the values, so count by
// type rather than by key.
const entries = (Object.entries(C) as [string, unknown][]).filter(
  ([, v]) => typeof v === "number" || typeof v === "bigint",
);
const wide = entries.filter(([, v]) => typeof v === "bigint");
const total = entries.length;
console.log(`constants.ts: SDK ${C.SDK_VERSION}, ${total} constants (${wide.length} BigInt)\n`);

check("several thousand constants", total > 3000, total);

// --- the SDK pin -----------------------------------------------------------
//
// Asserting SDK_VERSION against a literal only proves the file agrees with
// itself. The question that matters is whether the dump was taken from the SDK
// that is installed *now* — a stale dump still resolves every name and simply
// hands out values from the wrong OS.

const liveSDK = new TextDecoder()
  .decode(Bun.spawnSync(["xcrun", "--show-sdk-version"], { stdout: "pipe" }).stdout)
  .trim();

eq("SDK_VERSION matches the installed SDK", C.SDK_VERSION, liveSDK);

const sdk = C.checkSDK({ warn: false });
eq("checkSDK reports the generated version", sdk.generated, C.SDK_VERSION);
eq("checkSDK read the installed version", sdk.installed, liveSDK);
check("checkSDK is happy", sdk.ok && sdk.message === null, sdk.message);

// --- BigInt masks ----------------------------------------------------------
//
// The "all" masks do not fit in a JS number, so they are BigInt literals — and
// JS will not let a BigInt share an expression with a number. The obvious
// spelling is therefore not merely wrong, it throws, which is why mask() exists.

check(
  "the wide masks really are BigInt",
  typeof C.NSEventMaskAny === "bigint" && typeof C.NSUIntegerMax === "bigint",
  `${typeof C.NSEventMaskAny}, ${typeof C.NSUIntegerMax}`,
);

let mixError: unknown;
try {
  void ((C.NSEventMaskAny as any) | (C.NSEventMaskKeyDown as any));
} catch (e) {
  mixError = e;
}
check("`bigint | number` throws — the hazard mask() covers", mixError instanceof TypeError, mixError);

eq("mask() of two number flags", C.mask(C.NSEventMaskKeyDown, C.NSEventMaskKeyUp), 3072n);
eq("mask() absorbs a BigInt flag", C.mask(C.NSEventMaskAny, C.NSEventMaskKeyDown), C.NSEventMaskAny);
eq("mask() of nothing is empty", C.mask(), 0n);
check(
  "mask() refuses a non-integer rather than truncating",
  (() => {
    try {
      C.mask(1.5);
      return false;
    } catch (e) {
      return e instanceof RangeError;
    }
  })(),
);

// --- known values ----------------------------------------------------------

eq("NSWindowStyleMaskTitled", C.NSWindowStyleMaskTitled, 1);
eq("NSWindowStyleMaskClosable", C.NSWindowStyleMaskClosable, 2);
eq("NSWindowStyleMaskMiniaturizable", C.NSWindowStyleMaskMiniaturizable, 4);
eq("NSWindowStyleMaskResizable", C.NSWindowStyleMaskResizable, 8);
eq("NSWindowStyleMaskFullSizeContentView", C.NSWindowStyleMaskFullSizeContentView, 32768);
eq("NSBackingStoreBuffered", C.NSBackingStoreBuffered, 2);
eq("NSApplicationActivationPolicyRegular", C.NSApplicationActivationPolicyRegular, 0);

eq("NSUserInterfaceLayoutOrientationHorizontal", C.NSUserInterfaceLayoutOrientationHorizontal, 0);
eq("NSUserInterfaceLayoutOrientationVertical", C.NSUserInterfaceLayoutOrientationVertical, 1);
eq("NSStackViewGravityLeading", C.NSStackViewGravityLeading, 1);
eq("NSStackViewGravityCenter", C.NSStackViewGravityCenter, 2);
eq("NSStackViewGravityTrailing", C.NSStackViewGravityTrailing, 3);
eq("NSStackViewGravityTop", C.NSStackViewGravityTop, 1);
eq("NSStackViewGravityBottom", C.NSStackViewGravityBottom, 3);

eq("NSLayoutAttributeLeft", C.NSLayoutAttributeLeft, 1);
eq("NSLayoutAttributeNotAnAttribute", C.NSLayoutAttributeNotAnAttribute, 0);
eq("NSLayoutRelationEqual", C.NSLayoutRelationEqual, 0);
eq("NSLayoutPriorityRequired", C.NSLayoutPriorityRequired, 1000);

eq("NSTextAlignmentLeft", C.NSTextAlignmentLeft, 0);
eq("NSTextAlignmentCenter", C.NSTextAlignmentCenter, 1);
eq("NSTextAlignmentRight", C.NSTextAlignmentRight, 2);
eq("NSLineBreakByTruncatingTail", C.NSLineBreakByTruncatingTail, 4);

eq("NSControlSizeRegular", C.NSControlSizeRegular, 0);
eq("NSControlStateValueOn", C.NSControlStateValueOn, 1);
eq("NSControlStateValueOff", C.NSControlStateValueOff, 0);
eq("NSControlStateValueMixed", C.NSControlStateValueMixed, -1);
eq("NSButtonTypeSwitch", C.NSButtonTypeSwitch, 3);
eq("NSBezelStylePush", C.NSBezelStylePush, 1);

eq("NSViewWidthSizable", C.NSViewWidthSizable, 2);
eq("NSViewHeightSizable", C.NSViewHeightSizable, 16);
eq("NSCompositingOperationSourceOver", C.NSCompositingOperationSourceOver, 2);
eq("NSTableViewStyleSourceList", C.NSTableViewStyleSourceList, 3);
eq("NSScrollerStyleOverlay", C.NSScrollerStyleOverlay, 1);
eq("NSAlertStyleCritical", C.NSAlertStyleCritical, 2);
eq("NSModalResponseOK", C.NSModalResponseOK, 1);
eq("NSModalResponseCancel", C.NSModalResponseCancel, 0);
eq("NSImageScaleProportionallyDown", C.NSImageScaleProportionallyDown, 0);
eq("NSVisualEffectMaterialSidebar", C.NSVisualEffectMaterialSidebar, 7);
eq("NSVisualEffectBlendingModeBehindWindow", C.NSVisualEffectBlendingModeBehindWindow, 0);
eq("NSEventTypeKeyDown", C.NSEventTypeKeyDown, 10);

// Values past 2^53 have to survive as BigInt or they are silently wrong.
eq("NSUIntegerMax", C.NSUIntegerMax, 18446744073709551615n);
eq("NSEventMaskAny", C.NSEventMaskAny, 18446744073709551615n);
eq("NSIntegerMax", C.NSIntegerMax, 9223372036854775807n);
check("NSNotFound is a BigInt", typeof C.NSNotFound === "bigint", typeof C.NSNotFound);

// Floats, which arrive from linked symbols rather than from the preprocessor.
check(
  "NSFontWeightRegular < NSFontWeightBold",
  C.NSFontWeightRegular < C.NSFontWeightBold,
  `${C.NSFontWeightRegular} vs ${C.NSFontWeightBold}`,
);
check(
  "NSFontWeightUltraLight is negative",
  C.NSFontWeightUltraLight < 0 && C.NSFontWeightUltraLight > -1,
  C.NSFontWeightUltraLight,
);

// Other frameworks made it in too.
eq("kCTFontTraitBold", C.kCTFontTraitBold, 2);
eq("kCGColorSpaceModelRGB", C.kCGColorSpaceModelRGB, 1);
eq("kCALayerMinXMinYCorner", C.kCALayerMinXMinYCorner, 1);
eq("kCFStringEncodingUTF8", C.kCFStringEncodingUTF8, 134217984);

// --- the values AppKit actually agrees with --------------------------------

initApp();

const style =
  C.NSWindowStyleMaskTitled |
  C.NSWindowStyleMaskClosable |
  C.NSWindowStyleMaskMiniaturizable |
  C.NSWindowStyleMaskResizable;

const win = objc.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
  { x: 100, y: 100, width: 300, height: 200 },
  style,
  C.NSBackingStoreBuffered,
  false,
);
win.setReleasedWhenClosed_(false);
check("styleMask round-trips through AppKit", Number(win.styleMask()) === style, win.styleMask());
check("window is resizable", win.isResizable() === true);

const stack = objc.NSStackView.alloc().init();
stack.setOrientation_(C.NSUserInterfaceLayoutOrientationVertical);
eq(
  "NSStackView orientation round-trips",
  Number(stack.orientation()),
  C.NSUserInterfaceLayoutOrientationVertical,
);

const para = objc.NSMutableParagraphStyle.alloc().init();
para.setAlignment_(C.NSTextAlignmentCenter);
para.setLineBreakMode_(C.NSLineBreakByTruncatingTail);
eq("NSTextAlignmentCenter round-trips", Number(para.alignment()), C.NSTextAlignmentCenter);
eq("NSLineBreakByTruncatingTail round-trips", Number(para.lineBreakMode()), C.NSLineBreakByTruncatingTail);

const button = objc.NSButton.alloc().initWithFrame_({ x: 0, y: 0, width: 80, height: 24 });
button.setButtonType_(C.NSButtonTypeSwitch);
button.setState_(C.NSControlStateValueOn);
eq("NSControlStateValueOn round-trips", Number(button.state()), C.NSControlStateValueOn);
// A button clamps to on/off unless it has been told the third state is legal.
button.setAllowsMixedState_(true);
button.setState_(C.NSControlStateValueMixed);
eq("NSControlStateValueMixed round-trips", Number(button.state()), C.NSControlStateValueMixed);

const bold = objc.NSFont.systemFontOfSize_weight_(13, C.NSFontWeightBold);
check("NSFontWeightBold produces a font", bold !== null && String(bold).length > 0, String(bold));

const view = objc.NSView.alloc().initWithFrame_({ x: 0, y: 0, width: 10, height: 10 });
view.setAutoresizingMask_(C.NSViewWidthSizable | C.NSViewHeightSizable);
eq(
  "autoresizing mask round-trips",
  Number(view.autoresizingMask()),
  C.NSViewWidthSizable | C.NSViewHeightSizable,
);

// NSEventMaskAny is a BigInt; the bridge has to pass it through as a UInt64 with
// every bit intact. Checking that the call merely returns something proves
// nothing — a truncated or zeroed mask returns null just as happily. So post a
// known event and make the mask discriminate: one that excludes its type must
// not match it, and NSEventMaskAny must.

// All 64 bits, proven the direct way: hand the mask to something that stores a
// UInt64 and hands it straight back.
eq(
  "a 64-bit mask crosses the bridge intact",
  objc.NSNumber.numberWithUnsignedLongLong_(C.NSEventMaskAny).unsignedLongLongValue(),
  C.NSEventMaskAny,
);

const app = objc.NSApplication.sharedApplication();
const mode = "kCFRunLoopDefaultMode";
const past = objc.NSDate.distantPast();

const posted = objc.NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
  C.NSEventTypeApplicationDefined,
  { x: 0, y: 0 },
  0,
  0,
  0,
  null,
  0,
  0,
  0,
);
check("synthesized an application-defined event", posted !== null);
app.postEvent_atStart_(posted, true);

const missed = app.nextEventMatchingMask_untilDate_inMode_dequeue_(
  C.mask(C.NSEventMaskKeyDown, C.NSEventMaskKeyUp),
  past,
  mode,
  true,
);
check("a mask without the event's bit does not match it", missed === null, missed && missed.type());

const matched = app.nextEventMatchingMask_untilDate_inMode_dequeue_(C.NSEventMaskAny, past, mode, true);
check("NSEventMaskAny survives as a UInt64 and matches", matched !== null, matched);
eq(
  "the event NSEventMaskAny returned is the one posted",
  matched === null ? null : Number(matched.type()),
  C.NSEventTypeApplicationDefined,
);

win.close();

console.log(failures === 0 ? "\nALL CONSTANTS TESTS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
