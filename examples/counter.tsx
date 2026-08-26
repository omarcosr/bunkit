// A counter, written declaratively in JSX.
//
//   bun run examples/counter.tsx
//
// The count lives in a signal; the label echoes it (one-way binding), and the
// buttons mutate it. The imperative twin is examples/counter.ts.
import { Application, Button, HStack, Label, signal, VStack, Window } from "@omarcos/bunkit";

const app = new Application({ name: "Counter", theme: "light" });

const count = signal(0);
const display = new Label({ text: "0", font: { style: "title", weight: "semibold" } });
count.subscribe((v) => { display.text = String(v); });

const win = (
  <Window title="Counter" size={{ width: 300, height: 220 }}>
    <VStack spacing={16} padding={24} alignItems="center" justifyContent="center">
      {display}
      <HStack spacing={12}>
        <Button title="−" onClick={() => count.set(count.value - 1)} />
        <Button title="+" primary onClick={() => count.set(count.value + 1)} />
      </HStack>
      <Button title="Reset" onClick={() => count.set(0)} />
    </VStack>
  </Window>
);

void win; // the window is alive; app.run() pumps it

await app.run();
