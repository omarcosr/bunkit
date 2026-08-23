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
  Spacer, Separator, View,
} from "./index.ts";
import type {
  WindowOptions, StackOptions, LabelOptions, ButtonOptions,
  CheckboxOptions, TextFieldOptions, TextAreaOptions, SliderOptions,
  SelectOptions, SegmentedOptions, ProgressOptions, ImageOptions,
  BoxOptions, BlurOptions, ScrollOptions, SplitOptions, ViewOptions,
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

function create(type: any, props: any, children: any[]): any {
  const p = props ?? {};

  // Custom components: a plain function returning more JSX.
  if (typeof type === "function" && !(type.prototype instanceof View)) {
    return type({ ...p, children });
  }

  switch (type) {
    case Fragment:
      return children;
    case "window":
      return new Window({ ...p, content: children[0] });
    case "vstack":
      return new VStack(p, children);
    case "hstack":
      return new HStack(p, children);
    case "stack":
      return new Stack(p.orientation ?? 0, p, children);
    case "label":
      return new Label(p);
    case "button":
      return new Button(p);
    case "textfield":
      return new TextField(p);
    case "checkbox":
      return new Checkbox(p);
    case "switch":
      return new Switch(p);
    case "slider":
      return new Slider(p);
    case "select":
      return new Select(p);
    case "segmented":
      return new Segmented(p);
    case "textarea":
      return new TextArea(p);
    case "progress":
      return new Progress(p);
    case "groupbox":
      return new GroupBox(p, children);
    case "scrollview": {
      const sv = new ScrollView(p);
      if (children[0] !== undefined) sv.content = children[0];
      return sv;
    }
    case "splitview":
      return new SplitView(p, children);
    case "container":
      return new Container(p, children);
    case "imageview":
      return new ImageView(p);
    case "blurview":
      return new BlurView(p, children[0]);
    case "spacer":
      return new Spacer();
    case "separator":
      return new Separator();
    default:
      throw new Error(`bunkit/jsx-runtime: unknown tag <${String(type)}>`);
  }
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
    interface IntrinsicElements {
      window: ContainerProps<WindowOptions>;
      vstack: ContainerProps<StackOptions>;
      hstack: ContainerProps<StackOptions>;
      stack: ContainerProps<StackOptions> & { orientation?: number };
      label: LabelOptions;
      button: ButtonOptions;
      textfield: TextFieldOptions;
      checkbox: CheckboxOptions;
      switch: ViewOptions & { on?: boolean; onChange?: (on: boolean, s: InstanceType<typeof Switch>) => void };
      slider: SliderOptions;
      select: SelectOptions;
      segmented: SegmentedOptions;
      textarea: TextAreaOptions;
      progress: ProgressOptions;
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
