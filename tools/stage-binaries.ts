import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Target = "darwin-arm64" | "win32-x64";
interface Artifact {
  source: string;
  destination: string;
}

const sharedLegalFiles: Artifact[] = [
  { source: "LICENSE", destination: "LICENSE" },
  { source: "NOTICE", destination: "NOTICE" },
];

const artifacts: Record<Target, Artifact[]> = {
  "darwin-arm64": [
    { source: "build/libobjcbridge.dylib", destination: "bin/libobjcbridge.dylib" },
    ...sharedLegalFiles,
  ],
  "win32-x64": [
    { source: "build/winbridge.dll", destination: "bin/winbridge.dll" },
    {
      source: "build/Microsoft.WindowsAppRuntime.Bootstrap.dll",
      destination: "bin/Microsoft.WindowsAppRuntime.Bootstrap.dll",
    },
    ...sharedLegalFiles,
  ],
};

const packages: Record<Target, string> = {
  "darwin-arm64": "packages/bunkit-darwin-arm64",
  "win32-x64": "packages/bunkit-win32-x64",
};

const requested = process.argv[2] ?? "all";
if (requested !== "all" && !(requested in artifacts)) {
  throw new Error("Usage: bun run stage:binaries -- [all|darwin-arm64|win32-x64]");
}

const targets: Target[] = requested === "all"
  ? ["darwin-arm64", "win32-x64"]
  : [requested as Target];

for (const target of targets) {
  const packageRoot = resolve(root, packages[target]);
  for (const artifact of artifacts[target]) {
    const source = resolve(root, artifact.source);
    const destination = resolve(packageRoot, artifact.destination);
    if (!existsSync(source)) {
      throw new Error(`Missing ${relative(root, source)}. Build ${target} before staging its package.`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    console.log(`staged ${relative(root, destination)}`);
  }
}