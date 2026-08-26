import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  files?: string[];
  os?: string[];
  cpu?: string[];
  optionalDependencies?: Record<string, string>;
  exports?: Record<string, string>;
  publishConfig?: { access?: string };
};

type BinaryPackage = {
  name: string;
  directory: string;
  os: string;
  cpu: string;
  artifacts: string[];
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireBinaries = process.argv.includes("--require-binaries");
const packageFlag = process.argv.indexOf("--package");
const selectedName = packageFlag === -1 ? undefined : process.argv[packageFlag + 1];

function fail(message: string): never {
  throw new Error(`Package check failed: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function packPreview(cwd: string): string[] {
  const result = Bun.spawnSync(["bun", "pm", "pack", "--dry-run", "--ignore-scripts"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  const stderr = new TextDecoder().decode(result.stderr);
  if (result.exitCode !== 0) fail(`bun pm pack failed in ${cwd}: ${stderr || stdout}`);

  return stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("packed "))
    .map((line) => line.match(/^packed\s+\S+\s+(.+)$/)?.[1])
    .filter((file): file is string => file !== undefined);
}

function assertContents(label: string, files: string[], allowed: (file: string) => boolean): void {
  const unexpected = files.filter((file) => !allowed(file.replace(/\\/g, "/")));
  assert(
    unexpected.length === 0,
    `${label} would publish unexpected files: ${unexpected.join(", ")}`,
  );
}

const rootManifest = manifest(resolve(root, "package.json"));
const binaryPackages: BinaryPackage[] = [
  {
    name: "@omarcosr/bunkit-darwin-arm64",
    directory: "packages/bunkit-darwin-arm64",
    os: "darwin",
    cpu: "arm64",
    artifacts: ["bin/libobjcbridge.dylib"],
  },
  {
    name: "@omarcosr/bunkit-win32-x64",
    directory: "packages/bunkit-win32-x64",
    os: "win32",
    cpu: "x64",
    artifacts: ["bin/winbridge.dll", "bin/Microsoft.WindowsAppRuntime.Bootstrap.dll"],
  },
];

assert(rootManifest.name === "@omarcosr/bunkit", "root package name must be @omarcosr/bunkit");
assert(rootManifest.private !== true, "root package must not be private");
assert(rootManifest.publishConfig?.access === "public", "root package must publish publicly");
assert(
  rootManifest.os?.join(",") === "darwin,win32",
  "root package must support only macOS and Windows",
);
assert(
  rootManifest.cpu === undefined,
  "root package must not claim unsupported architecture pairs",
);
for (const file of ["src", "tsconfig.base.json", "README.md", "LICENSE", "NOTICE"]) {
  assert(rootManifest.files?.includes(file), `root files must include ${file}`);
}

for (const binary of binaryPackages) {
  assert(
    rootManifest.optionalDependencies?.[binary.name] === "workspace:*",
    `root optional dependency for ${binary.name} must use workspace:*`,
  );

  const packageRoot = resolve(root, binary.directory);
  const binaryManifest = manifest(resolve(packageRoot, "package.json"));
  assert(binaryManifest.name === binary.name, `${binary.directory} has the wrong package name`);
  assert(
    binaryManifest.version === rootManifest.version,
    `${binary.name} must match the root version`,
  );
  assert(binaryManifest.os?.join(",") === binary.os, `${binary.name} must target ${binary.os}`);
  assert(binaryManifest.cpu?.join(",") === binary.cpu, `${binary.name} must target ${binary.cpu}`);
  assert(binaryManifest.publishConfig?.access === "public", `${binary.name} must publish publicly`);
  for (const artifact of binary.artifacts) {
    const exportKey = `./${artifact.slice(artifact.lastIndexOf("/") + 1)}`;
    assert(
      binaryManifest.exports?.[exportKey] === `./${artifact}`,
      `${binary.name} must export ${exportKey}`,
    );
  }
  for (const file of [...binary.artifacts, "README.md", "LICENSE", "NOTICE"]) {
    assert(binaryManifest.files?.includes(file), `${binary.name} files must include ${file}`);
  }
}

const rootFiles = packPreview(root);
assertContents(
  "@omarcosr/bunkit",
  rootFiles,
  (file) =>
    ["package.json", "README.md", "LICENSE", "NOTICE", "tsconfig.base.json"].includes(file) ||
    file.startsWith("src/"),
);
assert(
  rootFiles.some((file) => file.startsWith("src/")),
  "root package must contain source files",
);

const selected = selectedName
  ? binaryPackages.filter((binary) => binary.name === selectedName)
  : binaryPackages;
if (selectedName) assert(selected.length === 1, `unknown binary package ${selectedName}`);

if (requireBinaries) {
  for (const binary of selected) {
    const packageRoot = resolve(root, binary.directory);
    for (const file of [...binary.artifacts, "LICENSE", "NOTICE"]) {
      const path = resolve(packageRoot, file);
      assert(existsSync(path), `${binary.name} is missing ${file}; run stage:binaries first`);
      assert(statSync(path).size > 0, `${binary.name} has an empty ${file}`);
    }
    const binaryFiles = packPreview(packageRoot);
    assertContents(binary.name, binaryFiles, (file) =>
      ["package.json", "README.md", "LICENSE", "NOTICE", ...binary.artifacts].includes(file),
    );
  }
}

console.log(`package checks passed${requireBinaries ? " with staged binaries" : ""}`);
