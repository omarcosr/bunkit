// The View base class — everything visible in Layer 3 is one of these.
//
// A View is a thin, stateful wrapper over an NSView. It deliberately does not
// diff or reconcile: AppKit views are retained, stateful objects and treating
// them like a virtual DOM is a category error. You mutate properties; the view
// updates.

import { objc, createBlock, createDelegate, nativeOf, ObjCObject } from "../objc.ts";
import { LayoutAttribute, LayoutPriority, LayoutRelation, Orientation } from "./appkit.ts";
import type { CGRect, CGSize } from "../structs.ts";

let actionCounter = 0;

/**
 * A target/action pair. AppKit controls need an Obj-C object with a selector,
 * so we mint a tiny runtime class per handler; all of them share one Obj-C
 * class because createDelegate caches by *shape*.
 */
export function actionTarget(fn: (sender: any) => void): ObjCObject {
  return createDelegate(
    { "brAction:": (sender: any) => fn(sender) },
    { types: { "brAction:": "v@:@" }, name: "Action" },
  );
}

export const ACTION_SELECTOR = "brAction:";

/**
 * Priority for sizes given in ViewOptions.
 *
 * Just below Required, deliberately. A `width: 220` is a strong preference, not
 * a promise the layout can keep at every window size — and when it cannot be
 * kept, compressing the view is right and letting it spill outside its
 * container is not. Call `constrain()` yourself if you truly need Required.
 */
export const SIZE_PRIORITY = LayoutPriority.Required - 1;

/** A View, or a JSX expression that evaluates to one. Content slots
 *  (Window.content, ScrollView/BlurView content) accept both: at runtime a
 *  JSX expression already is the control, and editors that resolve JSX
 *  through React's runtime (no bunkit tsconfig) type it as ReactElement. */
export type ViewContent = View | object;

export { nativeOf } from "../objc.ts";

export interface ViewOptions {
  /** Fixed width in points. */
  width?: number;
  /** Fixed height in points. */
  height?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  /** In a stack, how eagerly this view takes leftover space (0 = not at all). */
  grow?: number;
  hidden?: boolean;
  tooltip?: string;
  /** Opaque identifier; also used for view reuse in tables. */
  id?: string;
  /** Background colour: a semantic name, a CSS hex string, or an RGB object. */
  background?: ColorValue;
  /** CSS-style alias for `background`. */
  backgroundColor?: ColorValue;
  /** Border width — one number for all sides, `true` for 1,
   *  [top, right, bottom, left], or per-side names (CSS border-width vocabulary). */
  border?: number | boolean | BorderSideSpec;
  /** Alias for `border` (uniform number only). */
  borderWidth?: number;
  /** Border colour: a semantic name, a CSS hex string, or an RGB object. */
  borderColor?: ColorValue;
  /** Corner radius — one number for all corners, [tl, tr, br, bl], or
   *  per-corner names (CSS border-radius vocabulary). */
  borderRadius?: CornerRadiusSpec;
  /** "solid" (default), "dashed" or "dotted". */
  borderStyle?: "solid" | "dashed" | "dotted";
  alpha?: number;
  /** JSX children; ignored by controls that don't take content. */
  children?: any;
  /** A reusable styling object, merged into the options at construction.
   *  Inline props win over the style. Works in JSX too:
   *  `<Button style={{ backgroundColor: "#2D7DD2", borderRadius: 14 }} />`. */
  style?: ViewStyle;
}

/** The visual styling subset of ViewOptions, for the `style` prop and for
 *  reusable style objects (`satisfies ViewStyle`). */
export type ViewStyle = Omit<ViewOptions, "style" | "children">;

/** Merge `options.style` into the options; inline props take precedence.
 *  A non-object `style` (e.g. Table's "inset" style name) is left alone. */
export function mergeStyle(options: ViewOptions): ViewOptions {
  const { style, ...rest } = options;
  if (!style || typeof style !== "object") return rest;
  return { ...(style as ViewStyle), ...rest };
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

/** A bezier path with independent radii per corner (AppKit coordinates,
 *  bottom-left origin, tl/tr/br/bl in CSS terms). */
function roundedBezier(bounds: any, tl: number, tr: number, br: number, bl: number): any {
  const x = bounds.x, y = bounds.y, w = bounds.width, h = bounds.height;
  const path = objc.NSBezierPath.bezierPath();
  path.moveToPoint_({ x: x + tl, y: y + h });
  if (tr > 0) {
    path.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_({ x: x + w - tr, y: y + h - tr }, tr, 90, 0);
    path.lineTo_({ x: x + w, y: y + h - tr });
  } else {
    path.lineTo_({ x: x + w, y: y + h });
  }
  path.lineTo_({ x: x + w, y: y + br });
  if (br > 0) {
    path.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_({ x: x + w - br, y: y + br }, br, 0, -90);
  }
  path.lineTo_({ x: x + bl, y: y });
  if (bl > 0) {
    path.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_({ x: x + bl, y: y + bl }, bl, -90, -180);
  }
  path.lineTo_({ x: x, y: y + h - tl });
  if (tl > 0) {
    path.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_({ x: x + tl, y: y + h - tl }, tl, 180, 90);
  }
  path.closePath();
  return path;
}

/** Four open bezier paths, one per side [top, right, bottom, left], each
 *  covering its straight edge plus the two adjacent corner arcs (AppKit
 *  coordinates, same arcs/angles as roundedBezier). An arc shared by two
 *  active sides is stroked twice at the same geometry — invisible with a
 *  single border colour. */
function sideBeziers(bounds: any, tl: number, tr: number, br: number, bl: number): [any, any, any, any] {
  const x = bounds.x, y = bounds.y, w = bounds.width, h = bounds.height;
  const arc = (path: any, cx: number, cy: number, r: number, a: number, b: number) =>
    path.appendBezierPathWithArcWithCenter_radius_startAngle_endAngle_({ x: cx, y: cy }, r, a, b);
  const top = objc.NSBezierPath.bezierPath();
  top.moveToPoint_({ x, y: y + h - tl });
  if (tl > 0) arc(top, x + tl, y + h - tl, tl, 180, 90);
  top.lineTo_({ x: x + w - tr, y: y + h });
  if (tr > 0) arc(top, x + w - tr, y + h - tr, tr, 90, 0);
  const right = objc.NSBezierPath.bezierPath();
  right.moveToPoint_({ x: x + w - tr, y: y + h });
  if (tr > 0) arc(right, x + w - tr, y + h - tr, tr, 90, 0);
  right.lineTo_({ x: x + w, y: y + br });
  if (br > 0) arc(right, x + w - br, y + br, br, 0, -90);
  const bottom = objc.NSBezierPath.bezierPath();
  bottom.moveToPoint_({ x: x + w, y: y + br });
  if (br > 0) arc(bottom, x + w - br, y + br, br, 0, -90);
  bottom.lineTo_({ x: x + bl, y });
  if (bl > 0) arc(bottom, x + bl, y + bl, bl, -90, -180);
  const left = objc.NSBezierPath.bezierPath();
  left.moveToPoint_({ x: x + bl, y });
  if (bl > 0) arc(left, x + bl, y + bl, bl, -90, -180);
  left.lineTo_({ x, y: y + h - tl });
  if (tl > 0) arc(left, x + tl, y + h - tl, tl, 180, 90);
  return [top, right, bottom, left];
}

export class View {
  readonly native: any;
  /** @internal */ _children: View[] = [];
  /** @internal */ _parent: View | null = null;
  /** @internal */ _keepAlive: any[] = [];
  /** @internal Set once `grow` has been chosen explicitly. */
  _growExplicit = false;

  // React-compat stubs. If @types/react is in the program, its JSX namespace
  // requires class components to satisfy `Component<any, any, any>` (the
  // ElementClass gate). These make every control structurally valid as a JSX
  // element in that environment too; they are never called.
  declare context: unknown;
  declare state: any;
  setState(state: any, callback?: () => void): void {}
  forceUpdate(callback?: () => void): void {}
  render(): any { return null; }

  constructor(native: any, options: ViewOptions = {}) {
    this.native = native;
    // Everything in Layer 3 is laid out with constraints, never springs.
    native.setTranslatesAutoresizingMaskIntoConstraints_(false);
    this.applyViewOptions(mergeStyle(options));
  }

  protected applyViewOptions(o: ViewOptions) {
    if (o.width !== undefined) this.setWidth(o.width);
    if (o.height !== undefined) this.setHeight(o.height);
    if (o.minWidth !== undefined) this.constrain("width", ">=", o.minWidth, SIZE_PRIORITY);
    if (o.minHeight !== undefined) this.constrain("height", ">=", o.minHeight, SIZE_PRIORITY);
    if (o.maxWidth !== undefined) this.constrain("width", "<=", o.maxWidth, SIZE_PRIORITY);
    if (o.maxHeight !== undefined) this.constrain("height", "<=", o.maxHeight, SIZE_PRIORITY);
    if (o.grow !== undefined) this.grow = o.grow;
    if (o.hidden !== undefined) this.hidden = o.hidden;
    if (o.tooltip !== undefined) this.native.setToolTip_(o.tooltip);
    if (o.id !== undefined) this.native.setIdentifier_(o.id);
    if (o.alpha !== undefined) this.native.setAlphaValue_(o.alpha);
    if (o.borderRadius !== undefined) {
      this.applyCorners(o.borderRadius);
    }
    if (o.background !== undefined) this.setBackground(o.background);
    else if (o.backgroundColor !== undefined) this.setBackground(o.backgroundColor);

    // CSS-style borders: `border`/`borderWidth` (or `borderColor`/`borderStyle`
    // alone) turn the border on; `borderRadius` rides along when present.
    const borderSpec = o.border !== undefined ? o.border : o.borderWidth;
    if (borderSpec !== undefined || o.borderColor !== undefined || o.borderStyle !== undefined) {
      this.setBorder(
        o.borderColor ?? "#C6C6C8",
        borderSpec ?? 1,
        o.borderRadius ?? 0,
        o.borderStyle ?? "solid",
      );
    }
  }

  /** Keep a JS object reachable for as long as this view is. */
  retainJS(v: any) {
    this._keepAlive.push(v);
  }

  // --- hierarchy -----------------------------------------------------------

  get children(): readonly View[] {
    return this._children;
  }

  get parent(): View | null {
    return this._parent;
  }

  add(child: View): this {
    this.native.addSubview_(child.native);
    this._children.push(child);
    child._parent = this;
    return this;
  }

  removeFromParent(): void {
    this.native.removeFromSuperview();
    if (this._parent) {
      const i = this._parent._children.indexOf(this);
      if (i >= 0) this._parent._children.splice(i, 1);
      this._parent = null;
    }
  }

  // --- geometry ------------------------------------------------------------

  get frame(): CGRect {
    return this.native.frame();
  }

  set frame(r: CGRect) {
    this.native.setFrame_(r);
  }

  get bounds(): CGRect {
    return this.native.bounds();
  }

  get intrinsicSize(): CGSize {
    return this.native.intrinsicContentSize();
  }

  get fittingSize(): CGSize {
    return this.native.fittingSize();
  }

  /**
   * The rectangle Auto Layout actually constrains. Controls like NSTextField
   * and NSButton draw a couple of points outside it, so this — not `frame` — is
   * what a width constraint of 60 makes 60 wide.
   */
  get alignmentRect(): CGRect {
    return this.native.alignmentRectForFrame_(this.native.frame());
  }

  // --- constraints ---------------------------------------------------------

  /**
   * Add a constraint against a constant, e.g. `constrain("width", ">=", 120)`.
   * Returns the NSLayoutConstraint so it can be deactivated later.
   */
  constrain(
    attribute: keyof typeof LayoutAttribute | "width" | "height",
    relation: "==" | ">=" | "<=",
    constant: number,
    priority = LayoutPriority.Required,
  ): any {
    const attrName = (attribute[0]!.toUpperCase() + attribute.slice(1)) as keyof typeof LayoutAttribute;
    const attr = LayoutAttribute[attrName] ?? LayoutAttribute[attribute as keyof typeof LayoutAttribute];
    const rel =
      relation === "==" ? LayoutRelation.Equal
      : relation === ">=" ? LayoutRelation.GreaterThanOrEqual
      : LayoutRelation.LessThanOrEqual;
    const c = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
      this.native, attr, rel, null, LayoutAttribute.NotAnAttribute, 1.0, constant,
    );
    c.setPriority_(priority);
    c.setActive_(true);
    this.retainJS(c);
    return c;
  }

  setWidth(w: number, priority = SIZE_PRIORITY): this {
    this.constrain("width", "==", w, priority);
    return this;
  }

  setHeight(h: number, priority = SIZE_PRIORITY): this {
    this.constrain("height", "==", h, priority);
    return this;
  }

  /**
   * How readily this view gives up space to its siblings in a stack.
   * 0 = never grows (hugs its content); higher = grows first.
   */
  set grow(v: number) {
    this._growExplicit = true;
    // Lower hugging = expands sooner. Keep grown views well below the packing
    // spacer (249) so they, not the spacer, absorb the slack.
    const hugging = v > 0 ? Math.max(1, 200 - v * 50) : LayoutPriority.DefaultHigh + 1;
    for (const a of [Orientation.Horizontal, Orientation.Vertical]) {
      this.native.setContentHuggingPriority_forOrientation_(hugging, a);
    }
  }

  setHugging(priority: number, axis: number): this {
    this.native.setContentHuggingPriority_forOrientation_(priority, axis);
    return this;
  }

  setCompressionResistance(priority: number, axis: number): this {
    this.native.setContentCompressionResistancePriority_forOrientation_(priority, axis);
    return this;
  }

  /** Pin every edge of `child` to this view, with optional padding. */
  fill(child: View, padding = 0): this {
    this.add(child);
    const pin = (attr: number, constant: number) => {
      const c = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
        child.native, attr, LayoutRelation.Equal, this.native, attr, 1.0, constant,
      );
      c.setActive_(true);
      this.retainJS(c);
    };
    pin(LayoutAttribute.Left, padding);
    pin(LayoutAttribute.Top, padding);
    pin(LayoutAttribute.Right, -padding);
    pin(LayoutAttribute.Bottom, -padding);
    return this;
  }

  // --- appearance ----------------------------------------------------------

  get hidden(): boolean {
    return this.native.isHidden();
  }

  set hidden(v: boolean) {
    this.native.setHidden_(v);
  }

  setBackground(color: any): this {
    this.native.setWantsLayer_(true);
    const nsColor = toNSColor(color);
    if (nsColor) this.native.layer().setBackgroundColor_(nsColor.send("CGColor"));
    return this;
  }

  /** Draw a border in `color` with a per-side width (see BorderSideSpec), an
   *  optional corner radius and style. Uniform solid uses the layer's own
   *  border; dashed/dotted or differing per-side widths swap in stroked
   *  CAShapeLayers that follow the view's frame. */
  setBorder(color: any, width: BorderSideSpec | boolean | number = 1, radius: CornerRadiusSpec | number = 0, style: "solid" | "dashed" | "dotted" = "solid"): this {
    this.native.setWantsLayer_(true);
    const layer = this.native.layer();
    const nsColor = toNSColor(color);
    this.#removeBorderShapes();
    const [top, right, bottom, left] = normalizeSides(width as BorderSideSpec);
    const uniform = top === right && right === bottom && bottom === left;
    if (style === "solid" && uniform) {
      if (nsColor) layer.setBorderColor_(nsColor.send("CGColor"));
      layer.setBorderWidth_(top);
      if (radius !== 0) this.applyCorners(radius);
      return this;
    }
    // Dashed/dotted or per-side widths: CALayer borders cannot stroke a
    // pattern or differ per side, so shape layers over the border do it,
    // rebuilt whenever the frame changes. Uniform widths share one layer
    // with the full rounded path; differing widths get one per active side.
    layer.setBorderWidth_(0);
    const cg = nsColor ? nsColor.send("CGColor") : null;
    const mkShape = (w: number) => {
      const shape = objc.CAShapeLayer.layer();
      if (cg) shape.setStrokeColor_(cg);
      shape.setLineWidth_(w);
      shape.setFillColor_(null);
      const unit = Math.max(1, w);
      if (style === "dashed") shape.setLineDashPattern_([unit * 4, unit * 3]);
      else if (style === "dotted") shape.setLineDashPattern_([unit, unit * 3]);
      return shape;
    };
    const shapes: (any | null)[] = uniform
      ? [mkShape(top)]
      : [top, right, bottom, left].map((w) => (w > 0 ? mkShape(w) : null));
    const [rtl, rtr, rbr, rbl] = normalizeCorners(radius as CornerRadiusSpec);
    const rebuild = () => {
      const bounds = this.native.bounds();
      if (uniform) {
        shapes[0]!.setPath_(roundedBezier(bounds, rtl, rtr, rbr, rbl));
      } else {
        const paths = sideBeziers(bounds, rtl, rtr, rbr, rbl);
        shapes.forEach((s, i) => s && s.setPath_(paths[i]));
      }
    };
    rebuild();
    for (const s of shapes) if (s) layer.addSublayer_(s);
    this.#borderShapes = shapes.filter((s) => s);
    this.native.setPostsFrameChangedNotification_(true);
    const block = createBlock("v@?@@", () => rebuild());
    this.retainJS(block);
    this.retainJS(objc.NSNotificationCenter.defaultCenter()
      .addObserverForName_object_queue_usingBlock_(
        "NSViewFrameDidChangeNotification", this.native, null, block));
    return this;
  }

  /** Corner radii on the backing layer. Uniform is a plain corner radius;
   *  per-corner needs a bezier path mask (CACornerMask covers rounding but
   *  not differing radii, so the path is the general answer). */
  applyCorners(spec: CornerRadiusSpec): this {
    this.native.setWantsLayer_(true);
    const layer = this.native.layer();
    const [tl, tr, br, bl] = normalizeCorners(spec);
    if (tl === tr && tr === br && br === bl) {
      layer.setCornerRadius_(tl);
      layer.setMask_(null);
      return this;
    }
    const rebuild = () => {
      const bounds = this.native.bounds();
      layer.setMask_(objc.CAShapeLayer.layer());
      layer.mask().setPath_(roundedBezier(bounds, tl, tr, br, bl));
      layer.setCornerRadius_(0);
    };
    rebuild();
    this.native.setPostsFrameChangedNotification_(true);
    const block = createBlock("v@?@@", () => rebuild());
    this.retainJS(block);
    this.retainJS(objc.NSNotificationCenter.defaultCenter()
      .addObserverForName_object_queue_usingBlock_(
        "NSViewFrameDidChangeNotification", this.native, null, block));
    return this;
  }

  #borderShapes: any[] = [];

  #removeBorderShapes() {
    for (const shape of this.#borderShapes) {
      try { shape.removeFromSuperlayer(); } catch { /* already gone */ }
    }
    this.#borderShapes = [];
  }

  needsDisplay(): void {
    this.native.setNeedsDisplay_(true);
  }

  /** The window this view is in, if any. */
  get windowNative(): any {
    return this.native.window();
  }
}

// ---------------------------------------------------------------------------
// Colour helpers (shared by every view)
// ---------------------------------------------------------------------------

/** Accepts an NSColor, a "#rrggbb"/"#rrggbbaa" string, or {r,g,b,a} in 0..1. */
export function toNSColor(v: any): any {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v?.native) return v.native; // a Color instance
  if (typeof v === "object" && v?.ptr !== undefined) return v; // already an NSColor
  if (typeof v === "string") return colorFromString(v);
  if (typeof v === "object") {
    return objc.NSColor.colorWithSRGBRed_green_blue_alpha_(
      v.r ?? 0, v.g ?? 0, v.b ?? 0, v.a ?? 1,
    );
  }
  return null;
}

const NAMED_COLORS = {
  label: "labelColor",
  secondaryLabel: "secondaryLabelColor",
  tertiaryLabel: "tertiaryLabelColor",
  quaternaryLabel: "quaternaryLabelColor",
  placeholderText: "placeholderTextColor",
  link: "linkColor",
  separator: "separatorColor",
  windowBackground: "windowBackgroundColor",
  controlBackground: "controlBackgroundColor",
  control: "controlColor",
  controlAccent: "controlAccentColor",
  selectedContentBackground: "selectedContentBackgroundColor",
  textBackground: "textBackgroundColor",
  text: "textColor",
  textColor: "textColor",
  clear: "clearColor",
  white: "whiteColor",
  black: "blackColor",
  red: "systemRedColor",
  green: "systemGreenColor",
  blue: "systemBlueColor",
  orange: "systemOrangeColor",
  yellow: "systemYellowColor",
  purple: "systemPurpleColor",
  pink: "systemPinkColor",
  teal: "systemTealColor",
  indigo: "systemIndigoColor",
  gray: "systemGrayColor",
  grey: "systemGrayColor",
  brown: "systemBrownColor",
  mint: "systemMintColor",
  cyan: "systemCyanColor",
} as const;

/** A semantic colour name understood by both platforms ("secondaryLabel" is
 *  the system colour for secondary text and adapts to light/dark mode), or a
 *  CSS hex string like "#ff8800". */
export type ColorName = keyof typeof NAMED_COLORS;
export type ColorValue = ColorName | `#${string}` | { r: number; g: number; b: number; a?: number };

function colorFromString(s: string): any {
  const named = (NAMED_COLORS as Record<string, string | undefined>)[s];
  if (named) return objc.NSColor.send(named);
  const hex = s.replace(/^#/, "");
  const parse = (i: number) => parseInt(hex.substr(i, 2), 16) / 255;
  if (hex.length === 3) {
    const c = (i: number) => parseInt(hex[i]! + hex[i]!, 16) / 255;
    return objc.NSColor.colorWithSRGBRed_green_blue_alpha_(c(0), c(1), c(2), 1);
  }
  if (hex.length === 6) {
    return objc.NSColor.colorWithSRGBRed_green_blue_alpha_(parse(0), parse(2), parse(4), 1);
  }
  if (hex.length === 8) {
    return objc.NSColor.colorWithSRGBRed_green_blue_alpha_(parse(0), parse(2), parse(4), parse(6));
  }
  return objc.NSColor.labelColor();
}
