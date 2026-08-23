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
  Spacer, Separator, Table, View,
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

// The control constructors, for two purposes: distinguishing them from plain
// function components, and picking how each one takes children.
const CONTROLS: ReadonlySet<Function> = new Set([
  Window, VStack, HStack, Stack, Label, Button, TextField,
  Checkbox, Switch, Slider, Select, Segmented, TextArea, Progress,
  GroupBox, ScrollView, SplitView, Container, ImageView, BlurView,
  Spacer, Separator, Table,
]);

// True for the controls and for subclasses/aliases of them (e.g. a
// `const AlbumTable = Table<Album>` alias used as <AlbumTable />).
function isControl(type: any): boolean {
  if (CONTROLS.has(type)) return true;
  if (typeof type !== "function" || !type.prototype) return false;
  return type.prototype instanceof View;
}

function create(type: any, props: any, children: any[]): any {
  const p = props ?? {};

  // Custom components: a plain function returning more JSX.
  if (typeof type === "function" && !isControl(type)) {
    return type({ ...p, children });
  }
  if (typeof type !== "function") {
    throw new Error(`bunkit/jsx-runtime: <${String(type)}> is not a control`);
  }

  // Signals in props (value={name}) are bound by the control constructors
  // themselves (bindSignals), so they pass through unchanged here.
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
    case Table:
      control = new Table(p);
      break;
    default:
      // Subclasses and aliases (e.g. `const AlbumTable = Table<Album>`): they
      // take (options, children) like the base controls do; constructors
      // ignore extra arguments.
      if (isControl(type)) {
        control = new type(p, children);
      } else {
        throw new Error(`bunkit/jsx-runtime: <${String(type?.name ?? type)}> is not a control`);
      }
  }

  return control;
}

// A JSX expression evaluates to the control it creates: <TextArea /> is a
// TextArea, <AlbumTable /> (alias of Table<Album>) is a Table<Album>, and a
// custom function component evaluates to its return type. This is what makes
// `const log = <TextArea …/>` typed without a cast.
type JsxResult<T> = T extends abstract new (...args: any) => any ? InstanceType<T>
  : T extends (props: any) => any ? ReturnType<T>
  : any;

export function jsx<T>(type: T, props: any): JsxResult<T> {
  const { children, ...rest } = props ?? {};
  const out: any[] = [];
  flatten(children, out);
  return create(type, rest, out);
}

export const jsxs = jsx;
export const jsxDEV = jsx;
