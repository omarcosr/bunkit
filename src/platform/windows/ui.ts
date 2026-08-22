// src/platform/windows/ui.ts — public API over the Windows backend.
import { windowsBackend } from "./backend.ts";
import type { NativeHandle } from "./ffi.ts";

export type View = Label | Button | TextField | Checkbox | Switch | Slider | Select | TextArea | Progress | Separator | Spacer | VStack | HStack | GroupBox | Segmented | Table;

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

export class Application {
  constructor(private opts: {
    name?: string;
    menu?: any;
    onReady?: (app: Application) => void | Promise<void>;
    onQuit?: () => void | Promise<void>;
    exitOnQuit?: boolean;
  } = {}) {}

  async run(): Promise<void> {
    await windowsBackend.init();
    this.installMenu();
    if (this.opts.onReady) await this.opts.onReady(this);
    while (windowsBackend.isRunning()) {
      windowsBackend.pump();
      await Bun.sleep(2);
    }
    windowsBackend.shutdown();
    if (this.opts.onQuit) await this.opts.onQuit();
    if ((this.opts as any).exitOnQuit !== false) process.exit(0);
  }

  /** Project the macOS app menu onto every open window's menu bar. */
  private installMenu(): void {
    const menu = this.opts.menu;
    if (!menu || menu === false) return;
    const handlers = new Map<number, () => void>();
    let nextId = 1;
    const sections: string[] = [];

    const pushItems = (title: string, items: any[]) => {
      const fields = [title];
      for (const item of items) {
        if (item && item.separator) {
          fields.push("|0|0");
        } else if (item) {
          const id = nextId++;
          handlers.set(id, item.onClick);
          fields.push(`${item.title ?? ""}|${item.shortcut ?? ""}|${id}`);
        }
      }
      sections.push(fields.join("\x1f"));
    };

    if (menu.file) pushItems("File", menu.file);
    if (typeof menu.preferences === "function") {
      const id = nextId++;
      handlers.set(id, menu.preferences);
      sections.push(["Preferences", `Preferences...|cmd+,|${id}`].join("\x1f"));
    } else if (Array.isArray(menu.preferences)) {
      pushItems("Preferences", menu.preferences);
    }

    if (sections.length === 0) return;
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
    if (opts.show !== false) this.show();
  }
  show(): this { windowsBackend.showWindow(this.handle); return this; }
  close(): void { windowsBackend.closeWindow(this.handle); }
  quitOnClose(): this { windowsBackend.setWindowCloseCallback(this.handle, () => windowsBackend.shutdown()); return this; }
  set content(v: any) { const h: NativeHandle | null = v?.handle ?? v ?? null; if (h) windowsBackend.setWindowContent(this.handle, h); }
  set title(v: string) { windowsBackend.setWindowTitle(this.handle, v); }
  get native(): any { return tolerantProxy("win.native"); }
}

export class Label {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { text?: string; color?: string; font?: any; align?: string; width?: number; height?: number; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createLabel(opts as any);
  }
  get text(): string { return windowsBackend.getLabelText(this.handle); }
  set text(v: string) { windowsBackend.setLabelText(this.handle, v ?? ""); }
}

export class Button {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { title?: string; primary?: boolean; destructive?: boolean; symbol?: string; onClick?: () => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createButton(opts);
  }
  set title(v: string) { windowsBackend.setButtonText(this.handle, v); }
  onClick(fn: () => void): this { windowsBackend.setButtonClickCallback(this.handle, fn); return this; }
}

export class TextField {
  readonly handle: NativeHandle;
  grow: number;
  constructor(opts: { value?: string; placeholder?: string; secure?: boolean; onChange?: (v: string) => void; onSubmit?: () => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createTextField({ value: opts.value, placeholder: opts.placeholder, secure: opts.secure, onChange: opts.onChange });
    if (opts.onSubmit) windowsBackend.setTextFieldSubmitCallback(this.handle, opts.onSubmit);
  }
  get value(): string { return windowsBackend.getTextFieldValue(this.handle); }
  set value(v: string) { windowsBackend.setTextFieldValue(this.handle, v ?? ""); }
  onChange(fn: (v: string) => void): this { windowsBackend.setTextFieldChangeCallback(this.handle, fn); return this; }
  onSubmit(fn: () => void): this { windowsBackend.setTextFieldSubmitCallback(this.handle, fn); return this; }
}

export class Checkbox {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { title?: string; checked?: boolean; onChange?: (checked: boolean) => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createCheckbox(opts);
  }
  get checked(): boolean { return windowsBackend.getCheckboxChecked(this.handle); }
  set checked(value: boolean) { windowsBackend.setCheckboxChecked(this.handle, value); }
  onChange(fn: (checked: boolean) => void): this { windowsBackend.setCheckboxCallback(this.handle, fn); return this; }
}

export class Switch {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { on?: boolean; onChange?: (on: boolean) => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createSwitch(opts);
  }
  get on(): boolean { return windowsBackend.getSwitchOn(this.handle); }
  set on(value: boolean) { windowsBackend.setSwitchOn(this.handle, value); }
  onChange(fn: (on: boolean) => void): this { windowsBackend.setSwitchCallback(this.handle, fn); return this; }
}

export class Slider {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { min?: number; max?: number; value?: number; onChange?: (value: number) => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createSlider(opts);
  }
  get value(): number { return windowsBackend.getSliderValue(this.handle); }
  set value(value: number) { windowsBackend.setSliderValue(this.handle, value); }
  onChange(fn: (value: number) => void): this { windowsBackend.setSliderCallback(this.handle, fn); return this; }
}

export class Select {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { items?: readonly string[]; selected?: number; onChange?: (index: number, title: string) => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createSelect(opts);
  }
  set items(value: readonly string[]) { windowsBackend.setSelectItems(this.handle, value, this.selectedIndex); }
  get selectedIndex(): number { return windowsBackend.getSelectSelected(this.handle); }
  set selectedIndex(value: number) { windowsBackend.setSelectSelected(this.handle, value); }
  get selectedTitle(): string { return windowsBackend.getSelectTitle(this.handle); }
  onChange(fn: (index: number, title: string) => void): this { windowsBackend.setSelectCallback(this.handle, fn); return this; }
}

export class Segmented {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { items?: readonly string[]; selected?: number; onChange?: (index: number) => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createSegmented(opts);
    if (opts.onChange) windowsBackend.setSegmentedCallback(this.handle, opts.onChange);
  }
  get selectedIndex(): number { return windowsBackend.getSegmentedSelected(this.handle); }
  set selectedIndex(i: number) { windowsBackend.setSegmentedSelected(this.handle, i); }
  onChange(fn: (index: number) => void): this { windowsBackend.setSegmentedCallback(this.handle, fn); return this; }
}

export class TextArea {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { value?: string; editable?: boolean; font?: any; onChange?: (value: string) => void; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createTextArea({ value: opts.value, onChange: opts.onChange });
    if (opts.editable === false) windowsBackend.setTextAreaReadOnly(this.handle, true);
    if (opts.font) {
      windowsBackend.setTextAreaFont(this.handle, !!opts.font.monospace, opts.font.size ?? 0);
    }
  }
  get value(): string { return windowsBackend.getTextAreaValue(this.handle); }
  set value(value: string) { windowsBackend.setTextAreaValue(this.handle, value); }
  onChange(fn: (value: string) => void): this { windowsBackend.setTextAreaCallback(this.handle, fn); return this; }
  get textView(): any { return tolerantProxy("TextArea.textView"); }
}

export class Progress {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { max?: number; value?: number; indeterminate?: boolean; spinner?: boolean; width?: number; height?: number; grow?: number } = {}) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createProgress(opts.spinner ? { indeterminate: true } : opts);
  }
  get value(): number { return windowsBackend.getProgressValue(this.handle); }
  set value(value: number) { windowsBackend.setProgressValue(this.handle, value); }
}

export class Separator {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(orientation = 0) { this.handle = windowsBackend.createSeparator(orientation === 0); }
}

export class Spacer {
  readonly handle: NativeHandle;
  grow = 1;
  constructor() { this.handle = windowsBackend.createSpacer(); }
}

export class GroupBox {
  readonly handle: NativeHandle;
  grow = 0;
  constructor(opts: { title?: string; padding?: number; grow?: number } = {}, children: any[] = []) {
    this.grow = opts.grow ?? 0;
    this.handle = windowsBackend.createGroupBox(opts);
    if (children.length === 1) {
      windowsBackend.setGroupBoxContent(this.handle, children[0].handle ?? children[0]);
    } else if (children.length > 1) {
      const stack = new VStack({ spacing: 8 }, children);
      windowsBackend.setGroupBoxContent(this.handle, stack.handle);
    }
  }
}

export interface TableColumn<Row = any> {
  id: string;
  title: string;
  width?: number;
  align?: "left" | "center" | "right";
  flex?: boolean;
  value?: (row: Row, index: number) => string;
}

export class Table<Row = any> {
  readonly handle: NativeHandle;
  grow: number;
  #rows: Row[] = [];
  #columns: TableColumn<Row>[];
  #onSelect?: (row: Row | null, index: number) => void;
  #onDoubleClick?: (row: Row, index: number) => void;

  constructor(opts: {
    columns: TableColumn<Row>[];
    rows?: Row[];
    rowHeight?: number;
    onSelect?: (row: Row | null, index: number) => void;
    onDoubleClick?: (row: Row, index: number) => void;
    grow?: number;
    minHeight?: number;
  }) {
    this.grow = opts.grow ?? 0;
    this.#columns = opts.columns;
    this.#rows = opts.rows ?? [];
    this.#onSelect = opts.onSelect;
    this.#onDoubleClick = opts.onDoubleClick;
    this.handle = windowsBackend.createTable({ columns: opts.columns, rowHeight: opts.rowHeight });
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
      this.#columns.map((c) => (c.value ? c.value(row, i) : String((row as any)?.[c.id] ?? ""))),
    );
  }

  get rows(): Row[] { return this.#rows; }
  set rows(v: Row[]) { this.#rows = v ?? []; this.reload(); }

  reload(): void {
    windowsBackend.setTableRows(this.handle, this.#cells(), this.selectedIndex);
  }

  reloadRow(_index: number): void { this.reload(); }

  append(row: Row): void { this.#rows.push(row); this.reload(); }
  removeAt(index: number): void { this.#rows.splice(index, 1); this.reload(); }

  get selectedIndex(): number { return windowsBackend.getTableSelected(this.handle); }
  get selected(): Row | null { const i = this.selectedIndex; return i >= 0 ? (this.#rows[i] ?? null) : null; }

  select(index: number): void {
    // The native SelectionChanged this raises mirrors macOS, where
    // selectRowIndexes: also notifies the delegate.
    windowsBackend.selectTableRow(this.handle, index);
  }

  onSelect(fn: (row: Row | null, index: number) => void): this { this.#onSelect = fn; return this; }
}

export class VStack {
  readonly handle: NativeHandle;
  constructor(opts: { spacing?: number; padding?: number | any; align?: string } = {}, children: any[] = []) {
    this.handle = windowsBackend.createStack(0, opts as any);
    for (const c of children) { const h: NativeHandle = (c as any)?.handle ?? c; const g: number = (c as any)?.grow ?? 0; windowsBackend.stackAddChild(this.handle, h, g); }
  }
}

export class HStack {
  readonly handle: NativeHandle;
  constructor(opts: { spacing?: number; padding?: number | any; align?: string } = {}, children: any[] = []) {
    this.handle = windowsBackend.createStack(1, opts as any);
    for (const c of children) { const h: NativeHandle = (c as any)?.handle ?? c; const g: number = (c as any)?.grow ?? 0; windowsBackend.stackAddChild(this.handle, h, g); }
  }
}

// --- dialogs -------------------------------------------------------------------

export function alert(opts: { title: string; message?: string; buttons?: string[]; window?: Window; suppressible?: boolean }): Promise<{ button: number; title: string; suppressed: boolean }> {
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

export function openFile(opts: { title?: string; multiple?: boolean; window?: Window } = {}): Promise<string[]> {
  return windowsBackend.openFile({ ...opts, window: opts.window?.handle });
}

export function beep(): void { windowsBackend.beep(); }

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
