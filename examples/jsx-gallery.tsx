// The same gallery ideas, written declaratively in JSX.
//
//   bun run examples/jsx-gallery.tsx
//
// Tag names map to bunkit controls (see src/jsx-runtime.tsx); props pass
// straight to the constructors, so onClick/onChange/onSubmit are the event
// props. Bare text between tags is dropped — use text/title/placeholder.

import { Application, setTheme } from "bunkit";

const app = new Application({ name: "JSX Gallery", theme: "light" });

let dark = false;
const greeting = <label text="Type a name and press Return." color="secondaryLabel" />;
const log = <label text="" color="secondaryLabel" font={{ monospace: true, size: 11 }} />;
let count = 0;

const win = (
  <window title="BunKit JSX" size={{ width: 460, height: 340 }}>
    <vstack spacing={12} padding={16}>
      <hstack spacing={8} align="center">
        <label text="JSX Gallery" font={{ style: "title", weight: "semibold" }} />
        <spacer />
        <checkbox
          title="Dark mode"
          checked={dark}
          onChange={(on: boolean) => {
            dark = on;
            setTheme(on ? "dark" : "light", { background: on ? "#14141F" : "#FAFAFA" });
          }}
        />
      </hstack>

      <hstack spacing={8}>
        <textfield
          placeholder="Your name"
          grow={1}
          border
          borderRadius={4}
          onSubmit={(v: string) => {
            console.log(v);
            greeting.text = `Hello, ${v || "stranger"}!`;
          }}
        />
        <button
          title="Greet"
          primary
          onClick={() => {
            count++;
            log.text = `clicked ${count}×`;
          }}
        />
      </hstack>

      {greeting}
      {log}

      <scrollview border borderColor="#1398eb" borderRadius={4} grow={1}>
        <vstack spacing={6} padding={8}>
          {["Blue", "In Rainbows", "Kind of Blue"].map((album, _) => (
            <button
              title={album}
              grow={1}
              onClick={() => { log.text = `playing ${album}`; }}
            />
          ))}
        </vstack>
      </scrollview>
    </vstack>
  </window>
);

void win; // the window is alive; app.run() pumps it

await app.run();
