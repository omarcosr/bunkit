// JSX runtime — a thin declarative skin over the imperative API.
//
//   tsconfig:  "jsx": "react-jsx", "jsxImportSource": "bunkit"
//   example:   <vstack spacing={12}><label text="hi" /><button title="Go" onClick={…}/></vstack>
//
// Tag names map to the Layer 3 constructors; props are passed through
// unchanged (so event props are exactly the constructor option names:
// onClick, onChange, onSubmit…). String children are dropped — text goes in
// `text`/`title`/`placeholder` props. Function types are treated as custom
// components. The runtime is platform-agnostic and works on macOS and Windows.
import {
  Application, Window, VStack, HStack, Stack, Label, Button, TextField,
  Checkbox, Switch, Slider, Select, Segmented, TextArea, Progress,
  GroupBox, ScrollView, SplitView, Container, ImageView, BlurView,
  Spacer, Separator, View, isSignal,
} from "./index.ts";
import type {
  WindowOptions, StackOptions, LabelOptions, ButtonOptions,
  CheckboxOptions, TextFieldOptions, TextAreaOptions, SliderOptions,
  SelectOptions, SegmentedOptions, ProgressOptions, ImageOptions,
  BoxOptions, BlurOptions, ScrollOptions, SplitOptions, ViewOptions,
  Signal,
} from "./index.ts";

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

function create(type: any, props: any, children: any[]): any {
  const p = props ?? {};

  // Custom components: a plain function returning more JSX.
  if (typeof type === "function" && !(type.prototype instanceof View)) {
    return type({ ...p, children });
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
    case "window":
      control = new Window({ ...p, content: children[0] });
      break;
    case "vstack":
      control = new VStack(p, children);
      break;
    case "hstack":
      control = new HStack(p, children);
      break;
    case "stack":
      control = new Stack(p.orientation ?? 0, p, children);
      break;
    case "label":
      control = new Label(p);
      break;
    case "button":
      control = new Button(p);
      break;
    case "textfield":
      control = new TextField(p);
      break;
    case "checkbox":
      control = new Checkbox(p);
      break;
    case "switch":
      control = new Switch(p);
      break;
    case "slider":
      control = new Slider(p);
      break;
    case "select":
      control = new Select(p);
      break;
    case "segmented":
      control = new Segmented(p);
      break;
    case "textarea":
      control = new TextArea(p);
      break;
    case "progress":
      control = new Progress(p);
      break;
    case "groupbox":
      control = new GroupBox(p, children);
      break;
    case "scrollview": {
      control = new ScrollView(p);
      if (children[0] !== undefined) control.content = children[0];
      break;
    }
    case "splitview":
      control = new SplitView(p, children);
      break;
    case "container":
      control = new Container(p, children);
      break;
    case "imageview":
      control = new ImageView(p);
      break;
    case "blurview":
      control = new BlurView(p, children[0]);
      break;
    case "spacer":
      control = new Spacer();
      break;
    case "separator":
      control = new Separator();
      break;
    default:
      throw new Error(`bunkit/jsx-runtime: unknown tag <${String(type)}>`);
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

// The automatic runtime resolves the JSX namespace globally. Each tag's props
// are the real constructor options (LabelOptions, ButtonOptions…), so the
// editor and tsc check prop names and types; `children` stays loose because
// JSX children include arrays from .map and conditionals. Tags that don't take
// children (label, button…) reject them, matching the runtime, which drops
// bare text and only passes children to the container tags.
declare global {
  namespace JSX {
    type Element = any;
    /** A JSX child: a control, an array from .map, or a conditional. */
    type Child = any;
    /** The constructor options plus JSX children, where the runtime takes them. */
    type ContainerProps<T> = T & { children?: Child };
    /** A bindable prop: a plain value or a signal the runtime binds both ways. */
    type Bindable<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | Signal<T[P]> };
    interface IntrinsicElements {
      window: ContainerProps<WindowOptions>;
      vstack: ContainerProps<StackOptions>;
      hstack: ContainerProps<StackOptions>;
      stack: ContainerProps<StackOptions> & { orientation?: number };
      label: Bindable<LabelOptions, "text">;
      button: Bindable<ButtonOptions, "title">;
      textfield: Bindable<TextFieldOptions, "value">;
      checkbox: Bindable<CheckboxOptions, "checked">;
      switch: Bindable<ViewOptions & { on?: boolean; onChange?: (on: boolean, s: InstanceType<typeof Switch>) => void }, "on">;
      slider: Bindable<SliderOptions, "value">;
      select: Bindable<SelectOptions, "selected">;
      segmented: Bindable<SegmentedOptions, "selected">;
      textarea: Bindable<TextAreaOptions, "value">;
      progress: Bindable<ProgressOptions, "value">;
      groupbox: ContainerProps<BoxOptions>;
      scrollview: ContainerProps<ScrollOptions>;
      splitview: ContainerProps<SplitOptions>;
      container: ContainerProps<ViewOptions>;
      imageview: ImageOptions;
      blurview: ContainerProps<BlurOptions>;
      spacer: {};
      separator: {};
    }
    interface ElementChildrenAttribute {
      children: {};
    }
  }
}
