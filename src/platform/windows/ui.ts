// src/platform/windows/ui.ts — public API over the Windows backend.
import { resolveAssetPath } from "../../asset.ts";
import { bindSignals, extractSignals } from "../../signal.ts";
import {
  applyAdaptiveColor,
  isThemeColor,
  reapplyAdaptiveColors,
  resolveColor,
  trackAdaptive,
} from "../../ui/adaptive.ts";
import type { CursorValue } from "../../ui/cursor.ts";
import { colorToHex, isThemeShadow, parseShadow, type ShadowValue } from "../../ui/shadow.ts";
import {
  composeStateStyle,
  resolveStateStyle,
  stateStyleFromOptions,
  styleValueEqual,
  type InteractionState,
  type ViewStates,
  type ViewStateStyle,
} from "../../ui/states.ts";
import { windowsBackend } from "./backend.ts";
import type { NativeHandle } from "./ffi.ts";
import { winLib } from "./ffi.ts";
export { defineTheme } from "../../ui/tokens.ts";

// Theme-adaptive colour helpers, public on both platforms (macOS re-exports
// them from view.ts). Re-exported here so `import { resolveColor } from
// "@omarcos/bunkit"` works on Windows too.
export { applyAdaptiveColor, isThemeColor, resolveColor } from "../../ui/adaptive.ts";
export type { ShadowSpec, ShadowValue, ThemeShadow } from "../../ui/shadow.ts";
export type { ThemeTokenDefinition, ThemeTokens } from "../../ui/tokens.ts";

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

export function normalizeCorners(
  spec: CornerRadiusSpec | undefined,
  fallback = 0,
): [number, number, number, number] {
  if (spec === undefined) return [fallback, fallback, fallback, fallback];
  if (typeof spec === "number") return [spec, spec, spec, spec];
  if (Array.isArray(spec)) return [spec[0] ?? 0, spec[1] ?? 0, spec[2] ?? 0, spec[3] ?? 0];
  return [spec.topLeft ?? 0, spec.topRight ?? 0, spec.bottomRight ?? 0, spec.bottomLeft ?? 0];
}

/** A per-side border-width spec: one number for all four sides,
 *  [top, right, bottom, left] (CSS order), or per-side by name. */
export type BorderSideSpec =
  | number
  | [number, number, number, number]
  | { top?: number; right?: number; bottom?: number; left?: number };

export function normalizeSides(
  spec: BorderSideSpec | boolean | undefined,
  fallback = 0,
): [number, number, number, number] {
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
  /** Styles applied while the view is hovered, focused, pressed or disabled. */
  states?: ViewStates;
  /** Corner radius — one number for all corners, [tl, tr, br, bl], or
   *  per-corner names (CSS border-radius vocabulary). */
  borderRadius?: CornerRadiusSpec;
  /** Border width — one number for all sides, `true` for 1,
   *  [top, right, bottom, left], or per-side names (CSS border-width vocabulary). */
  border?: number | boolean | BorderSideSpec;
  borderWidth?: number;
  borderColor?: any;
  /** CSS-like outer box shadow, for example "0 4px 12px #0003". */
  shadow?: ShadowValue;
  /** CSS-like system cursor shown while the pointer is over this view. */
  cursor?: CursorValue;
  borderStyle?: "solid" | "dashed" | "dotted";
  /** In a GridView parent: which grid row this view occupies (CSS grid-row). */
  gridRow?: number;
  /** In a GridView parent: which grid column this view occupies (CSS grid-column). */
  gridColumn?: number;
  /** In a GridView parent: how many grid rows this view spans. */
  gridRowSpan?: number;
  /** In a GridView parent: how many grid columns this view spans. */
  gridColumnSpan?: number;
  /** A reusable styling object, merged into the options at construction.
   *  Inline props win over the style. */
  style?: ViewStyle;
}

/** The visual styling subset of ViewOptions, for the `style` prop. */
export type ViewStyle = Omit<ViewOptions, "style" | "children" | "states">;

/** A control's full `style` type: every option it takes, minus
 *  `style`/`children` (macOS parity — see `src/ui/view.ts`). */
export type StyleOf<T> = Omit<T, "style" | "children">;

/** Merge `options.style` into the options; inline props take precedence.
 *  A non-object `style` is left alone. */
/** Merge `options.style` into the options; inline props take precedence.
 *  A non-object `style` is left alone. Generic so the specific option type
 *  (ScrollOptions, StackOptions, …) survives the reassignment. */
export function mergeStyle<T extends ViewOptions>(options: T): T {
  const { style, ...rest } = options;
  if (!style || typeof style !== "object") return rest as T;
  return { ...(style as ViewStyle), ...rest } as T;
}

/** Base of every control: handle + grow + the shared view options. */
export class View {
  handle: NativeHandle = 0n;
  grow = 0;
  /** The constructor options this view was created with (after `style`
   *  merging); read by parents such as GridView for grid placement. Controls
   *  declare their own narrower `props` type for JSX checking. */
  declare readonly props: any;
  /** @internal */ _children: View[] = [];
  /** @internal */ _parent: View | null = null;
  /** @internal */ _hidden = false;
  #states: ViewStates | undefined;
  #activeStates: Record<InteractionState, boolean> = {
    hover: false,
    focus: false,
    pressed: false,
    disabled: false,
  };
  #lastStateStyle: ViewStateStyle = {};
  #hoverExitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(handle: NativeHandle, options: ViewOptions = {}) {
    this.handle = handle;
    this.props = mergeStyle(options);
    const o = this.props;
    if (o.grow !== undefined) this.grow = o.grow;
    if (o.width !== undefined || o.height !== undefined) {
      windowsBackend.setControlSize(handle, o.width ?? 0, o.height ?? 0);
    }
    if (o.minWidth !== undefined || o.minHeight !== undefined) {
      windowsBackend.setControlMinSize(handle, o.minWidth ?? 0, o.minHeight ?? 0);
    }
    if (o.maxWidth !== undefined || o.maxHeight !== undefined) {
      windowsBackend.setControlMaxSize(handle, o.maxWidth ?? 0, o.maxHeight ?? 0);
    }
    if (o.hidden !== undefined) this.hidden = o.hidden;
    if (o.tooltip !== undefined) windowsBackend.setControlTooltip(handle, o.tooltip);
    if (o.alpha !== undefined) windowsBackend.setControlAlpha(handle, o.alpha);
    if (o.borderRadius !== undefined) {
      const [tl, tr, br, bl] = normalizeCorners(o.borderRadius);
      windowsBackend.setControlCornerRadius(handle, tl, tr, br, bl);
    }
    if (o.background !== undefined || o.backgroundColor !== undefined) {
      this.setBackground(o.background ?? o.backgroundColor);
    }

    // CSS-style borders: `border`/`borderWidth` (or `borderColor`/`borderStyle`
    // alone) turn the border on; `borderRadius` rides along when present.
    const borderSpec = o.border !== undefined ? o.border : o.borderWidth;
    if (borderSpec !== undefined || o.borderColor !== undefined || o.borderStyle !== undefined) {
      this.setBorder(
        o.borderColor ?? "#C6C6C8",
        borderSpec ?? 1,
        o.borderRadius,
        o.borderStyle ?? "solid",
      );
    }
    if (o.shadow !== undefined) this.setShadow(o.shadow);
    if (o.cursor !== undefined) this.cursor = o.cursor;
    this.installInteractionStates(o.states);
  }
  /** @internal Configure declarative interaction styles for this view. */
  protected installInteractionStates(states?: ViewStates): void {
    if (!states) return;
    this.#states = states;
    this.#lastStateStyle = resolveStateStyle(stateStyleFromOptions(this.props), themeIsDark());
    trackAdaptive(() => this.#applyInteractionStyles());
    this.#applyInteractionStyles();
  }

  /** @internal Connect native pointer/focus events for a control. */
  protected startInteractionTracking(): void {
    if (!this.#states) return;
    windowsBackend.setControlStateCallback(this.handle, (state, active) => {
      const name = state === 1 ? "hover" : state === 2 ? "focus" : "pressed";
      this._setInteractionState(name, active);
    });
  }

  /** @internal Used by the platform interaction tracker. */
  _hasInteractionState(state: InteractionState): boolean {
    return this.#states?.[state] !== undefined;
  }

  /** @internal Used by the platform interaction tracker. */
  _isInteractionDisabled(): boolean {
    return this.#activeStates.disabled;
  }

  /** @internal Used by the platform interaction tracker. */
  _setInteractionState(state: InteractionState, active: boolean): void {
    if (!this.#states) return;
    if (state === "hover" && active) {
      if (this.#hoverExitTimer !== undefined) clearTimeout(this.#hoverExitTimer);
      this.#hoverExitTimer = undefined;
    }
    if (this.#activeStates[state] === active) return;
    if (state === "hover" && !active) {
      if (this.#hoverExitTimer !== undefined) clearTimeout(this.#hoverExitTimer);
      this.#hoverExitTimer = setTimeout(() => {
        this.#hoverExitTimer = undefined;
        if (!this.#activeStates.hover) return;
        this.#activeStates.hover = false;
        this.#applyInteractionStyles();
      }, 120);
      return;
    }
    if (this.#activeStates.disabled && (state === "hover" || state === "pressed") && active) return;
    if (state === "disabled" && active) {
      this.#activeStates.hover = false;
      this.#activeStates.pressed = false;
    }
    this.#activeStates[state] = active;
    this.#applyInteractionStyles();
  }

  #applyInteractionStyles(): void {
    if (!this.#states) return;
    const merged = composeStateStyle(
      stateStyleFromOptions(this.props),
      this.#states,
      this.#activeStates,
    );
    const next = resolveStateStyle(merged, themeIsDark());
    const previous = this.#lastStateStyle;
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    const styleChanged = (key: keyof ViewStateStyle) => !styleValueEqual(previous[key], next[key]);

    if (keys.has("backgroundColor") && styleChanged("backgroundColor")) {
      this.setBackground("backgroundColor" in next ? next.backgroundColor : undefined);
    }
    if (
      ["border", "borderColor", "borderRadius", "borderStyle"].some(
        (key) => keys.has(key) && styleChanged(key as keyof ViewStateStyle),
      )
    ) {
      const hasBorder =
        next.border !== undefined ||
        next.borderColor !== undefined ||
        next.borderStyle !== undefined;
      this.setBorder(
        next.borderColor ?? "#C6C6C8",
        hasBorder ? (next.border ?? 1) : 0,
        next.borderRadius ?? 0,
        next.borderStyle ?? "solid",
      );
    }
    if (keys.has("shadow") && styleChanged("shadow"))
      this.setShadow("shadow" in next ? (next.shadow ?? "none") : "none");
    if (keys.has("alpha") && styleChanged("alpha"))
      windowsBackend.setControlAlpha(this.handle, next.alpha ?? 1);
    if (keys.has("cursor") && styleChanged("cursor")) this.cursor = next.cursor;
    if (keys.has("placeholderColor") && styleChanged("placeholderColor")) {
      (this as any).placeholderColor =
        "placeholderColor" in next ? next.placeholderColor : undefined;
    }
    if (next.textColor !== undefined && "textColor" in next && styleChanged("textColor"))
      (this as any).textColor = next.textColor;
    if (next.font !== undefined && "font" in next && styleChanged("font"))
      (this as any).font = next.font;

    this.#lastStateStyle = next;
  }
  get children(): readonly View[] {
    return this._children;
  }
  get parent(): View | null {
    return this._parent;
  }
  get frame(): { x: number; y: number; width: number; height: number } {
    const [w, h] = windowsBackend.getControlSize(this.handle);
    return { x: 0, y: 0, width: w, height: h };
  }
  get hidden(): boolean {
    return this._hidden;
  }
  set hidden(v: boolean) {
    this._hidden = v;
    windowsBackend.setControlVisible(this.handle, !v);
  }
  /** CSS-like system cursor shown while the pointer is over this view. */
  set cursor(v: CursorValue | undefined) {
    windowsBackend.setControlCursor(this.handle, v);
  }

  /** Keep a JS object alive for as long as this view is. */
  retainJS(_v: any): void {}

  /** Background colour (hex string or { light, dark }). On acrylic-backed
   *  views this tints the acrylic instead of replacing it. */
  setBackground(color: any): this {
    if (color === undefined || color === null) {
      windowsBackend.setControlBackground(this.handle, "");
      return this;
    }
    applyAdaptiveColor(color, themeIsDark, (c) => {
      if (typeof c === "string") {
        windowsBackend.setControlBackground(this.handle, c);
      }
    });
    return this;
  }

  /** Border colour (hex string or { light, dark }), width in px (one number or
   *  per-side — see BorderSideSpec), optional corner radius (one number or
   *  per-corner — see CornerRadiusSpec) and style. dashed/dotted draw with a
   *  pattern overlay on Border-based views and fall back to solid on plain
   *  Controls. */
  setBorder(
    color: any,
    width: BorderSideSpec | boolean | number = 1,
    radius: CornerRadiusSpec | number = 0,
    style: "solid" | "dashed" | "dotted" = "solid",
  ): this {
    applyAdaptiveColor(color, themeIsDark, (c) => {
      if (typeof c !== "string") return;
      const [tl, tr, br, bl] = normalizeCorners(radius as CornerRadiusSpec);
      const [top, right, bottom, left] = normalizeSides(width as BorderSideSpec);
      if (style === "solid") {
        windowsBackend.setControlBorder(this.handle, c, top, right, bottom, left, tl, tr, br, bl);
      } else {
        const code = style === "dotted" ? 2 : 1;
        windowsBackend.setControlBorderStyle(
          this.handle,
          c,
          top,
          right,
          bottom,
          left,
          tl,
          tr,
          br,
          bl,
          code,
        );
      }
    });
    return this;
  }
  /** Apply a CSS-like outer box shadow. */
  setShadow(value: ShadowValue): this {
    let shadow = parseShadow(value, themeIsDark());
    const applyShadow = () => {
      shadow = parseShadow(value, themeIsDark());
      if (!shadow) {
        windowsBackend.setControlShadow(this.handle, "", 0, 0, 0, 0);
        return;
      }
      const c = resolveColor(shadow.color, themeIsDark());

      const hex = colorToHex(c);
      if (hex) {
        windowsBackend.setControlShadow(
          this.handle,
          hex,
          shadow.offsetX,
          shadow.offsetY,
          shadow.blur,
          shadow.opacity,
        );
      }
    };
    applyShadow();
    if (isThemeShadow(value) || (shadow !== null && isThemeColor(shadow.color))) {
      trackAdaptive(applyShadow);
    }
    return this;
  }

  focus(): this {
    windowsBackend.focusControl(this.handle);
    this._setInteractionState("focus", true);
    return this;
  }

  blur(): this {
    windowsBackend.blurControl(this.handle);
    this._setInteractionState("focus", false);
    return this;
  }

  get enabled(): boolean {
    return windowsBackend.getControlEnabled(this.handle);
  }

  set enabled(v: boolean) {
    windowsBackend.setControlEnabled(this.handle, v);
    this._setInteractionState("disabled", !v);
  }

  get disabled(): boolean {
    return !this.enabled;
  }

  set disabled(v: boolean) {
    this.enabled = !v;
  }

  disable(): this {
    this.disabled = true;
    return this;
  }

  /** Raw-object escape hatch: a tolerant proxy (unknown selectors no-op). */
  get native(): any {
    return tolerantProxy(this.constructor.name + ".native");
  }
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
    onClick: () => {
      options.onQuit?.();
      windowsBackend.shutdown();
    },
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
    bar.addSubmenu("Window", [{ title: "Minimize", shortcut: "cmd+m" }, { title: "Zoom" }]);
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
  windowsBackend.popUpMenu(win.handle, flattenItems(items, 0, handlers), (itemId) =>
    handlers.get(itemId)?.(),
  );
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

// Which way the theme resolves right now: the app theme if one was set,
// otherwise the OS-level light/dark setting (AppsUseLightTheme registry).
function themeIsDark(): boolean {
  if (appTheme === "light") return false;
  if (appTheme === "dark") return true;
  try {
    return (winLib.bk_theme_is_dark() as number) !== 0;
  } catch {
    return false;
  }
}

/** Whether the app's effective theme is dark (the app theme, or the OS if
 *  following it). Same name and semantics as the macOS export. */
export function currentThemeIsDark(): boolean {
  return themeIsDark();
}

export class Application {
  constructor(
    private opts: {
      name?: string;
      theme?: Theme;
      menu?: false | StandardMenuOptions | Menu;
      onReady?: (app: Application) => void | Promise<void>;
      onQuit?: () => void | Promise<void>;
      exitOnQuit?: boolean;
    } = {},
  ) {
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
    const bar =
      menu instanceof Menu
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

  quit(): void {
    windowsBackend.shutdown();
  }
  get running(): boolean {
    return windowsBackend.isRunning();
  }
}

export class Window {
  readonly handle: NativeHandle;
  constructor(
    opts: {
      title?: string;
      size?: { width: number; height: number };
      minSize?: { width: number; height: number };
      /** Screen position of the bottom-left corner; omitted means centred. */
      position?: { x: number; y: number };
      /** Window icon (titlebar + taskbar): .ico/.png path, or { light, dark }. */
      icon?: any;
      content?: any;
      show?: boolean;
      onClose?: () => void;
      /** Draw content behind a transparent titlebar (parity with macOS). */
      fullSizeContent?: boolean;
      /** Hide the title text (parity with macOS). */
      titleVisible?: boolean;
      /** Windows 11 titlebar background — hex or { light, dark }. */
      titlebarColor?: any;
      /** Windows 11 titlebar text colour — hex or { light, dark }. */
      titlebarTextColor?: any;
      /** Allow resizing (and the maximise button). Default true. */
      resizable?: boolean;
      /** Allow closing via the window chrome. Default true. */
      closable?: boolean;
      /** Allow minimising. Default true. */
      minimizable?: boolean;
    } = {},
  ) {
    this.handle = windowsBackend.createWindow({ title: opts.title, size: opts.size });
    if (opts.minSize) windowsBackend.setWindowMinSize(this.handle, opts.minSize);
    // Icon resolves per theme and re-applies on setTheme.
    if (opts.icon !== undefined) {
      const applyIcon = () => {
        const icon = resolveColor(opts.icon, themeIsDark());
        if (typeof icon === "string") {
          windowsBackend.setWindowIcon(this.handle, resolveAssetPath(icon));
        }
      };
      if (isThemeColor(opts.icon)) trackAdaptive(applyIcon);
      applyIcon();
    }
    if (opts.position !== undefined) {
      windowsBackend.setWindowPosition(this.handle, opts.position.x, opts.position.y);
    } else {
      // macOS parity: a window with no explicit position opens centred.
      windowsBackend.centerWindow(this.handle);
    }
    if (opts.resizable === false || opts.closable === false || opts.minimizable === false) {
      windowsBackend.setWindowStyle(this.handle, {
        resizable: opts.resizable,
        closable: opts.closable,
        minimizable: opts.minimizable,
      });
    }
    if (opts.content) this.content = opts.content;
    if (opts.onClose) windowsBackend.setWindowCloseCallback(this.handle, opts.onClose);
    // Inherit the Application theme before the first frame, so the window
    // opens already in it instead of flashing the system theme.
    if (appTheme !== null) {
      windowsBackend.setControlTheme(this.handle, themeCode(appTheme));
    }
    windowInstances.push(this);
    // Titlebar options must reach the native call together with the first
    // Activate, so the first painted frame already carries the custom colours
    // instead of flashing the default titlebar.
    const wantsTitlebar =
      opts.fullSizeContent ||
      opts.titleVisible === false ||
      opts.titlebarColor !== undefined ||
      opts.titlebarTextColor !== undefined;
    if (wantsTitlebar) {
      this.#titlebar = {
        fullSizeContent: opts.fullSizeContent,
        titlebarColor:
          typeof resolveColor(opts.titlebarColor, themeIsDark()) === "string"
            ? (resolveColor(opts.titlebarColor, themeIsDark()) as string)
            : undefined,
        titlebarTextColor:
          typeof resolveColor(opts.titlebarTextColor, themeIsDark()) === "string"
            ? (resolveColor(opts.titlebarTextColor, themeIsDark()) as string)
            : undefined,
      };
      // Re-resolve on theme changes (setTheme) — the window is already up then.
      if (isThemeColor(opts.titlebarColor) || isThemeColor(opts.titlebarTextColor)) {
        trackAdaptive(() => {
          const bg = resolveColor(opts.titlebarColor, themeIsDark());
          const fg = resolveColor(opts.titlebarTextColor, themeIsDark());
          windowsBackend.setWindowTitlebar(this.handle, {
            fullSizeContent: opts.fullSizeContent,
            titleVisible: opts.titleVisible,
            titlebarColor: typeof bg === "string" ? bg : undefined,
            titlebarTextColor: typeof fg === "string" ? fg : undefined,
          });
        });
      }
    }
    if (opts.show !== false) this.show();
  }
  /** @internal */ #titlebar: {
    fullSizeContent?: boolean;
    titlebarColor?: string;
    titlebarTextColor?: string;
  } | null = null;
  show(): this {
    if (this.#titlebar) windowsBackend.showWindowWithTitlebar(this.handle, this.#titlebar);
    else windowsBackend.showWindow(this.handle);
    return this;
  }
  center(): this {
    windowsBackend.centerWindow(this.handle);
    return this;
  }
  close(): void {
    windowsBackend.closeWindow(this.handle);
  }
  quitOnClose(): this {
    windowsBackend.setWindowCloseCallback(this.handle, () => windowsBackend.shutdown());
    return this;
  }
  set content(v: any) {
    const h: NativeHandle | null = v?.handle ?? v ?? null;
    if (h) windowsBackend.setWindowContent(this.handle, h);
  }
  set title(v: string) {
    windowsBackend.setWindowTitle(this.handle, v);
  }
  /** Bottom-left corner in screen pixels (macOS frame-origin semantics). */
  get position(): { x: number; y: number } {
    return windowsBackend.getWindowPosition(this.handle);
  }
  set position(p: { x: number; y: number }) {
    windowsBackend.setWindowPosition(this.handle, p.x, p.y);
  }
  get native(): any {
    return tolerantProxy("win.native");
  }
}

// --- controls ---------------------------------------------------------------------

export class Label extends View {
  constructor(
    opts: {
      text?: string;
      textColor?: any;
      font?: any;
      textAlign?: string;
      grow?: number;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    // A { light, dark } colour must not cross into the native create call —
    // it resolves per theme and re-applies on setTheme.
    super(
      windowsBackend.createLabel({
        ...opts,
        textColor: typeof opts.textColor === "string" ? opts.textColor : "",
      } as any),
      opts,
    );
    if (opts.textColor !== undefined) {
      applyAdaptiveColor(opts.textColor, themeIsDark, (c) => {
        if (typeof c === "string") windowsBackend.setLabelColor(this.handle, c);
      });
    }
    bindSignals(this, opts, bound);
  }
  get text(): string {
    return windowsBackend.getLabelText(this.handle);
  }
  set text(v: string) {
    windowsBackend.setLabelText(this.handle, v ?? "");
  }
  set textColor(v: any) {
    applyAdaptiveColor(v, themeIsDark, (c) => {
      if (typeof c === "string") windowsBackend.setLabelColor(this.handle, c);
    });
  }
}

export class Button extends View {
  constructor(
    opts: {
      title?: string;
      primary?: boolean;
      destructive?: boolean;
      symbol?: string;
      textColor?: any;
      font?: any;
      enabled?: boolean;
      disabled?: boolean;
      onClick?: () => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    if (opts.cursor === undefined) opts.cursor = "pointer";
    const bound = extractSignals(opts);
    super(windowsBackend.createButton(opts), opts);
    this.startInteractionTracking();
    if (opts.textColor !== undefined) this.textColor = opts.textColor;
    if (opts.font !== undefined) this.font = opts.font;
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.disabled !== undefined) this.disabled = opts.disabled;
    if (opts.onClick) windowsBackend.setButtonClickCallback(this.handle, opts.onClick);
    bindSignals(this, opts, bound);
  }
  set title(v: string) {
    windowsBackend.setButtonText(this.handle, v);
  }
  /** Title colour (hex, semantic name, or { light, dark }); re-resolves on
   *  theme change. */
  set textColor(v: any) {
    applyAdaptiveColor(v, themeIsDark, (c) => {
      if (typeof c === "string") windowsBackend.setButtonColor(this.handle, c);
    });
  }
  /** Title font — same vocabulary as `Label.font`. */
  set font(v: any) {
    windowsBackend.setButtonFont(this.handle, v);
  }
  get enabled(): boolean {
    return windowsBackend.getControlEnabled(this.handle);
  }
  set enabled(v: boolean) {
    windowsBackend.setControlEnabled(this.handle, v);
    this._setInteractionState("disabled", !v);
  }
  onClick(fn: () => void): this {
    windowsBackend.setButtonClickCallback(this.handle, fn);
    return this;
  }
}

export class TextField extends View {
  secure: boolean;
  constructor(
    opts: {
      value?: string;
      placeholder?: string;
      secure?: boolean;
      textColor?: any;
      placeholderColor?: any;
      enabled?: boolean;
      disabled?: boolean;
      onChange?: (v: string) => void;
      onSubmit?: (v: string) => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(
      windowsBackend.createTextField({
        value: opts.value,
        placeholder: opts.placeholder,
        secure: opts.secure,
        onChange: opts.onChange,
      }),
      opts,
    );
    this.startInteractionTracking();
    this.secure = !!opts.secure;
    if (opts.textColor !== undefined || opts.placeholderColor !== undefined) {
      const apply = () => {
        const tc = resolveColor(opts.textColor, themeIsDark());
        const pc = resolveColor(opts.placeholderColor, themeIsDark());
        windowsBackend.setTextFieldColors(
          this.handle,
          typeof tc === "string" ? tc : undefined,
          typeof pc === "string" ? pc : undefined,
        );
      };
      if (isThemeColor(opts.textColor) || isThemeColor(opts.placeholderColor)) trackAdaptive(apply);
      apply();
    }
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.disabled !== undefined) this.disabled = opts.disabled;
    if (opts.onSubmit) this.onSubmit(opts.onSubmit);
    bindSignals(this, opts, bound);
  }
  get value(): string {
    return windowsBackend.getTextFieldValue(this.handle);
  }
  set value(v: string) {
    windowsBackend.setTextFieldValue(this.handle, v ?? "");
  }
  /** Text colour (hex, semantic name, or { light, dark }); re-resolves on
   *  theme change. Also what a `textColor={signal}` binding writes to. */
  set textColor(v: any) {
    applyAdaptiveColor(v, themeIsDark, (c) => {
      if (typeof c === "string") windowsBackend.setTextFieldColors(this.handle, c, undefined);
    });
  }
  /** Placeholder colour; re-resolves on theme change. */
  set placeholderColor(v: any) {
    if (v === undefined) {
      windowsBackend.resetTextFieldPlaceholderColor(this.handle);
      return;
    }
    applyAdaptiveColor(v, themeIsDark, (c) => {
      if (typeof c === "string") windowsBackend.setTextFieldColors(this.handle, undefined, c);
    });
  }
  onChange(fn: (v: string) => void): this {
    windowsBackend.setTextFieldChangeCallback(this.handle, fn);
    return this;
  }
  onSubmit(fn: (v: string) => void): this {
    if (this.secure) windowsBackend.setPasswordSubmitCallback(this.handle, fn);
    else windowsBackend.setTextFieldSubmitCallback(this.handle, fn);
    return this;
  }
}

export class Checkbox extends View {
  constructor(
    opts: {
      title?: string;
      checked?: boolean;
      onChange?: (checked: boolean) => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createCheckbox(opts), opts);
    bindSignals(this, opts, bound);
  }
  get checked(): boolean {
    return windowsBackend.getCheckboxChecked(this.handle);
  }
  set checked(value: boolean) {
    windowsBackend.setCheckboxChecked(this.handle, value);
  }
  onChange(fn: (checked: boolean) => void): this {
    windowsBackend.setCheckboxCallback(this.handle, fn);
    return this;
  }
}

export class Switch extends View {
  constructor(
    opts: { on?: boolean; onChange?: (on: boolean) => void; style?: any } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createSwitch(opts), opts);
    bindSignals(this, opts, bound);
  }
  get on(): boolean {
    return windowsBackend.getSwitchOn(this.handle);
  }
  set on(value: boolean) {
    windowsBackend.setSwitchOn(this.handle, value);
  }
  onChange(fn: (on: boolean) => void): this {
    windowsBackend.setSwitchCallback(this.handle, fn);
    return this;
  }
}

export class Slider extends View {
  constructor(
    opts: {
      min?: number;
      max?: number;
      value?: number;
      onChange?: (value: number) => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createSlider(opts), opts);
    bindSignals(this, opts, bound);
  }
  get value(): number {
    return windowsBackend.getSliderValue(this.handle);
  }
  set value(value: number) {
    windowsBackend.setSliderValue(this.handle, value);
  }
  onChange(fn: (value: number) => void): this {
    windowsBackend.setSliderCallback(this.handle, fn);
    return this;
  }
}

export class Select extends View {
  constructor(
    opts: {
      items?: readonly string[];
      selected?: number;
      onChange?: (index: number, title: string) => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createSelect(opts), opts);
    bindSignals(this, opts, bound);
  }
  set items(value: readonly string[]) {
    windowsBackend.setSelectItems(this.handle, value, this.selectedIndex);
  }
  get selectedIndex(): number {
    return windowsBackend.getSelectSelected(this.handle);
  }
  set selectedIndex(value: number) {
    windowsBackend.setSelectSelected(this.handle, value);
  }
  get selectedTitle(): string {
    return windowsBackend.getSelectTitle(this.handle);
  }
  onChange(fn: (index: number, title: string) => void): this {
    windowsBackend.setSelectCallback(this.handle, fn);
    return this;
  }
}

export class Segmented extends View {
  constructor(
    opts: {
      items?: readonly string[];
      selected?: number;
      onChange?: (index: number) => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createSegmented(opts), opts);
    if (opts.onChange) windowsBackend.setSegmentedCallback(this.handle, opts.onChange);
    bindSignals(this, opts, bound);
  }
  get selectedIndex(): number {
    return windowsBackend.getSegmentedSelected(this.handle);
  }
  set selectedIndex(i: number) {
    windowsBackend.setSegmentedSelected(this.handle, i);
  }
  onChange(fn: (index: number) => void): this {
    windowsBackend.setSegmentedCallback(this.handle, fn);
    return this;
  }
}

export class TextArea extends View {
  constructor(
    opts: {
      value?: string;
      editable?: boolean;
      richText?: boolean;
      font?: any;
      textColor?: any;
      onChange?: (value: string) => void;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createTextAreaEx(!!opts.richText), opts);
    if (opts.value !== undefined) this.value = opts.value;
    if (opts.editable === false) windowsBackend.setTextAreaReadOnly(this.handle, true);
    if (opts.font)
      windowsBackend.setTextAreaFont(this.handle, !!opts.font.monospace, opts.font.size ?? 0);
    if (opts.textColor !== undefined) {
      applyAdaptiveColor(opts.textColor, themeIsDark, (c) => {
        if (typeof c === "string") windowsBackend.setTextAreaForeground(this.handle, c);
      });
    }
    if (opts.onChange) windowsBackend.setTextAreaCallback(this.handle, opts.onChange);
    bindSignals(this, opts, bound);
  }
  get value(): string {
    return windowsBackend.getTextAreaValue(this.handle);
  }
  set value(value: string) {
    windowsBackend.setTextAreaValue(this.handle, value);
  }
  /** Text colour (hex, semantic name, or { light, dark }); re-resolves on
   *  theme change. */
  set textColor(v: any) {
    applyAdaptiveColor(v, themeIsDark, (c) => {
      if (typeof c === "string") windowsBackend.setTextAreaForeground(this.handle, c);
    });
  }
  onChange(fn: (value: string) => void): this {
    windowsBackend.setTextAreaCallback(this.handle, fn);
    return this;
  }
  get textView(): any {
    return tolerantProxy("TextArea.textView");
  }
}

export class Progress extends View {
  constructor(
    opts: {
      max?: number;
      value?: number;
      indeterminate?: boolean;
      spinner?: boolean;
      style?: any;
    } & ViewOptions = {},
  ) {
    opts = mergeStyle(opts);
    const bound = extractSignals(opts);
    super(windowsBackend.createProgress(opts.spinner ? { indeterminate: true } : opts), opts);
    bindSignals(this, opts, bound);
  }
  get value(): number {
    return windowsBackend.getProgressValue(this.handle);
  }
  set value(value: number) {
    windowsBackend.setProgressValue(this.handle, value);
  }
}

export class Separator extends View {
  constructor(orientation = 0) {
    super(windowsBackend.createSeparator(orientation === 0));
  }
}

export class Spacer extends View {
  constructor(_options: { min?: number } = {}) {
    super(windowsBackend.createSpacer());
    this.grow = 1;
  }
}

export class GroupBox extends View {
  readonly contentStack: VStack;
  constructor(
    opts: { title?: string; padding?: number; spacing?: number; style?: any } & ViewOptions = {},
    children: any[] = [],
  ) {
    opts = mergeStyle(opts);
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
  /** Cross-axis alignment (CSS `align-items`): "leading" | "center" |
   *  "trailing" | "fill". */
  alignItems?: "leading" | "center" | "trailing" | "fill";
  /** Main-axis distribution (CSS `justify-content`): "start" | "center" | "fill". */
  justifyContent?: "start" | "center" | "fill";
  /**
   * Scroll instead of clipping when the content outgrows the available
   * space. `true` scrolls the stack's own axis (a row scrolls horizontally,
   * a column vertically); pass axes explicitly to scroll both.
   */
  scroll?: boolean | { horizontal?: boolean; vertical?: boolean };
  /** Inline styling object; accepts every Stack option. */
  style?: StyleOf<StackOptions>;
}

export class Stack extends View {
  constructor(orientation: 0 | 1, opts: StackOptions = {}, children: any[] = []) {
    opts = mergeStyle(opts);
    // scroll: true scrolls the main axis; explicit axes scroll each side.
    let scrollFlags = 0;
    if (opts.scroll) {
      const horizontal = orientation === 1;
      const wantH = opts.scroll === true ? horizontal : opts.scroll.horizontal === true;
      const wantV = opts.scroll === true ? !horizontal : opts.scroll.vertical === true;
      scrollFlags = (wantH ? 1 : 0) | (wantV ? 2 : 0);
    }
    super(windowsBackend.createStack(orientation, opts as any, scrollFlags), opts);
    const horizontal = orientation === 1;
    const align = opts.alignItems ?? (horizontal ? "center" : "fill");
    const pack = opts.justifyContent ?? (horizontal ? "fill" : "start");
    windowsBackend.stackSetAlign(
      this.handle,
      { leading: 0, center: 1, trailing: 2, fill: 3 }[align] ?? 3,
    );
    windowsBackend.stackSetPack(this.handle, { start: 0, center: 1, fill: 2 }[pack] ?? 0);
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
  /** Insert a child at a 0-based index (same semantics as the macOS Stack). */
  insert(child: any, index: number): this {
    const h: NativeHandle = child?.handle ?? child;
    const g: number = child?.grow ?? 0;
    windowsBackend.stackInsertChild(this.handle, h, index, g);
    this._children.splice(index, 0, child);
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
  set spacing(_v: number) {
    /* spacing is fixed at creation on Windows */
  }
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
  /** Inline styling object; accepts every ScrollView option. */
  style?: StyleOf<ScrollOptions>;
}

/** A scrolling container around a single content view. */
export class ScrollView extends View {
  #content: any = null;
  constructor(opts: ScrollOptions = {}, content?: any) {
    opts = mergeStyle(opts);
    super(windowsBackend.createScrollView(opts), { ...opts, minHeight: opts.minHeight ?? 80 });
    if (content) this.content = content;
  }
  get content(): any {
    return this.#content;
  }
  set content(v: any) {
    this.#content = v;
    if (v) windowsBackend.setScrollViewContent(this.handle, v.handle ?? v);
  }
  scrollToTop(): void {
    windowsBackend.scrollScrollViewTo(this.handle, 0);
  }
  scrollToBottom(): void {
    windowsBackend.scrollScrollViewTo(this.handle, 1);
  }
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

/** One column/row track of a GridView (CSS `grid-template-columns/rows`):
 *  a fixed width in points, "auto" to fit the content, or "fill" to take the
 *  leftover space. */
export type GridTrack = number | "auto" | "fill";

export interface GridViewOptions extends ViewOptions {
  /** Column tracks, left to right. */
  columns?: GridTrack[];
  /** Row tracks, top to bottom; "auto" when omitted. */
  rows?: GridTrack[];
  /** Gap between every cell, on both axes (CSS `gap`). */
  spacing?: number;
  /** Vertical gap between rows (CSS `row-gap`); overrides `spacing`. */
  rowSpacing?: number;
  /** Horizontal gap between columns (CSS `column-gap`); overrides `spacing`. */
  columnSpacing?: number;
  /** Inline styling object; accepts every GridView option. */
  style?: StyleOf<GridViewOptions>;
}

/** Where a view sits in its GridView parent (CSS grid placement). Children
 *  may also carry `gridRow`/`gridColumn`/`gridRowSpan`/`gridColumnSpan`
 *  options directly. */
export interface GridPlacement {
  row?: number;
  column?: number;
  rowSpan?: number;
  columnSpan?: number;
}

/** A two-dimensional grid (CSS `display: grid`): children are placed in
 *  explicit rows/columns, optionally spanning several cells.
 *
 *     <GridView columns={["fill", 200]} spacing={12}>
 *       <Label text="Name" gridColumn={0} />
 *       <TextField gridColumn={1} />
 *     </GridView>
 *
 * Backed by a WinUI Grid: "auto" tracks fit their content, fixed tracks are
 * exact pixels, and "fill" tracks share the leftover space (star sizing). */
export class GridView extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: GridViewOptions;
  constructor(opts: GridViewOptions = {}, children: any[] = []) {
    opts = mergeStyle(opts);
    const enc = (tracks?: GridTrack[]) =>
      (tracks ?? []).map((t) => (typeof t === "number" ? String(t) : t)).join(",");
    const rowSpacing = opts.rowSpacing ?? opts.spacing ?? 0;
    const colSpacing = opts.columnSpacing ?? opts.spacing ?? 0;
    super(
      windowsBackend.createGridView(enc(opts.columns), enc(opts.rows), rowSpacing, colSpacing),
      opts,
    );
    for (const c of children) this.add(c);
  }
  add(child: any, placement: GridPlacement = {}): this {
    const p = {
      row: placement.row ?? child.props?.gridRow ?? 0,
      column: placement.column ?? child.props?.gridColumn ?? 0,
      rowSpan: placement.rowSpan ?? child.props?.gridRowSpan ?? 1,
      columnSpan: placement.columnSpan ?? child.props?.gridColumnSpan ?? 1,
    };
    windowsBackend.gridViewAdd(
      this.handle,
      child.handle ?? child,
      p.row,
      p.column,
      p.rowSpan,
      p.columnSpan,
    );
    this._children.push(child);
    child._parent = this;
    return this;
  }
}

export interface SplitOptions extends ViewOptions {
  vertical?: boolean;
  position?: number;
  thickness?: number;
  /** Inline styling object; accepts every SplitView option. */
  style?: StyleOf<SplitOptions>;
}

export class SplitView extends View {
  #content: any = null;
  constructor(opts: SplitOptions = {}, panes: any[] = []) {
    opts = mergeStyle(opts);
    super(windowsBackend.createSplitView(), opts);
    if (panes[0] !== undefined)
      windowsBackend.setSplitViewPane(this.handle, panes[0].handle ?? panes[0]);
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
    if (!this.#content) {
      this.setContent(v);
      return this;
    }
    windowsBackend.addSplitViewPane(this.handle, v.handle ?? v);
    this._children.push(v);
    v._parent = this;
    return this;
  }
  setPosition(points: number): void {
    windowsBackend.setSplitViewPosition(this.handle, points);
  }
}

export interface ImageOptions extends ViewOptions {
  /** File path or http(s) URL. */
  src?: string;
  scaling?: number;
  /** SVG tint colour ("#RRGGBB") — replaces fill/stroke; ignored for bitmaps. */
  tint?: string;
  /** Inline styling object; accepts every ImageView option. */
  style?: StyleOf<ImageOptions>;
}

export class ImageView extends View {
  #src: string;
  #tint: string | undefined;
  constructor(opts: ImageOptions = {}) {
    opts = mergeStyle(opts);
    super(windowsBackend.createImageView(opts.src ?? ""), opts);
    this.#src = opts.src ?? "";
    if (opts.tint !== undefined) this.tint = opts.tint;
  }
  get src(): string {
    return this.#src;
  }
  set src(v: string) {
    this.#src = v;
    if (v) windowsBackend.setImageSource(this.handle, resolveAssetPath(v), this.#tint);
  }
  /** Recolour an SVG's fill/stroke; ignored for bitmaps. */
  get tint(): string | undefined {
    return this.#tint;
  }
  set tint(v: string | undefined) {
    this.#tint = v;
    if (this.#src) windowsBackend.setImageSource(this.handle, resolveAssetPath(this.#src), v);
  }
}

export function loadImage(_src: string | any): any {
  // On Windows the path crosses the ABI directly; there is no JS image object.
  return _src;
}

export interface BlurOptions extends ViewOptions {
  material?: number;
  blending?: number;
  /** Inline styling object; accepts every BlurView option. */
  style?: StyleOf<BlurOptions>;
}

/** A translucent "vibrancy" background (Acrylic), as used by sidebars and HUDs. */
export class BlurView extends View {
  constructor(opts: BlurOptions = {}, content?: any) {
    opts = mergeStyle(opts);
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

  get rows(): Row[] {
    return this.#rows;
  }
  set rows(v: Row[]) {
    this.#rows = v ?? [];
    this.reload();
  }

  reload(): void {
    this.#cellViews.clear();
    windowsBackend.setTableRows(this.handle, this.#cells(), this.selectedIndex);
  }

  reloadRow(_index: number): void {
    this.reload();
  }

  append(row: Row): void {
    this.#rows.push(row);
    this.reload();
  }
  removeAt(index: number): void {
    this.#rows.splice(index, 1);
    this.reload();
  }

  get selectedIndex(): number {
    return windowsBackend.getTableSelected(this.handle);
  }
  get selected(): Row | null {
    const i = this.selectedIndex;
    return i >= 0 ? (this.#rows[i] ?? null) : null;
  }

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

  onSelect(fn: (row: Row | null, index: number) => void): this {
    this.#onSelect = fn;
    return this;
  }
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
  opts: {
    confirmLabel?: string;
    cancelLabel?: string;
    window?: Window;
    destructive?: boolean;
  } = {},
): Promise<boolean> {
  const r = await windowsBackend.alert({
    title,
    message,
    buttons: [opts.confirmLabel ?? "OK", opts.cancelLabel ?? "Cancel"],
    window: opts.window?.handle,
  });
  return r.button === 0;
}

export function prompt(
  title: string,
  opts: { message?: string; value?: string; placeholder?: string; window?: Window } = {},
): Promise<string | null> {
  return windowsBackend.prompt({ title, ...opts, window: opts.window?.handle });
}

export function openFile(
  opts: {
    title?: string;
    multiple?: boolean;
    types?: string[];
    chooseDirectories?: boolean;
    window?: Window;
  } = {},
): Promise<string[]> {
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
  reapplyAdaptiveColors();
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

export function saveFile(
  opts: { title?: string; defaultName?: string; window?: Window } = {},
): Promise<string | null> {
  return windowsBackend.saveFile({ defaultName: opts.defaultName, window: opts.window?.handle });
}

/** No notification centre is reachable from an unpackaged process; this is
 *  best-effort on macOS too, where it returns false without a bundle id. */
export function notify(_title: string, _body?: string): boolean {
  return false;
}

export function beep(): void {
  windowsBackend.beep();
}

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
  0x08: "delete",
  0x09: "tab",
  0x0d: "return",
  0x10: "shift",
  0x11: "control",
  0x12: "option",
  0x14: "capslock",
  0x1b: "escape",
  0x20: "space",
  0x25: "left",
  0x26: "up",
  0x27: "right",
  0x28: "down",
  0x2e: "forwarddelete",
  0x5b: "command",
  0x5c: "command",
  0x60: "numpad0",
  0x61: "numpad1",
  0x62: "numpad2",
  0x63: "numpad3",
  0x64: "numpad4",
  0x65: "numpad5",
  0x66: "numpad6",
  0x67: "numpad7",
  0x68: "numpad8",
  0x69: "numpad9",
  0x6a: "numpad*",
  0x6b: "numpad+",
  0x6d: "numpad-",
  0x6e: "numpad.",
  0x6f: "numpad/",
  0x70: "f1",
  0x71: "f2",
  0x72: "f3",
  0x73: "f4",
  0x74: "f5",
  0x75: "f6",
  0x76: "f7",
  0x77: "f8",
  0x78: "f9",
  0x79: "f10",
  0x7a: "f11",
  0x7b: "f12",
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

  get shift(): boolean {
    return this.held("shift");
  }
  get control(): boolean {
    return this.held("control");
  }
  get option(): boolean {
    return this.held("option");
  }
  get command(): boolean {
    return this.held("command");
  }

  get mouse(): MouseState {
    const local = this.#tracked ? windowsBackend.readMouseLocal(this.#tracked.handle) : null;
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
      x,
      y,
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

  onKeyDown(fn: KeyHandler): this {
    this.#keyDown.push(fn);
    return this;
  }
  onKeyUp(fn: KeyHandler): this {
    this.#keyUp.push(fn);
    return this;
  }
  onScroll(_fn: (dx: number, dy: number, event?: any) => void): this {
    return this;
  }

  /** @internal Attach to the newest window. Called once, by input(). */
  start(): this {
    if (this.#started) return this;
    this.#started = true;
    this.#hook();
    return this;
  }

  stop(): this {
    this.#started = false;
    return this;
  }

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
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
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
