#!/usr/bin/env bun
// Recover enum / #define constants from the macOS SDK.
//
// The Obj-C runtime knows every class and every method, but it knows nothing
// about `NSWindowStyleMaskTitled` — enum members and #defines vanish at compile
// time. The only authority on their values is the compiler, so this tool asks it:
//
//   1. sweep the SDK headers with regexes for *candidate* identifiers
//   2. emit a probe .mm that prints each candidate's value
//   3. compile it; clang rejects the ones that are not really constants
//   4. drop those, recompile, repeat until it builds
//   5. run it and turn the output into src/generated/constants.ts
//
// The SDK version is recorded in the output alongside a `checkSDK()` that
// re-asks `xcrun` at runtime: a dump generated against a different SDK than the
// one AppKit is running from is silent — every name still resolves — so the
// mismatch has to be announced or it is never noticed.
//
// Step 3 is the whole trick. A regex cannot tell an enumerator from a typedef
// name, an iOS-only symbol, or a macro that takes arguments — but clang can, and
// its error messages carry the line number, which is all the attribution we need
// because every candidate gets a line of its own.
//
//   bun run tools/gen-constants.ts
//
// Options:
//   --keep        leave the probe sources in the temp dir and print the path
//   --rounds N    cap the convergence loop (default 25)
//   --out PATH    write somewhere other than src/generated/constants.ts

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(name);
}
function opt(name: string, fallback: string): string {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : fallback;
}

const KEEP = flag("--keep");
const MAX_ROUNDS = Number(opt("--rounds", "25"));
const OUT_PATH = resolve(opt("--out", join(repo, "src/generated/constants.ts")));

// ---------------------------------------------------------------------------
// SDK
// ---------------------------------------------------------------------------

function sh(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  return new TextDecoder().decode(p.stdout).trim();
}

const SDK = process.env.MACOS_SDK ?? sh(["xcrun", "--show-sdk-path"]);
const SDK_VERSION = process.env.MACOS_SDK_VERSION ?? sh(["xcrun", "--show-sdk-version"]);
if (!SDK || !existsSync(SDK)) throw new Error(`macOS SDK not found (got ${JSON.stringify(SDK)})`);

const ARCH = "arm64";

// Frameworks whose headers we sweep. Order decides attribution when the same
// name turns up twice: first framework listed wins.
const FRAMEWORKS: { name: string; dirs: string[] }[] = [
  { name: "AppKit", dirs: [`${SDK}/System/Library/Frameworks/AppKit.framework/Headers`] },
  {
    name: "Foundation",
    dirs: [
      `${SDK}/System/Library/Frameworks/Foundation.framework/Headers`,
      // NSIntegerMax / NSUIntegerMax live with the runtime, not with Foundation.
      `${SDK}/usr/include/objc`,
    ],
  },
  { name: "CoreGraphics", dirs: [`${SDK}/System/Library/Frameworks/CoreGraphics.framework/Headers`] },
  { name: "CoreText", dirs: [`${SDK}/System/Library/Frameworks/CoreText.framework/Headers`] },
  { name: "QuartzCore", dirs: [`${SDK}/System/Library/Frameworks/QuartzCore.framework/Headers`] },
  { name: "CoreFoundation", dirs: [`${SDK}/System/Library/Frameworks/CoreFoundation.framework/Headers`] },
];

// ---------------------------------------------------------------------------
// Header text handling
// ---------------------------------------------------------------------------

function headerFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...headerFiles(p));
    else if (entry.endsWith(".h")) out.push(p);
  }
  return out.sort();
}

/**
 * Remove comments, being careful not to eat a `//` that lives inside a string
 * (API_DEPRECATED("see https://...") is common). Comments matter here because
 * doc comments are full of prose that looks exactly like an enumerator list.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      out += " ";
    } else if (c === '"' || c === "'") {
      const q = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out += src[i]! + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i]!;
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

// Universal C / Obj-C spellings that are technically integer constants but that
// nobody wants exported from a UI binding.
const NAME_BLOCKLIST = new Set([
  "TRUE", "FALSE", "YES", "NO", "NULL", "nil", "Nil", "EOF", "true", "false",
  "MAX", "MIN", "BUFSIZ", "RAND_MAX", "SEEK_SET", "SEEK_CUR", "SEEK_END",
]);

// JS keywords cannot be `export const` names.
const JS_RESERVED = new Set([
  "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends", "false",
  "finally", "for", "function", "if", "implements", "import", "in", "instanceof",
  "interface", "let", "new", "null", "package", "private", "protected", "public",
  "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof",
  "var", "void", "while", "with", "yield",
]);

function acceptable(name: string): boolean {
  return (
    IDENT.test(name) &&
    name.length > 1 &&
    !NAME_BLOCKLIST.has(name) &&
    !JS_RESERVED.has(name)
  );
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split an enum body on top-level commas. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/**
 * The enumerator name in `NSFooBar API_AVAILABLE(macos(11.0)) = 3`. Leading
 * all-caps availability macros are skipped; everything after `=` is ignored.
 */
function enumeratorName(item: string): string | null {
  let s = item.trim();
  for (let guard = 0; guard < 8; guard++) {
    const m = /^([A-Za-z_]\w*)/.exec(s);
    if (!m) return null;
    const name = m[1]!;
    let j = m[0].length;
    while (j < s.length && (s[j] === " " || s[j] === "\t" || s[j] === "\n")) j++;
    // An all-caps macro that takes arguments is an attribute, not the name.
    if (s[j] === "(" && /^[A-Z_][A-Z0-9_]*$/.test(name)) {
      let depth = 0;
      let k = j;
      for (; k < s.length; k++) {
        if (s[k] === "(") depth++;
        else if (s[k] === ")") {
          depth--;
          if (depth === 0) {
            k++;
            break;
          }
        }
      }
      s = s.slice(k);
      continue;
    }
    return name;
  }
  return null;
}

const ENUM_KEYWORD =
  /\b(?:NS_ENUM|NS_OPTIONS|NS_CLOSED_ENUM|NS_ERROR_ENUM|NS_TYPED_ENUM|CF_ENUM|CF_OPTIONS|CF_CLOSED_ENUM|enum)\b/g;

function scanEnums(src: string, add: (n: string) => void): void {
  ENUM_KEYWORD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENUM_KEYWORD.exec(src))) {
    // Walk forward to the body. A `;` first means this was a forward
    // declaration or a variable of enum type, not a definition.
    let i = m.index + m[0].length;
    const limit = Math.min(src.length, i + 200);
    let open = -1;
    for (; i < limit; i++) {
      const c = src[i]!;
      if (c === ";") break;
      if (c === "{") {
        open = i;
        break;
      }
    }
    if (open < 0) continue;
    const close = matchBrace(src, open);
    if (close < 0) continue;
    // Enum bodies are full of `#if TARGET_OS_IPHONE` / `#else` / `#endif`, and a
    // directive line separates two enumerators without a comma between them.
    // Turning each directive into a comma makes the split see them both — which
    // is how NSTextAlignmentJustified and NSLayoutAttributeFirstBaseline (each
    // the first enumerator after an `#endif`) get found at all.
    const body = src.slice(open + 1, close).replace(/^[ \t]*#[^\n]*$/gm, ",");
    for (const item of splitTopLevel(body)) {
      const name = enumeratorName(item);
      if (name && acceptable(name)) add(name);
    }
    ENUM_KEYWORD.lastIndex = close;
  }
}

// `static const NSModalResponse NSModalResponseOK = 1;`
// Rejected when the type is a pointer, because those are object constants.
const STATIC_CONST = /\bstatic\s+const\s+(?:unsigned\s+|signed\s+|long\s+|short\s+)*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:\w|\(|=)/g;

// `APPKIT_EXTERN const NSFontWeight NSFontWeightBold API_AVAILABLE(...);`
// Same pointer rule: `NSString * const NSFontAttributeName` must not match.
const EXTERN_CONST =
  /\b(?:APPKIT_EXTERN|FOUNDATION_EXPORT|FOUNDATION_EXTERN|CG_EXTERN|CT_EXPORT|CA_EXTERN|CF_EXPORT|extern)\s+const\s+(?:unsigned\s+|signed\s+|long\s+|short\s+)*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*(?:;|\[|[A-Z_]\w*\s*\()/g;

function scanConstVariables(src: string, add: (n: string) => void): void {
  for (const re of [STATIC_CONST, EXTERN_CONST]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const name = m[2]!;
      if (acceptable(name)) add(name);
    }
  }
}

// `#define NSNotFound NSIntegerMax`, `#define kCGFooBar (1 << 3)`.
// Object-like only (a space, not a `(`, after the name) and the replacement must
// look arithmetic: no strings, no braces, no statements.
const DEFINE = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)[ \t]+([^\n\\]+)$/gm;
const DEFINE_VALUE_OK = /^[\w\s()+\-*/<>|&^~.,']+$/;
const DEFINE_VALUE_BAD = /\b(?:static|inline|extern|struct|union|typedef|return|volatile|register|sizeof|_Nullable|_Nonnull|__attribute__|__has_\w+|do|while|if|else|for)\b/;

function scanDefines(src: string, add: (n: string) => void): void {
  DEFINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEFINE.exec(src))) {
    const name = m[1]!;
    const value = m[2]!.trim();
    if (!acceptable(name)) continue;
    if (!value || !DEFINE_VALUE_OK.test(value) || DEFINE_VALUE_BAD.test(value)) continue;
    add(name);
  }
}

// ---------------------------------------------------------------------------
// Sweep
// ---------------------------------------------------------------------------

interface Candidate {
  name: string;
  framework: string;
}

function sweep(): Map<string, Candidate> {
  const found = new Map<string, Candidate>();
  let headerCount = 0;
  for (const fw of FRAMEWORKS) {
    let before = found.size;
    for (const dir of fw.dirs) {
      for (const file of headerFiles(dir)) {
        headerCount++;
        const src = stripComments(readFileSync(file, "utf8"));
        const add = (n: string) => {
          if (!found.has(n)) found.set(n, { name: n, framework: fw.name });
        };
        scanEnums(src, add);
        scanConstVariables(src, add);
        scanDefines(src, add);
      }
    }
    console.log(`  ${fw.name.padEnd(15)} +${found.size - before} candidates`);
  }
  console.log(`scanned ${headerCount} headers, ${found.size} candidates total`);
  return found;
}

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

// Objective-C++ rather than C: a template lets the *compiler* classify each
// candidate. Object constants, structs and function pointers select the "skip"
// branch instead of being blindly cast to (long long), which is how you end up
// exporting a pointer address as if it were an enum value.
const PROBE_PROLOGUE = `// Generated by tools/gen-constants.ts. Do not edit.
#import <Cocoa/Cocoa.h>
#import <CoreFoundation/CoreFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <QuartzCore/QuartzCore.h>
#include <stdio.h>
#include <type_traits>

template <class T>
static inline void br_emit(const char* n, T v) {
  if constexpr (std::is_same<T, bool>::value) {
    printf("%s=i%lld\\n", n, (long long)(v ? 1 : 0));
  } else if constexpr (std::is_floating_point<T>::value) {
    printf("%s=f%.17g\\n", n, (double)v);
  } else if constexpr (std::is_enum<T>::value) {
    typedef typename std::underlying_type<T>::type U;
    if constexpr (std::is_unsigned<U>::value) printf("%s=u%llu\\n", n, (unsigned long long)v);
    else printf("%s=i%lld\\n", n, (long long)v);
  } else if constexpr (std::is_integral<T>::value) {
    if constexpr (std::is_unsigned<T>::value) printf("%s=u%llu\\n", n, (unsigned long long)v);
    else printf("%s=i%lld\\n", n, (long long)v);
  } else {
    printf("%s=x\\n", n);
  }
}

#define P(x) br_emit(#x, (x));
`;

const CHUNK_SIZE = 1500;

interface Probe {
  source: string;
  /** 1-based line number -> candidate name. */
  lineOf: Map<number, string>;
}

// One candidate per line, and never more than one, because the line number in a
// clang diagnostic is the only thing that tells us *which* candidate it hated.
function buildProbe(names: string[]): Probe {
  const lines: string[] = PROBE_PROLOGUE.split("\n");
  const lineOf = new Map<number, string>();
  const chunks = Math.ceil(names.length / CHUNK_SIZE);
  for (let c = 0; c < chunks; c++) {
    // Chunked rather than one enormous main(): a function body with tens of
    // thousands of statements makes clang's own analysis superlinear.
    lines.push(`static void br_chunk${c}(void) {`);
    for (const name of names.slice(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE)) {
      lines.push(`P(${name})`);
      lineOf.set(lines.length, name); // after push, lines.length *is* the 1-based line number
    }
    lines.push("}");
  }
  lines.push("int main(void) {");
  for (let c = 0; c < chunks; c++) lines.push(`  br_chunk${c}();`);
  lines.push("  return 0;");
  lines.push("}");
  return { source: lines.join("\n") + "\n", lineOf };
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

const FRAMEWORK_FLAGS = [
  "-framework", "Cocoa",
  "-framework", "CoreText",
  "-framework", "QuartzCore",
  "-framework", "CoreGraphics",
  "-framework", "CoreFoundation",
];

const CLANG_COMMON = [
  "clang",
  "-x", "objective-c++",
  "-std=c++17",
  "-isysroot", SDK,
  "-arch", ARCH,
  "-fno-color-diagnostics",
  "-ferror-limit=0",
  "-Wno-everything",
];

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCommand(cmd: string[], cwd: string): Promise<RunResult> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, stdout, stderr };
}

const ERROR_LINE = /^probe\.mm:(\d+):\d+:\s+(?:fatal\s+)?error:/;
// ld has printed this both with and without the quotes over the years.
const UNDEFINED_SYMBOL = /^\s*"?_([A-Za-z_]\w*)"?,\s+referenced from:/;

/** Names clang refused, taken from one compile or link attempt. */
function rejected(stderr: string, lineOf: Map<number, string>): { names: Set<string>; unattributed: string[] } {
  const names = new Set<string>();
  const unattributed: string[] = [];
  for (const line of stderr.split("\n")) {
    const e = ERROR_LINE.exec(line);
    if (e) {
      const name = lineOf.get(Number(e[1]));
      if (name) names.add(name);
      else unattributed.push(line);
      continue;
    }
    const u = UNDEFINED_SYMBOL.exec(line);
    if (u) {
      // A declared-but-not-exported global: the header promised a symbol the
      // framework does not actually ship.
      names.add(u[1]!);
    }
  }
  return { names, unattributed };
}

// ---------------------------------------------------------------------------
// Emitting
// ---------------------------------------------------------------------------

const MAX_SAFE = 9007199254740991n;

interface Value {
  literal: string;
  framework: string;
}

// Runtime helpers that ship inside the generated file. They live here as source
// text rather than in a hand-written module because both of them are *about* the
// dump — the SDK it came from, and the two numeric types it is forced to use —
// and a consumer that imports the constants should not have to import a second
// file to handle them safely. Written with string concatenation, never template
// literals, so this generator's own template literal needs no escaping.
const RUNTIME_HELPERS = `
export interface SDKCheck {
  /** False only when xcrun reported a *different* SDK; unknown counts as fine. */
  ok: boolean;
  /** The SDK version these values were generated from. */
  generated: string;
  /** What xcrun reports now, or null when it could not be asked. */
  installed: string | null;
  /** The warning text, when there is one. */
  message: string | null;
}

let probedSDK: string | null | undefined;

/**
 * Compare the SDK this file was generated from against the one installed now.
 *
 * A stale dump is exactly how wrong enum values creep in, and it is invisible:
 * every name still resolves, nothing throws, a control just quietly does the
 * wrong thing. So this warns loudly — but it only warns, because a version skew
 * is usually harmless and refusing to start an app over one would be worse than
 * the bug. Call it once at startup (or in a test) rather than on every import:
 * it shells out to xcrun, which costs tens of milliseconds.
 */
export function checkSDK(options: { warn?: boolean } = {}): SDKCheck {
  if (probedSDK === undefined) {
    probedSDK = null;
    try {
      const p = Bun.spawnSync(["xcrun", "--show-sdk-version"], { stdout: "pipe", stderr: "ignore" });
      const v = new TextDecoder().decode(p.stdout).trim();
      if (p.exitCode === 0 && v) probedSDK = v;
    } catch {
      // No xcrun: no Command Line Tools, or not macOS. Nothing to compare against.
    }
  }
  // Compare the major version only. Apple does not renumber enums within a
  // major SDK, so 26.0 against 26.2 is not a reason to fail a build; 26 against
  // 15 is exactly what this exists to catch.
  const major = (v: string) => v.split(".")[0];
  const ok = probedSDK === null || major(probedSDK) === major(SDK_VERSION);
  const message = ok
    ? null
    : [
        "",
        "!!! macOS SDK MISMATCH " + "-".repeat(50),
        "!!! generated/constants.ts was built against SDK " + SDK_VERSION + ", but the",
        "!!! installed SDK is " + probedSDK + ". Enum values may be stale, and nothing",
        "!!! downstream will notice: every name still resolves.",
        "!!! Regenerate with:  bun run tools/gen-constants.ts",
        "!!! " + "-".repeat(69),
        "",
      ].join("\\n");
  if (message !== null && options.warn !== false) console.warn(message);
  return { ok, generated: SDK_VERSION, installed: probedSDK, message };
}

/**
 * Combine flag constants into one 64-bit mask.
 *
 * The widest masks below are BigInt literals because they do not fit in a JS
 * number, and JS refuses to mix the two numeric types: NSEventMaskAny |
 * NSEventMaskKeyDown throws "Cannot mix BigInt and other types". Widening every
 * operand to BigInt sidesteps that, and BigInt is what the bridge wants for a
 * 64-bit argument anyway. Non-integers are rejected rather than truncated.
 */
export function mask(...values: (number | bigint)[]): bigint {
  let m = 0n;
  for (const v of values) {
    if (typeof v === "number" && !Number.isSafeInteger(v)) {
      throw new RangeError("mask(): " + v + " is not an integer flag value");
    }
    m |= BigInt(v);
  }
  return m;
}
`;

/** Wrap a comma-separated name list into `// ` comment lines. */
function wrapNames(names: string[], indent: string, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (let i = 0; i < names.length; i++) {
    const piece = names[i]! + (i === names.length - 1 ? "" : ",");
    if (line && indent.length + line.length + 1 + piece.length > width) {
      out.push(`//${indent}${line}`);
      line = piece;
    } else {
      line = line ? `${line} ${piece}` : piece;
    }
  }
  if (line) out.push(`//${indent}${line}`);
  return out;
}

function literalFor(tag: string, raw: string): string | null {
  if (tag === "f") {
    if (raw === "inf") return "Infinity";
    if (raw === "-inf") return "-Infinity";
    if (raw === "nan" || raw === "-nan") return null; // never emit a value we cannot compute
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    // String(Number) is the shortest round-tripping decimal form in JS.
    return String(n);
  }
  let b: bigint;
  try {
    b = BigInt(raw);
  } catch {
    return null;
  }
  if (b > MAX_SAFE || b < -MAX_SAFE) return `${b}n`;
  return String(b);
}

function emit(values: Map<string, Value>): string {
  const byFramework = new Map<string, string[]>();
  for (const [name, v] of values) {
    let g = byFramework.get(v.framework);
    if (!g) byFramework.set(v.framework, (g = []));
    g.push(name);
  }

  const wide = [...values]
    .filter(([, v]) => v.literal.endsWith("n"))
    .map(([name]) => name)
    .sort();

  const out: string[] = [];
  out.push("// Generated by tools/gen-constants.ts — do not edit by hand.");
  out.push("//");
  out.push("// Enum members and #defines do not survive compilation, so the Obj-C runtime");
  out.push("// cannot report them the way it reports classes and methods. These values were");
  out.push("// recovered by compiling and running a probe against the macOS SDK headers.");
  out.push("//");
  out.push("// Regenerate with:  bun run tools/gen-constants.ts");
  out.push("//");
  out.push(`// SDK ${SDK_VERSION} (${ARCH}) — ${values.size} constants, ${wide.length} of them BigInt.`);
  out.push("// checkSDK() compares that SDK against the installed one at runtime.");
  out.push("//");
  out.push("// The BigInt ones are the values too wide for a JS number: the flag-style \"all\"");
  out.push("// masks and the integer extremes. JS will not mix BigInt with number, so the");
  out.push("// obvious spelling of a mask is a TypeError rather than a mask —");
  out.push("// `NSEventMaskAny | NSEventMaskKeyDown` throws. Use `mask(...)`, which widens");
  out.push("// everything to BigInt (and BigInt is what the bridge wants for a 64-bit");
  out.push("// argument anyway):");
  out.push("//");
  out.push("//   nextEventMatchingMask_untilDate_inMode_dequeue_(");
  out.push("//     mask(NSEventMaskKeyDown, NSEventMaskKeyUp), date, mode, true)");
  out.push("//");
  out.push("// The BigInt-valued names, so you know which ones bite:");
  out.push("//");
  out.push(...wrapNames(wide, "   ", 88));
  out.push("");
  out.push(`export const SDK_VERSION = ${JSON.stringify(SDK_VERSION)};`);
  out.push(RUNTIME_HELPERS.trimEnd());

  const order = [...FRAMEWORKS.map((f) => f.name), "other"];
  for (const fw of order) {
    const names = byFramework.get(fw);
    if (!names || names.length === 0) continue;
    names.sort();
    out.push("");
    out.push(`// --- ${fw} (${names.length}) ---`);
    for (const name of names) out.push(`export const ${name} = ${values.get(name)!.literal};`);
  }
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`SDK ${SDK_VERSION} at ${SDK} (${ARCH})`);
console.log("scanning headers...");

const candidates = sweep();

const work = mkdtempSync(join(tmpdir(), "gen-constants-"));
const probePath = join(work, "probe.mm");
const binPath = join(work, "probe");

let names = [...candidates.keys()].sort();
let probe = buildProbe(names);
let dropped = 0;
let round = 0;
let built = false;

console.log(`\nconverging (max ${MAX_ROUNDS} rounds)...`);

/**
 * Drop the blamed names, returning how many candidates that actually removed.
 *
 * The count is what makes the loop terminate. Blame is not the same as
 * progress: `rejected()` also harvests names out of ld's "undefined symbol"
 * lines, and ld reports the *linker* name, which need not be a candidate at all
 * (a `_OBJC_CLASS_$_Foo`, or a name already dropped this round). A round guarded
 * on "was anyone blamed" could therefore rebuild an identical probe forever,
 * whereas a round guarded on "did the set shrink" cannot: every iteration either
 * ends with a clean build or strictly shrinks `candidates`, so the loop runs at
 * most `candidates.size` times regardless of what the diagnostics say.
 */
function dropCandidates(bad: Set<string>): number {
  let removed = 0;
  for (const n of bad) if (candidates.delete(n)) removed++;
  return removed;
}

function noProgress(stage: string, stderr: string, bad: Set<string>, unattributed: number): Error {
  console.error(stderr.split("\n").slice(0, 40).join("\n"));
  return new Error(
    `round ${round + 1}: ${stage} failed without removing any candidate ` +
      `(${bad.size} name(s) blamed, none of them still in the set; ` +
      `${unattributed} unattributed diagnostics)`,
  );
}

for (; round < MAX_ROUNDS; round++) {
  writeFileSync(probePath, probe.source);

  // Syntax-only first: it is several times faster than a full compile+link and
  // catches the overwhelming majority of rejects (undeclared, unavailable,
  // wrong-arity macros).
  const syntax = await runCommand([...CLANG_COMMON, "-fsyntax-only", "probe.mm"], work);
  if (syntax.code !== 0) {
    const { names: bad, unattributed } = rejected(syntax.stderr, probe.lineOf);
    const removed = dropCandidates(bad);
    if (removed === 0) throw noProgress("compile", syntax.stderr, bad, unattributed.length);
    dropped += removed;
    console.log(`  round ${round + 1}: compile rejected ${removed} (${candidates.size} left)`);
    names = [...candidates.keys()].sort();
    probe = buildProbe(names);
    continue;
  }

  // It parses; now it has to link.
  const link = await runCommand([...CLANG_COMMON, ...FRAMEWORK_FLAGS, "-o", "probe", "probe.mm"], work);
  if (link.code !== 0) {
    const { names: bad, unattributed } = rejected(link.stderr, probe.lineOf);
    const removed = dropCandidates(bad);
    if (removed === 0) throw noProgress("link", link.stderr, bad, unattributed.length);
    dropped += removed;
    console.log(`  round ${round + 1}: link rejected ${removed} (${candidates.size} left)`);
    names = [...candidates.keys()].sort();
    probe = buildProbe(names);
    continue;
  }

  built = true;
  console.log(`  round ${round + 1}: clean build`);
  break;
}

if (!built) throw new Error(`did not converge in ${MAX_ROUNDS} rounds; ${candidates.size} candidates left`);

console.log(`converged after ${round + 1} round(s); dropped ${dropped} candidate(s)`);

// --- run it ----------------------------------------------------------------

const probeRun = await runCommand([binPath], work);
if (probeRun.code !== 0) {
  console.error(probeRun.stderr);
  throw new Error(`probe exited with ${probeRun.code}`);
}

const values = new Map<string, Value>();
let skippedNonScalar = 0;
let unparsable = 0;

for (const line of probeRun.stdout.split("\n")) {
  if (!line) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  const name = line.slice(0, eq);
  const tag = line[eq + 1]!;
  const raw = line.slice(eq + 2);
  if (tag === "x") {
    // An object, struct or function pointer — a real symbol, just not a number.
    skippedNonScalar++;
    continue;
  }
  const literal = literalFor(tag, raw);
  if (literal === null) {
    unparsable++;
    continue;
  }
  values.set(name, { literal, framework: candidates.get(name)?.framework ?? "other" });
}

console.log(
  `probe printed ${values.size} numeric constants ` +
    `(${skippedNonScalar} non-scalar, ${unparsable} unrepresentable)`,
);

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, emit(values));

console.log(`wrote ${OUT_PATH} (${values.size} constants)`);
if (KEEP) console.log(`probe sources kept in ${work}`);
