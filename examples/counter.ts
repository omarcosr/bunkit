// A counter, written imperatively.
//
//   bun run examples/counter.ts
//
// The count lives in a signal; the label echoes it (one-way binding), and the
// buttons mutate it. The JSX twin is examples/counter.tsx — same structure,
// same behaviour.
import { Application, Button, HStack, Label, signal, VStack, Window } from "@omarcos/bunkit";

const app = new Application({ name: "Counter", theme: "light" });

const count = signal(0);
const display = new Label({ text: "0", font: { style: "title", weight: "semibold" } });
count.subscribe((v) => {
  display.text = String(v);
});

const win = new Window({
  title: "Counter",
  size: { width: 300, height: 220 },
  content: new VStack(
    { spacing: 16, padding: 24, alignItems: "center", justifyContent: "center" },
    [
      display,
      new HStack({ spacing: 12 }, [
        new Button({ title: "−", onClick: () => count.set(count.value - 1) }),
        new Button({ title: "+", primary: true, onClick: () => count.set(count.value + 1) }),
      ]),
      new Button({ title: "Reset", onClick: () => count.set(0) }),
    ],
  ),
});
win.quitOnClose();

await app.run();
