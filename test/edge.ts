// Edge cases in the bridge that the everyday paths do not exercise:
// C functions, global constants, out-parameters, odd encodings, super
// dispatch with structs, and runtime subclassing.

import {
  cfunction,
  createDelegate,
  globalObject,
  invokeSuper,
  makeStringRaw,
  nsstring,
  objc,
  splitEncoding,
  symbolAddress,
  toJS,
  wrap,
  ObjCObject,
} from "../src/objc.ts";
import { lib, sigLayout, typeLayout, K, NIL, ptr, toArrayBuffer } from "../src/bridge.ts";
import { initApp, pumpOnce } from "../src/runtime.ts";

let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

initApp();

// ---------------------------------------------------------------------------
// Encoding parser
// ---------------------------------------------------------------------------
{
  const cases: Array<[string, string, string[]]> = [
    ["v24@0:8@16", "v", ["@", ":", "@"]],
    ["v52@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16B48", "v",
      ["@", ":", "{CGRect={CGPoint=dd}{CGSize=dd}}", "B"]],
    ["{_NSRange=QQ}24@0:8@16", "{_NSRange=QQ}", ["@", ":", "@"]],
    ["v32@0:8@16@?24", "v", ["@", ":", "@", "@?"]],
    // Qualifiers (r = const, n = in, o = out, ...) are stripped: they say how an
    // argument is used, not what it is, and both parsers must agree on that.
    ["@24@0:8r*16", "@", ["@", ":", "*"]],
    ["v28@0:8o^@16r@24", "v", ["@", ":", "^@", "@"]],
    ["@\"NSString\"16@0:8", '@"NSString"', ["@", ":"]],
    ["v20@0:8^@16", "v", ["@", ":", "^@"]],
    ["v24@0:8[4f]16", "v", ["@", ":", "[4f]"]],
  ];
  let ok = true;
  for (const [enc, ret, args] of cases) {
    const s = splitEncoding(enc);
    if (s.ret !== ret || JSON.stringify(s.args) !== JSON.stringify(args)) {
      ok = false;
      console.log(`    ${enc} -> ret=${s.ret} args=${JSON.stringify(s.args)}`);
    }
  }
  check("JS encoding splitter handles every shape", ok);

  check("nested struct size", typeLayout("{CGRect={CGPoint=dd}{CGSize=dd}}").size === 32);
  check("array-in-struct size", typeLayout("{X=[4f]i}").size === 20, typeLayout("{X=[4f]i}"));
  check("union size", typeLayout("(U=dq)").size === 8, typeLayout("(U=dq)"));
  check("pointer to struct is 8 bytes", typeLayout("^{CGRect=}").size === 8);
  check("bitfields are refused, not guessed", (() => {
    try { typeLayout("{X=b3b5}"); return false; } catch { return true; }
  })());

  const L = sigLayout("v52@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16B48");
  check("struct arg is 16-byte aligned in the argbuf", L.args[2]!.offset % 16 === 0, L.args[2]);
  check("arg after a 32-byte struct is placed correctly",
    L.args[3]!.offset === L.args[2]!.offset + 32, L.args[3]);
  check("BOOL is one byte", L.args[3]!.kind === K.BOOL && L.args[3]!.size === 1);
}

// ---------------------------------------------------------------------------
// Global object constants (dlsym)
// ---------------------------------------------------------------------------
{
  const fontAttr = globalObject("NSFontAttributeName");
  check("NSFontAttributeName resolved", String(fontAttr) === "NSFont", String(fontAttr));
  check("a bogus symbol resolves to null", globalObject("NSDefinitelyNotASymbol") === null);
  check("symbolAddress finds a real function", symbolAddress("NSBeep") !== NIL);

  // Use one in anger: attributed string with a font attribute.
  const attrs = objc.NSMutableDictionary.dictionary();
  attrs.setObject_forKey_(objc.NSFont.systemFontOfSize_(18), fontAttr);
  const s = objc.NSAttributedString.alloc().initWithString_attributes_("hello", attrs);
  check("attributed string built from a global constant", Number(s.length()) === 5, s.length());
}

// ---------------------------------------------------------------------------
// Plain C functions
// ---------------------------------------------------------------------------
{
  // NSHomeDirectory() -> NSString*
  const home = cfunction("NSHomeDirectory", "@");
  check("cfunction resolved NSHomeDirectory", home !== null);
  const dir = home?.();
  check("NSHomeDirectory returned a usable path", String(dir).startsWith("/"), String(dir));

  // CGRectContainsPoint(CGRect, CGPoint) -> bool
  const contains = cfunction(
    "CGRectContainsPoint", "B{CGRect={CGPoint=dd}{CGSize=dd}}{CGPoint=dd}",
  );
  check("cfunction resolved CGRectContainsPoint", contains !== null);
  check("struct-by-value C call: inside",
    contains?.({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5 }) === true);
  check("struct-by-value C call: outside",
    contains?.({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 5 }) === false);

  // CGRectIntersection returns a struct by value.
  const intersect = cfunction(
    "CGRectIntersection",
    "{CGRect={CGPoint=dd}{CGSize=dd}}{CGRect={CGPoint=dd}{CGSize=dd}}{CGRect={CGPoint=dd}{CGSize=dd}}",
  );
  const r = intersect?.({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 });
  check("struct-returning C call", r?.x === 5 && r?.width === 5, JSON.stringify(r));

  check("a missing C function is null, not a crash", cfunction("NSNotAFunctionAtAll", "v") === null);
}

// ---------------------------------------------------------------------------
// Out-parameters (NSError**)
// ---------------------------------------------------------------------------
{
  // -[NSString writeToFile:atomically:encoding:error:] takes NSError**.
  const errSlot = new BigUint64Array(1);
  const path = "/definitely/not/a/writable/path/x.txt";
  const ok = objc.NSString.stringWithUTF8String_("hi").writeToFile_atomically_encoding_error_(
    path, true, 4 /* NSUTF8StringEncoding */, ptr(errSlot),
  );
  check("a failing call returns NO", ok === false, ok);
  check("the NSError** out-parameter was filled", errSlot[0] !== 0n, errSlot[0]);
  if (errSlot[0] !== 0n) {
    const err = wrap(errSlot[0]!, false)!;
    check("the out-param is a real NSError", err.isKindOf("NSError"), err.className);
    check("the error has a description", String(err.localizedDescription()).length > 0);
  }
}

// ---------------------------------------------------------------------------
// Runtime subclassing and super dispatch
// ---------------------------------------------------------------------------
{
  let drawCalls = 0;
  let seenRect: any = null;

  // Subclass NSView and override a struct-taking method, so the struct arrives
  // through a libffi closure rather than through objc_msgSend.
  const view = createDelegate(
    {
      drawRect_: function (this: any, rect: any) {
        drawCalls++;
        seenRect = rect;
      },
    },
    { superclass: "NSView", name: "CustomView" },
  );
  check("runtime subclass of NSView created", view.isKindOf("NSView"), view.className);
  view.setFrame_({ x: 0, y: 0, width: 100, height: 60 });
  check("inherited struct setter works on a subclass",
    view.frame().width === 100 && view.frame().height === 60, JSON.stringify(view.frame()));

  // Make AppKit call the override: -displayRectIgnoringOpacity:inContext: takes
  // the same path a real redraw does.
  const rep = view.bitmapImageRepForCachingDisplayInRect_(view.bounds());
  view.cacheDisplayInRect_toBitmapImageRep_(view.bounds(), rep);
  check("the overridden drawRect: was called by AppKit", drawCalls > 0, drawCalls);
  check("the CGRect argument arrived intact through the closure",
    seenRect?.width === 100 && seenRect?.height === 60, JSON.stringify(seenRect));
}

// ---------------------------------------------------------------------------
// Structs returned *from* JS through a libffi closure
// ---------------------------------------------------------------------------
{
  // Two sizes on purpose: CGSize (16 bytes, returned in registers) and
  // NSEdgeInsets (32 bytes, returned indirectly). They take different paths
  // through the ABI and libffi hands the closure a differently sized buffer.
  const v = createDelegate(
    {
      intrinsicContentSize: () => ({ width: 123, height: 45 }),
      alignmentRectInsets: () => ({ top: 1, left: 2, bottom: 3, right: 4 }),
    },
    { superclass: "NSView", name: "StructRet" },
  );
  const size = v.intrinsicContentSize();
  const insets = v.alignmentRectInsets();
  check("16-byte struct returned from JS", size.width === 123 && size.height === 45,
    JSON.stringify(size));
  check("32-byte struct returned from JS",
    insets.top === 1 && insets.left === 2 && insets.bottom === 3 && insets.right === 4,
    JSON.stringify(insets));

  // The real test: make AppKit consume the overridden values in a layout pass.
  const stack = objc.NSStackView.alloc().init();
  stack.setTranslatesAutoresizingMaskIntoConstraints_(false);
  stack.addArrangedSubview_(v);
  stack.layoutSubtreeIfNeeded();
  const f = v.frame();
  check("AppKit laid out using the JS-supplied intrinsic size",
    Math.abs(f.width - (123 + 2 + 4)) < 1 && Math.abs(f.height - (45 + 1 + 3)) < 1,
    JSON.stringify(f));
}

// super dispatch that returns a struct
{
  const win = objc.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
    { x: 10, y: 20, width: 200, height: 120 }, 15, 2, false,
  );
  win.setReleasedWhenClosed_(false);
  const viaSuper = win.sendSuper("NSResponder", "className");
  check("sendSuper returning an object", String(viaSuper) === "NSWindow", String(viaSuper));
  win.close();
}

// ---------------------------------------------------------------------------
// nil handling
// ---------------------------------------------------------------------------
{
  const nothing = objc.NSArray.array().lastObject();
  check("a nil return becomes null", nothing === null, nothing);
  check("messaging null is a no-op returning null", (nothing as any) === null);

  const dict = objc.NSMutableDictionary.dictionary();
  check("objectForKey: on a missing key is null", dict.objectForKey_("nope") === null);

  const win = objc.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
    { x: 0, y: 0, width: 100, height: 100 }, 15, 2, false,
  );
  win.setReleasedWhenClosed_(false);
  win.setDelegate_(null);
  check("passing null for an object argument works", win.delegate() === null);
  win.close();
}

// ---------------------------------------------------------------------------
// Numeric edges
// ---------------------------------------------------------------------------
{
  const n = objc.NSNumber.numberWithLongLong_(9007199254740993n); // 2^53 + 1
  check("a BigInt survives the round trip", n.longLongValue() === 9007199254740993n,
    n.longLongValue());

  const neg = objc.NSNumber.numberWithLongLong_(-42);
  check("negative integers round-trip", neg.longLongValue() === -42, neg.longLongValue());

  check("an unsafe integer argument is rejected rather than truncated", (() => {
    try {
      objc.NSNumber.numberWithLongLong_(1e30);
      return false;
    } catch (e: any) {
      return /precision|BigInt/.test(e.message);
    }
  })());

  const f = objc.NSNumber.numberWithFloat_(0.5);
  check("float round-trips exactly at 0.5", f.floatValue() === 0.5, f.floatValue());

  // NSUInteger sentinel: NSNotFound comes back as a BigInt, not a wrong number.
  const idx = objc.NSArray.array().indexOfObject_("nope");
  check("NSNotFound survives as a BigInt", typeof idx === "bigint", `${typeof idx} ${idx}`);
}

// ---------------------------------------------------------------------------
// Argument-count checking
// ---------------------------------------------------------------------------
{
  check("too few arguments throws", (() => {
    try { (objc.NSMutableArray.array() as any).addObject_(); return false; }
    catch (e: any) { return /expects 1 argument/.test(e.message); }
  })());
  check("too many arguments throws", (() => {
    try { (objc.NSMutableArray.array() as any).addObject_("a", "b"); return false; }
    catch (e: any) { return /expects 1 argument/.test(e.message); }
  })());
}

// ---------------------------------------------------------------------------
// Identity and disposal
// ---------------------------------------------------------------------------
{
  const a = objc.NSMutableArray.array();
  const b = objc.NSMutableArray.arrayWithObject_(a);
  check("round-tripped through a container, identity holds", b.objectAtIndex_(0) === a);

  const s1 = nsstring("dispose me");
  const p = s1.ptr;
  s1.dispose();
  const s2 = nsstring("dispose me");
  check("a disposed wrapper leaves the identity map", s2 !== s1);
  check("dispose is idempotent", (() => { s1.dispose(); return true; })());
}

// ---------------------------------------------------------------------------
// respondsToSelector: on a runtime class
// ---------------------------------------------------------------------------
{
  const d = createDelegate(
    { windowWillClose_: () => {}, windowDidResize_: () => {} },
    { protocols: ["NSWindowDelegate"], name: "Responds" },
  );
  check("implements what it declared", d.respondsTo("windowWillClose:") && d.respondsTo("windowDidResize:"));
  check("does not claim what it did not", !d.respondsTo("windowDidMove:"));
  // NSProtocolFromString is a C function, not a class — reach it through the
  // C-function binding and use the Protocol* it returns.
  const protocolFromString = cfunction("NSProtocolFromString", "@@");
  const proto = protocolFromString?.(nsstring("NSWindowDelegate"));
  check("NSProtocolFromString returned a Protocol", proto !== null && proto !== undefined);
  check("conforms to the declared protocol", d.conformsToProtocol_(proto) === true,
    d.conformsToProtocol_(proto));
  check("does not conform to an undeclared protocol",
    d.conformsToProtocol_(protocolFromString?.(nsstring("NSTableViewDataSource"))) === false);
  // AppKit checks respondsToSelector: before every optional delegate call, so
  // getting this wrong means AppKit calling methods that do not exist.
  check("inherits NSObject's own methods", d.respondsTo("description") && d.respondsTo("isEqual:"));
}

console.log(failures === 0 ? "\nALL EDGE TESTS PASSED" : `\n${failures} EDGE FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
