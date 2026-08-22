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
```

The Windows backend implements the same control set the examples use:
`GroupBox` (bordered panel + header), `Segmented` (SelectorBar), `Table`
(ListView with column headers; cells are computed in JS), the async dialogs
(`alert` / `confirm` / `prompt` as ContentDialogs, `openFile` as a picker; all
resolve via the event queue, never blocking Bun), window menu bars
(`Application({ menu })` maps the macOS app menu onto each window's MenuBar),
`beep`, and the styling options (`Button.primary/destructive/symbol`,
`Label.color/font/align`, `TextField.onSubmit`, `Window.minSize`).

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
```
