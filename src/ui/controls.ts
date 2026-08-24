// Controls — labels, buttons, fields, and the rest of the everyday widgets.
//
// Every control exposes events as plain callbacks (`onClick`, `onChange`); the
// delegate and target/action machinery stays out of sight in Layer 2.

import { createDelegate, objc, str } from "../objc.ts";
import type { Signal } from "../signal.ts";
import { bindSignals, unwrap } from "../signal.ts";
import { ACTION_SELECTOR, actionTarget, toNSColor, View, type ViewOptions, type ColorValue } from "./view.ts";
import {
  AutoresizingMask,
  BezelStyle,
  BorderType,
  ButtonType,
  ControlSize,
  ControlState,
  FontWeight,
  ImagePosition,
  ImageScaling,
  LineBreakMode,
  Orientation,
  ProgressIndicatorStyle,
  SegmentStyle,
  TextAlignment,
  TextFieldBezelStyle,
} from "./appkit.ts";

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

export type FontWeightName =
  | "ultraLight" | "thin" | "light" | "regular"
  | "medium" | "semibold" | "bold" | "heavy" | "black";

export interface FontSpec {
  size?: number;
  weight?: number | FontWeightName;
  monospace?: boolean;
  /** Use the system font at a semantic size instead of a point size. */
  style?: "body" | "title" | "headline" | "caption" | "largeTitle";
}

const STYLE_SIZES: Record<string, number> = {
  largeTitle: 26,
  title: 20,
  headline: 15,
  body: 13,
  caption: 11,
};

const WEIGHTS: Record<FontWeightName, number> = {
  ultraLight: FontWeight.UltraLight,
  thin: FontWeight.Thin,
  light: FontWeight.Light,
  regular: FontWeight.Regular,
  medium: FontWeight.Medium,
  semibold: FontWeight.Semibold,
  bold: FontWeight.Bold,
  heavy: FontWeight.Heavy,
  black: FontWeight.Black,
};

export function makeFont(spec: FontSpec | number | undefined): any {
  if (spec === undefined) return null;
  if (typeof spec === "number") return objc.NSFont.systemFontOfSize_(spec);
  const size = spec.size ?? (spec.style ? STYLE_SIZES[spec.style]! : 13);
  const weight =
    typeof spec.weight === "string" ? WEIGHTS[spec.weight] : (spec.weight ?? FontWeight.Regular);
  if (spec.monospace) return objc.NSFont.monospacedSystemFontOfSize_weight_(size, weight);
  return objc.NSFont.systemFontOfSize_weight_(size, weight);
}

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

export interface LabelOptions extends ViewOptions {
  text?: string | Signal<string>;
  font?: FontSpec | number;
  /** Text colour: a semantic name ("secondaryLabel"…) or a CSS hex string. */
  color?: ColorValue;
  textAlign?: "left" | "center" | "right";
  /** Wrap onto multiple lines instead of truncating. */
  wrap?: boolean;
  selectable?: boolean;
  lines?: number;
}

export class Label extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: LabelOptions;
  constructor(options: LabelOptions = {}) {
    const f = objc.NSTextField.labelWithString_(unwrap(options.text) ?? "");
    super(f, options);
    this.applyLabelOptions(options);
    bindSignals(this, options);
  }

  protected applyLabelOptions(o: LabelOptions) {
    const f = this.native;
    if (o.font !== undefined) f.setFont_(makeFont(o.font));
    if (o.color !== undefined) f.setTextColor_(toNSColor(o.color));
    if (o.textAlign !== undefined) {
      f.setAlignment_(
        o.textAlign === "center" ? TextAlignment.Center
        : o.textAlign === "right" ? TextAlignment.Right
        : TextAlignment.Left,
      );
    }
    if (o.selectable !== undefined) f.setSelectable_(o.selectable);
    if (o.wrap) {
      f.setLineBreakMode_(LineBreakMode.WordWrapping);
      f.cell().setWraps_(true);
      f.setUsesSingleLineMode_(false);
      if (o.lines !== undefined) f.setMaximumNumberOfLines_(o.lines);
      // A wrapping label must know how wide it is allowed to be.
      f.setPreferredMaxLayoutWidth_(o.width ?? o.maxWidth ?? 0);
    }
  }

  get text(): string {
    return str(this.native.stringValue());
  }

  set text(v: string) {
    this.native.setStringValue_(v ?? "");
  }

  set color(v: any) {
    this.native.setTextColor_(toNSColor(v));
  }

  set font(v: FontSpec | number) {
    this.native.setFont_(makeFont(v));
  }
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export interface ButtonOptions extends ViewOptions {
  title?: string | Signal<string>;
  onClick?: (button: Button) => void;
  /** Draw as the window's default button and respond to Return. */
  primary?: boolean;
  destructive?: boolean;
  enabled?: boolean;
  /** An SF Symbol name, e.g. "plus.circle". */
  symbol?: string;
  bezel?: number;
  size?: number;
  key?: string;
  bordered?: boolean;
}

export class Button extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: ButtonOptions;
  #handler: ((b: Button) => void) | null = null;

  constructor(options: ButtonOptions = {}) {
    const b = objc.NSButton.buttonWithTitle_target_action_(unwrap(options.title) ?? "", null, null);
    super(b, options);

    if (options.symbol) {
      const img = objc.NSImage.imageWithSystemSymbolName_accessibilityDescription_(
        options.symbol, options.title ?? options.symbol,
      );
      if (img) {
        b.setImage_(img);
        b.setImagePosition_(options.title ? ImagePosition.ImageLeft : ImagePosition.ImageOnly);
      }
    }
    if (options.bezel !== undefined) b.setBezelStyle_(options.bezel);
    if (options.size !== undefined) b.setControlSize_(options.size);
    if (options.bordered !== undefined) b.setBordered_(options.bordered);
    if (options.enabled !== undefined) b.setEnabled_(options.enabled);
    if (options.primary) b.setKeyEquivalent_("\r");
    if (options.key) b.setKeyEquivalent_(options.key);
    if (options.destructive) {
      b.setContentTintColor_(toNSColor("red"));
      if (b.respondsTo("setHasDestructiveAction:")) b.setHasDestructiveAction_(true);
    }
    if (options.onClick) this.onClick(options.onClick);
    bindSignals(this, options);
  }

  onClick(fn: (b: Button) => void): this {
    this.#handler = fn;
    const target = actionTarget(() => this.#handler?.(this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
    return this;
  }

  /** Fire the button's action as though the user clicked it. */
  click(): void {
    this.native.performClick_(null);
  }

  get title(): string {
    return str(this.native.title());
  }

  set title(v: string) {
    this.native.setTitle_(v);
  }

  get enabled(): boolean {
    return this.native.isEnabled();
  }

  set enabled(v: boolean) {
    this.native.setEnabled_(v);
  }
}

// ---------------------------------------------------------------------------
// Checkbox / Switch / Radio
// ---------------------------------------------------------------------------

export interface CheckboxOptions extends ViewOptions {
  title?: string | Signal<string>;
  checked?: boolean | Signal<boolean>;
  onChange?: (checked: boolean, cb: Checkbox) => void;
  enabled?: boolean;
}

export class Checkbox extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: CheckboxOptions;
  #handler: ((checked: boolean, cb: Checkbox) => void) | null = null;

  constructor(options: CheckboxOptions = {}) {
    const b = objc.NSButton.checkboxWithTitle_target_action_(options.title ?? "", null, null);
    super(b, options);
    if (options.checked !== undefined) this.checked = unwrap(options.checked);
    if (options.enabled !== undefined) b.setEnabled_(options.enabled);
    if (options.onChange) this.onChange(options.onChange);
    bindSignals(this, options);
  }

  onChange(fn: (checked: boolean, cb: Checkbox) => void): this {
    this.#handler = fn;
    const target = actionTarget(() => this.#handler?.(this.checked, this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
    return this;
  }

  get checked(): boolean {
    return Number(this.native.state()) === ControlState.On;
  }

  set checked(v: boolean) {
    this.native.setState_(v ? ControlState.On : ControlState.Off);
  }

  get title(): string {
    return str(this.native.title());
  }

  set title(v: string) {
    this.native.setTitle_(v);
  }
}

export class Switch extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: ViewOptions & { on?: boolean | Signal<boolean>; onChange?: (on: boolean, s: Switch) => void };
  #handler: ((on: boolean, s: Switch) => void) | null = null;

  constructor(options: { on?: boolean | Signal<boolean>; onChange?: (on: boolean, s: Switch) => void } & ViewOptions = {}) {
    const s = objc.NSSwitch.alloc().init();
    super(s, options);
    if (options.on !== undefined) this.on = unwrap(options.on);
    if (options.onChange) this.onChange(options.onChange);
    bindSignals(this, options);
  }

  onChange(fn: (on: boolean, s: Switch) => void): this {
    this.#handler = fn;
    const target = actionTarget(() => this.#handler?.(this.on, this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
    return this;
  }

  get on(): boolean {
    return Number(this.native.state()) === ControlState.On;
  }

  set on(v: boolean) {
    this.native.setState_(v ? ControlState.On : ControlState.Off);
  }
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------

export interface TextFieldOptions extends ViewOptions {
  value?: string | Signal<string>;
  placeholder?: string;
  /** Fires on every keystroke. */
  onChange?: (value: string, field: TextField) => void;
  /** Fires when the user presses Return or the field loses focus. */
  onSubmit?: (value: string, field: TextField) => void;
  secure?: boolean;
  editable?: boolean;
  font?: FontSpec | number;
  textAlign?: "left" | "center" | "right";
  enabled?: boolean;
  /** Text colour: a semantic name ("secondaryLabel"…) or a CSS hex string. */
  textColor?: ColorValue;
  /** Placeholder colour (semantic name or CSS hex string). */
  placeholderColor?: ColorValue;
}

export class TextField extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: TextFieldOptions;
  #onChange: ((v: string, f: TextField) => void) | null = null;
  #onSubmit: ((v: string, f: TextField) => void) | null = null;

  constructor(options: TextFieldOptions = {}) {
    const f = options.secure
      ? objc.NSSecureTextField.alloc().init()
      : objc.NSTextField.alloc().init();
    super(f, options);

    if (options.value !== undefined) f.setStringValue_(unwrap(options.value));
    if (options.placeholder !== undefined) f.setPlaceholderString_(options.placeholder);
    if (options.textColor !== undefined) f.setTextColor_(toNSColor(options.textColor));
    if (options.placeholderColor !== undefined && options.placeholder !== undefined) {
      const attrs = objc.NSDictionary.dictionaryWithObject_forKey_(
        toNSColor(options.placeholderColor), "NSForegroundColorAttributeName");
      f.setPlaceholderAttributedString_(
        objc.NSAttributedString.alloc().initWithString_attributes_(
          options.placeholder, attrs));
    }
    if (options.editable !== undefined) f.setEditable_(options.editable);
    if (options.enabled !== undefined) f.setEnabled_(options.enabled);
    if (options.font !== undefined) f.setFont_(makeFont(options.font));
    if (options.textAlign !== undefined) {
      f.setAlignment_(
        options.textAlign === "center" ? TextAlignment.Center
        : options.textAlign === "right" ? TextAlignment.Right
        : TextAlignment.Left,
      );
    }
    f.setBezelStyle_(TextFieldBezelStyle.Square);
    f.setBezeled_(true);

    this.#onChange = options.onChange ?? null;
    this.#onSubmit = options.onSubmit ?? null;
    this.installDelegate();
    bindSignals(this, options);
  }

  private installDelegate() {
    const d = createDelegate(
      {
        controlTextDidChange_: () => this.#onChange?.(this.value, this),
        controlTextDidEndEditing_: () => this.#onSubmit?.(this.value, this),
      },
      { protocols: ["NSTextFieldDelegate"], name: "TextField" },
    );
    this.retainJS(d);
    this.native.setDelegate_(d);
    // Return key also fires the action.
    const target = actionTarget(() => this.#onSubmit?.(this.value, this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
  }

  onChange(fn: (v: string, f: TextField) => void): this {
    this.#onChange = fn;
    return this;
  }

  onSubmit(fn: (v: string, f: TextField) => void): this {
    this.#onSubmit = fn;
    return this;
  }

  get value(): string {
    return str(this.native.stringValue());
  }

  set value(v: string) {
    this.native.setStringValue_(v ?? "");
  }

  focus(): void {
    const w = this.native.window();
    if (w) w.makeFirstResponder_(this.native);
  }

  selectAll(): void {
    this.native.selectText_(null);
  }
}

// ---------------------------------------------------------------------------
// TextView (multi-line)
// ---------------------------------------------------------------------------

export interface TextAreaOptions extends ViewOptions {
  value?: string | Signal<string>;
  onChange?: (value: string, t: TextArea) => void;
  font?: FontSpec | number;
  editable?: boolean;
  richText?: boolean;
  /** Text colour: a semantic name ("secondaryLabel"…) or a CSS hex string. */
  textColor?: ColorValue;
}

export class TextArea extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: TextAreaOptions;
  readonly textView: any;
  #onChange: ((v: string, t: TextArea) => void) | null = null;

  constructor(options: TextAreaOptions = {}) {
    const scroll = objc.NSScrollView.alloc().init();
    scroll.setHasVerticalScroller_(true);
    scroll.setBorderType_(BorderType.Bezel);
    const tv = objc.NSTextView.alloc().init();
    tv.setMinSize_({ width: 0, height: 0 });
    tv.setMaxSize_({ width: 1e7, height: 1e7 });
    tv.setVerticallyResizable_(true);
    tv.setHorizontallyResizable_(false);
    tv.setAutoresizingMask_(AutoresizingMask.WidthSizable);
    tv.textContainer().setWidthTracksTextView_(true);
    tv.setRichText_(options.richText ?? false);
    if (options.editable !== undefined) tv.setEditable_(options.editable);
    if (options.font !== undefined) tv.setFont_(makeFont(options.font));
    if (options.textColor !== undefined) tv.setTextColor_(toNSColor(options.textColor));
    if (options.value !== undefined) tv.setString_(unwrap(options.value));
    scroll.setDocumentView_(tv);

    super(scroll, options);
    if (options.height === undefined && options.minHeight === undefined) {
      this.constrain("height", ">=", 80);
    }
    this.textView = tv;
    this.#onChange = options.onChange ?? null;

    const d = createDelegate(
      { textDidChange_: () => this.#onChange?.(this.value, this) },
      { protocols: ["NSTextViewDelegate"], name: "TextView" },
    );
    this.retainJS(d);
    tv.setDelegate_(d);
    bindSignals(this, options);
  }

  get value(): string {
    return str(this.textView.string());
  }

  set value(v: string) {
    this.textView.setString_(v ?? "");
  }

  append(v: string): void {
    this.textView.setString_(this.value + v);
    this.textView.scrollRangeToVisible_({ location: this.value.length, length: 0 });
  }
}

// ---------------------------------------------------------------------------
// Slider
// ---------------------------------------------------------------------------

export interface SliderOptions extends ViewOptions {
  value?: number | Signal<number>;
  min?: number;
  max?: number;
  ticks?: number;
  onChange?: (value: number, s: Slider) => void;
  vertical?: boolean;
}

export class Slider extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: SliderOptions;
  #handler: ((v: number, s: Slider) => void) | null = null;

  constructor(options: SliderOptions = {}) {
    const s = objc.NSSlider.alloc().init();
    s.setMinValue_(options.min ?? 0);
    s.setMaxValue_(options.max ?? 1);
    s.setDoubleValue_(unwrap(options.value) ?? options.min ?? 0);
    if (options.ticks) {
      s.setNumberOfTickMarks_(options.ticks);
      s.setAllowsTickMarkValuesOnly_(false);
    }
    if (options.vertical) s.setVertical_(true);
    super(s, options);
    if (options.onChange) this.onChange(options.onChange);
    bindSignals(this, options);
  }

  onChange(fn: (v: number, s: Slider) => void): this {
    this.#handler = fn;
    const target = actionTarget(() => this.#handler?.(this.value, this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
    this.native.setContinuous_(true);
    return this;
  }

  get value(): number {
    return Number(this.native.doubleValue());
  }

  set value(v: number) {
    this.native.setDoubleValue_(v);
  }
}

// ---------------------------------------------------------------------------
// PopUpButton / SegmentedControl
// ---------------------------------------------------------------------------

export interface SelectOptions extends ViewOptions {
  items?: string[];
  selected?: number | Signal<number>;
  onChange?: (index: number, title: string, s: Select) => void;
  enabled?: boolean;
}

export class Select extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: SelectOptions;
  #handler: ((i: number, t: string, s: Select) => void) | null = null;

  constructor(options: SelectOptions = {}) {
    const p = objc.NSPopUpButton.alloc().initWithFrame_pullsDown_(
      { x: 0, y: 0, width: 120, height: 25 }, false,
    );
    super(p, options);
    if (options.items) this.items = options.items;
    if (options.selected !== undefined) this.selectedIndex = unwrap(options.selected);
    if (options.enabled !== undefined) p.setEnabled_(options.enabled);
    if (options.onChange) this.onChange(options.onChange);
    bindSignals(this, options);
  }

  onChange(fn: (i: number, t: string, s: Select) => void): this {
    this.#handler = fn;
    const target = actionTarget(() => this.#handler?.(this.selectedIndex, this.selectedTitle, this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
    return this;
  }

  set items(v: string[]) {
    this.native.removeAllItems();
    for (const t of v) this.native.addItemWithTitle_(t);
  }

  get selectedIndex(): number {
    return Number(this.native.indexOfSelectedItem());
  }

  set selectedIndex(i: number) {
    this.native.selectItemAtIndex_(i);
  }

  get selectedTitle(): string {
    return str(this.native.titleOfSelectedItem());
  }
}

export interface SegmentedOptions extends ViewOptions {
  items: string[];
  selected?: number | Signal<number>;
  onChange?: (index: number, s: Segmented) => void;
}

export class Segmented extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: SegmentedOptions;
  #handler: ((i: number, s: Segmented) => void) | null = null;

  constructor(options: SegmentedOptions) {
    const sc = objc.NSSegmentedControl.alloc().init();
    sc.setSegmentCount_(options.items.length);
    options.items.forEach((t, i) => {
      sc.setLabel_forSegment_(t, i);
      sc.setWidth_forSegment_(0, i);
    });
    sc.setSegmentStyle_(SegmentStyle.Rounded);
    sc.setSelectedSegment_(unwrap(options.selected) ?? 0);
    super(sc, options);
    if (options.onChange) this.onChange(options.onChange);
    bindSignals(this, options);
  }

  onChange(fn: (i: number, s: Segmented) => void): this {
    this.#handler = fn;
    const target = actionTarget(() => this.#handler?.(this.selectedIndex, this));
    this.retainJS(target);
    this.native.setTarget_(target);
    this.native.setAction_(ACTION_SELECTOR);
    return this;
  }

  get selectedIndex(): number {
    return Number(this.native.selectedSegment());
  }

  set selectedIndex(i: number) {
    this.native.setSelectedSegment_(i);
  }
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressOptions extends ViewOptions {
  value?: number | Signal<number>;
  max?: number;
  indeterminate?: boolean;
  spinner?: boolean;
}

export class Progress extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: ProgressOptions;
  constructor(options: ProgressOptions = {}) {
    const p = objc.NSProgressIndicator.alloc().init();
    p.setStyle_(options.spinner ? ProgressIndicatorStyle.Spinning : ProgressIndicatorStyle.Bar);
    p.setIndeterminate_(options.indeterminate ?? !!options.spinner);
    p.setMinValue_(0);
    p.setMaxValue_(options.max ?? 1);
    p.setDoubleValue_(unwrap(options.value) ?? 0);
    super(p, options);
    if (options.indeterminate || options.spinner) p.startAnimation_(null);
    bindSignals(this, options);
  }

  get value(): number {
    return Number(this.native.doubleValue());
  }

  set value(v: number) {
    this.native.setDoubleValue_(v);
  }

  start(): void {
    this.native.startAnimation_(null);
  }

  stop(): void {
    this.native.stopAnimation_(null);
  }
}

// ---------------------------------------------------------------------------
// Image
// ---------------------------------------------------------------------------

export interface ImageOptions extends ViewOptions {
  /** File path, SF Symbol name (prefix "sf:"), or an NSImage. */
  src?: string | any;
  scaling?: number;
}

export class ImageView extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: ImageOptions;
  constructor(options: ImageOptions = {}) {
    const v = objc.NSImageView.alloc().init();
    v.setImageScaling_(options.scaling ?? ImageScaling.ProportionallyUpOrDown);
    super(v, options);
    if (options.src !== undefined) this.src = options.src;
    bindSignals(this, options);
  }

  set src(v: string | any) {
    this.native.setImage_(loadImage(v));
  }
}

export function loadImage(src: string | any): any {
  if (src === null || src === undefined) return null;
  if (typeof src !== "string") return src;
  if (src.startsWith("sf:")) {
    return objc.NSImage.imageWithSystemSymbolName_accessibilityDescription_(src.slice(3), null);
  }
  if (src.startsWith("named:")) {
    return objc.NSImage.imageNamed_(src.slice(6));
  }
  return objc.NSImage.alloc().initWithContentsOfFile_(src);
}

export { BezelStyle, ButtonType, ControlSize, ControlState, Orientation };
