// Table — NSTableView with a JS-shaped API.
//
// NSTableView pulls data through a datasource protocol, which maps badly onto a
// JS array. The wrapper inverts it: you hand over an array and a renderer, and
// it implements the protocol against them.

import { createDelegate, objc, str } from "../objc.ts";
import { ACTION_SELECTOR, actionTarget, View, mergeStyle, type ViewOptions, type ViewStyle } from "./view.ts";
import { makeFont, type FontSpec } from "./controls.ts";
import {
  BorderType,
  LayoutAttribute,
  LayoutRelation,
  LineBreakMode,
  TableColumnResizing,
  TableViewColumnAutoresizingStyle,
  TableViewSelectionHighlightStyle,
  TableViewStyle,
  TextAlignment,
} from "./appkit.ts";

export interface Column<Row = any> {
  id: string;
  title: string;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  textAlign?: "left" | "center" | "right";
  /** Absorb the table's spare width. Defaults to any column with no `width`. */
  flex?: boolean;
  /** Produce the cell text for a row. Defaults to `row[id]`. */
  value?: (row: Row, index: number) => string;
  /** Produce a whole view for the cell; wins over `value`. */
  render?: (row: Row, index: number) => View | unknown;
}

export interface TableOptions<Row = any> extends Omit<ViewOptions, "style"> {
  columns: Column<Row>[];
  rows?: Row[];
  onSelect?: (row: Row | null, index: number) => void;
  onDoubleClick?: (row: Row, index: number) => void;
  rowHeight?: number;
  headers?: boolean;
  /** "plain" | "inset" | "sourceList" | "fullWidth", or a styling object
   *  (the shared `style` prop) when given an object. */
  style?: keyof typeof TableViewStyle | ViewStyle;
  alternatingRows?: boolean;
  multiSelect?: boolean;
  font?: FontSpec | number;
}

export class Table<Row = any> extends View {
  /** JSX props type (ElementAttributesProperty). */
  declare readonly props: TableOptions<Row>;
  readonly tableView: any;
  readonly scrollView: any;
  #rows: Row[] = [];
  #columns: Column<Row>[];
  #dataSource: any;
  #onSelect?: (row: Row | null, index: number) => void;
  #onDoubleClick?: (row: Row, index: number) => void;
  #font: any;
  // Views handed to AppKit must stay reachable from JS until AppKit lets go.
  #cellViews = new Set<any>();

  constructor(options: TableOptions<Row>) {
    const scroll = objc.NSScrollView.alloc().init();
    scroll.setHasVerticalScroller_(true);
    scroll.setHasHorizontalScroller_(false);
    scroll.setAutohidesScrollers_(true);
    scroll.setBorderType_(BorderType.None);
    scroll.setDrawsBackground_(false);

    const tv = objc.NSTableView.alloc().init();
    tv.setStyle_(TableViewStyle[typeof options.style === "string" ? options.style : "Inset"]);
    tv.setUsesAlternatingRowBackgroundColors_(options.alternatingRows ?? false);
    tv.setAllowsMultipleSelection_(options.multiSelect ?? false);
    tv.setColumnAutoresizingStyle_(TableViewColumnAutoresizingStyle.Uniform);
    tv.setSelectionHighlightStyle_(TableViewSelectionHighlightStyle.Regular);
    tv.setRowHeight_(options.rowHeight ?? 24);
    if (options.headers === false) tv.setHeaderView_(null);

    scroll.setDocumentView_(tv);
    super(scroll, mergeStyle(options as unknown as ViewOptions));

    if (options.height === undefined && options.minHeight === undefined) {
      this.constrain("height", ">=", 120);
    }
    this.scrollView = scroll;
    this.tableView = tv;
    this.#columns = options.columns;
    this.#rows = options.rows ?? [];
    this.#onSelect = options.onSelect;
    this.#onDoubleClick = options.onDoubleClick;
    this.#font = options.font !== undefined ? makeFont(options.font) : null;

    // Slack goes to the columns marked `flex`, else to those with no explicit
    // width, else to the last one so the table never leaves a dead strip.
    const explicitFlex = options.columns.some((c) => c.flex);
    const anyAuto = options.columns.some((c) => c.width === undefined);
    options.columns.forEach((c, i) => {
      const flexible = explicitFlex
        ? !!c.flex
        : anyAuto
          ? c.width === undefined
          : i === options.columns.length - 1;
      this.addColumn(c, flexible);
    });
    this.installDataSource();
    tv.reloadData();
  }

  private addColumn(c: Column<Row>, flexible: boolean) {
    const col = objc.NSTableColumn.alloc().initWithIdentifier_(c.id);
    col.setTitle_(c.title);
    if (c.width !== undefined) col.setWidth_(c.width);
    if (c.minWidth !== undefined) col.setMinWidth_(c.minWidth);
    if (c.maxWidth !== undefined) col.setMaxWidth_(c.maxWidth);
    // Only columns in the autoresizing mask absorb slack when the table grows,
    // so a column given an explicit width keeps it.
    col.setResizingMask_(
      TableColumnResizing.UserResizing | (flexible ? TableColumnResizing.Autoresizing : 0),
    );
    this.tableView.addTableColumn_(col);
  }

  private installDataSource() {
    const self = this;
    this.#dataSource = createDelegate(
      {
        numberOfRowsInTableView_: () => self.#rows.length,

        // View-based tables: return a configured NSView for the cell. AppKit
        // recycles views through makeViewWithIdentifier:owner:.
        "tableView:viewForTableColumn:row:": (_tv: any, column: any, row: number) => {
          const colId = str(column.identifier());
          const spec = self.#columns.find((c) => c.id === colId);
          const index = Number(row);
          const data = self.#rows[index];
          if (!spec || data === undefined) return null;

          if (spec.render) {
            const v = spec.render(data, index) as View | null | undefined;
            if (!v) return null;
            self.#cellViews.add(v);
            return v.native;
          }

          let cell = self.tableView.makeViewWithIdentifier_owner_(colId, self.#dataSource);
          if (!cell) {
            // An NSTextField handed straight back as the cell view draws its
            // text at the top of the row rather than the middle — a 26pt row
            // with a 13pt font leaves the glyphs 10pt above centre. The fix is
            // the structure AppKit expects: an NSTableCellView whose textField
            // is pinned to the vertical centre.
            cell = objc.NSTableCellView.alloc().init();
            cell.setIdentifier_(colId);

            const text = objc.NSTextField.labelWithString_("");
            text.setTranslatesAutoresizingMaskIntoConstraints_(false);
            text.setLineBreakMode_(LineBreakMode.TruncatingTail);
            text.setBordered_(false);
            text.setDrawsBackground_(false);
            if (self.#font) text.setFont_(self.#font);
            if (spec.textAlign) {
              text.setAlignment_(
                spec.textAlign === "center" ? TextAlignment.Center
                : spec.textAlign === "right" ? TextAlignment.Right
                : TextAlignment.Left,
              );
            }
            cell.addSubview_(text);
            cell.setTextField_(text);

            for (const [attr, constant] of [
              [LayoutAttribute.Leading, 0],
              [LayoutAttribute.Trailing, 0],
              [LayoutAttribute.CenterY, 0],
            ] as Array<[number, number]>) {
              const c = objc.NSLayoutConstraint.constraintWithItem_attribute_relatedBy_toItem_attribute_multiplier_constant_(
                text, attr, LayoutRelation.Equal, cell, attr, 1.0, constant,
              );
              c.setActive_(true);
            }
            self.#cellViews.add(cell);
          }
          const text = spec.value ? spec.value(data, index) : String((data as any)?.[colId] ?? "");
          cell.textField().setStringValue_(text ?? "");
          return cell;
        },

        tableViewSelectionDidChange_: () => {
          const i = self.selectedIndex;
          self.#onSelect?.(i >= 0 ? (self.#rows[i] ?? null) : null, i);
        },
      },
      {
        protocols: ["NSTableViewDataSource", "NSTableViewDelegate"],
        name: "Table",
      },
    );
    this.retainJS(this.#dataSource);
    this.tableView.setDataSource_(this.#dataSource);
    this.tableView.setDelegate_(this.#dataSource);

    if (this.#onDoubleClick) {
      const t = actionTarget(() => {
        const i = this.selectedIndex;
        if (i >= 0 && this.#rows[i] !== undefined) this.#onDoubleClick!(this.#rows[i]!, i);
      });
      this.retainJS(t);
      this.tableView.setTarget_(t);
      this.tableView.setDoubleAction_(ACTION_SELECTOR);
    }
  }

  // --- data ----------------------------------------------------------------

  get rows(): Row[] {
    return this.#rows;
  }

  set rows(v: Row[]) {
    this.#rows = v ?? [];
    this.reload();
  }

  reload(): void {
    this.#cellViews.clear();
    this.tableView.reloadData();
  }

  /** Refresh a single row without rebuilding the table. */
  reloadRow(index: number): void {
    const rows = objc.NSIndexSet.indexSetWithIndex_(index);
    const cols = objc.NSIndexSet.indexSetWithIndexesInRange_({
      location: 0,
      length: this.#columns.length,
    });
    this.tableView.reloadDataForRowIndexes_columnIndexes_(rows, cols);
  }

  append(row: Row): void {
    this.#rows.push(row);
    this.tableView.reloadData();
  }

  removeAt(index: number): void {
    this.#rows.splice(index, 1);
    this.tableView.reloadData();
  }

  // --- selection -----------------------------------------------------------

  get selectedIndex(): number {
    const i = this.tableView.selectedRow();
    return Number(i);
  }

  get selected(): Row | null {
    const i = this.selectedIndex;
    return i >= 0 ? (this.#rows[i] ?? null) : null;
  }

  get selectedIndexes(): number[] {
    const set = this.tableView.selectedRowIndexes();
    const out: number[] = [];
    let i = Number(set.firstIndex());
    // NSNotFound
    while (i >= 0 && i < 9007199254740991) {
      out.push(i);
      const next = Number(set.indexGreaterThanIndex_(i));
      if (next === i || next > 1e15) break;
      i = next;
    }
    return out;
  }

  select(index: number): void {
    if (index < 0) {
      this.tableView.deselectAll_(null);
      return;
    }
    this.tableView.selectRowIndexes_byExtendingSelection_(
      objc.NSIndexSet.indexSetWithIndex_(index), false,
    );
    this.tableView.scrollRowToVisible_(index);
  }

  onSelect(fn: (row: Row | null, index: number) => void): this {
    this.#onSelect = fn;
    return this;
  }
}
