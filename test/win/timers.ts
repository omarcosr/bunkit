import { windowsBackend } from "../../src/platform/windows/backend.ts";
await windowsBackend.init();
const win = windowsBackend.createWindow({ title: "timers", size: { width: 200, height: 200 } });
windowsBackend.showWindow(win);
let timeoutFired = false;
let intervalCount = 0;
let microFired = false;
setTimeout(() => { timeoutFired = true; }, 200);
const iv = setInterval(() => { intervalCount++; }, 80);
Promise.resolve().then(() => { microFired = true; });
await Bun.sleep(600);
clearInterval(iv);
console.log(`timers: timeout=${timeoutFired} interval=${intervalCount} micro=${microFired} running=${windowsBackend.isRunning()}`);
if (!timeoutFired) { console.error("FAIL: timeout"); process.exit(1); }
if (intervalCount < 4) { console.error("FAIL: interval", intervalCount); process.exit(1); }
if (!microFired) { console.error("FAIL: microtask"); process.exit(1); }
if (!windowsBackend.isRunning()) { console.error("FAIL: not running"); process.exit(1); }
windowsBackend.shutdown();
console.log("TIMERS OK — Bun event loop alive with WinUI open");
