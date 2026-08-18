// Every example must start, open its window, and stay up without erroring.
//
// The examples deliberately contain no test hooks — they are meant to read as
// the code you would actually write — so this drives them from the outside:
// launch, let AppKit settle, then check the process is alive and quiet.

import { spawn } from "bun";
import { gpuAvailable } from "../src/metal/index.ts";

const EXAMPLES = [
  "examples/hello.ts",
  "examples/tour.ts",
  "examples/demo.ts",
  "examples/raw-objc.ts",
  "examples/scene3d.ts",
  "examples/lighting-rig.ts",
];

let failures = 0;
function check(name: string, cond: any, extra?: any) {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}`, extra ?? "");
  }
}

for (const example of EXAMPLES) {
  // scene3d needs a GPU. A CI runner without one is not a failing example.
  if ((example.includes("scene3d") || example.includes("lighting-rig")) && !gpuAvailable()) {
    console.log(`  skip ${example} (no Metal device)`);
    continue;
  }

  const proc = spawn({
    cmd: ["bun", "run", example],
    stdout: "pipe",
    stderr: "pipe",
    // raw-objc quits itself after a few seconds unless told otherwise.
    env: { ...process.env, HELLO_STAY: "1" },
  });

  await Bun.sleep(3000);
  const alive = proc.exitCode === null;
  proc.kill();
  const err = await new Response(proc.stderr).text();
  const out = await new Response(proc.stdout).text();

  check(`${example} stayed up`, alive, `exited with ${proc.exitCode}`);
  check(
    `${example} logged no errors`,
    !/error|Error|exception|uncaught/.test(err + out),
    (err + out).split("\n").slice(0, 4).join(" | "),
  );
}

console.log(failures === 0 ? "\nALL EXAMPLES RAN" : `\n${failures} EXAMPLE FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
