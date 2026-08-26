import { dlopen } from "bun:ffi";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version?: string }).version;
if (!packageVersion) throw new Error("package.json must define a version.");
const target = process.argv[2];

if (target !== "darwin-arm64" && target !== "win32-x64") {
  throw new Error("Usage: bun run check:native -- [darwin-arm64|win32-x64]");
}

const file = target === "darwin-arm64" ? "libobjcbridge.dylib" : "winbridge.dll";
const path = resolve(root, "build", file);
if (!existsSync(path)) throw new Error(`Missing native artifact: ${path}`);

const symbol = target === "darwin-arm64" ? "br_version" : "bk_version";
const library = dlopen(path, {
  [symbol]: { args: [], returns: "cstring" },
});

try {
  const symbols = library.symbols as unknown as Record<string, () => { toString(): string } | null>;
  const version = symbols[symbol]?.()?.toString() ?? "";
  if (version.length === 0) {
    throw new Error(`${file} did not return a version string.`);
  }
  if (!version.includes(packageVersion)) {
    throw new Error(`${file} reports ${JSON.stringify(version)}, which does not include package version ${packageVersion}.`);
  }
  console.log(`${target}: ${version}`);
} finally {
  library.close();
}