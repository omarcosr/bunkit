# CSS → BunKit reference

BunKit does not ship a CSS engine. Layout happens in the OS's own layout
system (AppKit on macOS, WinUI on Windows), so each CSS concept maps to a
named control or an option — `<VStack>` is `display: flex; flex-direction:
column`, `<GridView>` is `display: grid`, and so on. The mapping below is the
translation table. All values are points (macOS) or device-independent pixels
(Windows) — there are no `%` lengths and no em/rem.

## Display

| CSS | BunKit |
|---|---|
| `display: flex; flex-direction: column` | `<VStack>` |
| `display: flex; flex-direction: row` | `<HStack>` |
| `display: grid` | `<GridView>` |
| `display: block` | `<Container>` |
| `display: none` | `hidden` |
| `display: contents` | `<Fragment>` (JSX `<>…</>`) |
| `display: inline` | n/a — text lives in `Label` |

`Container` is the "div": a plain box with `backgroundColor`, `border`,
`borderRadius`, sizing and children. On Windows its children stack vertically
like a `block` div; on macOS they are positioned freely (see *Position*).

## Flexbox

| CSS | BunKit |
|---|---|
| `gap` | `spacing` |
| `align-items: flex-start/center/flex-end/stretch` | `alignItems: "leading" / "center" / "trailing" / "fill"` |
| `justify-content: flex-start/center/space-between` | `justifyContent: "start" / "center" / "fill"` |
| `flex-grow` | `grow` (number; 0 = don't grow) |
| `flex: 1` on the parent + overflow | `scroll` on the stack (`<VStack scroll>` scrolls its own axis) |
| `flex-wrap` | n/a — repetition is explicit (`<For>` + stacks) |
| `flex-shrink`, `flex-basis`, `order` | n/a — native controls keep their intrinsic sizes |

```tsx
<VStack spacing={12} alignItems="center" justifyContent="center" padding={24}>
  <Label text="Hi" />
  <HStack spacing={8} grow={0}>
    <Button title="−" />
    <Button title="+" primary />
  </HStack>
</VStack>
```

## Grid

| CSS | BunKit |
|---|---|
| `grid-template-columns` | `columns` on `<GridView>` |
| `grid-template-rows` | `rows` |
| `gap` | `spacing` |
| `row-gap` / `column-gap` | `rowSpacing` / `columnSpacing` |
| `grid-row` / `grid-column` | `gridRow` / `gridColumn` on the child |
| `grid-row-span` / `grid-column-span` | `gridRowSpan` / `gridColumnSpan` on the child |
| `grid-template-areas`, auto-placement | n/a — placement is explicit |
| `1fr` / fixed px / auto | `"fill"` / `200` / `"auto"` |

```tsx
<GridView columns={["fill", 200]} rows={["auto", "auto"]} spacing={12}>
  <Label text="Name" gridColumn={0} gridRow={0} />
  <TextField gridColumn={1} gridRow={0} />
  <Label text="Notes" gridColumn={0} gridRow={1} gridRowSpan={2} />
</GridView>
```

A child placed without props goes to cell (0, 0). Imperative placement is
equivalent: `grid.add(view, { row: 1, column: 1, rowSpan: 2 })`.

## Box model

| CSS | BunKit |
|---|---|
| `width` / `height` | `width` / `height` |
| `min-width` / `min-height` | `minWidth` / `minHeight` |
| `max-width` / `max-height` | `maxWidth` / `maxHeight` |
| `margin` | `spacing` between siblings in a stack; individual margins n/a |
| `padding` | `padding` on `VStack` / `HStack` / `GroupBox` |
| `border-width` | `border` (number, `true` for 1, `[top, right, bottom, left]`, or per-side names) |
| `border-color` | `borderColor` |
| `border-style` | `borderStyle: "solid" / "dashed" / "dotted"` |
| `border-radius` | `borderRadius` (number, `[tl, tr, br, bl]`, or per-corner names) |
| `box-shadow` | `shadow` (CSS-like string or `ShadowSpec`; one outer shadow) |
| `box-sizing` | always border-box |
| `aspect-ratio` | n/a |

```tsx
<Container
  backgroundColor={{ light: "#FFFFFF", dark: "#1E1E1E" }}
  border={1}
  borderColor="#8A8A8A"
  borderRadius={12}
>
  …
</Container>
```

## Position

| CSS | BunKit |
|---|---|
| `position: static` | the default — flow inside a stack |
| `position: absolute` | `Container` on macOS (children are positioned freely); on Windows children stack — parity pending |
| `position: fixed` / `sticky` | n/a |
| `z-index` | child order in a stack (later = on top) |

## Typography

| CSS | BunKit |
|---|---|
| `font-size` | `font.size` (Label, TextField, TextArea) |
| `font-weight` | `font.weight: "regular" / "medium" / "semibold" / "bold"` |
| `font-family` | `font.family` / `font.monospace: true` |
| `color` | `color` on `Label` — plain hex or theme-adaptive `{ light, dark }` |
| `text-align` | `alignment` on `Label` |
| `line-height` | n/a |
| `letter-spacing` | n/a |

## Background & effects

| CSS | BunKit |
|---|---|
| `background-color` | `backgroundColor` / `background` on any view |
| `background-image` | `<ImageView src="…" />` (PNG/JPG/SVG, local or http(s)) |
| `opacity` | `alpha` (0…1) |
| `visibility: hidden` | `hidden` |
| `filter: blur(…)` | `<BlurView>` (behind content) |
| `cursor` | n/a — native cursors |

## Overflow

| CSS | BunKit |
|---|---|
| `overflow: auto` | `scroll` on a stack (`<VStack scroll>`; explicit `{ horizontal, vertical }` to pick axes) |
| `overflow: hidden` | the default — content clips |

## Theme ("media queries")

There is no `prefers-color-scheme` in CSS-in-JS terms; BunKit colours are
**theme-adaptive by construction**:

```tsx
<Label color={{ light: "#1F3B4D", dark: "#E0E0E0" }} />
```

Every option that takes a colour accepts `{ light, dark }`; the active variant
resolves against the current theme (`Application({ theme })` or `setTheme`)
and re-resolves automatically when the theme changes. `Application({
theme: "default" })` follows the system.

## Reactivity

CSS has no state, so the mental model stops here — but a UI built on BunKit
re-renders through data, not reflows: values live in `signal`s, controls bind
them in their options (`value={name}`), and lists render with `<For>`:

```tsx
const todos = signal<Todo[]>([]);

<For each={todos} by={(t) => t.id}>
  {(todo) => <Row todo={todo} />}
</For>
```

There is no virtual DOM; a signal update touches exactly the control that
subscribed to it.
