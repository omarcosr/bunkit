// Compile-time check that JSX props are typed against real option types.
// This file never runs; the @ts-expect-error lines fail the typecheck if
// the JSX namespace stops being precise (TS2578: unused directive).
import { Application, signal } from "bunkit";

const app = new Application({ name: "JSX Types", theme: "light" });

// --- valid props: must compile without error ---
const name = signal("");
const dark = signal(false);
const ok = (
  <window title="t" size={{ width: 100, height: 100 }}>
    <vstack spacing={8} padding={12}>
      <label text="hi" color="secondaryLabel" font={{ style: "title", weight: "semibold" }} />
      <button title="Go" primary onClick={(b) => { void b; }} />
      <textfield placeholder="name" value={name} onSubmit={(v, f) => { void v; void f; }} />
      <checkbox title="Dark" checked={dark} onChange={(on) => { void on; }} />
      <segmented items={["A", "B"]} onChange={(i) => { void i; }} />
      <slider value={0.5} min={0} max={1} onChange={(v) => { void v; }} />
    </vstack>
  </window>
);
void ok;

// --- wrong props: each @ts-expect-error must fire ---
// @ts-expect-error text expects a string, not a number
const bad1 = <label text={123} />;
// @ts-expect-error unknown prop
const bad2 = <label bogus="x" />;
// @ts-expect-error spacing is a number, not a string
const bad3 = <vstack spacing="8" />;
// @ts-expect-error items is required for segmented
const bad4 = <segmented />;
// @ts-expect-error labels don't accept children
const bad5 = <label>bare text</label>;
// @ts-expect-error padding doesn't exist on scrollview
const bad6 = <scrollview padding={8} />;
// @ts-expect-error unknown tag
const bad7 = <nonexistent />;
// @ts-expect-error value must be a string or a Signal<string>, not a number
const bad8 = <textfield value={123} />;
// @ts-expect-error checked must be a boolean or a Signal<boolean>, not a string
const bad9 = <checkbox checked="yes" />;