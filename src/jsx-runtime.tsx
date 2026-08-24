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

// For — declarative list rendering, SolidJS-style.
//
//   <For each={todos} by={(t) => t.id} spacing={8}>
//     {(todo) => <Row todo={todo} />}
//   </For>
//
// `each` is an array or a signal of an array; the render function is the JSX
// child. Rows are reconciled by key (`by`): new items are created, removed
// ones deleted, and an item whose reference changed is re-created in place —
// untouched rows keep their views, so the entrance animation only plays on
// the rows that actually changed. The For itself is a stack (its spacing
// separates the rows), so it drops into any parent layout.
import { isSignal, unwrap, type Signal } from "./signal.ts";

export class For<T> {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: any;
  /** The stack that holds the rendered rows; add `<For>` to any layout. */
  readonly host: InstanceType<typeof VStack>;
  // View facade so Stack.add/remove/insert work on both platforms.
  get native(): any { return (this.host as any).native; }
  get handle(): any { return (this.host as any).handle; }
  get grow(): any { return (this.host as any).grow; }
  /** @internal */ _growExplicit = false;
  /** @internal */ _parent: any = null;

  #each: T[] | Signal<T[]> | undefined;
  #render: (item: T) => any;
  #by: (item: T) => unknown;
  #rows = new Map<unknown, { item: T; view: any }>();
  #order: unknown[] = [];

  constructor(
    props: { each?: T[] | Signal<T[]>; by?: (item: T) => unknown; spacing?: number } = {},
    render?: (item: T) => any,
  ) {
    this.host = new VStack({ spacing: props.spacing ?? 8 });
    this.#each = props.each;
    this.#render = render ?? (() => null);
    this.#by = props.by ?? ((item: T) => item as unknown);
    this.reconcile();
    if (isSignal(this.#each)) {
      this.#each.subscribe(() => this.reconcile());
    }
  }

  reconcile(): void {
    const items = (unwrap(this.#each) ?? []) as T[];
    const newKeys = items.map((item) => this.#by(item));
    const oldKeys = this.#order;
    // Keep the common prefix and suffix; only the middle can change.
    let i = 0;
    while (i < newKeys.length && i < oldKeys.length && newKeys[i] === oldKeys[i]) i++;
    let j = 0;
    while (j < newKeys.length - i && j < oldKeys.length - i &&
           newKeys[newKeys.length - 1 - j] === oldKeys[oldKeys.length - 1 - j]) j++;
    // Drop rows that are gone or whose item reference changed (re-create).
    for (const key of oldKeys.slice(i, oldKeys.length - j)) {
      const row = this.#rows.get(key);
      if (!row) continue;
      const idx = newKeys.indexOf(key);
      if (idx < 0 || items[idx] !== row.item) {
        this.host.remove(row.view);
        this.#rows.delete(key);
      }
    }
    // (Re)create the middle in order, at their position after the prefix.
    for (let k = 0; k < newKeys.length - i - j; k++) {
      const key = newKeys[i + k];
      if (!this.#rows.has(key)) {
        const view = this.#render(items[i + k]);
        this.#rows.set(key, { item: items[i + k], view });
        this.host.insert(view, i + k);
      }
    }
    this.#order = newKeys;
  }
}

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

// True for the controls and for subclasses/aliases of them (e.g. a
// `const AlbumTable = Table<Album>` alias used as <AlbumTable />). Everything
// except Window and For extends View; the check is lazy so this module can be
// imported by src/index.ts without a load-time cycle.
function isControl(type: any): boolean {
  if (typeof type !== "function" || !type.prototype) return false;
  if (type === Window || type === For) return true;
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
    case For:
      control = new For(p, children[0]);
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
