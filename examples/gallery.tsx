// The same gallery ideas, written declaratively in JSX, with reactive
// signal bindings (SolidJS-style):
//
//   const name = signal("");
//   <TextField value={name} />   // two-way: typing updates the signal,
//                                // name.set(...) updates the field
//   <Label text={name} />        // one-way: live echo of whatever you type
//
// Elements are the imported constructors — <Window>, <VStack>, <Label>,
// <TextField>, … — so props are type-checked against each control's real
// option types. No global IntrinsicElements table needed.
//
//   bun run examples/gallery.tsx
import { Application, setTheme, signal, Window, VStack, HStack, Label,
  TextField, Button, Checkbox, ScrollView, Spacer } from "bunkit";

const app = new Application({ name: "JSX Gallery", theme: "light" });

const dark = signal(false);
const name = signal("");
// Constructed (not JSX) so `greeting.text` is typed as Label's setter even
// when the editor falls back to React's JSX namespace (no tsconfig).
const greeting = new Label({ text: "Type a name and press Return.", color: "secondaryLabel" });
const log = new Label({ text: "", color: "secondaryLabel", font: { monospace: true, size: 11 } });
let count = 0;

const win = (
  <Window title="BunKit JSX" size={{ width: 460, height: 340 }}>
    <VStack spacing={12} padding={16}>
      <HStack spacing={8} align="center">
        <Label text="JSX Gallery" font={{ style: "title", weight: "semibold" }} />
        <Spacer />
        <Checkbox
          title="Dark mode"
          checked={dark}
          onChange={() => setTheme(dark.value ? "dark" : "light", { background: dark.value ? "#14141F" : "#FAFAFA" })}
        />
      </HStack>

      <HStack spacing={8}>
        <TextField
          placeholder="Your name"
          grow={1}
          border
          borderRadius={4}
          value={name}
          onSubmit={() => greeting.text = `Hello, ${name.value || "stranger"}!`}
        />
        <Button
          title="Greet"
          primary
          onClick={() => {
            count++;
            log.text = `clicked ${count}×`;
          }}
        />
      </HStack>

      <Label text={name} color="secondaryLabel" font={{ size: 11 }} />
      {greeting}
      {log}

      <ScrollView border borderColor="#1398eb" borderRadius={4} grow={1}>
        <VStack spacing={6} padding={8}>
          {["Blue", "In Rainbows", "Kind of Blue"].map((album, _) => (
            <Button
              title={album}
              grow={1}
              onClick={() => { log.text = `playing ${album}`; }}
            />
          ))}
        </VStack>
      </ScrollView>
    </VStack>
  </Window>
);

void win; // the window is alive; app.run() pumps it

await app.run();