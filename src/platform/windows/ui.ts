// src/platform/windows/ui.ts — public API over the Windows backend.
import { windowsBackend } from "./backend.ts";
import type { NativeHandle } from "./ffi.ts";

// macOS examples reach for raw AppKit through `.native`. WinUI has no Obj-C
// runtime, so those escape hatches get a tolerant proxy: known names map to
// behavior where a cheap equivalent exists, unknown ones no-op. This keeps the
// example sources byte-identical across platforms.
const warned = new Set<string>();
function tolerantProxy(label: string, known: Record<string, any> = {}): any {
  return new Proxy(known, {
    get(_t, prop: string) {
      if (prop in known) return (known as any)[prop];
      if (typeof prop === "string" && !warned.has(prop)) {
        warned.add(prop);
        console.warn(`[BunKit] ${label}.${prop}() has no Windows equivalent; ignored`);
      }
      return () => undefined;
    },
  });
}

/** A corner-radius spec: one number for all four corners, [tl, tr, br, bl],
 *  or per-corner by name (CSS border-radius vocabulary). */
export type CornerRadiusSpec =
  | number
  | [number, number, number, number]
  | { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number };

export function normalizeCorners(spec: CornerRadiusSpec | undefined, fallback = 0): [number, number, number, number] {
  if (spec === undefined) return [fallback, fallback, fallback, fallback];
  if (typeof spec === "number") return [spec, spec, spec, spec];
  if (Array.isArray(spec)) return [spec[0] ?? 0, spec[1] ?? 0, spec[2] ?? 0, spec[3] ?? 0];
  return [
    spec.topLeft ?? 0,
    spec.topRight ?? 0,
    spec.bottomRight ?? 0,
    spec.bottomLeft ?? 0,
  ];
}

/** A per-side border-width spec: one number for all four sides,
 *  [top, right, bottom, left] (CSS order), or per-side by name. */
export type BorderSideSpec =
  | number
  | [number, number, number, number]
  | { top?: number; right?: number; bottom?: number; left?: number };

export function normalizeSides(spec: BorderSideSpec | boolean | undefined, fallback = 0): [number, number, number, number] {
  if (spec === undefined) return [fallback, fallback, fallback, fallback];
  if (spec === true) return [1, 1, 1, 1];
  if (spec === false) return [0, 0, 0, 0];
  if (typeof spec === "number") return [spec, spec, spec, spec];
  if (Array.isArray(spec)) return [spec[0] ?? 0, spec[1] ?? 0, spec[2] ?? 0, spec[3] ?? 0];
  return [spec.top ?? 0, spec.right ?? 0, spec.bottom ?? 0, spec.left ?? 0];
}

export interface ViewOptions {
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  grow?: number;
  hidden?: boolean;
  tooltip?: string;
  alpha?: number;
  background?: any;
  /** CSS-style alias for `background`. */
  backgroundColor?: any;
  /** Corner radius — same as `borderRadius`. One number, [tl,tr,br,bl], or
   *  per-corner names (CSS border-radius vocabulary). */
  cornerRadius?: CornerRadiusSpec;
  /** Alias for `cornerRadius`. */
  borderRadius?: CornerRadiusSpec;
  /** Border width — one number for all sides, `true` for 1,
   *  [top, right, bottom, left], or per-side names (CSS border-width vocabulary). */
  border?: number | boolean | BorderSideSpec;
  borderWidth?: number;
  borderColor?: string;
  borderStyle?: "solid" | "dashed" | "dotted";
}

/** Base of every control: handle + grow + the shared view options. */
export class View {
  handle: NativeHandle = 0n;
  grow = 0;
  /** @internal */ _children: View[] = [];
  /** @internal */ _parent: View | null = null;
  /** @internal */ _hidden = false;

  constructor(handle: NativeHandle, options: ViewOptions = {}) {
    this.handle = handle;
    if (options.grow !== undefined) this.grow = options.grow;
    if (options.width !== undefined || options.height !== undefined) {
      windowsBackend.setControlSize(handle, options.width ?? 0, options.height ?? 0);
    }
    if (options.minWidth !== undefined || options.minHeight !== undefined) {
      windowsBackend.setControlMinSize(handle, options.minWidth ?? 0, options.minHeight ?? 0);
    }
    if (options.maxWidth !== undefined || options.maxHeight !== undefined) {
      windowsBackend.setControlMaxSize(handle, options.maxWidth ?? 0, options.maxHeight ?? 0);
    }
    if (options.hidden !== undefined) this.hidden = options.hidden;
    if (options.tooltip !== undefined) windowsBackend.setControlTooltip(handle, options.tooltip);
    if (options.alpha !== undefined) windowsBackend.setControlAlpha(handle, options.alpha);
    if (options.cornerRadius !== undefined || options.borderRadius !== undefined) {
      const [tl, tr, br, bl] = normalizeCorners(options.cornerRadius ?? options.borderRadius);
      windowsBackend.setControlCornerRadius(handle, tl, tr, br, bl);
    }
    if (options.background !== undefined && typeof options.background === "string") {
      windowsBackend.setControlBackground(handle, options.background);
    } else if (options.backgroundColor !== undefined && typeof options.backgroundColor === "string") {
      windowsBackend.setControlBackground(handle, options.backgroundColor);
    }

    // CSS-style borders: `border`/`borderWidth` (or `borderColor`/`borderStyle`
    // alone) turn the border on; `borderRadius` rides along when present.
    const borderSpec = options.border !== undefined ? options.border : options.borderWidth;
    if (borderSpec !== undefined || options.borderColor !== undefined || options.borderStyle !== undefined) {
      const corners = normalizeCorners(
        (options.borderRadius ?? options.cornerRadius) as CornerRadiusSpec | undefined);
      this.setBorder(
        options.borderColor ?? "#C6C6C8",
        borderSpec ?? 1,
        corners,
        options.borderStyle ?? "solid",
      );
    }
  }

  get children(): readonly View[] { return this._children; }
  get parent(): View | null { return this._parent; }
  get frame(): { x: number; y: number; width: number; height: number } {
    const [w, h] = windowsBackend.getControlSize(this.handle);
    return { x: 0, y: 0, width: w, height: h };
  }
  get hidden(): boolean { return this._hidden; }
  set hidden(v: boolean) { this._hidden = v; windowsBackend.setControlVisible(this.handle, !v); }

  /** Keep a JS object alive for as long as this view is. */
  retainJS(_v: any): void {}

  /** Background colour (hex string). On acrylic-backed views this tints the
   *  acrylic instead of replacing it. */
  setBackground(color: any): this {
    if (typeof color === "string") {
      windowsBackend.setControlBackground(this.handle, color);
    }
    return this;
  }

  /** Border colour (hex string), width in px (one number or per-side — see
   *  BorderSideSpec), optional corner radius (one number or per-corner — see
   *  CornerRadiusSpec) and style. dashed/dotted draw with a pattern overlay on
   *  Border-based views and fall back to solid on plain Controls. */
  setBorder(color: any, width: BorderSideSpec | boolean | number = 1, radius: CornerRadiusSpec | number = 0, style: "solid" | "dashed" | "dotted" = "solid"): this {
    if (typeof color === "string") {
      const [tl, tr, br, bl] = normalizeCorners(radius as CornerRadiusSpec);
      const [top, right, bottom, left] = normalizeSides(width as BorderSideSpec);
      if (style === "solid") {
        windowsBackend.setControlBorder(this.handle, color, top, right, bottom, left, tl, tr, br, bl);
      } else {
        const code = style === "dotted" ? 2 : 1;
        windowsBackend.setControlBorderStyle(this.handle, color, top, right, bottom, left, tl, tr, br, bl, code);
      }
    }
    return this;
  }

  /** Raw-object escape hatch: a tolerant proxy (unknown selectors no-op). */
  get native(): any { return tolerantProxy(this.constructor.name + ".native"); }
}

// --- menus ---------------------------------------------------------------------

export interface MenuItemSpec {
  title: string;
  shortcut?: string;
  onClick?: (item?: any) => void;
  separator?: boolean;
  enabled?: boolean;
  checked?: boolean;
  submenu?: MenuItemSpec[];
}

export interface StandardMenuOptions {
  appName?: string;
  about?: boolean | (() => void);
  preferences?: () => void;
  menus?: Array<{ title: string; items: MenuItemSpec[] }>;
  file?: MenuItemSpec[];
  edit?: boolean;
  view?: MenuItemSpec[];
  window?: boolean;
  help?: MenuItemSpec[];
  onQuit?: () => void;
}

/** A menu bar description the Application projects onto windows. */
export class Menu {
  readonly sections: Array<{ title: string; items: MenuItemSpec[] }> = [];

  constructor(_title = "") {}

  static from(items: MenuItemSpec[], title = ""): Menu {
    const m = new Menu(title);
    for (const i of items) m.add(i);
    return m;
  }

  add(spec: MenuItemSpec): this {
    if (this.sections.length === 0) this.sections.push({ title: "", items: [] });
    this.sections[this.sections.length - 1]!.items.push(spec);
    return this;
  }

  addSubmenu(title: string, items: MenuItemSpec[]): Menu {
    this.sections.push({ title, items });
    return this;
  }

  get itemCount(): number {
    return this.sections.reduce((n, s) => n + s.items.length, 0);
  }
}

/** Build the conventional menu bar (Windows projection of the macOS one). */
export function standardMenu(options: StandardMenuOptions = {}): Menu {
  const name = options.appName ?? "App";
  const bar = new Menu("MainMenu");

  const app: MenuItemSpec[] = [];
  if (options.about !== false) {
    app.push({
      title: `About ${name}`,
      onClick: typeof options.about === "function" ? options.about : undefined,
    });
    app.push({ separator: true, title: "" });
  }
  if (options.preferences) {
    app.push({ title: "Settings…", shortcut: "cmd+,", onClick: options.preferences });
    app.push({ separator: true, title: "" });
  }
  app.push({
    title: `Quit ${name}`,
    shortcut: "cmd+q",
    onClick: () => { options.onQuit?.(); windowsBackend.shutdown(); },
  });
  bar.addSubmenu(name, app);

  if (options.file) bar.addSubmenu("File", options.file);
  if (options.edit !== false) {
    bar.addSubmenu("Edit", [
      { title: "Undo", shortcut: "cmd+z" },
      { title: "Redo", shortcut: "cmd+shift+z" },
      { separator: true, title: "" },
      { title: "Cut", shortcut: "cmd+x" },
      { title: "Copy", shortcut: "cmd+c" },
      { title: "Paste", shortcut: "cmd+v" },
      { title: "Select All", shortcut: "cmd+a" },
    ]);
  }
  if (options.view) bar.addSubmenu("View", options.view);
  for (const m of options.menus ?? []) bar.addSubmenu(m.title, m.items);
  if (options.window !== false) {
    bar.addSubmenu("Window", [
      { title: "Minimize", shortcut: "cmd+m" },
      { title: "Zoom" },
    ]);
  }
  if (options.help) bar.addSubmenu("Help", options.help);
  return bar;
}

// Flattens a MenuItemSpec tree into "depth|label|shortcut|id" records; an
// item followed by deeper items becomes a MenuFlyoutSubItem natively.
function flattenItems(
  items: MenuItemSpec[],
  depth: number,
  handlers: Map<number, () => void>,
): string {
  const out: string[] = [];
  let nextId = 1;
  const walk = (list: MenuItemSpec[], level: number): void => {
    for (const item of list) {
      if (item.separator) {
        out.push(`${level}||0|0`);
        continue;
      }
      if (item.submenu?.length) {
        out.push(`${level}|${item.title ?? ""}||0`);
        walk(item.submenu, level + 1);
        continue;
      }
      let id = 0;
      if (item.onClick) {
        id = nextId++;
        handlers.set(id, item.onClick);
      }
      out.push(`${level}|${item.title ?? ""}|${item.shortcut ?? ""}|${id}`);
    }
  };
  walk(items, depth);
  return out.join("\x1f");
}

/** Show a context menu at the pointer over a window. */
export function popUpMenu(items: MenuItemSpec[], view?: any): void {
  const win = view instanceof Window ? view : lastWindow();
  if (!win) return;
  const handlers = new Map<number, () => void>();
  windowsBackend.popUpMenu(win.handle, flattenItems(items, 0, handlers), (itemId) => handlers.get(itemId)?.());
}

// --- application -----------------------------------------------------------------

const windowInstances: Window[] = [];

function lastWindow(): Window | null {
  return windowInstances[windowInstances.length - 1] ?? null;
}

/** Every live Window, oldest first. */
export function allWindows(): Window[] {
  return [...windowInstances];
}

// The default theme chosen via Application({ theme }); windows created after
// it open already themed (applied before show, so there is no flash).
let appTheme: Theme | null = null;

function themeCode(theme: Theme | null): number {
  return theme === "light" ? 1 : theme === "dark" ? 2 : 0;
}

export class Application {
  constructor(private opts: {
    name?: string;
    theme?: Theme;
    menu?: false | StandardMenuOptions | Menu;
    onReady?: (app: Application) => void | Promise<void>;
    onQuit?: () => void | Promise<void>;
    exitOnQuit?: boolean;
  } = {}) {
    appTheme = opts.theme ?? null;
  }

  async run(): Promise<void> {
    await windowsBackend.init();
    this.installMenu();
    // Re-apply in case windows predate the Application or the theme changed
    // between construction and run; idempotent.
    if (appTheme !== null) {
      for (const handle of windowsBackend.allWindows) {
        windowsBackend.setControlTheme(handle, themeCode(appTheme));
      }
    }
    if (this.opts.onReady) await this.opts.onReady(this);
    // pumpBlocking sleeps in the DLL until a native event arrives, so an
    // idle app spends ~0% CPU instead of polling every 2 ms.
    while (windowsBackend.isRunning()) {
      windowsBackend.pumpBlocking();
      await Bun.sleep(0);
    }
    windowsBackend.shutdown();
    if (this.opts.onQuit) await this.opts.onQuit();
    if ((this.opts as any).exitOnQuit !== false) process.exit(0);
  }

  /** Project the app menu onto every open window's menu bar. */
  private installMenu(): void {
    const menu = this.opts.menu;
    if (!menu) return;
    const bar = menu instanceof Menu
      ? menu
      : standardMenu({ ...menu, appName: menu.appName ?? this.opts.name });
    if (bar.sections.length === 0) return;

    const handlers = new Map<number, () => void>();
    const sections: string[] = [];
    for (const section of bar.sections) {
      if (section.items.length === 0) continue;
      // Title field first, then the flattened depth-prefixed items.
      sections.push((section.title || "Menu") + "\x1f" + flattenItems(section.items, 0, handlers));
    }
    const spec = sections.join("\x1e");
    for (const win of windowsBackend.allWindows) {
      windowsBackend.setMenu(win, spec, (itemId) => handlers.get(itemId)?.());
    }
  }

  quit(): void { windowsBackend.shutdown(); }
  get running(): boolean { return windowsBackend.isRunning(); }
}

export class Window {
  readonly handle: NativeHandle;
  constructor(opts: { title?: string; size?: { width: number; height: number }; minSize?: { width: number; height: number }; content?: any; show?: boolean; onClose?: () => void } = {}) {
    this.handle = windowsBackend.createWindow({ title: opts.title, size: opts.size });
    if (opts.minSize) windowsBackend.setWindowMinSize(this.handle, opts.minSize);
    if (opts.content) this.content = opts.content;
    if (opts.onClose) windowsBackend.setWindowCloseCallback(this.handle, opts.onClose);
    // Inherit the Application theme before the first frame, so the window
    // opens already in it instead of flashing the system theme.
    if (appTheme !== null) {
      windowsBackend.setControlTheme(this.handle, themeCode(appTheme));
    }
    windowInstances.push(this);
    if (opts.show !== false) this.show();
  }
  show(): this { windowsBackend.showWindow(this.handle); return this; }
  close(): void { windowsBackend.closeWindow(this.handle); }
  quitOnClose(): this { windowsBackend.setWindowCloseCallback(this.handle, () => windowsBackend.shutdown()); return this; }
  set content(v: any) { const h: NativeHandle | null = v?.handle ?? v ?? null; if (h) windowsBackend.setWindowContent(this.handle, h); }
  set title(v: string) { windowsBackend.setWindowTitle(this.handle, v); }
  get native(): any { return tolerantProxy("win.native"); }
}

// --- controls ---------------------------------------------------------------------

export class Label extends View {
  constructor(opts: { text?: string; color?: string; font?: any; align?: string; grow?: number } & ViewOptions = {}) {
    super(windowsBackend.createLabel(opts as any), opts);
  }
  get text(): string { return windowsBackend.getLabelText(this.handle); }
  set text(v: string) { windowsBackend.setLabelText(this.handle, v ?? ""); }
}

export class Button extends View {
  constructor(opts: { title?: string; primary?: boolean; destructive?: boolean; symbol?: string; onClick?: () => void } & ViewOptions = {}) {
    super(windowsBackend.createButton(opts), opts);
    if (opts.onClick) windowsBackend.setButtonClickCallback(this.handle, opts.onClick);
  }
  set title(v: string) { windowsBackend.setButtonText(this.handle, v); }
  onClick(fn: () => void): this { windowsBackend.setButtonClickCallback(this.handle, fn); return this; }
}

export class TextField extends View {
  secure: boolean;
  constructor(opts: { value?: string; placeholder?: string; secure?: boolean; textColor?: string; placeholderColor?: string; onChange?: (v: string) => void; onSubmit?: (v: string) => void } & ViewOptions = {}) {
    super(windowsBackend.createTextField({ value: opts.value, placeholder: opts.placeholder, secure: opts.secure, onChange: opts.onChange }), opts);
    this.secure = !!opts.secure;
    if (opts.textColor !== undefined || opts.placeholderColor !== undefined) {
      windowsBackend.setTextFieldColors(this.handle, opts.textColor, opts.placeholderColor);
    }
    if (opts.onSubmit) this.onSubmit(opts.onSubmit);
  }
  get value(): string { return windowsBackend.getTextFieldValue(this.handle); }
  set value(v: string) { windowsBackend.setTextFieldValue(this.handle, v ?? ""); }
  onChange(fn: (v: string) => void): this { windowsBackend.setTextFieldChangeCallback(this.handle, fn); return this; }
  onSubmit(fn: (v: string) => void): this {
    if (this.secure) windowsBackend.setPasswordSubmitCallback(this.handle, fn);
    else windowsBackend.setTextFieldSubmitCallback(this.handle, fn);
    return this;
  }
}

export class Checkbox extends View {
  constructor(opts: { title?: string; checked?: boolean; onChange?: (checked: boolean) => void } & ViewOptions = {}) {
    super(windowsBackend.createCheckbox(opts), opts);
  }
  get checked(): boolean { return windowsBackend.getCheckboxChecked(this.handle); }
  set checked(value: boolean) { windowsBackend.setCheckboxChecked(this.handle, value); }
  onChange(fn: (checked: boolean) => void): this { windowsBackend.setCheckboxCallback(this.handle, fn); return this; }
}

export class Switch extends View {
  constructor(opts: { on?: boolean; onChange?: (on: boolean) => void } & ViewOptions = {}) {
    super(windowsBackend.createSwitch(opts), opts);
  }
  get on(): boolean { return windowsBackend.getSwitchOn(this.handle); }
  set on(value: boolean) { windowsBackend.setSwitchOn(this.handle, value); }
  onChange(fn: (on: boolean) => void): this { windowsBackend.setSwitchCallback(this.handle, fn); return this; }
}

export class Slider extends View {
  constructor(opts: { min?: number; max?: number; value?: number; onChange?: (value: number) => void } & ViewOptions = {}) {
    super(windowsBackend.createSlider(opts), opts);
  }
  get value(): number { return windowsBackend.getSliderValue(this.handle); }
  set value(value: number) { windowsBackend.setSliderValue(this.handle, value); }
  onChange(fn: (value: number) => void): this { windowsBackend.setSliderCallback(this.handle, fn); return this; }
}

export class Select extends View {
  constructor(opts: { items?: readonly string[]; selected?: number; onChange?: (index: number, title: string) => void } & ViewOptions = {}) {
    super(windowsBackend.createSelect(opts), opts);
  }
  set items(value: readonly string[]) { windowsBackend.setSelectItems(this.handle, value, this.selectedIndex); }
  get selectedIndex(): number { return windowsBackend.getSelectSelected(this.handle); }
  set selectedIndex(value: number) { windowsBackend.setSelectSelected(this.handle, value); }
  get selectedTitle(): string { return windowsBackend.getSelectTitle(this.handle); }
  onChange(fn: (index: number, title: string) => void): this { windowsBackend.setSelectCallback(this.handle, fn); return this; }
}

export class Segmented extends View {
  constructor(opts: { items?: readonly string[]; selected?: number; onChange?: (index: number) => void } & ViewOptions = {}) {
    super(windowsBackend.createSegmented(opts), opts);
    if (opts.onChange) windowsBackend.setSegmentedCallback(this.handle, opts.onChange);
  }
  get selectedIndex(): number { return windowsBackend.getSegmentedSelected(this.handle); }
  set selectedIndex(i: number) { windowsBackend.setSegmentedSelected(this.handle, i); }
  onChange(fn: (index: number) => void): this { windowsBackend.setSegmentedCallback(this.handle, fn); return this; }
}

export class TextArea extends View {
  constructor(opts: { value?: string; editable?: boolean; richText?: boolean; font?: any; textColor?: string; onChange?: (value: string) => void } & ViewOptions = {}) {
    super(windowsBackend.createTextAreaEx(!!opts.richText), opts);
    if (opts.value !== undefined) this.value = opts.value;
    if (opts.editable === false) windowsBackend.setTextAreaReadOnly(this.handle, true);
    if (opts.font) windowsBackend.setTextAreaFont(this.handle, !!opts.font.monospace, opts.font.size ?? 0);
    if (opts.textColor !== undefined) windowsBackend.setTextAreaForeground(this.handle, opts.textColor);
    if (opts.onChange) windowsBackend.setTextAreaCallback(this.handle, opts.onChange);
  }
  get value(): string { return windowsBackend.getTextAreaValue(this.handle); }
  set value(value: string) { windowsBackend.setTextAreaValue(this.handle, value); }
  onChange(fn: (value: string) => void): this { windowsBackend.setTextAreaCallback(this.handle, fn); return this; }
  get textView(): any { return tolerantProxy("TextArea.textView"); }
}

export class Progress extends View {
  constructor(opts: { max?: number; value?: number; indeterminate?: boolean; spinner?: boolean } & ViewOptions = {}) {
    super(windowsBackend.createProgress(opts.spinner ? { indeterminate: true } : opts), opts);
  }
  get value(): number { return windowsBackend.getProgressValue(this.handle); }
  set value(value: number) { windowsBackend.setProgressValue(this.handle, value); }
}

export class Separator extends View {
  constructor(orientation = 0) { super(windowsBackend.createSeparator(orientation === 0)); }
}

export class Spacer extends View {
  constructor(_options: { min?: number } = {}) {
    super(windowsBackend.createSpacer());
    this.grow = 1;
  }
}

export class GroupBox extends View {
  readonly contentStack: VStack;
  constructor(opts: { title?: string; padding?: number; spacing?: number } & ViewOptions = {}, children: any[] = []) {
    super(windowsBackend.createGroupBox(opts), opts);
    this.contentStack = new VStack({ spacing: opts.spacing ?? 8 }, children);
    windowsBackend.setGroupBoxContent(this.handle, this.contentStack.handle);
  }
  add(child: any): this {
    this.contentStack.add(child);
    return this;
  }
}

// --- layout containers ---------------------------------------------------------------

export interface StackOptions extends ViewOptions {
  spacing?: number;
  /** Uniform padding, or per-edge. */
  padding?: number | any;
  /** Cross-axis alignment: "leading" | "center" | "trailing" | "fill". */
  align?: "leading" | "center" | "trailing" | "fill";
  /**
   * Scroll instead of clipping when the content outgrows the available
   * space. `true` scrolls the stack's own axis (a row scrolls horizontally,
   * a column vertically); pass axes explicitly to scroll both.
   */
  scroll?: boolean | { horizontal?: boolean; vertical?: boolean };
}

export class Stack extends View {
  constructor(orientation: 0 | 1, opts: StackOptions = {}, children: any[] = []) {
    // scroll: true scrolls the main axis; explicit axes scroll each side.
    let scrollFlags = 0;
    if (opts.scroll) {
      const horizontal = orientation === 1;
      const wantH = opts.scroll === true ? horizontal : opts.scroll.horizontal === true;
      const wantV = opts.scroll === true ? !horizontal : opts.scroll.vertical === true;
      scrollFlags = (wantH ? 1 : 0) | (wantV ? 2 : 0);
    }
    super(windowsBackend.createStack(orientation, opts as any, scrollFlags), opts);
    for (const c of children) this.add(c);
  }
  add(child: any): this {
    const h: NativeHandle = child?.handle ?? child;
    const g: number = child?.grow ?? 0;
    windowsBackend.stackAddChild(this.handle, h, g);
    this._children.push(child);
    child._parent = this;
    return this;
  }
  remove(child: any): this {
    windowsBackend.stackRemoveChild(this.handle, child?.handle ?? child);
    const i = this._children.indexOf(child);
    if (i >= 0) this._children.splice(i, 1);
    if (child) child._parent = null;
    return this;
  }
  removeAll(): this {
    for (const c of [...this._children]) this.remove(c);
    return this;
  }
  set spacing(_v: number) { /* spacing is fixed at creation on Windows */ }
}

export class VStack extends Stack {
  constructor(opts: StackOptions = {}, children: any[] = []) {
    super(0, opts, children);
  }
}

export class HStack extends Stack {
  constructor(opts: StackOptions = {}, children: any[] = []) {
    super(1, opts, children);
  }
}

export interface ScrollOptions extends ViewOptions {
  horizontal?: boolean;
  vertical?: boolean;
  border?: boolean;
}

/** A scrolling container around a single content view. */
export class ScrollView extends View {
  #content: any = null;
  constructor(opts: ScrollOptions = {}, content?: any) {
    super(windowsBackend.createScrollView(opts), { ...opts, minHeight: opts.minHeight ?? 80 });
    if (content) this.content = content;
  }
  get content(): any { return this.#content; }
  set content(v: any) {
    this.#content = v;
    if (v) windowsBackend.setScrollViewContent(this.handle, v.handle ?? v);
  }
  scrollToTop(): void { windowsBackend.scrollScrollViewTo(this.handle, 0); }
  scrollToBottom(): void { windowsBackend.scrollScrollViewTo(this.handle, 1); }
}

/** A plain container. Children stack vertically — absolute positioning has no
 *  WinUI equivalent without a canvas, so macOS frames are not honored. */
export class Container extends View {
  constructor(opts: ViewOptions = {}, children: any[] = []) {
    super(windowsBackend.createContainer(), opts);
    for (const c of children) this.add(c);
  }
  add(child: any): this {
    windowsBackend.containerAdd(this.handle, child.handle ?? child);
    this._children.push(child);
    child._parent = this;
    return this;
  }
}

export interface SplitOptions extends ViewOptions {
  vertical?: boolean;
  position?: number;
  thickness?: number;
}

export class SplitView extends View {
  #content: any = null;
  constructor(opts: SplitOptions = {}, panes: any[] = []) {
    super(windowsBackend.createSplitView(), opts);
    if (panes[0] !== undefined) windowsBackend.setSplitViewPane(this.handle, panes[0].handle ?? panes[0]);
    if (panes[1] !== undefined) this.setContent(panes[1]);
    for (const extra of panes.slice(2)) this.addPane(extra);
    if (opts.position !== undefined) this.setPosition(opts.position);
  }
  setPane(v: any): this {
    windowsBackend.setSplitViewPane(this.handle, v.handle ?? v);
    return this;
  }
  setContent(v: any): this {
    this.#content = v;
    windowsBackend.setSplitViewContent(this.handle, v.handle ?? v);
    return this;
  }
  addPane(v: any): this {
    // SplitView holds one pane + one content area; extra panes join content.
    if (!this.#content) { this.setContent(v); return this; }
    windowsBackend.addSplitViewPane(this.handle, v.handle ?? v);
    this._children.push(v);
    v._parent = this;
    return this;
  }
  setPosition(points: number): void { windowsBackend.setSplitViewPosition(this.handle, points); }
}

export interface ImageOptions extends ViewOptions {
  /** File path or http(s) URL. */
  src?: string;
  scaling?: number;
}

export class ImageView extends View {
  #src: string;
  constructor(opts: ImageOptions = {}) {
    super(windowsBackend.createImageView(opts.src ?? ""), opts);
    this.#src = opts.src ?? "";
  }
  get src(): string { return this.#src; }
  set src(v: string) {
    this.#src = v;
    if (v) windowsBackend.setImageSource(this.handle, v);
  }
}

export function loadImage(_src: string | any): any {
  // On Windows the path crosses the ABI directly; there is no JS image object.
  return _src;
}

export interface BlurOptions extends ViewOptions {
  material?: number;
  blending?: number;
}

/** A translucent "vibrancy" background (Acrylic), as used by sidebars and HUDs. */
export class BlurView extends View {
  constructor(opts: BlurOptions = {}, content?: any) {
    super(windowsBackend.createBlurView(), opts);
    if (content) windowsBackend.setBlurViewContent(this.handle, content.handle ?? content);
  }
}

// --- table -----------------------------------------------------------------------------

export interface TableColumn<Row = any> {
  id: string;
  title: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  align?: "left" | "center" | "right";
  flex?: boolean;
  value?: (row: Row, index: number) => string;
  /** Produce a whole view for the cell; wins over `value`. */
  render?: (row: Row, index: number) => any;
}

export interface TableOptions<Row = any> extends ViewOptions {
  columns: TableColumn<Row>[];
  rows?: Row[];
  onSelect?: (row: Row | null, index: number) => void;
  onDoubleClick?: (row: Row, index: number) => void;
  rowHeight?: number;
  headers?: boolean;
  alternatingRows?: boolean;
  multiSelect?: boolean;
  font?: any;
}

export class Table<Row = any> extends View {
  #rows: Row[] = [];
  #columns: TableColumn<Row>[];
  #onSelect?: (row: Row | null, index: number) => void;
  #onDoubleClick?: (row: Row, index: number) => void;
  // Rendered cell views handed to the native table; keep them reachable.
  #cellViews = new Set<any>();

  constructor(opts: TableOptions<Row>) {
    super(windowsBackend.createTableEx(opts), opts);
    this.#columns = opts.columns;
    this.#rows = opts.rows ?? [];
    this.#onSelect = opts.onSelect;
    this.#onDoubleClick = opts.onDoubleClick;
    windowsBackend.setTableCallbacks(
      this.handle,
      (index) => this.#onSelect?.(index >= 0 ? (this.#rows[index] ?? null) : null, index),
      (index) => {
        const row = this.#rows[index];
        if (row !== undefined) this.#onDoubleClick?.(row, index);
      },
    );
    this.reload();
  }

  #cells(): string[][] {
    return this.#rows.map((row, i) =>
      this.#columns.map((c) => {
        if (c.render) {
          const view = c.render(row, i);
          if (view?.handle !== undefined) {
            this.#cellViews.add(view);
            return "\x01" + view.handle.toString();
          }
          return "";
        }
        return c.value ? c.value(row, i) : String((row as any)?.[c.id] ?? "");
      }),
    );
  }

  get rows(): Row[] { return this.#rows; }
  set rows(v: Row[]) { this.#rows = v ?? []; this.reload(); }

  reload(): void {
    this.#cellViews.clear();
    windowsBackend.setTableRows(this.handle, this.#cells(), this.selectedIndex);
  }

  reloadRow(_index: number): void { this.reload(); }

  append(row: Row): void { this.#rows.push(row); this.reload(); }
  removeAt(index: number): void { this.#rows.splice(index, 1); this.reload(); }

  get selectedIndex(): number { return windowsBackend.getTableSelected(this.handle); }
  get selected(): Row | null { const i = this.selectedIndex; return i >= 0 ? (this.#rows[i] ?? null) : null; }

  get selectedIndexes(): number[] {
    const count = windowsBackend.tableSelectedCount(this.handle);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const at = windowsBackend.tableSelectedAt(this.handle, i);
      if (at >= 0) out.push(at);
    }
    return out;
  }

  select(index: number): void {
    // The native SelectionChanged this raises mirrors macOS, where
    // selectRowIndexes: also notifies the delegate.
    windowsBackend.selectTableRow(this.handle, index);
  }

  onSelect(fn: (row: Row | null, index: number) => void): this { this.#onSelect = fn; return this; }
}

// --- dialogs -----------------------------------------------------------------------------

export interface AlertOptions {
  title: string;
  message?: string;
  buttons?: string[];
  window?: Window;
  suppressible?: boolean;
}

export interface AlertResult {
  button: number;
  title: string;
  suppressed: boolean;
}

export function alert(opts: AlertOptions): Promise<AlertResult> {
  return windowsBackend.alert({ ...opts, window: opts.window?.handle });
}

export async function confirm(
  title: string,
  message?: string,
  opts: { confirmLabel?: string; cancelLabel?: string; window?: Window; destructive?: boolean } = {},
): Promise<boolean> {
  const r = await windowsBackend.alert({
    title,
    message,
    buttons: [opts.confirmLabel ?? "OK", opts.cancelLabel ?? "Cancel"],
    window: opts.window?.handle,
  });
  return r.button === 0;
}

export function prompt(title: string, opts: { message?: string; value?: string; placeholder?: string; window?: Window } = {}): Promise<string | null> {
  return windowsBackend.prompt({ title, ...opts, window: opts.window?.handle });
}

export function openFile(opts: { title?: string; multiple?: boolean; types?: string[]; chooseDirectories?: boolean; window?: Window } = {}): Promise<string[]> {
  return windowsBackend.openFile({ ...opts, window: opts.window?.handle });
}

// --- theme -----------------------------------------------------------------------------

export type Theme = "default" | "light" | "dark";

/** Applies a light/dark theme to every live window's content subtree. The
 *  root is repainted with the standard page background; pass
 *  `opts.background` (hex) to choose the colour used for that mode instead. */
export function setTheme(theme: Theme, opts?: { background?: string }): void {
  appTheme = theme;
  const code = themeCode(theme);
  for (const handle of windowsBackend.allWindows) {
    windowsBackend.setControlTheme(handle, code, opts?.background);
  }
}

// --- clipboard ---------------------------------------------------------------------

/** Plain text onto the system clipboard. */
export function setClipboardText(text: string): void {
  windowsBackend.setClipboardText(text);
}

/** Plain text from the system clipboard ("" when empty or non-text). */
export function getClipboardText(): string {
  return windowsBackend.getClipboardText();
}

export function saveFile(opts: { title?: string; defaultName?: string; window?: Window } = {}): Promise<string | null> {
  return windowsBackend.saveFile({ defaultName: opts.defaultName, window: opts.window?.handle });
}

/** No notification centre is reachable from an unpackaged process; this is
 *  best-effort on macOS too, where it returns false without a bundle id. */
export function notify(_title: string, _body?: string): boolean {
  return false;
}

export function beep(): void { windowsBackend.beep(); }

// --- input ---------------------------------------------------------------------------------

export interface MouseState {
  x: number;
  y: number;
  dx: number;
  dy: number;
  wheelX: number;
  wheelY: number;
  buttons: Set<number>;
  inside: boolean;
}

// Virtual-key codes to position-based names, matching the macOS KEY_NAMES
// contract (W stays "w" on AZERTY, numpad/arrows named by position).
const VK_NAMES: Record<number, string> = {
  0x08: "delete", 0x09: "tab", 0x0d: "return", 0x10: "shift", 0x11: "control",
  0x12: "option", 0x14: "capslock", 0x1b: "escape", 0x20: "space",
  0x25: "left", 0x26: "up", 0x27: "right", 0x28: "down", 0x2e: "forwarddelete",
  0x5b: "command", 0x5c: "command",
  0x60: "numpad0", 0x61: "numpad1", 0x62: "numpad2", 0x63: "numpad3",
  0x64: "numpad4", 0x65: "numpad5", 0x66: "numpad6", 0x67: "numpad7",
  0x68: "numpad8", 0x69: "numpad9",
  0x6a: "numpad*", 0x6b: "numpad+", 0x6d: "numpad-", 0x6e: "numpad.",
  0x6f: "numpad/",
  0x70: "f1", 0x71: "f2", 0x72: "f3", 0x73: "f4", 0x74: "f5", 0x75: "f6",
  0x76: "f7", 0x77: "f8", 0x78: "f9", 0x79: "f10", 0x7a: "f11", 0x7b: "f12",
};
for (let c = 0x41; c <= 0x5a; c++) VK_NAMES[c] = String.fromCharCode(c).toLowerCase();
for (let d = 0x30; d <= 0x39; d++) VK_NAMES[d] = String.fromCharCode(d);

const NAME_VK: Record<string, number> = {};
for (const [vk, name] of Object.entries(VK_NAMES)) {
  if (!(name in NAME_VK)) NAME_VK[name] = Number(vk);
}

export type KeyHandler = (key: string, event?: any) => void;

export class Input {
  #downAt = new Map<string, number>();
  #upAt = new Map<string, number>();
  #keyDown: KeyHandler[] = [];
  #keyUp: KeyHandler[] = [];
  #tracked: Window | null = null;
  #started = false;
  #mouseX = 0;
  #mouseY = 0;
  #dx = 0;
  #dy = 0;
  #motionTick = -1;
  #buttons = new Set<number>();

  /** Report mouse position relative to this window. */
  track(view: any): this {
    this.#tracked = view instanceof Window ? view : lastWindow();
    return this;
  }

  /** Is this key down right now? Global — works without focus. */
  held(key: string): boolean {
    const vk = NAME_VK[key.toLowerCase()];
    return vk !== undefined && windowsBackend.asyncKeyState(vk);
  }

  /** Did it go down during this frame? Needs a focused window (see start()). */
  pressed(key: string): boolean {
    this.#ensureHooked();
    return this.#downAt.get(key.toLowerCase()) === windowsBackend.tick;
  }

  /** Did it come up during this frame? */
  released(key: string): boolean {
    this.#ensureHooked();
    return this.#upAt.get(key.toLowerCase()) === windowsBackend.tick;
  }

  get keys(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const [name, vk] of Object.entries(NAME_VK)) {
      if (windowsBackend.asyncKeyState(vk)) out.add(name);
    }
    return out;
  }

  get shift(): boolean { return this.held("shift"); }
  get control(): boolean { return this.held("control"); }
  get option(): boolean { return this.held("option"); }
  get command(): boolean { return this.held("command"); }

  get mouse(): MouseState {
    const local = this.#tracked
      ? windowsBackend.readMouseLocal(this.#tracked.handle)
      : null;
    const global = windowsBackend.readMouse();
    const x = local ? local.x : global.x;
    const y = local ? local.y : global.y;

    const current = windowsBackend.tick;
    if (this.#motionTick !== current) {
      this.#motionTick = current;
      this.#dx = 0;
      this.#dy = 0;
    }
    this.#dx += x - this.#mouseX;
    this.#dy += y - this.#mouseY;
    this.#mouseX = x;
    this.#mouseY = y;

    const raw = global.buttons;
    this.#buttons = new Set([0, 1, 2, 3, 4].filter((b) => (raw & (1 << b)) !== 0));
    return {
      x, y,
      dx: this.#dx,
      dy: this.#dy,
      wheelX: 0, // would need a message hook; see WINDOWS.md
      wheelY: 0,
      buttons: this.#buttons,
      inside: local ? local.inside : true,
    };
  }

  /** Is this mouse button down? 0 is left, 1 is right. */
  button(index = 0): boolean {
    const raw = windowsBackend.readMouse().buttons;
    return (raw & (1 << index)) !== 0;
  }

  onKeyDown(fn: KeyHandler): this { this.#keyDown.push(fn); return this; }
  onKeyUp(fn: KeyHandler): this { this.#keyUp.push(fn); return this; }
  onScroll(_fn: (dx: number, dy: number, event?: any) => void): this { return this; }

  /** @internal Attach to the newest window. Called once, by input(). */
  start(): this {
    if (this.#started) return this;
    this.#started = true;
    this.#hook();
    return this;
  }

  stop(): this { this.#started = false; return this; }

  #ensureHooked(): void {
    if (!this.#started) this.start();
  }

  #hook(): void {
    const win = this.#tracked ?? lastWindow();
    if (!win) {
      // No window yet: retry on the next query.
      this.#started = false;
      return;
    }
    windowsBackend.trackInput(win.handle, (vkey, down) => {
      const key = VK_NAMES[vkey];
      if (!key) return;
      const tick = windowsBackend.tick;
      if (down) {
        this.#downAt.set(key, tick);
        for (const fn of this.#keyDown) fn(key);
      } else {
        this.#upAt.set(key, tick);
        for (const fn of this.#keyUp) fn(key);
      }
    });
  }
}

let shared: Input | null = null;

/** The application's input state. Call `.track(window)` for local mouse coords. */
export function input(): Input {
  if (!shared) shared = new Input().start();
  return shared;
}

// --- snapshot / debug -------------------------------------------------------------------------

export function snapshotView(view: any, path: string): number {
  const bytes = windowsBackend.snapshotView(view.handle ?? view, path);
  if (bytes < 0) throw new Error(`snapshot failed with code ${bytes}`);
  return bytes;
}

export function snapshotWindow(window: any, path: string): number {
  return snapshotView({ handle: window.handle ?? window }, path);
}

export function describeViewTree(root: any): string {
  return windowsBackend.describeTree(root.handle ?? root);
}

export interface LayoutViolation {
  view: string;
  parent: string;
  detail: string;
}

export function checkLayout(root: any, _options: { tolerance?: number } = {}): LayoutViolation[] {
  const raw = windowsBackend.checkLayoutRaw(root.handle ?? root);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [view, parent, detail] = line.split("\x1f");
    return { view: view ?? "", parent: parent ?? "", detail: detail ?? "" };
  });
}

// --- layer-2 helpers -----------------------------------------------------------------------------

/** Wrap a callback as an action target; on Windows this is a plain closure. */
export function actionTarget(fn: () => void): any {
  return { fire: fn, dispose(): void {} };
}

export const ACTION_SELECTOR = "brAction:";

/** macOS builds an NSFont; the Windows side passes the spec through. */
export function makeFont(spec: any): any {
  return spec;
}

/** macOS converts to NSColor; the Windows side passes the string through. */
export function toNSColor(v: any): any {
  return v;
}

export const SIZE_PRIORITY = 999;

// Obj-C escape hatch: only the calls the examples actually make have a Windows
// story; everything else no-ops through the tolerant proxy.
export const objc = new Proxy({} as any, {
  get(_t, prop: string) {
    if (prop === "NSProcessInfo") {
      return {
        processInfo: () => ({
          processName: () => process.argv[0]?.replace(/\\/g, "/").split("/").pop() ?? "bun",
        }),
      };
    }
    return tolerantProxy(`objc.${String(prop)}`);
  },
});
