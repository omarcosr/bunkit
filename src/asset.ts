// asset.ts — resolve asset paths relative to the referencing source file.
//
// `src="icons/sparkle.svg"` in examples/todo.tsx should mean
// `<example-dir>/icons/sparkle.svg` — like a CSS url(), not the process's
// working directory. The referencing file is found through the call stack:
// the first frame outside the library's own source root wins.
import { dirname, isAbsolute, resolve } from "node:path";

const LIB_SRC = import.meta.dir.replace(/\\/g, "/");

export function resolveAssetPath(path: string): string {
  if (!path) return path;
  // Absolute (drive letter or leading /), or a URL scheme — pass through.
  if (isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) ||
      /^[a-z][a-z0-9+.-]*:\/\//.test(path)) {
    return path;
  }
  try {
    const frames = (new Error().stack ?? "").split("\n").slice(1);
    for (const frame of frames) {
      // Bun on Windows prints raw paths: `at probe (C:\x\file.ts:2:19)`;
      // browser-style `(file:///A:/x/file.ts:2:19)` also appears.
      // Extract the path between the last `(` and the second-to-last `:`
      // (function frames), or after `at ` for module-level frames.
      let caller = "";
      const paren = frame.lastIndexOf("(");
      if (paren >= 0) {
        const colon = frame.lastIndexOf(":");
        const colon2 = colon > 0 ? frame.lastIndexOf(":", colon - 1) : -1;
        if (colon2 > paren) caller = frame.substring(paren + 1, colon2);
      } else {
        const at = frame.indexOf("at ");
        const colon = frame.lastIndexOf(":");
        if (at >= 0 && colon > at) caller = frame.substring(at + 3, colon);
      }
      if (!caller) continue;
      // Normalise Windows backslashes and strip file:/// prefix.
      caller = caller.replace(/\\/g, "/");
      if (caller.startsWith("file:///")) caller = caller.slice(7);
      if (caller.startsWith(LIB_SRC)) continue; // library frame
      return resolve(dirname(caller), path);
    }
  } catch {
    // fall through to the working directory
  }
  return resolve(process.cwd(), path);
}
