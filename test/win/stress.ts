import { windowsBackend } from "../../src/platform/windows/backend.ts";
await windowsBackend.init();
console.log("stress: creating 200 labels");
const handles: bigint[] = [];
for (let i = 0; i < 200; i++) {
  const h = windowsBackend.createLabel({ text: `label ${i} Olá 🙂` });
  handles.push(h);
}
console.log("created", handles.length);
for (let i = 0; i < 5; i++) {
  for (const h of handles) windowsBackend.setLabelText(h, `v${i}`);
}
console.log("mutated");
for (const h of handles) windowsBackend.destroy(h);
console.log("destroyed");
const h2 = windowsBackend.createLabel({ text: "after stress" });
console.log("recreated", h2.toString(), windowsBackend.getLabelText(h2));
windowsBackend.destroy(h2);
windowsBackend.shutdown();
console.log("STRESS OK");
