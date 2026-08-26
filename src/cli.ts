#!/usr/bin/env bun
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";

type BuildConfig = {
  entry: string;
  outdir: string;
  name?: string;
  outfile?: string;
  target: string;
  compileFlags: string[];
  forwarded: string[];
};

function usage(): string {
  return `Usage:
  bunx @omarcos/bunkit build <entry.ts|entry.tsx> [options]

Options:
  --outdir <dir>              Output directory (default: dist)
  --name <name>               Executable name (default: entry name)
  --outfile <path>            Full executable path; replaces --outdir/--name
  --target <target>           Bun target (default: bun-windows-x64)
  --windows-icon <path>       Set the executable icon
  --windows-hide-console      Hide the console window
  --minify                    Minify the compiled JavaScript
  --bytecode                  Compile JavaScript bytecode
  -- <bun options>            Forward additional options to bun build
`;
}

function fail(message: string): never {
  console.error(`[BunKit] ${message}`);
  process.exit(1);
}

function optionValue(args: string[], arg: string, flag: string): string {
  if (arg === flag) {
    const value = args.shift();
    if (!value || value.startsWith("-")) fail(`${flag} requires a value`);
    return value;
  }
  return arg.slice(flag.length + 1);
}

function executablePath(path: string): string {
  const absolute = resolve(path);
  return extname(absolute).length === 0 ? `${absolute}.exe` : absolute;
}

function parseBuildConfig(argv: string[]): BuildConfig {
  const entry = argv.shift();
  if (!entry || entry.startsWith("-")) fail("build requires an entry file");

  const config: BuildConfig = {
    entry: resolve(entry),
    outdir: "dist",
    target: "bun-windows-x64",
    compileFlags: [],
    forwarded: [],
  };

  let forwarding = false;
  while (argv.length > 0) {
    const arg = argv.shift()!;
    if (forwarding) {
      config.forwarded.push(arg);
      continue;
    }
    if (arg === "--") {
      forwarding = true;
      continue;
    }
    if (arg === "--outdir" || arg.startsWith("--outdir=")) {
      config.outdir = optionValue(argv, arg, "--outdir");
      continue;
    }
    if (arg === "--name" || arg.startsWith("--name=")) {
      config.name = optionValue(argv, arg, "--name");
      continue;
    }
    if (arg === "--outfile" || arg.startsWith("--outfile=")) {
      config.outfile = optionValue(argv, arg, "--outfile");
      continue;
    }
    if (arg === "--target" || arg.startsWith("--target=")) {
      config.target = optionValue(argv, arg, "--target");
      continue;
    }
    if (arg === "--windows-icon" || arg.startsWith("--windows-icon=")) {
      const icon = optionValue(argv, arg, "--windows-icon");
      config.compileFlags.push(`--windows-icon=${resolve(icon)}`);
      continue;
    }
    if (arg === "--windows-hide-console" || arg === "--minify" ||
        arg === "--bytecode" || arg === "--sourcemap") {
      config.compileFlags.push(arg);
      continue;
    }
    fail(`unknown option: ${arg}. Use -- to forward options to bun build.`);
  }

  return config;
}

function nativeArtifact(specifier: string): string {
  const packageRequire = createRequire(import.meta.url);
  try {
    return packageRequire.resolve(specifier);
  } catch {
    fail(
      `native artifact ${specifier} was not found. ` +
      "Reinstall @omarcos/bunkit with optional dependencies enabled.",
    );
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    console.log(usage());
    return;
  }

  const command = argv.shift();
  if (command !== "build") fail(`unknown command: ${command}`);
  if (process.platform !== "win32" || process.arch !== "x64") {
    fail("the Windows build command currently requires Windows x64");
  }

  const config = parseBuildConfig(argv);
  if (!existsSync(config.entry)) fail(`entry file not found: ${config.entry}`);
  if (!config.target.startsWith("bun-windows-x64")) {
    fail(`target ${config.target} does not match the installed Windows x64 bridge`);
  }
  if (config.outfile && config.name) {
    fail("use either --outfile or --outdir/--name, not both");
  }

  const defaultName = basename(config.entry, extname(config.entry)) || "BunKitApp";
  const output = executablePath(
    config.outfile ?? join(config.outdir, config.name ?? defaultName),
  );
  const outputDir = dirname(output);
  mkdirSync(outputDir, { recursive: true });

  const commandArgs = [
    process.execPath,
    "build",
    "--compile",
    config.entry,
    `--target=${config.target}`,
    "--outfile",
    output,
    ...config.compileFlags,
    ...config.forwarded,
  ];
  const result = Bun.spawnSync(commandArgs, { stdout: "pipe", stderr: "pipe" });
  if (result.stdout.length > 0) process.stdout.write(result.stdout);
  if (result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.exitCode !== 0) fail(`bun build --compile failed with exit code ${result.exitCode}`);

  const bridge = nativeArtifact("@omarcos/bunkit-win32-x64/winbridge.dll");
  const bootstrap = nativeArtifact(
    "@omarcos/bunkit-win32-x64/Microsoft.WindowsAppRuntime.Bootstrap.dll",
  );
  const bridgeOutput = join(outputDir, "winbridge.dll");
  const bootstrapOutput = join(outputDir, "Microsoft.WindowsAppRuntime.Bootstrap.dll");
  copyFileSync(bridge, bridgeOutput);
  copyFileSync(bootstrap, bootstrapOutput);

  console.log(`BunKit app created: ${output}`);
  console.log(`  ${bridgeOutput}`);
  console.log(`  ${bootstrapOutput}`);
  console.log("Keep the DLLs next to the EXE when distributing the app.");
}

main();
