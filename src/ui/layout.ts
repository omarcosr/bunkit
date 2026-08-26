// Layout containers.
//
// NSStackView covers roughly 80% of real layouts with none of the constraint
// misery, so it is the primitive here. Raw anchors remain reachable through
// View.constrain() and .native for the other 20%.

import { objc } from "../objc.ts";
import { View, mergeStyle, type StyleOf, type ViewContent, type ViewOptions } from "./view.ts";
import {
  BorderType,
  BoxType,
  LayoutAttribute,
  LayoutPriority,
  LayoutRelation,
  Orientation,
  ScrollElasticity,
  StackDistribution,
  StackGravity,
  TitlePosition,
  VisualEffectBlendingMode,
  VisualEffectMaterial,
  VisualEffectState,
  SplitViewDividerStyle,
} from "./appkit.ts";
import type { NSEdgeInsets } from "../structs.ts";
import { Range } from "../structs.ts";

export interface StackOptions extends ViewOptions {
  spacing?: number;
  /** Uniform padding, or per-edge. */
  padding?: number | Partial<NSEdgeInsets>;
  /** How leftover space is shared out. */
  distribution?: number;
  /** Cross-axis alignment (CSS `align-items`): "leading" | "center" |
   *  "trailing" | "fill". */
  alignItems?: "leading" | "center" | "trailing" | "fill";
  /**
   * What to do with leftover space along the stack's own axis (CSS
   * `justify-content`): "start" pushes the content to the top/left (the
   * default for a column), "center" centres it, "fill" shares it out among
   * the items (the default for a row). A child with `grow` always wins over
   * either.
   */
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

function insets(p: StackOptions["padding"]): NSEdgeInsets {
  if (p === undefined) return { top: 0, left: 0, bottom: 0, right: 0 };
  if (typeof p === "number") return { top: p, left: p, bottom: p, right: p };
  return { top: p.top ?? 0, left: p.left ?? 0, bottom: p.bottom ?? 0, right: p.right ?? 0 };
}

export class Stack extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: StackOptions & { orientation?: number };
  readonly orientation: number;
  readonly alignItems: "leading" | "center" | "trailing" | "fill";
  #insets: NSEdgeInsets;
  // The NSStackView itself; equals `native` unless the stack scrolls, in
  // which case `native` is the wrapping NSScrollView.
  #stack: any = null;

  constructor(orientation: number, options: StackOptions = {}, children: View[] = []) {
    options = mergeStyle(options);
    const native = objc.NSStackView.alloc().init();
    native.setOrientation_(orientation);

    const horizontal = orientation === Orientation.Horizontal;
    const insetsValue = insets(options.padding);
    native.setSpacing_(options.spacing ?? 8);
    native.setEdgeInsets_(insetsValue);
    native.setDistribution_(options.distribution ?? StackDistribution.Fill);

    // Wrap in a scroll view when asked for; the bare stack view otherwise.
    // Everything that touches children goes to `native` (the stack), never
    // to the scroll view.
    let host: any = native;
    if (options.scroll) {
      const wantH = options.scroll === true ? horizontal : options.scroll.horizontal === true;
      const wantV = options.scroll === true ? !horizontal : options.scroll.vertical === true;
      const sv = objc.NSScrollView.alloc().init();
      sv.setHasHorizontalScroller_(wantH);
      sv.setHasVerticalScroller_(wantV);
      sv.setAutohidesScrollers_(true);
      sv.setBorderType_(BorderType.None);
      sv.setDrawsBackground_(false);
      sv.setDocumentView_(native);
      // Pin the non-scrolling axis to the clip view; a document sized by
      // constraints otherwise collapses to its intrinsic size.
      const clip = sv.contentView();
      for (const [attr, scrolls] of [
        [LayoutAttribute.Width, wantH],
        [LayoutAttribute.Height, wantV],
      ] as Array<[number, boolean]>) {
        if (scrolls) continue;
        const pin = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
          native, attr, LayoutRelation.Equal, clip, attr, 1.0, 0,
        );
        pin.setActive_(true);
      }
      host = sv;
    }

    super(host, options);
    this.orientation = orientation;
    this.#stack = native;
    this.#insets = insetsValue;

    // A vertical stack almost always wants its rows full width; a horizontal
    // one almost always wants its items vertically centred.
    this.alignItems = options.alignItems ?? (horizontal ? "center" : "fill");

    // NSStackView's `alignment` is a *cross-axis* NSLayoutAttribute, and only a
    // few values are legal per orientation — Width/Height are silently ignored,
    // which is why "fill" is implemented with our own constraints below.
    const attr = horizontal
      ? { leading: LayoutAttribute.Top, center: LayoutAttribute.CenterY,
          trailing: LayoutAttribute.Bottom, fill: LayoutAttribute.Top }[this.alignItems]
      : { leading: LayoutAttribute.Leading, center: LayoutAttribute.CenterX,
          trailing: LayoutAttribute.Trailing, fill: LayoutAttribute.Leading }[this.alignItems];
    native.setAlignment_(attr);

    for (const c of children) this.add(c);

    // A column of rows should sit at the top with the slack below it, which is
    // not something NSStackView expresses; a trailing flexible view is how you
    // say it. Rows default to sharing the slack instead. "center" puts an equal
    // flexible view at each end so the content sits mid-axis.
    const pack = options.justifyContent ?? (horizontal ? "fill" : "start");
    if (pack === "start") {
      const filler = this.makeFiller();
      native.addArrangedSubview_(filler);
      this.#fillers.push(filler);
    } else if (pack === "center") {
      const lead = this.makeFiller();
      const trail = this.makeFiller();
      native.insertArrangedSubview_atIndex_(lead, 0);
      native.addArrangedSubview_(trail);
      this.#fillers.push(lead, trail);
    }
  }

  /** A flexible view with a low hugging priority, so it absorbs the stack's
   *  spare space along the main axis. */
  private makeFiller(): any {
    const filler = objc.NSView.alloc().init();
    filler.setTranslatesAutoresizingMaskIntoConstraints_(false);
    for (const a of [Orientation.Horizontal, Orientation.Vertical]) {
      filler.setContentHuggingPriority_forOrientation_(249, a);
      filler.setContentCompressionResistancePriority_forOrientation_(1, a);
    }
    return filler;
  }

  // Kept out of `children` — it is layout plumbing, not part of the tree.
  #fillers: any[] = [];

  // "fill" means every item spans the stack's cross axis. NSStackView will not
  // do this for us, so each arranged subview gets one constraint tying its
  // cross-axis size to the stack's, minus the edge insets. Priority 999 lets an
  // explicit width/height (which is Required) win instead of conflicting.
  // Growth along the main axis is opt-in: without this, whichever view happens
  // to have the lowest built-in hugging priority silently swallows all the
  // spare space, which is impossible to reason about. Pass `grow` to opt in.
  #applyMainAxisHugging(child: View) {
    if (child._growExplicit) return;
    const axis = this.orientation === Orientation.Horizontal
      ? Orientation.Horizontal
      : Orientation.Vertical;
    child.native.setContentHuggingPriority_forOrientation_(LayoutPriority.DefaultHigh, axis);
  }

  #applyFill(child: View) {
    if (this.alignItems !== "fill") return;
    const horizontal = this.orientation === Orientation.Horizontal;
    const attr = horizontal ? LayoutAttribute.Height : LayoutAttribute.Width;
    const inset = horizontal
      ? this.#insets.top + this.#insets.bottom
      : this.#insets.left + this.#insets.right;
    const c = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
      child.native, attr, LayoutRelation.Equal, this.#stack, attr, 1.0, -inset,
    );
    c.setPriority_(999);
    c.setActive_(true);
    this.retainJS(c);
  }

  // An arranged subview is added by NSStackView itself, so we only mirror the
  // bookkeeping rather than calling View.add (which would add it twice).
  add(child: any): this {
    const fillers = this.#fillers.length;
    if (fillers === 1) {
      // "start": the single trailing filler must stay last.
      this.#stack.insertArrangedSubview_atIndex_(child.native, this._children.length);
    } else if (fillers === 2) {
      // "center": a leading filler at 0 and a trailing one at the end.
      this.#stack.insertArrangedSubview_atIndex_(child.native, this._children.length + 1);
    } else {
      this.#stack.addArrangedSubview_(child.native);
    }
    this._children.push(child);
    child._parent = this;
    this.#applyFill(child);
    this.#applyMainAxisHugging(child);
    child._enableInteractionWindow();
    child._refreshShadowTree();
    return this;
  }

  insert(child: any, index: number): this {
    this.#stack.insertArrangedSubview_atIndex_(child.native, index);
    this._children.splice(index, 0, child);
    child._parent = this;
    this.#applyFill(child);
    this.#applyMainAxisHugging(child);
    child._enableInteractionWindow();
    child._refreshShadowTree();
    return this;
  }

  remove(child: any): this {
    this.#stack.removeArrangedSubview_(child.native);
    child.native.removeFromSuperview();
    const i = this._children.indexOf(child);
    if (i >= 0) this._children.splice(i, 1);
    child._parent = null;
    return this;
  }

  removeAll(): this {
    for (const c of [...this.children]) this.remove(c);
    return this;
  }

  set spacing(v: number) {
    this.#stack.setSpacing_(v);
  }

  /** Pin a view to a gravity area (leading/center/trailing). */
  addToGravity(child: View, gravity: number): this {
    this.#stack.addView_inGravity_(child.native, gravity);
    this._children.push(child);
    child._parent = this;
    return this;
  }
}

export class VStack extends Stack {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: StackOptions;
  constructor(options: StackOptions = {}, children: View[] = []) {
    super(Orientation.Vertical, options, children);
  }
}

export class HStack extends Stack {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: StackOptions;
  constructor(options: StackOptions = {}, children: View[] = []) {
    super(Orientation.Horizontal, options, children);
  }
}

/** Flexible empty space. Put one between two views to push them apart. */
export class Spacer extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: { min?: number };
  constructor(options: { min?: number } = {}) {
    const v = objc.NSView.alloc().init();
    super(v, {});
    this.setHugging(LayoutPriority.FittingSizeCompression, Orientation.Horizontal);
    this.setHugging(LayoutPriority.FittingSizeCompression, Orientation.Vertical);
    this.setCompressionResistance(1, Orientation.Horizontal);
    this.setCompressionResistance(1, Orientation.Vertical);
    if (options.min !== undefined) {
      this.constrain("width", ">=", options.min, LayoutPriority.DefaultLow);
      this.constrain("height", ">=", options.min, LayoutPriority.DefaultLow);
    }
  }
}

/** A 1px separator line. */
export class Separator extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: { orientation?: number };
  constructor(orientation: number = Orientation.Horizontal) {
    const b = objc.NSBox.alloc().init();
    b.setBoxType_(BoxType.Separator);
    super(b, {});
    if (orientation === Orientation.Horizontal) this.setHeight(1);
    else this.setWidth(1);
  }
}

export interface ScrollOptions extends ViewOptions {
  horizontal?: boolean;
  vertical?: boolean;
  border?: boolean;
  /** Let the document view stretch to the scroll view's width. */
  fitWidth?: boolean;
  /** Inline styling object; accepts every ScrollView option. */
  style?: StyleOf<ScrollOptions>;
}

/** A scrolling container around a single content view. */
export class ScrollView extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: ScrollOptions;
  #content: View | null = null;

  constructor(options: ScrollOptions = {}, content?: ViewContent) {
    options = mergeStyle(options);
    const sv = objc.NSScrollView.alloc().init();
    sv.setHasVerticalScroller_(options.vertical !== false);
    sv.setHasHorizontalScroller_(options.horizontal === true);
    sv.setAutohidesScrollers_(true);
    sv.setBorderType_(options.border ? BorderType.Bezel : BorderType.None);
    sv.setDrawsBackground_(false);
    if (options.horizontal !== true) sv.setHorizontalScrollElasticity_(ScrollElasticity.None);
    super(sv, options);
    // An NSScrollView has no intrinsic height, so give it a floor rather than
    // letting it vanish in a stack that hugs its content.
    if (options.height === undefined && options.minHeight === undefined) {
      this.constrain("height", ">=", 80);
    }
    if (content) this.content = content as View;
  }

  get content(): View | null {
    return this.#content;
  }

  set content(v: View | null) {
    this.#content = v;
    if (!v) {
      this.native.setDocumentView_(null);
      return;
    }
    this.native.setDocumentView_(v.native);
    // A document view sized by constraints still needs its width pinned to the
    // clip view, otherwise it collapses to its intrinsic width.
    const clip = this.native.contentView();
    const c = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
      v.native, LayoutAttribute.Width, LayoutRelation.Equal, clip, LayoutAttribute.Width, 1.0, 0,
    );
    c.setActive_(true);
    this.retainJS(c);
  }

  scrollToTop(): void {
    const doc = this.native.documentView();
    if (doc) this.native.contentView().scrollToPoint_({ x: 0, y: 0 });
    this.native.reflectScrolledClipView_(this.native.contentView());
  }

  scrollToBottom(): void {
    const doc = this.native.documentView();
    if (!doc) return;
    const h = doc.frame().height;
    const vh = this.native.contentView().bounds().height;
    this.native.contentView().scrollToPoint_({ x: 0, y: Math.max(0, h - vh) });
    this.native.reflectScrolledClipView_(this.native.contentView());
  }
}

export interface BoxOptions extends ViewOptions {
  title?: string;
  padding?: number;
  spacing?: number;
  /** Border colour; pass null for no border. */
  border?: any;
  radius?: number;
  /** Inline styling object; accepts every GroupBox option. */
  style?: StyleOf<BoxOptions>;
}

/**
 * A titled group of controls.
 *
 * Deliberately not an NSBox: NSBox positions its content view with springs and
 * derives no intrinsic size from it, so a constraint-driven NSBox collapses to
 * nothing. This is a plain bordered container instead, which behaves.
 */
export class GroupBox extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: BoxOptions;
  readonly contentStack: VStack;
  readonly titleLabel: View | null = null;

  constructor(options: BoxOptions = {}, children: View[] = []) {
    options = mergeStyle(options);
    const outer = objc.NSStackView.alloc().init();
    outer.setOrientation_(Orientation.Vertical);
    outer.setSpacing_(6);
    outer.setAlignment_(LayoutAttribute.Leading);
    outer.setDistribution_(StackDistribution.Fill);
    super(outer, options);

    if (options.title !== undefined) {
      const label = objc.NSTextField.labelWithString_(options.title);
      label.setTranslatesAutoresizingMaskIntoConstraints_(false);
      label.setFont_(objc.NSFont.systemFontOfSize_weight_(11, 0.3));
      label.setTextColor_(objc.NSColor.secondaryLabelColor());
      outer.addArrangedSubview_(label);
      this.titleLabel = new View(label, {});
    }

    this.contentStack = new VStack({
      spacing: options.spacing ?? 8,
      padding: options.padding ?? 10,
    }, children);
    if (options.border !== null) {
      this.contentStack.setBorder(options.border ?? "separator", 1, options.radius ?? 8);
    }
    outer.addArrangedSubview_(this.contentStack.native);
    this._children.push(this.contentStack);
    this.contentStack._parent = this;

    // Title and body both span the group's full width.
    for (const v of [this.titleLabel, this.contentStack]) {
      if (!v) continue;
      const c = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
        v.native, LayoutAttribute.Width, LayoutRelation.Equal, outer, LayoutAttribute.Width, 1.0, 0,
      );
      c.setPriority_(999);
      c.setActive_(true);
      this.retainJS(c);
    }
  }

  add(child: any): this {
    this.contentStack.add(child);
    return this;
  }

  removeAll(): this {
    this.contentStack.removeAll();
    return this;
  }
}

export interface BlurOptions extends ViewOptions {
  material?: number;
  blending?: number;
  /** Inline styling object; accepts every BlurView option. */
  style?: StyleOf<BlurOptions>;
}

/** A translucent "vibrancy" background, as used by sidebars and HUDs. */
export class BlurView extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: BlurOptions;
  constructor(options: BlurOptions = {}, content?: ViewContent) {
    options = mergeStyle(options);
    const v = objc.NSVisualEffectView.alloc().init();
    v.setMaterial_(options.material ?? VisualEffectMaterial.Sidebar);
    v.setBlendingMode_(options.blending ?? VisualEffectBlendingMode.BehindWindow);
    v.setState_(VisualEffectState.Active);
    super(v, options);
    if (content) this.fill(content as View);
  }
}

/** A plain container you can fill or position children in yourself. */
export class Container extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: ViewOptions;
  constructor(options: ViewOptions = {}, children: View[] = []) {
    super(objc.NSView.alloc().init(), options);
    for (const c of children) this.add(c);
  }
}

export interface SplitOptions extends ViewOptions {
  vertical?: boolean;
  /** Initial position of the divider, in points from the leading edge. */
  position?: number;
  thickness?: number;
  /** Inline styling object; accepts every SplitView option. */
  style?: StyleOf<SplitOptions>;
}

export class SplitView extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: SplitOptions;
  constructor(options: SplitOptions = {}, panes: View[] = []) {
    options = mergeStyle(options);
    const sv = objc.NSSplitView.alloc().init();
    sv.setVertical_(options.vertical !== false);
    sv.setDividerStyle_(SplitViewDividerStyle.Thin);
    super(sv, options);
    for (const p of panes) this.addPane(p);
    if (options.position !== undefined) {
      // Applied once the view has a size.
      queueMicrotask(() => this.setPosition(options.position!, 0));
    }
  }

  addPane(v: View): this {
    this.native.addArrangedSubview_(v.native);
    this._children.push(v);
    v._parent = this;
    return this;
  }

  setPosition(points: number, dividerIndex = 0): void {
    this.native.setPosition_ofDividerAtIndex_(points, dividerIndex);
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
 *       <Label text="Notes" gridRow={1} gridColumn={0} gridRowSpan={2} />
 *     </GridView>
 *
 * Backed by NSGridView: fixed tracks are exact, "auto" sizes to content, and
 * "fill" tracks absorb the leftover space via the grid's .fill distribution
 * (their cells hug least). */
export class GridView extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: GridViewOptions;
  /** @internal */ #rows = 0;
  /** @internal */ #cols = 0;

  constructor(options: GridViewOptions = {}, children: any[] = []) {
    options = mergeStyle(options);
    const grid = objc.NSGridView.alloc().init();
    super(grid, options);
    const rowSpacing = options.rowSpacing ?? options.spacing ?? 0;
    const colSpacing = options.columnSpacing ?? options.spacing ?? 0;
    if (rowSpacing > 0) grid.setRowSpacing_(rowSpacing);
    if (colSpacing > 0) grid.setColumnSpacing_(colSpacing);
    if (options.columns?.includes("fill") || options.rows?.includes("fill")) {
      // NSGridDistributionFill: fixed tracks keep their width, the rest of the
      // space goes to the tracks whose cells hug least (see #applyTrack).
      grid.setColumnDistribution_(1);
      grid.setRowDistribution_(1);
      grid.setContentHuggingPriority_forOrientation_(1, 0);
      grid.setContentHuggingPriority_forOrientation_(1, 1);
    }
    for (const c of children) this.add(c);
    // Tracks from options pin sizes even when no child sits in that track.
    const cols = options.columns ?? [];
    const rows = options.rows ?? [];
    for (let c = 0; c < cols.length; c++) this.#ensure(0, c);
    for (let r = 0; r < rows.length; r++) this.#ensure(r, 0);
    for (let c = 0; c < cols.length; c++) this.#applyTrack(cols[c], c, true);
    for (let r = 0; r < rows.length; r++) this.#applyTrack(rows[r], r, false);
  }

  add(child: any, placement: GridPlacement = {}): this {
    const p = {
      row: placement.row ?? child.props?.gridRow ?? 0,
      column: placement.column ?? child.props?.gridColumn ?? 0,
      rowSpan: placement.rowSpan ?? child.props?.gridRowSpan ?? 1,
      columnSpan: placement.columnSpan ?? child.props?.gridColumnSpan ?? 1,
    };
    const endRow = p.row + p.rowSpan - 1;
    const endCol = p.column + p.columnSpan - 1;
    this.#ensure(endRow, endCol);
    this.native.cellAtColumn_row_(p.column, p.row).setContentView_(child.native);
    if (p.rowSpan > 1 || p.columnSpan > 1) {
      // mergeCellIn:to: takes NSRanges used as (row, column) pairs.
      this.native.mergeCellIn_to_(Range(p.row, p.column), Range(endRow, endCol));
    }
    this._children.push(child);
    child._parent = this;
    child._enableInteractionWindow();
    child._refreshShadowTree();
    return this;
  }

  /** Grow the grid until cell (row, col) exists, filling new cells with
   *  empty NSViews. */
  #ensure(row: number, col: number): void {
    while (this.#rows < row + 1) {
      const views: any[] = [];
      for (let c = 0; c < this.#cols; c++) views.push(objc.NSView.alloc().init());
      this.native.addRowWithViews_(views);
      this.#rows++;
    }
    while (this.#cols < col + 1) {
      const views: any[] = [];
      for (let r = 0; r < this.#rows; r++) views.push(objc.NSView.alloc().init());
      this.native.addColumnWithViews_(views);
      this.#cols++;
    }
  }

  /** Size a track: fixed points, "auto" (default), or "fill" — bias the .fill
   *  distribution towards it by making its cells hug least. */
  #applyTrack(track: GridTrack, index: number, horizontal: boolean): void {
    if (typeof track === "number") {
      if (horizontal) this.native.columnAtIndex_(index).setWidth_(track);
      else this.native.rowAtIndex_(index).setHeight_(track);
      return;
    }
    if (track === "fill") {
      const axis = horizontal ? 0 : 1; // NSLayoutConstraintOrientation
      const n = horizontal ? this.#rows : this.#cols;
      for (let i = 0; i < n; i++) {
        const cell = horizontal
          ? this.native.cellAtColumn_row_(index, i)
          : this.native.cellAtColumn_row_(i, index);
        cell.contentView().setContentHuggingPriority_forOrientation_(1, axis);
      }
    }
  }
}
