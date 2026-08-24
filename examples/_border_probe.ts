import { Application, Window, VStack, TextField } from "A:/bunkit/src/index.ts";
const app = new Application({ name: "BP", theme: "light" });
const win = new Window({
  title: "Border Probe",
  size: { width: 300, height: 160 },
  content: new VStack({ padding: 40 }, [new TextField({ placeholder: "field", width: 220 })]),
});
win.quitOnClose();
await app.run();
