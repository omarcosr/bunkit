import {
  Checkbox,
  Progress,
  Select,
  Separator,
  Slider,
  Spacer,
  Switch,
  TextArea,
} from "../../src/platform/windows/ui.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";

await windowsBackend.init();

const checkbox = new Checkbox({ title: "Enabled", checked: true, onChange: () => undefined });
const toggle = new Switch({ on: true, onChange: () => undefined });
const slider = new Slider({ min: 0, max: 100, value: 42, onChange: () => undefined });
const select = new Select({ items: ["one", "two", "três"], selected: 2, onChange: () => undefined });
const textarea = new TextArea({ value: "hello", onChange: () => undefined });
const progress = new Progress({ max: 100, value: 25 });
const separator = new Separator();
const spacer = new Spacer();

if (!checkbox.checked || !toggle.on || slider.value !== 42 || select.selectedIndex !== 2 || select.selectedTitle !== "três") {
  throw new Error("advanced control state roundtrip failed");
}
if (textarea.value !== "hello" || progress.value !== 25) {
  throw new Error("advanced text/progress roundtrip failed");
}

checkbox.checked = false;
toggle.on = false;
slider.value = 75;
select.selectedIndex = 1;
textarea.value = "updated";
progress.value = 80;

if (checkbox.checked || toggle.on || slider.value !== 75 || select.selectedTitle !== "two" || textarea.value !== "updated" || progress.value !== 80) {
  throw new Error("advanced control setter roundtrip failed");
}

for (const view of [checkbox, toggle, slider, select, textarea, progress, separator, spacer]) {
  windowsBackend.destroy(view.handle);
}
windowsBackend.shutdown();
console.log("ADVANCED CONTROLS OK");
