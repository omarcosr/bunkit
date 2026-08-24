// gridview_jsx.tsx — GridView through the JSX runtime: placement comes from
// child props (gridColumn/gridRow), tracks from the GridView options.
//
//   bun test/win/gridview_jsx.tsx
import { Window, GridView, Label, TextField } from "../../src/index.ts";
import { windowsBackend } from "../../src/platform/windows/backend.ts";

await windowsBackend.init();

const grid = (
  <GridView columns={["fill", 160]} rows={["auto", "auto"]} spacing={8}>
    <Label text="Nome" gridColumn={0} gridRow={0} />
    <TextField placeholder="Digite…" gridColumn={1} gridRow={0} />
    <Label text="Notas" gridColumn={0} gridRow={1} />
    <TextField placeholder="…" gridColumn={1} gridRow={1} />
  </GridView>
);

const win = (
  <Window title="GridView JSX" size={{ width: 380, height: 200 }}>
    {grid}
  </Window>
);
win.show();

await Bun.sleep(900);
for (let i = 0; i < 20; i++) {
  windowsBackend.pump();
  await Bun.sleep(5);
}

const [gridW] = windowsBackend.getControlSize(grid.handle);
const field = grid.children[1] as any;
const [fieldW] = windowsBackend.getControlSize(field.handle);

const fail = (msg: string): never => {
  console.error("FAIL:", msg);
  process.exit(1);
};
if (Math.abs(fieldW - 160) > 3) fail(`fixed column should be ~160px, got ${fieldW}`);
if (gridW <= 0) fail("grid not laid out");
if (grid.children.length !== 4) fail(`expected 4 children, got ${grid.children.length}`);

win.close();
await Bun.sleep(300);
console.log("GRIDVIEW JSX OK — 4 children placed, fixed column =", fieldW);
process.exit(0);
