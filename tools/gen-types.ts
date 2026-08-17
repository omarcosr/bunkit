#!/usr/bin/env bun
// TypeScript declarations for Layer 2, generated from the live Obj-C runtime.
//
// Constants need the SDK headers because nothing at runtime remembers them.
// Method signatures are the opposite case: `method_getTypeEncoding` hands back
// the complete argument and return types of every method in the process, so
// this generator needs no headers at all. It walks objc_copyClassList and
// class_copyMethodList through the bridge, parses each encoding with the very
// code Layer 2 dispatches with (sigLayout + splitEncoding), and prints one
// interface per class.
//
//   bun run tools/gen-types.ts [--out src/generated/appkit.d.ts] [--private]
//
// Protocols get the same treatment, one `<Protocol>Handlers` interface each:
// they are what a delegate *may* implement, and the runtime keeps their method
// descriptions even though no class implements them.
//
// The one thing the runtime does *not* carry is the concrete class behind a
// plain `@`. Encodings only keep the @"NSString" hint for properties and some
// protocol methods; for ordinary methods the class is erased. Those returns are
// typed `ObjCId` (= any) so chaining and casting both keep working. The
// exception is the init family, which is typed `this` — that one *is* knowable,
// and it is the case that matters:
//
//   objc.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(...)
//     -> NSWindow, fully autocompleted.
//
// The output is types only. It declares no runtime value, because there is no
// module to import one from — Layer 2's `objc` is a Proxy built at run time.
// Callers put the two together themselves:
//
//   import { objc as untyped } from "../src/objc.ts";
//   import type { ObjCNamespace } from "../src/generated/appkit.d.ts";
//   const objc = untyped as unknown as ObjCNamespace;

import {
  lib,
  ptr,
  cstr,
  classFor,
  sigLayout,
  toArrayBuffer,
  K,
  NIL,
  type Ptr,
} from "../src/bridge.ts";
import type { Pointer } from "bun:ffi";
import { objc, splitEncoding, fromSelector, cfunction } from "../src/objc.ts";
import { structName } from "../src/structs.ts";
import { initApp, ActivationPolicy } from "../src/runtime.ts";
import { dirname, relative, resolve, sep } from "node:path";

// objc_getProtocol and friends only see what is already loaded, and AppKit
// loads most of itself lazily. Bringing NSApplication up first is what makes
// NSWindowDelegate and the rest of the delegate protocols visible; Accessory
// keeps the generator out of the Dock while it does so.
initApp(ActivationPolicy.Accessory);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function opt(name: string, dflt: string): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : dflt;
}

const SRC_DIR = new URL("../src/", import.meta.url).pathname;
const OUT = resolve(opt("out", resolve(SRC_DIR, "generated/appkit.d.ts")));
/** Underscore-prefixed selectors are Apple's private API; off by default. */
const WITH_PRIVATE = flag("private");
const PREFIXES = opt("prefixes", "NS,CA,CG").split(",");

/** An import specifier for a src/ module, relative to wherever --out points. */
function importOf(module: string): string {
  const p = relative(dirname(OUT), resolve(SRC_DIR, module)).split(sep).join("/");
  return p.startsWith(".") ? p : `./${p}`;
}

const OBJC_IMPORT = importOf("objc.ts");
const STRUCTS_IMPORT = importOf("structs.ts");

// ---------------------------------------------------------------------------
// The shim's buffer protocol: it returns the byte count it wanted, so a short
// buffer is not an error — grow to the reported size and ask again.
// ---------------------------------------------------------------------------

const dec = new TextDecoder();

function readTable(fill: (buf: Uint8Array, cap: number) => number): string {
  let cap = 1 << 16;
  for (let attempt = 0; attempt < 8; attempt++) {
    const buf = new Uint8Array(cap);
    const need = fill(buf, cap);
    // br_copy_* only writes an entry when it fits strictly inside cap, so treat
    // "exactly full" as truncated too.
    if (need < cap) {
      const zero = buf.indexOf(0);
      return dec.decode(buf.subarray(0, zero === -1 ? cap : zero));
    }
    cap = need + 4096;
  }
  throw new Error("br_copy_* kept asking for a larger buffer");
}

function classNames(): string[] {
  return readTable((b, c) => lib.br_copy_class_list(ptr(b), c)).split("\n").filter(Boolean);
}

interface RawMethod {
  sel: string;
  types: string;
  /** Protocol methods only: @required rather than @optional. */
  required?: boolean;
}

function ownMethods(cls: Ptr, instance: boolean): RawMethod[] {
  const text = readTable((b, c) => lib.br_copy_method_list(cls, instance ? 1 : 0, ptr(b), c));
  const out: RawMethod[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const tab = line.indexOf("\t");
    if (tab <= 0) continue;
    out.push({ sel: line.slice(0, tab), types: line.slice(tab + 1) });
  }
  return out;
}

function superName(cls: Ptr): string | null {
  const s = lib.br_class_super_name(cls);
  return s === null || s === undefined ? null : String(s);
}

// ---------------------------------------------------------------------------
// Protocols
//
// The shim exposes one protocol at a time, by name, so the list of names has to
// come from somewhere. objc_copyProtocolList is a plain C symbol, which
// cfunction() can call directly — no new shim entry point needed.
// ---------------------------------------------------------------------------

/** Mirrors DEFAULT_PROTOCOLS in src/objc.ts: what createDelegate searches. */
const DEFAULT_PROTOCOLS = [
  "NSApplicationDelegate",
  "NSWindowDelegate",
  "NSTableViewDataSource",
  "NSTableViewDelegate",
  "NSOutlineViewDataSource",
  "NSOutlineViewDelegate",
  "NSTextFieldDelegate",
  "NSTextViewDelegate",
  "NSTextDelegate",
  "NSControlTextEditingDelegate",
  "NSMenuDelegate",
  "NSMenuItemValidation",
  "NSSplitViewDelegate",
  "NSToolbarDelegate",
  "NSToolbarItemValidation",
  "NSTabViewDelegate",
  "NSComboBoxDelegate",
  "NSComboBoxDataSource",
  "NSSearchFieldDelegate",
  "NSCollectionViewDelegate",
  "NSCollectionViewDataSource",
  "NSCollectionViewDelegateFlowLayout",
  "NSDraggingDestination",
  "NSDraggingSource",
  "NSPathControlDelegate",
  "NSOpenSavePanelDelegate",
  "NSUserInterfaceValidations",
];

/**
 * Every protocol the runtime knows about.
 *
 * `objc_copyProtocolList` returns a malloc'd array of Protocol* plus a count;
 * `protocol_getName` turns each into a string. Both are typed as void* here so
 * writeArg treats them as raw pointers instead of trying to box them as objects.
 */
function allProtocolNames(): { names: string[]; discovered: boolean } {
  const copyList = cfunction("objc_copyProtocolList", "^v^I");
  const getName = cfunction("protocol_getName", "*^v");
  if (!copyList || !getName) return { names: [...DEFAULT_PROTOCOLS], discovered: false };
  const count = new Uint32Array(1);
  const list = copyList(count) as bigint;
  const n = count[0]!;
  if (list === NIL || n === 0) return { names: [...DEFAULT_PROTOCOLS], discovered: false };
  const dv = new DataView(toArrayBuffer(Number(list) as Pointer, 0, n * 8));
  const names = new Set<string>(DEFAULT_PROTOCOLS);
  for (let i = 0; i < n; i++) {
    const name = getName(dv.getBigUint64(i * 8, true));
    if (typeof name === "string" && name) names.add(name);
  }
  lib.br_free(Number(list) as Pointer);
  return { names: [...names], discovered: true };
}

const getProtocol = cfunction("objc_getProtocol", "^v*");
// The runtime keeps a second, richer copy of every protocol method's encoding —
// the one with @"NSNotification" still in it. protocol_getMethodDescription
// hands back the stripped version; this SPI hands back the annotated one, which
// is the difference between `arg0: ObjCId` and `notification: NSNotification`.
// It is not API, so everything below falls back to the stripped encoding.
const protocolMethodEncoding = cfunction("_protocol_getMethodTypeEncoding", "*^v:BB");

/** "selector\ttypes\trequired\n" — see br_copy_protocol_method_list. */
function protocolMethods(name: string): RawMethod[] {
  const buf = cstr(name);
  const text = readTable((b, c) => lib.br_copy_protocol_method_list(buf, ptr(b), c));
  const proto = getProtocol && protocolMethodEncoding ? (getProtocol(name) as bigint) : NIL;
  const annotate = (sel: string, required: boolean): unknown =>
    proto === NIL ? null : protocolMethodEncoding!(proto, sel, required, true);
  const out: RawMethod[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 3 || !parts[0]) continue;
    const sel = parts[0];
    const required = parts[2] === "1";
    const annotated = annotate(sel, required);
    // Prefer the annotated encoding, but only if it parses the same way.
    const types =
      typeof annotated === "string" && annotated && analyse({ sel, types: annotated })
        ? annotated
        : (parts[1] ?? "");
    out.push({ sel, types, required });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Types the generated file defines or imports; a class of the same name loses. */
const TAKEN = new Set([
  "ObjCObject", "ObjCClass", "ObjCBlock", "ObjCId", "ObjCArg", "ObjCInt",
  "BlockArg", "PtrArg", "ClassArg", "ObjCNamespace",
  "ProtocolHandlers", "ProtocolName", "DefaultProtocolName", "DelegateHandlers",
  "CreateDelegate", "Intersect",
  "CGRect", "CGPoint", "CGSize", "NSRange", "NSEdgeInsets", "CGVector",
  "CGAffineTransform",
]);

function keepName(name: string): boolean {
  if (!PREFIXES.some((p) => name.startsWith(p))) return false;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) return false; // no ., no unicode
  if (name.startsWith("_") || name.includes("__") || name.includes("Internal")) return false;
  if (TAKEN.has(name)) return false;
  return true;
}

function keepClass(name: string): boolean {
  if (!keepName(name)) return false;
  if (name.startsWith("BRJS_")) return false; // our own runtime-created delegates
  if (name.startsWith("NSKVONotifying_")) return false; // KVO's dynamic subclasses
  return true;
}

/**
 * Names already spoken for, so a synthesised name can never shadow a real one:
 * `NSFooClass` is only safe while no class called NSFooClass exists.
 */
const reserved = new Set<string>(TAKEN);

function uniqueName(...candidates: string[]): string {
  for (const c of candidates) {
    if (reserved.has(c)) continue;
    reserved.add(c);
    return c;
  }
  const base = candidates[candidates.length - 1]!;
  for (let i = 2; ; i++) {
    const n = `${base}${i}`;
    if (!reserved.has(n)) {
      reserved.add(n);
      return n;
    }
  }
}

/** Members ObjCObject/ObjCClass already define; a same-named selector would
 *  never reach dispatch (the proxy returns the wrapper's own property first). */
const BASE_INSTANCE = new Set([
  "ptr", "dispose", "className", "objcClass", "isKindOf", "respondsTo",
  "retainCount", "send", "sendSuper", "toString", "js", "constructor",
  // objc.ts RESERVED — the proxy answers undefined for these.
  "then", "toJSON", "inspect", "nodeType", "$$typeof", "_bunTag",
]);
const BASE_CLASS = new Set([...BASE_INSTANCE, "name", "alloc", "new"]);

const TS_RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally",
  "for", "function", "if", "import", "in", "instanceof", "new", "null",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var",
  "void", "while", "with", "yield", "let", "static", "implements", "interface",
  "package", "private", "protected", "public", "arguments", "eval",
]);

/** `initWithFrame:options:` -> `initWithFrame_options_`; `_foo` -> `$foo`. */
function jsName(sel: string): string | null {
  const n = fromSelector(sel);
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) ? n : null;
}

/** `new(): T` in an interface is a construct signature, not a method. */
function memberKey(name: string): string {
  return name === "new" ? '"new"' : name;
}

// ---------------------------------------------------------------------------
// Parameter names
//
// A parameter name is documentation, and a wrong one is worse than no name at
// all: `convertRectToScreen_(screen: CGRect)` says the argument is a screen. So
// a name is only lifted out of the selector by a rule that is reliable, and
// otherwise comes from the argument's own type, or is positional.
// ---------------------------------------------------------------------------

// Words that separate a method's verb from its first argument. Splitting on the
// last one turns `initWithContentRect:` into `contentRect`, which reads far
// better in a signature than the whole keyword.
const SPLITTERS = ["With", "Using", "From", "Into", "For", "And", "By", "To", "At", "In", "Of"];

// Leading verbs it is safe to drop: `addObject:` names its argument `object`.
// Anything not listed keeps its whole keyword, because `tableView:` must not
// become `view` and `windowDidResize:` must not become `didResize`.
const VERBS = new Set([
  "accept", "add", "append", "apply", "begin", "bind", "cancel", "collapse",
  "compare", "conclude", "convert", "copy", "create", "decode", "dequeue",
  "deselect", "detach", "did", "discard", "dispatch", "display", "draw",
  "encode", "end", "enqueue", "enumerate", "evaluate", "exchange", "expand",
  "extend", "filter", "find", "finish", "get", "handle", "highlight",
  "init", "insert", "invoke", "load", "lock", "make", "move", "note", "open",
  "parse", "pause", "perform", "pop", "post", "prepare", "print", "push", "put",
  "read", "register", "reload", "remove", "rename", "render", "replace",
  "resume", "run", "save", "scale", "scroll", "select", "send", "set", "show",
  "sort", "start", "stop", "take", "toggle", "translate", "unbind", "unlock",
  "unregister", "update", "validate", "will", "write",
]);

// A keyword carrying one of these is describing an event, not naming a thing.
const EVENTFUL = /(Will|Did|Should|Can|Has|Is|Needs|Wants|Must|Would)[A-Z]/;

const TYPE_NOUN: Record<string, string> = {
  CGRect: "rect",
  CGPoint: "point",
  CGSize: "size",
  NSRange: "range",
  NSEdgeInsets: "insets",
  CGVector: "vector",
  CGAffineTransform: "transform",
};
const NOUNS = new Set(Object.values(TYPE_NOUN));

// Words that name a coordinate space rather than a value: whatever
// `convertBaseToScreen:` converts, it is not a screen.
const DESTINATIONS = new Set(["screen", "backing", "base", "visible", "window", "layer", "view"]);

/**
 * The name an argument would have if it were named after its type alone.
 *
 * Only for types that *are* their own name: a CGRect argument is a rect, no
 * matter what the selector calls it. A class is not — an @"NSObject" argument
 * is far more likely to want the selector's word ("observer", "sender"), so
 * class names are only a fallback. See classNoun.
 */
function typeNoun(ts: string, kind: number): string | null {
  if (kind === K.SEL) return "selector";
  return TYPE_NOUN[ts] ?? null;
}

/** `NSNotification` -> notification, `NSURL` -> url. */
function classNoun(name: string): string | null {
  const bare = name.replace(/^(NS|CA|CG|CF|CI|AV|UI)(?=[A-Z])/, "");
  if (!bare) return null;
  const n = /^[A-Z0-9]+$/.test(bare) ? bare.toLowerCase() : bare[0]!.toLowerCase() + bare.slice(1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return null;
  return TS_RESERVED.has(n) ? n + "_" : n;
}

function sanitize(s: string): string {
  const t = s.replace(/[^A-Za-z0-9_]/g, "");
  if (!t) return "";
  const n = t[0]!.toLowerCase() + t.slice(1);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return "";
  return TS_RESERVED.has(n) ? n + "_" : n;
}

/** `didAddSubview` -> `subview`. Stops at the first word that is not a verb. */
function dropVerbs(s: string): string {
  for (let pass = 0; pass < 3; pass++) {
    const next = s.slice(1).search(/[A-Z]/);
    const cut = next + 1;
    if (next < 0 || cut >= s.length - 1) break;
    if (!VERBS.has(s.slice(0, cut).toLowerCase())) break;
    s = s.slice(cut);
  }
  return s;
}

function paramName(keyword: string, first: boolean, noun: string | null): string {
  let s = keyword;
  // `windowWillClose:`, `applicationShouldTerminateAfterLastWindowClosed:` — a
  // first keyword that narrates an event says nothing about its argument, and
  // its prepositions belong to the sentence ("...FailToEnterFullScreen" is not
  // a name for the window). Let the caller fall back to the argument's class or
  // to a positional name; either beats a guess.
  if (first && EVENTFUL.test(s)) return noun ?? "";
  let best = -1;
  let bestLen = 0;
  for (const w of SPLITTERS) {
    const i = s.lastIndexOf(w);
    // A splitter at position 0 is part of the keyword, not a hinge:
    // `forKey:` names its argument `forKey`, not the empty string.
    if (i > 0 && i + w.length < s.length && s[i + w.length]! >= "A" && s[i + w.length]! <= "Z") {
      if (i > best) {
        best = i;
        bestLen = w.length;
      }
    }
  }
  if (best >= 0) {
    const head = s.slice(0, best);
    s = dropVerbs(s.slice(best + bestLen)); // `needsToDrawRect:` -> rect
    // The tail names the destination, not the argument, when the head already
    // says the argument's type (`convertRectToScreen:`, `scrollRectToVisible:`)
    // or when the tail is a coordinate space (`convertBaseToScreen:`).
    if (noun && (head.toLowerCase().includes(noun) || DESTINATIONS.has(sanitize(s)))) return noun;
  } else if (first) {
    if (/^set[A-Z]/.test(s)) {
      s = s.slice(3);
    } else {
      const stripped = dropVerbs(s);
      if (stripped !== s) {
        s = stripped;
        // `hitTest:` reduces to "test", which says nothing about a CGPoint.
        if (noun && !s.toLowerCase().includes(noun)) return noun;
      } else if (noun) {
        return noun;
      }
      // Otherwise the keyword is a plain noun and names the argument well:
      // `tableView:`, `control:`, `comboBox:`.
    }
  }
  const n = sanitize(s);
  // A name that is some *other* type's noun is actively misleading.
  if (noun && n !== noun && (NOUNS.has(n) || n === "selector")) return noun;
  return n;
}

interface ArgSpec {
  type: string;
  /** A name the type alone justifies. */
  noun: string | null;
  /** A name the argument's class suggests, used only if nothing better exists. */
  fallback: string | null;
}

function paramNames(sel: string, args: ArgSpec[]): string[] {
  const parts = sel.split(":");
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    let name = paramName(parts[i] ?? "", i === 0, args[i]!.noun);
    if (!name) name = args[i]!.fallback ?? "";
    if (!name || used.has(name)) name = `arg${i}`;
    used.add(name);
    out.push(name);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Obj-C encodings -> TypeScript
// ---------------------------------------------------------------------------

const STRUCT_TS: Record<string, string> = {
  CGPoint: "CGPoint", NSPoint: "CGPoint",
  CGSize: "CGSize", NSSize: "CGSize",
  CGRect: "CGRect", NSRect: "CGRect",
  _NSRange: "NSRange", NSRange: "NSRange",
  NSEdgeInsets: "NSEdgeInsets",
  CGVector: "CGVector",
  CGAffineTransform: "CGAffineTransform",
};

/** `@"NSString"` -> NSString. Only properties and some protocol methods keep it. */
function classHint(encoding: string): string | null {
  const m = /^@"([A-Za-z_][A-Za-z0-9_]*)"$/.exec(encoding);
  return m ? m[1]! : null;
}

let emitted: Set<string> = new Set();

/** A 64-bit integer coming *out* of the bridge. readValue() hands back a number
 *  only while the value fits in a double, so NSNotFound arrives as a BigInt. */
const INT64_OUT = "number | bigint";

/**
 * `out` = a value the bridge produces (a method's return, or a delegate
 * handler's argument), otherwise a value the bridge consumes (a method's
 * argument, or a handler's return). The two differ: writeArg boxes JS strings,
 * numbers, arrays and functions into objects, so the consuming side is much
 * wider than the producing side.
 */
function tsType(encoding: string, kind: number, out: boolean): string {
  switch (kind) {
    case K.VOID:
      return "void";
    case K.BOOL:
      return "boolean";
    // NB arm64 encodes BOOL as `B`; a bare `c` there really is a signed char,
    // and readValue() returns it as a number.
    case K.SINT8:
    case K.UINT8:
    case K.SINT16:
    case K.UINT16:
    case K.SINT32:
    case K.UINT32:
    case K.FLOAT:
    case K.DOUBLE:
      return "number";
    case K.SINT64:
    case K.UINT64:
      // NSInteger. Anything past 2^53 stays a BigInt on the way out, which for
      // NSNotFound and NSUIntegerMax is the ordinary case, not a corner.
      return out ? INT64_OUT : "ObjCInt";
    case K.OBJECT: {
      if (!out) return "ObjCArg";
      const hint = classHint(encoding);
      return hint && emitted.has(hint) ? hint : "ObjCId";
    }
    case K.CLASS:
      return out ? "ObjCClass" : "ClassArg";
    case K.SEL:
      // readValue() resolves a selector to its name, and nil to null.
      return out ? "string | null" : "string";
    case K.CHARPTR:
      // Null both ways: readValue() returns null for a NULL char*, and writeArg
      // accepts null as one.
      return "string | null";
    case K.BLOCK:
      return out ? "ObjCId" : "BlockArg";
    case K.POINTER:
      return out ? "bigint" : "PtrArg";
    case K.STRUCT:
    case K.UNION:
    case K.ARRAY: {
      const n = structName(encoding);
      return (n && STRUCT_TS[n]) ?? "Uint8Array";
    }
    default:
      return "any";
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

interface Member {
  name: string;
  ret: string;
  params: string[]; // types only, for the compatibility check
  text: string; // the emitted line(s)
  required?: boolean; // protocol members only
}

/** alloc/new/copy return +1; init returns the receiver — typed `this`. */
function isInitFamily(sel: string): boolean {
  return /^init(?![a-z])/.test(sel);
}

interface Parsed {
  layout: ReturnType<typeof sigLayout>;
  split: ReturnType<typeof splitEncoding>;
  /** User-supplied arguments — the encoding minus self and _cmd. */
  n: number;
}

/**
 * Parse an encoding into the pieces both a method and a protocol method need.
 * Returns null when the encoding is unusable — bitfields, a handful of Carbon
 * structs, and the occasional method whose encoding disagrees with its selector.
 */
function analyse(m: RawMethod): Parsed | null {
  if (!m.types) return null;
  let layout;
  try {
    layout = sigLayout(m.types);
  } catch {
    return null;
  }
  const split = splitEncoding(m.types);
  const n = layout.userArgs;
  // A selector's colon count is the arity Layer 2 enforces; if the encoding
  // disagrees the method is unusable, so leave it out rather than lie.
  if (n !== (m.sel.match(/:/g)?.length ?? 0)) return null;
  if (split.args.length < n + 2) return null;
  return { layout, split, n };
}

/** Describe one argument: how to type it, and what to call it. */
function argSpec(encoding: string, kind: number, out: boolean): ArgSpec {
  const type = tsType(encoding, kind, out);
  const hint = kind === K.OBJECT ? classHint(encoding) : null;
  return {
    type,
    noun: typeNoun(type, kind),
    fallback: hint && emitted.has(hint) ? classNoun(hint) : null,
  };
}

function argSpecs(p: Parsed, out: boolean): ArgSpec[] {
  const specs: ArgSpec[] = [];
  for (let i = 0; i < p.n; i++) {
    specs.push(argSpec(p.split.args[i + 2]!, p.layout.args[i + 2]!.kind, out));
  }
  return specs;
}

function signature(sel: string, specs: ArgSpec[]): string {
  const names = paramNames(sel, specs);
  return specs.map((s, i) => `${names[i]}: ${s.type}`).join(", ");
}

function buildMember(m: RawMethod, instance: boolean): Member | null {
  const name = jsName(m.sel);
  if (!name) return null;
  if ((instance ? BASE_INSTANCE : BASE_CLASS).has(name)) return null;
  if (!WITH_PRIVATE && m.sel.startsWith("_")) return null;
  const parsed = analyse(m);
  if (!parsed) return null;

  const specs = argSpecs(parsed, false);
  const ret =
    instance && isInitFamily(m.sel) && parsed.layout.ret.kind === K.OBJECT
      ? "this"
      : tsType(parsed.split.ret, parsed.layout.ret.kind, true);

  return {
    name,
    ret,
    params: specs.map((s) => s.type),
    text: `  ${memberKey(name)}(${signature(m.sel, specs)}): ${ret};`,
  };
}

/**
 * A protocol method as a JS handler.
 *
 * The direction is the mirror image of a method call: the trampoline *decodes*
 * the arguments with readValue and *encodes* whatever JS returns with writeArg.
 */
function buildHandler(m: RawMethod): Member | null {
  const name = jsName(m.sel);
  if (!name) return null;
  if (!WITH_PRIVATE && m.sel.startsWith("_")) return null;
  const parsed = analyse(m);
  if (!parsed) return null;

  const specs = argSpecs(parsed, true);
  const ret = tsType(parsed.split.ret, parsed.layout.ret.kind, false);
  const doc = m.required ? `  /** Required of a conforming class. */\n` : "";
  return {
    name,
    ret,
    params: specs.map((s) => s.type),
    text: `${doc}  ${memberKey(name)}?(${signature(m.sel, specs)}): ${ret};`,
    required: m.required === true,
  };
}

// ---------------------------------------------------------------------------
// Interface inheritance
//
// TypeScript rejects an interface that narrows an inherited member the wrong
// way, and Obj-C overrides do that all the time. Anything that would not
// type-check is dropped and simply inherited instead.
// ---------------------------------------------------------------------------

/** Both spellings of a 64-bit integer: the argument alias and the return type. */
const WIDE_INT = new Set(["ObjCInt", INT64_OUT]);

function assignable(sub: string, sup: string): boolean {
  if (sub === sup) return true;
  if (sup === "any" || sub === "any" || sup === "ObjCId" || sub === "ObjCId") return true;
  if (sup === "ObjCArg") return sub !== "void";
  if (sup === "ObjCObject" && emitted.has(sub)) return true;
  // number widens to `number | bigint`, never the other way: a 32-bit override
  // of a 64-bit method would not compile.
  if (sub === "number" && WIDE_INT.has(sup)) return true;
  if (WIDE_INT.has(sub) && WIDE_INT.has(sup)) return true;
  if (sub === "string" && sup === "string | null") return true;
  if (sub === "this" && (sup === "ObjCObject" || emitted.has(sup))) return true;
  return false;
}

function compatible(sub: Member, sup: Member): boolean {
  if (sub.params.length !== sup.params.length) return false;
  if (!assignable(sub.ret, sup.ret)) return false;
  // Methods are checked bivariantly, so either direction is enough.
  for (let i = 0; i < sub.params.length; i++) {
    if (!assignable(sub.params[i]!, sup.params[i]!) && !assignable(sup.params[i]!, sub.params[i]!)) {
      return false;
    }
  }
  return true;
}

interface Absorbed {
  ptr: Ptr;
  name: string;
}

interface ClsInfo {
  name: string;
  /** Name of the interface describing the class object itself. */
  metaName: string;
  ptr: Ptr;
  parent: ClsInfo | null;
  /** Ancestors that were filtered out; their methods fold into this class. */
  absorbed: Absorbed[];
  depth: number;
  inst: Map<string, Member>;
  cls: Map<string, Member>;
}

function inherited(c: ClsInfo, name: string, instance: boolean): Member | undefined {
  for (let p = c.parent; p; p = p.parent) {
    const hit = (instance ? p.inst : p.cls).get(name);
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

const t0 = Date.now();
const all = classNames();
const kept = all.filter(keepClass).sort();

// Every runtime class name is spoken for, whether or not it gets an interface:
// `NSFooClass` may not be synthesised while a real NSFooClass exists.
for (const name of all) reserved.add(name);

const info = new Map<string, ClsInfo>();
for (const name of kept) {
  const p = classFor(name);
  if (p === NIL) continue;
  info.set(name, {
    name,
    metaName: "",
    ptr: p,
    parent: null,
    absorbed: [],
    depth: 0,
    inst: new Map(),
    cls: new Map(),
  });
}
// Only names that end up with an interface may be used as a type.
emitted = new Set(info.keys());

for (const c of info.values()) c.metaName = uniqueName(`${c.name}Class`, `${c.name}$Class`);

// Link each class to its nearest *kept* ancestor, folding in whatever was
// skipped on the way up so no public method disappears with a private base.
for (const c of info.values()) {
  let sn = superName(c.ptr);
  while (sn) {
    const parent = info.get(sn);
    if (parent) {
      c.parent = parent;
      break;
    }
    const sp = classFor(sn);
    if (sp === NIL) break;
    c.absorbed.push({ ptr: sp, name: sn });
    sn = superName(sp);
  }
}
for (const c of info.values()) {
  let d = 0;
  for (let p = c.parent; p; p = p.parent) d++;
  c.depth = d;
}

const ordered = [...info.values()].sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

let nInst = 0;
let nCls = 0;
let nSkippedIncompatible = 0;
// Keyed by (class, selector): every class re-scans its filtered-out ancestors,
// so counting hits would count the same method once per descendant.
const unrepresentable = new Set<string>();

for (const c of ordered) {
  for (const instance of [true, false]) {
    const target = instance ? c.inst : c.cls;
    const sources: Absorbed[] = [{ ptr: c.ptr, name: c.name }, ...c.absorbed];
    for (const src of sources) {
      for (const raw of ownMethods(src.ptr, instance)) {
        if (!instance && (raw.sel === "alloc" || raw.sel === "new")) continue; // synthesised
        const key = jsName(raw.sel);
        if (!key || target.has(key)) continue;
        const m = buildMember(raw, instance);
        if (!m) {
          if (raw.sel[0] !== "_" || WITH_PRIVATE) {
            unrepresentable.add(`${src.name}\t${instance ? "-" : "+"}${raw.sel}`);
          }
          continue;
        }
        const up = inherited(c, m.name, instance);
        if (up) {
          if (up.text === m.text) continue; // identical, no point restating
          if (!compatible(m, up)) {
            nSkippedIncompatible++;
            continue;
          }
        }
        target.set(key, m);
      }
    }
  }
  nInst += c.inst.size;
  nCls += c.cls.size;
}

// --- protocols -------------------------------------------------------------

interface ProtoInfo {
  name: string;
  iface: string;
  members: Member[];
}

const { names: protoNames, discovered } = allProtocolNames();
const protos: ProtoInfo[] = [];
let nHandlers = 0;

for (const name of protoNames.filter(keepName).sort()) {
  const members = new Map<string, Member>();
  for (const raw of protocolMethods(name)) {
    const key = jsName(raw.sel);
    if (!key || members.has(key)) continue;
    const h = buildHandler(raw);
    if (!h) {
      if (raw.sel[0] !== "_" || WITH_PRIVATE) unrepresentable.add(`${name}\t-${raw.sel}`);
      continue;
    }
    members.set(key, h);
  }
  if (members.size === 0) continue; // a marker protocol has nothing to declare
  protos.push({
    name,
    iface: uniqueName(`${name}Handlers`),
    // Required first, then alphabetical: the runtime's own order is neither,
    // and a stable order keeps regenerations diffable.
    members: [...members.values()].sort(
      (a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name),
    ),
  });
  nHandlers += members.size;
}

const emittedProtos = new Set(protos.map((p) => p.name));
const defaultProtos = DEFAULT_PROTOCOLS.filter((p) => emittedProtos.has(p));

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

// Ask the runtime what it is, rather than naming an SDK this generator never
// reads: these declarations describe the frameworks loaded right now.
const osVersion = String(objc.NSProcessInfo.processInfo().operatingSystemVersionString());

const out: string[] = [];
out.push(
  `// GENERATED — do not edit. Regenerate with \`bun run tools/gen-types.ts\`.`,
  `//`,
  `// Source: the Objective-C runtime of this process — ${osVersion}, ${process.arch}.`,
  `// ${ordered.length} classes, ${nInst} instance methods, ${nCls} class methods,`,
  `// ${protos.length} protocols, ${nHandlers} delegate handlers.`,
  `//`,
  `// Selector spelling: \`initWithFrame:options:\` -> \`initWithFrame_options_\`,`,
  `// and a literal underscore in a selector is written \`$\`.`,
  `//`,
  `// A plain \`@\` in a method encoding does not name its class — the runtime`,
  `// erases it — so those returns are \`ObjCId\` (= any). Methods of the init`,
  `// family return \`this\`, which is what makes alloc().initWith...() chain.`,
  `//`,
  `// Two return types are wider than they look, because Layer 2 says so:`,
  `// NSInteger comes back as \`${INT64_OUT}\` (readValue narrows to a number`,
  `// only while the value fits in a double, and NSNotFound does not), and SEL`,
  `// comes back as \`string | null\`, nil being a legal selector value.`,
  `//`,
  `// This file declares types only. Layer 2's \`objc\` is a Proxy built at run`,
  `// time, so the type and the value are joined at the call site:`,
  `//`,
  `//   import { objc as untyped } from "${OBJC_IMPORT}";`,
  `//   import type { ObjCNamespace } from "./${OUT.split(sep).pop()}";`,
  `//   const objc = untyped as unknown as ObjCNamespace;`,
  ``,
  `import type { ObjCObject, ObjCClass, ObjCBlock } from "${OBJC_IMPORT}";`,
  `import type { CGRect, CGPoint, CGSize, NSRange, NSEdgeInsets } from "${STRUCTS_IMPORT}";`,
  ``,
  `export type { ObjCObject, ObjCClass, ObjCBlock, CGRect, CGPoint, CGSize, NSRange, NSEdgeInsets };`,
  ``,
  `/** An object whose class the encoding did not record. */`,
  `export type ObjCId = any;`,
  `/** NSInteger/NSUInteger argument: BigInt is only needed past 2^53. */`,
  `export type ObjCInt = number | bigint;`,
  `/** Anything writeArg() will box into an \`id\`. */`,
  `export type ObjCArg =`,
  `  | ObjCObject | ObjCBlock | string | number | bigint | boolean | Date`,
  `  | Uint8Array | readonly any[] | Record<string, any> | ((...a: any[]) => any)`,
  `  | null | undefined;`,
  `export type ClassArg = ObjCClass | string;`,
  `export type BlockArg = ObjCBlock | ((...a: any[]) => any);`,
  `export type PtrArg = bigint | number | ObjCObject | ArrayBufferView | ArrayBuffer | null;`,
  `export type CGVector = { dx: number; dy: number };`,
  `export type CGAffineTransform = {`,
  `  a: number; b: number; c: number; d: number; tx: number; ty: number;`,
  `};`,
  ``,
);

for (const c of ordered) {
  const base = c.parent ? c.parent.name : "ObjCObject";
  out.push(`export interface ${c.name} extends ${base} {`);
  for (const m of c.inst.values()) out.push(m.text);
  out.push(`}`);

  const clsBase = c.parent ? c.parent.metaName : "ObjCClass";
  out.push(`export interface ${c.metaName} extends ${clsBase} {`);
  out.push(`  alloc(): ${c.name};`);
  out.push(`  "new"(): ${c.name};`);
  for (const m of c.cls.values()) out.push(m.text);
  out.push(`}`);
  out.push(``);
}

out.push(
  `// --- protocols -------------------------------------------------------------`,
  `//`,
  `// What a delegate *may* implement. Every member is optional: createDelegate`,
  `// builds a class from exactly the handlers you pass, and AppKit asks`,
  `// respondsToSelector: before calling any of them. Members marked @required`,
  `// are required of a conforming Obj-C class, not of a JS handler table.`,
  `//`,
  `// The argument types are the mirror image of a method's: these values come`,
  `// *out* of the bridge, and whatever the handler returns goes back in.`,
  ``,
);

for (const p of protos) {
  out.push(`export interface ${p.iface} {`);
  for (const m of p.members) out.push(m.text);
  out.push(`}`);
  out.push(``);
}

out.push(`/** Every protocol above, by name. */`);
out.push(`export interface ProtocolHandlers {`);
for (const p of protos) out.push(`  ${p.name}: ${p.iface};`);
out.push(`}`);
out.push(``);
out.push(`export type ProtocolName = keyof ProtocolHandlers;`);
out.push(``);
out.push(`/** The protocols createDelegate() consults even when you name none. */`);
out.push(`export type DefaultProtocolName =`);
if (defaultProtos.length) {
  out.push(defaultProtos.map((p) => `  | ${JSON.stringify(p)}`).join("\n") + ";");
} else {
  out.push(`  never;`);
}
out.push(``);
out.push(`type Intersect<U> = (U extends unknown ? (x: U) => void : never) extends`);
out.push(`  (x: infer I) => void ? I : never;`);
out.push(``);
out.push(`/**`);
out.push(` * The handler table for a delegate, merged across every protocol that will`);
out.push(` * be searched for its type encodings.`);
out.push(` *`);
out.push(` *   const handlers = {`);
out.push(` *     windowWillClose_: () => app.quit(),`);
out.push(` *   } satisfies DelegateHandlers;`);
out.push(` *`);
out.push(` * \`satisfies\` is what you want here rather than an annotation: it checks`);
out.push(` * every handler and rejects a misspelled selector, while createDelegate still`);
out.push(` * receives a plain object of functions.`);
out.push(` */`);
out.push(
  `export type DelegateHandlers<P extends ProtocolName = never> =`,
  `  Intersect<ProtocolHandlers[P | DefaultProtocolName]>;`,
);
out.push(``);
out.push(`/**`);
out.push(` * createDelegate(), typed:`);
out.push(` *`);
out.push(` *   import { createDelegate as raw } from "${OBJC_IMPORT}";`);
out.push(` *   const createDelegate = raw as unknown as CreateDelegate;`);
out.push(` *   const d = createDelegate(`);
out.push(` *     { tableView_objectValueForTableColumn_row_: (_t, _c, row) => rows[Number(row)] },`);
out.push(` *     { protocols: ["NSTableViewDataSource"] },`);
out.push(` *   );`);
out.push(` */`);
out.push(`export type CreateDelegate = <P extends ProtocolName = never>(`);
out.push(`  handlers: DelegateHandlers<P>,`);
out.push(`  options?: {`);
out.push(`    protocols?: readonly P[];`);
out.push(`    types?: Record<string, string>;`);
out.push(`    superclass?: string;`);
out.push(`    name?: string;`);
out.push(`  },`);
out.push(`) => ObjCId;`);
out.push(``);

out.push(`/**`);
out.push(` * The Layer 2 root proxy, typed.`);
out.push(` *`);
out.push(` *   import { objc as raw } from "${OBJC_IMPORT}";`);
out.push(` *   import type { ObjCNamespace } from "./${OUT.split(sep).pop()}";`);
out.push(` *   const objc = raw as unknown as ObjCNamespace;`);
out.push(` */`);
out.push(`export interface ObjCNamespace {`);
for (const c of [...info.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  out.push(`  readonly ${c.name}: ${c.metaName};`);
}
out.push(`  /** Any other class in the runtime still resolves, just untyped. */`);
out.push(`  readonly [name: string]: ObjCClass;`);
out.push(`}`);
out.push(``);

const text = out.join("\n");
await Bun.write(OUT, text);

console.log(`wrote ${OUT}`);
console.log(
  `  ${ordered.length} classes, ${nInst} instance methods, ${nCls} class methods` +
    ` (+${ordered.length * 2} synthesised alloc/new)`,
);
console.log(
  `  ${protos.length} protocols, ${nHandlers} handlers` +
    (discovered ? "" : " (from the built-in list: objc_copyProtocolList was unavailable)"),
);
console.log(
  `  skipped: ${nSkippedIncompatible} overrides TypeScript would reject,` +
    ` ${unrepresentable.size} unrepresentable encodings`,
);
console.log(`  ${(text.length / 1e6).toFixed(2)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
