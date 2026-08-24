# BunKit on Windows — WinUI 3 Backend

This document describes how to build and run BunKit with the Windows backend
(`winbridge.dll` → C++/WinRT → Windows App SDK → WinUI 3).

## Requirements

- Windows 10 21H2 or Windows 11, x64
- [Bun](https://bun.sh) 1.4+
- Visual Studio 2022 or 2026 with **Desktop development with C++**
  (MSVC v145, Windows SDK 10.0.26100, C++ ATL)
- Windows App SDK Runtime 1.7 (7000.785+) — installed by the Windows installer

Check:

```powershell
bun --version        # >=1.4.0
where cl             # via VsDevCmd
Get-AppxPackage *WindowsAppRuntime*  # should list 1.7 or newer
```

## Build

The Windows backend is a plain C-ABI DLL loaded by `bun:ffi` — no WebView,
no Electron, no subprocess.

```powershell
bun install
bun run build:windows   # -> build/winbridge.dll (+ Microsoft.WindowsAppRuntime.Bootstrap.dll)
```

The script:

1. Fetches `Microsoft.WindowsAppSDK` 1.7 and `Microsoft.Windows.CppWinRT` 2.0 via NuGet (cached in `native/windows/deps`)
2. Restores the `bridge.vcxproj` (`PackageReference` → WinUI + C++/WinRT codegen)
3. Builds `native/windows/build/Release/x64/winbridge.dll` with MSVC (`/std:c++20`)
4. Copies to `build/winbridge.dll` + `build/Microsoft.WindowsAppRuntime.Bootstrap.dll`

Clean rebuild:

```powershell
bun run build:windows -- -Clean
# or
Remove-Item -Recurse -Force native/windows/build, native/windows/deps
bun run build:windows
```

The macOS `libobjcbridge.dylib` is untouched; `src/bridge.ts` is lazy on Windows.

## Run

The public API is identical on both platforms. `src/index.ts` dispatches at
runtime (`process.platform === "win32"` → WinUI, otherwise AppKit).

```ts
// same file on macOS and Windows
import { Application, Window, VStack, Label, Button, TextField } from "bunkit";

const app = new Application({ name: "Hello" });
const name = new TextField({ placeholder: "Your name", grow: 1 });
const greeting = new Label({ text: "…" });

new Window({
  title: "Hello",
  size: { width: 360, height: 180 },
  content: new VStack({ spacing: 12, padding: 20 }, [
    new HStack({ spacing: 8 }, [name, new Button({ title: "Greet", onClick: () => {
      greeting.text = `Hello, ${name.value}!`;
    }})]),
    greeting,
  ]),
}).quitOnClose();

await app.run();
```

The cross-platform UI examples run 1:1 (same source, no edits) on both
platforms:

```powershell
bun run examples/hello.ts   # smallest useful app
bun run examples/tour.ts    # Table, GroupBox, dialogs, menu, objc hatch
bun run examples/demo.ts    # full showcase: Segmented, alert/prompt, openFile…
bun run examples/gallery.ts # second tour: SplitView, ImageView, Input, snapshot…
bun run examples/gallery.tsx # the same gallery written declaratively in JSX
bun run examples/counter.ts / counter.tsx # a counter: signal + subscribe, imperative & JSX
```

### JSX

The library ships its own automatic JSX runtime (no React — `bun run`
compiles `.tsx` directly). Configure it once in `tsconfig.json`:

```jsonc
"compilerOptions": {
  "jsx": "react-jsx",
  "jsxImportSource": "bunkit"
}
```

Elements are the **imported constructors** — `<Window>`, `<VStack>`,
`<HStack>`, `<Stack>`, `<Label>`, `<Button>`, `<TextField>`, `<Checkbox>`,
`<Switch>`, `<Slider>`, `<Select>`, `<Segmented>`, `<TextArea>`,
`<Progress>`, `<GroupBox>`, `<ScrollView>`, `<SplitView>`, `<Container>`,
`<GridView>`, `<ImageView>`, `<BlurView>`, `<Spacer>`, `<Separator>`.
Because they're the
real classes, props are type-checked against each control's option types —
a typo, a wrong value type (`<Label text={123} />`), or a prop the control
doesn't take (`<ScrollView padding={8} />`) all fail `tsc`. There is no
global `IntrinsicElements` table, so nothing can collide with React's. Props
go straight to the constructor options, so the event props are exactly the
option names (`onClick`, `onChange`, `onSubmit`…). Bare text between tags is
dropped — put text in `text`/`title`/`placeholder` props. Plain functions
are custom components (functions returning more JSX). The only imports you
need are the controls, `Application`, and helpers like `setTheme` from
`"bunkit"`. `src/jsx-runtime.tsx` is the reference. The same file runs on
macOS and Windows.

### Reactive bindings (signals)

`signal()` (from `"bunkit"`) is a tiny reactive cell in the SolidJS style,
and the JSX runtime binds it to a control when you pass it as a prop:

```tsx
import { Application, signal, TextField, Label, Checkbox } from "bunkit";

const name = signal("");
const dark = signal(false);

<TextField value={name} />                      // two-way: typing updates
                                                // the signal, name.set(...)
                                                // updates the field
<Label text={name} />                           // one-way live echo
<Checkbox checked={dark} />                     // two-way boolean
<Switch on={sig} /> <Slider value={sig} />
<Select selected={sig} /> <Segmented selected={sig} />
<TextArea value={sig} /> <Progress value={sig} />
<Button title={sig} />                          // one-way
```

Bindable props are `value`, `checked`, `on`, `selected` (two-way — the
controls' change event writes the new value back into the signal) and
`text`/`title` (one-way — signal to control only). A user-supplied
`onChange` still runs, after the signal is written back. The option types
accept `T | Signal<T>` for these props, so `<TextField value={name} />`
checks at compile time. Passing a signal in the options binds it —
imperatively too, no separate call:

```ts
const name = signal("");
const field = new TextField({ value: name });  // two-way: typing updates
                                               // name, name.set() the field
const echo = new Label({ text: name });        // one-way live echo
```

(`bind(control, prop, signal)` still exists for wiring a signal onto a
control after construction.)

(`examples/gallery.ts` has a "Signals" section using this.)

### Reusable styles

Two ways to style without repeating yourself:

**The `style` prop** — every control accepts a nested styling object, merged at
construction (inline props win over the style). The style accepts the
control's *own* options too, not just the shared view options:
`<TextField style={{ textColor: "#C33", font: { size: 14 } }} />` is valid on
both platforms.

```tsx
<Button
  title="Go"
  style={{ backgroundColor: "#2D7DD2", borderRadius: 14, border: 2, borderColor: "#1F3B4D" }}
/>
```

**A reusable style object** — define once with `satisfies ViewStyle`
(autocomplete + type checking) and pass it to the `style` prop, or spread it
into the options:

```ts
import type { ViewStyle } from "bunkit";

const tinted = { backgroundColor: "#2D7DD2", borderRadius: 14 } satisfies ViewStyle;

new Button({ title: "OK", style: tinted });
// in JSX: <Button style={tinted} />  or  <Button {...tinted} />
```

Styles compose (`{ ...tinted, border: 2 }`) and props override
(`<Button style={tinted} background="#F26419" />`). The `style` prop accepts
the visual subset of `ViewOptions`: background, border, corner radius, sizing,
alpha, grow, and the rest.

The Windows backend implements the same control set the examples use:
`GroupBox` (bordered panel + header), `Segmented` (SelectorBar), `Table`
(ListView with column headers; cells are computed in JS), the async dialogs
(`alert` / `confirm` / `prompt` / `openFile` / `saveFile` as ContentDialogs and
pickers; all resolve via the event queue, never blocking Bun — `openFile`
honors `types` as an extension filter and `chooseDirectories` as a folder
picker), window menu bars
(`Application({ menu })` maps the macOS app menu onto each window's MenuBar,
including About/Settings/Quit, File/Edit/View/Window/Help sections), context
menus (`popUpMenu` as a MenuFlyout at the pointer, opening under the live
cursor; `MenuItemSpec.submenu` nests into MenuFlyoutSubItems, any depth),
`beep`, the clipboard
(`setClipboardText`/`getClipboardText`, synchronous Win32), theming
(`Application({ theme: "light" | "dark" })` opens every window already in
that theme without flashing; `setTheme("light" | "dark" | "default",
{ background }?)` re-tunes live windows via XAML RequestedTheme and
repaints the page background — pass `{ background: "#14141F" }` to choose
the colour used for that mode), and the styling
options (`Button.primary/destructive/symbol`, `Label.color/font/textAlign`,
`TextField.onSubmit` including secure fields, `Window.minSize`,
`TextField.textColor`/`placeholderColor` and `TextArea.textColor` as hex —
secure fields take the text colour only, the placeholder keeps the theme
colour).

The run loop is event-driven: `bk_event_wait` blocks the Bun thread on a
condition variable until a native event arrives (or 15 ms pass), so an idle
app spends ~0.2% of a core instead of polling every 2 ms.

The rest of the macOS API has Windows equivalents too:

- **Views** — `ScrollView` (ScrollViewer), `Container`, `Stack`/`VStack`/`HStack`
  (with `scroll: true` to scroll the stack's own axis, or
  `{ horizontal, vertical }` for explicit axes, instead of clipping when the
  window is too small), `SplitView` (pane + content; extra panes join the
  content grid), `ImageView` (BitmapImage from a path/URL), `BlurView`
  (AcrylicBrush with a translucent fallback), and a `View` base class carrying
  `width/height/min/max`, `hidden`, `tooltip`, `alpha`, `background` (hex),
  `borderRadius`, `frame`, `children`, `setBackground`/`setBorder`.
- **Table** — `multiSelect` + `selectedIndexes`, `headers: false`,
  `alternatingRows`, `font`, per-column `minWidth`/`maxWidth`, and `render`
  cells (each cell view crosses the ABI by handle and is embedded live).
- **Input** — `input()` with `held/pressed/released/keys` and mouse state.
  `held()` polls globally (`GetAsyncKeyState`, works unfocused); `pressed()`/
  `released()` need a focused window (key events bubble through its content).
  Mouse position is screen-space unless `.track(window)` makes it window-local.
  Wheel deltas need a message hook and stay 0.
- **Snapshot/debug** — `snapshotView`/`snapshotWindow` render any element to
  PNG (RenderTargetBitmap + PngEncoder; the same blind spot as macOS for
  GPU surfaces), `describeViewTree` dumps the visual tree, `checkLayout`
  reports children spilling outside their parents, `allWindows()` lists windows.
- **Layer-2 helpers** — `actionTarget`, `makeFont`, `toNSColor`, `Menu`,
  `standardMenu`, `SIZE_PRIORITY` exist as pass-throughs so cross-platform
  imports resolve.

Symbols map to Segoe MDL2 Assets glyphs (`plus` E710, `folder` E8B7, `gear`
E713, `trash` E74D, `pencil` E70F) rendered alongside the title.

**Escape hatches.** macOS examples reach for raw AppKit through `win.native`,
`textView` or `objc.NSProcessInfo…`. On Windows these are tolerant proxies:
known calls map to a Windows equivalent where a cheap one exists, unknown ones
no-op with a one-time console warning — so example sources stay byte-identical
across platforms.

`raw-objc.ts` is macOS-only because it directly calls Objective-C/AppKit.
`scene3d.ts`, `lighting-rig.ts`, `particles.ts` and `shader-playground.ts` are
macOS-only because the GPU backend is Metal; a Direct3D backend is not part of
the current Windows port. On Windows they exit immediately with a
"requires macOS" message instead of a module-resolution crash.

`bun build --compile`:

```powershell
bun build --compile examples/hello.ts --outfile dist/app.exe
# dist/app.exe + build/winbridge.dll + Bootstrap.dll → run together
```

Create a client installer for any compatible example:

```powershell
bun run installer:windows -- examples/hello.ts --name Hello
bun run installer:windows -- examples/tour.ts --name Tour
bun run installer:windows -- examples/demo.ts --name BunKitDemo
# output: dist/<Name>-Setup.exe
```

The installer includes the Windows App Runtime packages, creates a Start Menu
shortcut and installs an uninstaller. It is unsigned, so Windows SmartScreen
may require the user to choose **More info → Run anyway**.

Single-file is not yet supported (WinAppSDK needs its framework package).

## Architecture

```
TypeScript (same process, Bun thread)
  ↓ bun:ffi
winbridge.dll (C ABI, handles are uint64)
  ↓ DispatcherQueue::TryEnqueue
WinUI STA thread (Application::Start, DispatcherQueue, ObjectRegistry)
  ↓ EventQueue (mutex+deque, UTF-8 payloads)
Bun thread drains via bk_event_pop() → callback registry → JS
```

- `DllMain` does nothing; `bk_runtime_init()` bootstraps WASDK (`MddBootstrapInitialize2`),
  starts the STA thread, publishes the `DispatcherQueue`.
- `ObjectRegistry` is UI-thread-only (no locks); handles are monotonic, 0 is invalid.
- Strings are UTF-8 at the ABI, `winrt::hstring` inside.

## DLL lookup

`src/platform/windows/ffi.ts` searches deterministically, never the CWD:

1. `WINBRIDGE_DLL` env
2. `build/winbridge.dll` relative to the package
3. `build/winbridge.dll` relative to cwd
4. `winbridge.dll` next to the running executable (`process.execPath` — for `bun build --compile`)
5. `winbridge.<suffix>` on `PATH`

## Troubleshooting

- `winbridge.dll not found` → `bun run build:windows` first
- `MddBootstrapInitialize2 failed` → install Windows App SDK Runtime 1.8
- `Failed to open library winbridge.dll: 126` → missing `Microsoft.WindowsAppRuntime.Bootstrap.dll` next to `winbridge.dll` (the build script copies it)
- TextBox was previously stowed (`0xC000027B`) → fixed by `IXamlMetadataProvider` (`XamlControlsXamlMetaDataProvider`) + `XamlControlsResources` in `Application::OnLaunched`
- Instant `0xC0000409` exit when creating a symbol button → a lone PUA glyph as
  the entire `TextBlock.Text` fail-fasts XAML text analysis on some builds;
  the button renders "glyph  title" as a single string in Segoe MDL2 Assets

## Tests

Milestone suites live in `test/win/` (manual, each a standalone script):

```powershell
bun test/win/m2-window.ts
bun test/win/highlevel.ts
bun test/win/advanced-controls.ts
bun test/win/parity.ts        # composite controls, menu, proxies
bun test/win/parity2.ts       # views, advanced table, input, snapshot, debug
```

## Known approximations

- Styling works on every control — `Label` and `ImageView` render inside a
  Border shell, so `background`/`border`/`borderRadius` apply to them too.
  `borderRadius` accepts one number, `[tl, tr, br, bl]`, or per-corner names
  (`{ topLeft, topRight, bottomRight, bottomLeft }` — CSS border-radius
  vocabulary). `border` accepts one number, `true`, `[top, right, bottom,
  left]`, or per-side names (`{ top, right, bottom, left }` — CSS
  border-width vocabulary) and maps straight onto XAML's per-side
  `Thickness`. CSS-style options (`backgroundColor`, `border`, `borderWidth`,
  `borderColor`, `borderRadius`, `borderStyle`) mirror the macOS layer API;
  `borderStyle: "dashed" | "dotted"` draws with a pattern overlay on
  Border-based views and falls back to solid on plain Controls (the overlay
  rounds uniformly with the largest requested radius, and strokes per-side
  widths with the largest requested width).
- Text inputs (`TextField`, `TextArea`, `Select`) render a neutral 1px border
  on all four sides by default: WASDK's stock border is a near-invisible
  `F2F2F2` that flips to the accent colour on focus, so the bridge sets an
  explicit `8A8A8A` border at creation and shadows the focus/hover
  brush+thickness theme resources on the control (`border_state.h`). The
  border never turns blue, and an explicit `border`/`borderColor` from the
  caller replaces it as usual.
- Stack layout props are CSS-named too: `alignItems` (cross axis,
  `align-items`) and `justifyContent` (main axis, `justify-content`), with
  `justifyContent: "center"` centring a stack's content along its own axis —
  `<VStack alignItems="center" justifyContent="center">` centres a group
  both ways, like `display: flex` + `place-items: center`.
- bun:ffi corrupts the last `f64` in 8-argument win64 signatures, so the
  four corner radii and the four border widths cross the ABI as `double[4]`
  buffers (radii `{tl, tr, br, bl}`; widths in Thickness order
  `{left, top, right, bottom}`) rather than trailing doubles. Keep new
  exports under 7 arguments, or pack extras into a pointer.
- `Thickness`/`CornerRadius` are plain aggregates — `Thickness(w)` compiles
  under C++20 but zeroes three of the four sides. Always pass every field.
- Titlebar customisation: `Window({ fullSizeContent })` extends the content
  under the titlebar (`AppWindow.TitleBar.ExtendsContentIntoTitleBar`);
  `titlebarColor`/`titlebarTextColor` (hex or `{ light, dark }`, reapplied on
  `setTheme`) colour the Windows 11 titlebar and caption buttons. Both must be
  applied after the window is shown, which the constructor does. `titleVisible`
  is accepted for macOS parity but has no effect on WASDK 1.7 (no
  `IsVisible` on `AppWindowTitleBar`).
- `Stack.remove` drops the child and its row/column definition (a grid
  rebuild under the hood — heavy churn is O(n) per call, not incremental).
  `ImageView.src` swaps the bitmap in place.
- `Container` children stack vertically; absolute positioning has no WinUI
  equivalent without a canvas.
- `TextArea` `richText` uses RichEditBox (plain get/set round-trip; no styled
  runs API yet).
- Wheel deltas in `input().mouse` are 0 (needs a message hook).
