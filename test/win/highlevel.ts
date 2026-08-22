import { Application, Window, VStack, Label, Button, TextField } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";
import { winLib } from "../../src/platform/windows/ffi.ts";

await windowsBackend.init();

const label = new Label({ text: "Not clicked" });
const input = new TextField({ placeholder: "Type something" });
let clicked = false;

const button = new Button({
  title: "Click me",
  onClick() {
    clicked = true;
    label.text = input.value;
  },
});

const win = new Window({
  title: "Highlevel",
  size: { width: 400, height: 250 },
  content: new VStack({ padding: 12, spacing: 8 }, [input, button, label]),
});

await Bun.sleep(800);
(input as any).value = "Hello Highlevel";
(winLib as any).bk_button_click((button as any).handle);

for (let i = 0; i < 20; i++) {
  windowsBackend.pump();
  await Bun.sleep(5);
}

if (!clicked) {
  console.error("FAIL: click handler never fired");
  process.exit(1);
}
if (label.text !== "Hello Highlevel") {
  console.error(`FAIL: label.text expected "Hello Highlevel", got ${JSON.stringify(label.text)}`);
  process.exit(1);
}
console.log("HIGHLEVEL OK — click → label.text =", JSON.stringify(label.text));

label.text = "Olá ação 🙂";
if (label.text !== "Olá ação 🙂") {
  console.error("FAIL: UTF-8 label roundtrip via high-level API");
  process.exit(1);
}
console.log("HIGHLEVEL UTF-8 OK");

win.close();
await Bun.sleep(400);
console.log("HIGHLEVEL CLEAN SHUTDOWN OK");
process.exit(0);
