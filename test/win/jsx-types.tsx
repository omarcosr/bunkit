// Compile-time check that JSX props are typed against the imported elements'
// real option types. This file never runs; the @ts-expect-error lines fail
// the typecheck if the typing stops being precise (TS2578: unused directive).
import {
  Application,
  Button,
  Checkbox,
  Label,
  ScrollView,
  Segmented,
  signal,
  Slider,
  TextField,
  VStack,
  Window
} from "@omarcosr/bunkit";

const app = new Application({ name: "JSX Types", theme: "light" });

// --- valid props: must compile without error ---
const name = signal("");
const dark = signal(false);

// JSX expressions are typed as the control instance (no casts needed).
const echo = <Label text="hi" />;
echo.text = "typed";                      // Label.text setter
const field = <TextField value={name} />;
field.value = "also typed";               // TextField.value setter
const list = <Segmented items={["A", "B"]} />;
list.selectedIndex = 1;                   // Segmented.selectedIndex setter

const ok = (
  <Window title="t" size={{ width: 100, height: 100 }}>
    <VStack spacing={8} padding={12}>
      <Label text="hi" textColor="secondaryLabel" font={{ style: "title", weight: "semibold" }} />
      <Button title="Go" primary onClick={(b) => { void b; }} />
      <TextField placeholder="name" value={name} onSubmit={(v, f) => { void v; void f; }} />
      <Checkbox title="Dark" checked={dark} onChange={(on) => { void on; }} />
      <Segmented items={["A", "B"]} onChange={(i) => { void i; }} />
      <Slider value={0.5} min={0} max={1} onChange={(v) => { void v; }} />
      {/* style accepts the control's own props, not just ViewOptions */}
      <TextField style={{ textColor: "#C33", placeholderColor: "#888", font: { size: 14 } }} />
      <Label style={{ textColor: "secondaryLabel", font: { weight: "bold" } }} text="styled" />
      <VStack style={{ spacing: 16, alignItems: "center" }} />
      <Button style={{ primary: true, title: "styled button" }} />
    </VStack>
  </Window>
);
void ok;

// --- wrong props: each @ts-expect-error must fire ---
// @ts-expect-error text expects a string, not a number
const bad1 = <Label text={123} />;
// @ts-expect-error unknown prop
const bad2 = <Label bogus="x" />;
// @ts-expect-error spacing is a number, not a string
const bad3 = <VStack spacing="8" />;
// @ts-expect-error items is required for segmented
const bad4 = <Segmented />;
// @ts-expect-error padding doesn't exist on scrollview
const bad5 = <ScrollView padding={8} />;
// @ts-expect-error unknown element
const bad6 = <Nonexistent />;
// @ts-expect-error value must be a string or a Signal<string>, not a number
const bad7 = <TextField value={123} />;
// @ts-expect-error checked must be a boolean or a Signal<boolean>, not a string
const bad8 = <Checkbox checked="yes" />;
// @ts-expect-error textColor is a known name or a hex string, not a random word
const bad9 = <Label textColor="not-a-color" />;
