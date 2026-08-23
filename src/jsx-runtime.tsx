// JSX runtime — a thin declarative skin over the imperative API.
//
//   tsconfig:  "jsx": "react-jsx", "jsxImportSource": "bunkit"
//   example:   <VStack spacing={12}><Label text="hi" /><Button title="Go" onClick={…}/></VStack>
//
// Elements are the imported constructors themselves — <Window>, <VStack>,
// <Label>, … — so props are type-checked against the real option types with
// no global IntrinsicElements table. Props are passed through unchanged (so
// event props are exactly the constructor option names: onClick, onChange,
// onSubmit…). String children are dropped — text goes in `text`/`title`/
// `placeholder` props. Plain functions are custom components. The runtime is
// platform-agnostic and works on macOS and Windows.
import {
  Application, Window, VStack, HStack, Stack, Label, Button, TextField,
  Checkbox, Switch, Slider, Select, Segmented, TextArea, Progress,
  GroupBox, ScrollView, SplitView, Container, ImageView, BlurView,
  Spacer, Separator, isSignal,
} from "./index.ts";
import type { Signal } from "./index.ts";

export const Fragment = Symbol.for("bunkit.Fragment");

/** A JSX child, or a tree of them (arrays from .map, conditionals…). */
function flatten(value: any, out: any[]): void {
  if (value === null || value === undefined || value === true || value === false) return;
  if (Array.isArray(value)) {
    for (const item of value) flatten(item, out);
    return;
  }
  if (typeof value === "string" || typeof value === "number") return; // bare text
  out.push(value);
}

// Signal binding. Passing a signal as one of these props binds it to the
// control: typing/flipping writes back into the signal, and signal.set()
// updates the control. `value`/`checked`/`on`/`selected` are two-way (the
// controls have change events); `text`/`title` are one-way (no event to
// write back from).
import { WRITE_BACK_EVENT } from "./signal.ts";

// The control constructors, for two purposes: distinguishing them from plain
// function components, and picking how each one takes children.
const CONTROLS: ReadonlySet<Function> = new Set([
  Window, VStack, HStack, Stack, Label, Button, TextField,
  Checkbox, Switch, Slider, Select, Segmented, TextArea, Progress,
  GroupBox, ScrollView, SplitView, Container, ImageView, BlurView,
  Spacer, Separator,
]);

function create(type: any, props: any, children: any[]): any {
  const p = props ?? {};

  // Custom components: a plain function returning more JSX.
  if (typeof type === "function" && !CONTROLS.has(type)) {
    return type({ ...p, children });
  }
  if (typeof type !== "function") {
    throw new Error(`bunkit/jsx-runtime: <${String(type)}> is not a control`);
  }

  // Pull signals out of their props (bindings are wired after construction);
  // a user-supplied onChange runs after the signal is written back.
  const bound: Array<[string, Signal<any>]> = [];
  for (const key of Object.keys(p)) {
    if (isSignal(p[key])) {
      const sig = p[key] as Signal<any>;
      bound.push([key, sig]);
      p[key] = sig.get();
    }
  }
  for (const [key, sig] of bound) {
    const ev = WRITE_BACK_EVENT[key];
    if (ev && typeof p[ev] === "function") {
      const user = p[ev];
      p[ev] = (v: any, ...rest: any[]) => {
        sig.set(v);
        user(v, ...rest);
      };
    }
  }

  let control: any;
  switch (type) {
    case Fragment:
      return children;
    case Window:
      control = new Window({ ...p, content: children[0] });
      break;
    case VStack:
      control = new VStack(p, children);
      break;
    case HStack:
      control = new HStack(p, children);
      break;
    case Stack:
      control = new Stack(p.orientation ?? 0, p, children);
      break;
    case Label:
      control = new Label(p);
      break;
    case Button:
      control = new Button(p);
      break;
    case TextField:
      control = new TextField(p);
      break;
    case Checkbox:
      control = new Checkbox(p);
      break;
    case Switch:
      control = new Switch(p);
      break;
    case Slider:
      control = new Slider(p);
      break;
    case Select:
      control = new Select(p);
      break;
    case Segmented:
      control = new Segmented(p);
      break;
    case TextArea:
      control = new TextArea(p);
      break;
    case Progress:
      control = new Progress(p);
      break;
    case GroupBox:
      control = new GroupBox(p, children);
      break;
    case ScrollView: {
      control = new ScrollView(p);
      if (children[0] !== undefined) control.content = children[0];
      break;
    }
    case SplitView:
      control = new SplitView(p, children);
      break;
    case Container:
      control = new Container(p, children);
      break;
    case ImageView:
      control = new ImageView(p);
      break;
    case BlurView:
      control = new BlurView(p, children[0]);
      break;
    case Spacer:
      control = new Spacer();
      break;
    case Separator:
      control = new Separator();
      break;
    default:
      throw new Error(`bunkit/jsx-runtime: <${String(type?.name ?? type)}> is not a control`);
  }

  // Wire signal bindings: one-way (signal → control) + two-way (also write-back).
  for (const [key, sig] of bound) {
    sig.subscribe(() => { control[key] = sig.get(); });
    const ev = WRITE_BACK_EVENT[key];
    if (ev && typeof control[ev] === "function" && typeof p[ev] !== "function") {
      control[ev]((v: any) => sig.set(v));
    }
  }
  return control;
}

export function jsx(type: any, props: any): any {
  const { children, ...rest } = props ?? {};
  const out: any[] = [];
  flatten(children, out);
  return create(type, rest, out);
}

export const jsxs = jsx;
export const jsxDEV = jsx;
