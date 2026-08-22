// src/platform/windows/backend.ts — implements PlatformBackend over winbridge.dll
import { winLib } from "./ffi.ts";
import * as callbacks from "./callbacks.ts";
import { dispatch as dispatchEvents, dialogResolvers, menuHandlers } from "./events.ts";

export type NativeHandle = bigint;

const enc = new TextEncoder();

function cstr(s: string): Buffer {
  return Buffer.from(enc.encode(s));
}

const buttonCbMap = new Map<bigint, bigint>();
const textCbMap = new Map<bigint, bigint>();
const advancedCbMap = new Map<bigint, bigint>();
const submitCbMap = new Map<bigint, bigint>();

// Every live window, so dialogs can find an owner and menus can reach all
// windows after the fact.
const windows: NativeHandle[] = [];
let nextDialogId = 1;

export class WindowsBackend {
  private inited = false;

  private ensureInited(): void {
    if (this.inited) return;
    const rc = winLib.bk_runtime_init() as number;
    if (rc !== 0) {
      const len = winLib.bk_last_error_length() as number;
      let msg = "bk_runtime_init failed";
      if (len > 0) {
        const buf = Buffer.alloc(len + 1);
        winLib.bk_copy_last_error(buf as any, len + 1);
        msg += ": " + buf.toString("utf8", 0, len);
      }
      throw new Error(msg);
    }
    this.inited = true;
  }

  async init(): Promise<void> {
    if (this.inited) return;
    this.ensureInited();
  }

  shutdown(): void {
    if (!this.inited) return;
    winLib.bk_runtime_shutdown();
    this.inited = false;
    callbacks.clear();
    buttonCbMap.clear();
    textCbMap.clear();
    advancedCbMap.clear();
    dialogResolvers.clear();
    menuHandlers.clear();
    windows.length = 0;
  }

  isRunning(): boolean {
    return (winLib.bk_runtime_running() as number) !== 0;
  }

  pump(): boolean {
    dispatchEvents();
    return this.isRunning();
  }

  createWindow(opts: { title?: string; size?: { width: number; height: number } }): NativeHandle {
    this.ensureInited();
    const title = opts.title ?? "";
    const b = cstr(title);
    const w = opts.size?.width ?? 0;
    const h = opts.size?.height ?? 0;
    const h2 = winLib.bk_window_create(b as any, b.length, w, h) as bigint;
    windows.push(h2);
    return h2;
  }

  setWindowMinSize(h: NativeHandle, size: { width: number; height: number }): void {
    winLib.bk_window_set_min_size(h, size.width, size.height);
  }

  setWindowTitle(h: NativeHandle, title: string): void {
    const b = cstr(title);
    winLib.bk_window_set_title(h, b as any, b.length);
  }

  showWindow(h: NativeHandle): void {
    winLib.bk_window_show(h);
  }

  closeWindow(h: NativeHandle): void {
    winLib.bk_window_close(h);
  }

  setWindowContent(win: NativeHandle, content: NativeHandle): void {
    winLib.bk_window_set_content(win, content);
  }

  setWindowCloseCallback(handle: NativeHandle, cb: (() => void) | null): void {
    // Window close uses the Closed event's callback id; store in a side map
    // and let events.ts dispatch it. For now use a global map keyed by handle.
    const map = ((globalThis as any).__bk_onWindowClosed as Map<bigint, () => void>) ?? new Map();
    (globalThis as any).__bk_onWindowClosed = map;
    if (cb) map.set(handle, cb);
    else map.delete(handle);
  }

  createLabel(opts: { text?: string; color?: string; font?: any; align?: string; width?: number; height?: number }): NativeHandle {
    this.ensureInited();
    const t = cstr(opts.text ?? "");
    const color = cstr(opts.color ?? "");
    const font = opts.font ?? {};
    const fontSize = typeof font === "number" ? font : (font.size ?? 0);
    let bits = 0;
    if (typeof font === "object") {
      if (font.weight === "semibold" || font.weight === "bold") bits |= 1;
      if (font.style === "title") bits |= 2;
      if (font.monospace) bits |= 4;
    }
    const align = opts.align === "center" ? 1 : opts.align === "right" ? 2 : 0;
    return winLib.bk_label_create_ex(
      t as any, t.length,
      color as any, color.length,
      fontSize, bits, align,
      opts.width ?? 0, opts.height ?? 0,
    ) as bigint;
  }

  setLabelText(h: NativeHandle, text: string): void {
    const b = cstr(text);
    winLib.bk_label_set_text(h, b as any, b.length);
  }

  getLabelText(h: NativeHandle): string {
    const len = winLib.bk_label_text_length(h) as number;
    if (len === 0) return "";
    const buf = Buffer.alloc(len + 1);
    winLib.bk_label_copy_text(h, buf as any, len + 1);
    return buf.toString("utf8", 0, len);
  }

  createButton(opts: { title?: string; onClick?: () => void; primary?: boolean; destructive?: boolean; symbol?: string }): NativeHandle {
    this.ensureInited();
    const t = cstr(opts.title ?? "");
    const sym = cstr(opts.symbol ?? "");
    const h = winLib.bk_button_create_ex(
      t as any, t.length,
      opts.primary ? 1 : 0, opts.destructive ? 1 : 0,
      sym as any, sym.length,
    ) as bigint;
    if (opts.onClick) this.setButtonClickCallback(h, opts.onClick);
    return h;
  }

  setButtonText(h: NativeHandle, text: string): void {
    const b = cstr(text);
    winLib.bk_button_set_text(h, b as any, b.length);
  }

  setButtonClickCallback(h: NativeHandle, cb: (() => void) | null): void {
    const prev = buttonCbMap.get(h);
    if (prev) { callbacks.unregister(prev); buttonCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register(cb);
      buttonCbMap.set(h, id);
      winLib.bk_button_set_click_callback(h, id);
    } else {
      winLib.bk_button_set_click_callback(h, 0n);
    }
  }

  createTextField(opts: { value?: string; placeholder?: string; secure?: boolean; onChange?: (v: string) => void }): NativeHandle {
    this.ensureInited();
    const ph = opts.placeholder ?? "";
    const b = cstr(ph);
    const h = winLib.bk_textbox_create(opts.secure ? 1 : 0, b as any, b.length) as bigint;
    if (opts.value) this.setTextFieldValue(h, opts.value);
    if (opts.onChange) this.setTextFieldChangeCallback(h, opts.onChange);
    return h;
  }

  setTextFieldValue(h: NativeHandle, value: string): void {
    const b = cstr(value);
    winLib.bk_textbox_set_text(h, b as any, b.length);
  }

  getTextFieldValue(h: NativeHandle): string {
    const len = winLib.bk_textbox_value_length(h) as number;
    if (len === 0) return "";
    const buf = Buffer.alloc(len + 1);
    winLib.bk_textbox_copy_value(h, buf as any, len + 1);
    return buf.toString("utf8", 0, len);
  }

  setTextFieldPlaceholder(h: NativeHandle, ph: string): void {
    const b = cstr(ph);
    winLib.bk_textbox_set_placeholder(h, b as any, b.length);
  }

  setTextFieldChangeCallback(h: NativeHandle, cb: ((v: string) => void) | null): void {
    const prev = textCbMap.get(h);
    if (prev) { callbacks.unregister(prev); textCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register(cb as any);
      textCbMap.set(h, id);
      winLib.bk_textbox_set_change_callback(h, id);
    } else {
      winLib.bk_textbox_set_change_callback(h, 0n);
    }
  }

  createCheckbox(opts: { title?: string; checked?: boolean; onChange?: (checked: boolean) => void }): NativeHandle {
    this.ensureInited();
    const title = cstr(opts.title ?? "");
    const h = winLib.bk_checkbox_create(title as any, title.length, opts.checked ? 1 : 0) as bigint;
    if (opts.onChange) this.setCheckboxCallback(h, opts.onChange);
    return h;
  }

  setCheckboxChecked(h: NativeHandle, checked: boolean): void {
    winLib.bk_checkbox_set_checked(h, checked ? 1 : 0);
  }

  getCheckboxChecked(h: NativeHandle): boolean {
    return (winLib.bk_checkbox_get_checked(h) as number) !== 0;
  }

  setCheckboxCallback(h: NativeHandle, cb: ((checked: boolean) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register((value: number) => cb(value !== 0));
      advancedCbMap.set(h, id);
      winLib.bk_checkbox_set_callback(h, id);
    } else winLib.bk_checkbox_set_callback(h, 0n);
  }

  createSwitch(opts: { on?: boolean; onChange?: (on: boolean) => void }): NativeHandle {
    this.ensureInited();
    const h = winLib.bk_switch_create(opts.on ? 1 : 0) as bigint;
    if (opts.onChange) this.setSwitchCallback(h, opts.onChange);
    return h;
  }

  setSwitchOn(h: NativeHandle, on: boolean): void {
    winLib.bk_switch_set_on(h, on ? 1 : 0);
  }

  getSwitchOn(h: NativeHandle): boolean {
    return (winLib.bk_switch_get_on(h) as number) !== 0;
  }

  setSwitchCallback(h: NativeHandle, cb: ((on: boolean) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register((value: number) => cb(value !== 0));
      advancedCbMap.set(h, id);
      winLib.bk_switch_set_callback(h, id);
    } else winLib.bk_switch_set_callback(h, 0n);
  }

  createSlider(opts: { min?: number; max?: number; value?: number; onChange?: (value: number) => void }): NativeHandle {
    this.ensureInited();
    const min = opts.min ?? 0;
    const max = opts.max ?? 1;
    const h = winLib.bk_slider_create(min, max, opts.value ?? min) as bigint;
    if (opts.onChange) this.setSliderCallback(h, opts.onChange);
    return h;
  }

  setSliderValue(h: NativeHandle, value: number): void { winLib.bk_slider_set_value(h, value); }
  getSliderValue(h: NativeHandle): number { return winLib.bk_slider_get_value(h) as number; }

  setSliderCallback(h: NativeHandle, cb: ((value: number) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register((value: number) => cb(value));
      advancedCbMap.set(h, id);
      winLib.bk_slider_set_callback(h, id);
    } else winLib.bk_slider_set_callback(h, 0n);
  }

  createSelect(opts: { items?: readonly string[]; selected?: number; onChange?: (index: number, title: string) => void }): NativeHandle {
    this.ensureInited();
    const h = winLib.bk_select_create() as bigint;
    this.setSelectItems(h, opts.items ?? [], opts.selected ?? -1);
    if (opts.onChange) this.setSelectCallback(h, opts.onChange);
    return h;
  }

  setSelectItems(h: NativeHandle, items: readonly string[], selected: number): void {
    const data = cstr(items.join("\n"));
    winLib.bk_select_set_items(h, data as any, data.length, selected);
  }

  setSelectSelected(h: NativeHandle, selected: number): void { winLib.bk_select_set_selected(h, selected); }
  getSelectSelected(h: NativeHandle): number { return winLib.bk_select_get_selected(h) as number; }

  getSelectTitle(h: NativeHandle): string {
    const len = winLib.bk_select_title_length(h) as number;
    if (len === 0) return "";
    const data = Buffer.alloc(len + 1);
    winLib.bk_select_copy_title(h, data as any, len + 1);
    return data.toString("utf8", 0, len);
  }

  setSelectCallback(h: NativeHandle, cb: ((index: number, title: string) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register((index: number, title: string) => cb(index, title));
      advancedCbMap.set(h, id);
      winLib.bk_select_set_callback(h, id);
    } else winLib.bk_select_set_callback(h, 0n);
  }

  createTextArea(opts: { value?: string; onChange?: (value: string) => void }): NativeHandle {
    this.ensureInited();
    const h = winLib.bk_textarea_create() as bigint;
    if (opts.value !== undefined) this.setTextAreaValue(h, opts.value);
    if (opts.onChange) this.setTextAreaCallback(h, opts.onChange);
    return h;
  }

  setTextAreaValue(h: NativeHandle, value: string): void {
    const data = cstr(value);
    winLib.bk_textarea_set_text(h, data as any, data.length);
  }

  getTextAreaValue(h: NativeHandle): string {
    const len = winLib.bk_textarea_value_length(h) as number;
    if (len === 0) return "";
    const data = Buffer.alloc(len + 1);
    winLib.bk_textarea_copy_value(h, data as any, len + 1);
    return data.toString("utf8", 0, len);
  }

  setTextAreaCallback(h: NativeHandle, cb: ((value: string) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register((value: string) => cb(value));
      advancedCbMap.set(h, id);
      winLib.bk_textarea_set_callback(h, id);
    } else winLib.bk_textarea_set_callback(h, 0n);
  }

  createProgress(opts: { max?: number; value?: number; indeterminate?: boolean }): NativeHandle {
    this.ensureInited();
    return winLib.bk_progress_create(opts.max ?? 1, opts.value ?? 0, opts.indeterminate ? 1 : 0) as bigint;
  }

  setProgressValue(h: NativeHandle, value: number): void { winLib.bk_progress_set_value(h, value); }
  getProgressValue(h: NativeHandle): number { return winLib.bk_progress_get_value(h) as number; }
  createSeparator(horizontal: boolean): NativeHandle { this.ensureInited(); return winLib.bk_separator_create(horizontal ? 1 : 0) as bigint; }
  createSpacer(): NativeHandle { this.ensureInited(); return winLib.bk_spacer_create() as bigint; }

  createStack(orientation: number, opts: { spacing?: number; padding?: number | { top: number; left: number; bottom: number; right: number } }): NativeHandle {
    this.ensureInited();
    const spacing = opts.spacing ?? 8;
    let pad: { top: number; left: number; bottom: number; right: number };
    if (typeof opts.padding === "number") pad = { top: opts.padding, left: opts.padding, bottom: opts.padding, right: opts.padding };
    else if (opts.padding) pad = { top: (opts.padding as any).top ?? 0, left: (opts.padding as any).left ?? 0, bottom: (opts.padding as any).bottom ?? 0, right: (opts.padding as any).right ?? 0 };
    else pad = { top: 0, left: 0, bottom: 0, right: 0 };
    return winLib.bk_stack_create(orientation, spacing, pad.left, pad.top, pad.right, pad.bottom) as bigint;
  }

  stackAddChild(stack: NativeHandle, child: NativeHandle, grow?: number): void {
    winLib.bk_stack_add_child(stack, child, grow ?? 0);
  }

  // --- composite controls -----------------------------------------------------

  createGroupBox(opts: { title?: string; padding?: number }): NativeHandle {
    this.ensureInited();
    const t = cstr(opts.title ?? "");
    return winLib.bk_groupbox_create(t as any, t.length, opts.padding ?? 0) as bigint;
  }

  setGroupBoxContent(g: NativeHandle, child: NativeHandle): void {
    winLib.bk_groupbox_set_content(g, child);
  }

  createSegmented(opts: { items?: readonly string[]; selected?: number }): NativeHandle {
    this.ensureInited();
    const items = cstr((opts.items ?? []).join("\n"));
    return winLib.bk_segmented_create(items as any, items.length, opts.selected ?? -1) as bigint;
  }

  setSegmentedSelected(h: NativeHandle, i: number): void { winLib.bk_segmented_set_selected(h, i); }
  getSegmentedSelected(h: NativeHandle): number { return winLib.bk_segmented_get_selected(h) as number; }

  setSegmentedCallback(h: NativeHandle, cb: ((index: number) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register((index: number) => cb(index));
      advancedCbMap.set(h, id);
      winLib.bk_segmented_set_callback(h, id);
    } else winLib.bk_segmented_set_callback(h, 0n);
  }

  createTable(opts: { columns: Array<{ title: string; width?: number; align?: string; flex?: boolean }>; rowHeight?: number }): NativeHandle {
    this.ensureInited();
    // "title<US>width<US>align<US>flex" records; width <= 0 = star-sized.
    const spec = opts.columns.map((c) =>
      [c.title, String(c.width ?? 0), c.align === "center" ? 1 : c.align === "right" ? 2 : 0, c.flex ? 1 : 0].join("\x1f"),
    ).join("\n");
    const b = cstr(spec);
    return winLib.bk_table_create(b as any, b.length, opts.rowHeight ?? 0) as bigint;
  }

  setTableRows(h: NativeHandle, cells: string[][], selected: number): void {
    const data = cstr(cells.map((row) => row.join("\x1f")).join("\n"));
    winLib.bk_table_set_rows(h, data as any, data.length, selected);
  }

  selectTableRow(h: NativeHandle, index: number): void { winLib.bk_table_select(h, index); }
  getTableSelected(h: NativeHandle): number { return winLib.bk_table_get_selected(h) as number; }

  setTableCallbacks(h: NativeHandle, onSelect: ((index: number) => void) | null, onDouble: ((index: number) => void) | null): void {
    const prev = advancedCbMap.get(h);
    if (prev) { callbacks.unregister(prev); advancedCbMap.delete(h); }
    const id1 = onSelect ? callbacks.register((index: number) => onSelect(index)) : 0n;
    const id2 = onDouble ? callbacks.register((index: number) => onDouble(index)) : 0n;
    if (id1) advancedCbMap.set(h, id1);
    winLib.bk_table_set_callbacks(h, id1, id2);
  }

  setTextFieldSubmitCallback(h: NativeHandle, cb: (() => void) | null): void {
    const prev = submitCbMap.get(h);
    if (prev) { callbacks.unregister(prev); submitCbMap.delete(h); }
    if (cb) {
      const id = callbacks.register(() => cb());
      submitCbMap.set(h, id);
      winLib.bk_textbox_set_submit_callback(h, id);
    } else winLib.bk_textbox_set_submit_callback(h, 0n);
  }

  setTextAreaReadOnly(h: NativeHandle, readonly: boolean): void {
    winLib.bk_textarea_set_readonly(h, readonly ? 1 : 0);
  }

  setTextAreaFont(h: NativeHandle, monospace: boolean, size: number): void {
    winLib.bk_textarea_set_font(h, monospace ? 1 : 0, size);
  }

  // --- dialogs ------------------------------------------------------------------

  private dialogOwner(window?: NativeHandle): NativeHandle {
    if (window) return window;
    return windows[windows.length - 1] ?? 0n;
  }

  private waitForDialog(id: number, start: () => void): Promise<any> {
    return new Promise((resolve) => {
      dialogResolvers.set(id, (e) => {
        dialogResolvers.delete(id);
        resolve(e);
      });
      start();
    });
  }

  async alert(opts: { title: string; message?: string; buttons?: string[]; suppressible?: boolean; window?: NativeHandle }): Promise<{ button: number; title: string; suppressed: boolean }> {
    this.ensureInited();
    const buttons = opts.buttons ?? ["OK"];
    // ContentDialog has exactly three slots; the first is the default action.
    const cfg = [opts.title, opts.message ?? "", buttons[0] ?? "", buttons[1] ?? "", buttons[2] ?? "", opts.suppressible ? "1" : "0"].join("\x1e");
    const b = cstr(cfg);
    const id = nextDialogId++;
    const e = await this.waitForDialog(id, () => {
      winLib.bk_dialog_alert(this.dialogOwner(opts.window), b as any, b.length, BigInt(id));
    });
    const button = e.value1 >= 0 ? e.value1 : 2;
    return { button, title: buttons[button] ?? "", suppressed: e.value2 === 1 };
  }

  async prompt(opts: { title: string; message?: string; value?: string; placeholder?: string; window?: NativeHandle }): Promise<string | null> {
    this.ensureInited();
    const cfg = [opts.title, opts.message ?? "", opts.placeholder ?? "", opts.value ?? ""].join("\x1e");
    const b = cstr(cfg);
    const id = nextDialogId++;
    const e = await this.waitForDialog(id, () => {
      winLib.bk_dialog_prompt(this.dialogOwner(opts.window), b as any, b.length, BigInt(id));
    });
    return e.value1 === 0 ? e.text : null;
  }

  async openFile(opts: { title?: string; multiple?: boolean; window?: NativeHandle }): Promise<string[]> {
    this.ensureInited();
    const t = cstr(opts.title ?? "");
    const id = nextDialogId++;
    const e = await this.waitForDialog(id, () => {
      winLib.bk_file_open(this.dialogOwner(opts.window), t as any, t.length, opts.multiple ? 1 : 0, BigInt(id));
    });
    return e.value1 === 1 && e.text ? e.text.split("\n") : [];
  }

  // --- menu ---------------------------------------------------------------------

  setMenu(h: NativeHandle, spec: string, handler: (itemId: number, label: string) => void): void {
    menuHandlers.set(h, handler);
    const b = cstr(spec);
    winLib.bk_window_set_menu(h, b as any, b.length);
  }

  get allWindows(): readonly NativeHandle[] { return windows; }

  beep(): void { winLib.bk_beep(); }

  destroy(handle: NativeHandle): void {
    const cb1 = buttonCbMap.get(handle);
    if (cb1) { callbacks.unregister(cb1); buttonCbMap.delete(handle); }
    const cb2 = textCbMap.get(handle);
    if (cb2) { callbacks.unregister(cb2); textCbMap.delete(handle); }
    const cb3 = advancedCbMap.get(handle);
    if (cb3) { callbacks.unregister(cb3); advancedCbMap.delete(handle); }
    const cb4 = submitCbMap.get(handle);
    if (cb4) { callbacks.unregister(cb4); submitCbMap.delete(handle); }
    winLib.bk_object_destroy(handle);
  }
}

export const windowsBackend = new WindowsBackend();
