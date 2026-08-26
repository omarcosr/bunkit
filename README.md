# @omarcosr/bunkit

Native desktop applications for Bun, built with real platform controls instead of a WebView.

`@omarcosr/bunkit` lets TypeScript create native windows, layouts, controls,
menus, dialogs and input on macOS and Windows. The same application source can
run on both supported platforms while keeping a direct escape hatch to the
native layer when it is needed.

## Highlights

- Native AppKit controls on macOS and WinUI 3 controls on Windows.
- TypeScript-first API with a built-in JSX runtime — no React dependency.
- Shared `Window`, stack layout, form control, menu, dialog, theme and styling APIs.
- CSS-inspired styling for colors, borders, radius, shadow and interaction states.
- Native bridges are delivered as small platform packages; users do not compile C++ or Objective-C during installation.

## Supported platforms

| Platform                      | Architecture            | Backend | Notes                                      |
| ----------------------------- | ----------------------- | ------- | ------------------------------------------ |
| macOS                         | Apple silicon (`arm64`) | AppKit  | Includes the Metal API.                    |
| Windows 10 21H2+ / Windows 11 | `x64`                   | WinUI 3 | Requires Windows App Runtime 1.7 or newer. |

Linux, Intel macOS and Windows ARM64 are not supported at this time.

## Install

Bun 1.4 or newer is required.

```sh
bun add @omarcosr/bunkit
```

The matching native bridge is installed automatically as an optional dependency.
Do not install the platform packages directly. If your install command omits
optional dependencies, reinstall without that option.

On Windows, install the [Windows App Runtime](https://learn.microsoft.com/windows/apps/windows-app-sdk/downloads) before running an application.

## Quick start

```ts
import { Application, Button, HStack, Label, TextField, VStack, Window } from "@omarcosr/bunkit";

const app = new Application({ name: "Greeting" });
const name = new TextField({ placeholder: "Your name", grow: 1 });
const greeting = new Label({ text: "Hello!" });

new Window({
  title: "Greeting",
  size: { width: 360, height: 180 },
  content: new VStack({ spacing: 12, padding: 20 }, [
    new HStack({ spacing: 8 }, [
      name,
      new Button({
        title: "Greet",
        primary: true,
        onClick: () => {
          greeting.text = `Hello, ${name.value || "there"}!`;
        },
      }),
    ]),
    greeting,
  ]),
}).quitOnClose();

await app.run();
```

## JSX

Extend the packaged tsconfig to use the bundled JSX runtime:

```jsonc
{
  "extends": "@omarcosr/bunkit/tsconfig",
  "include": ["src"],
}
```

```tsx
import { Application, Button, Label, VStack, Window } from "@omarcosr/bunkit";

const app = new Application({ name: "Counter" });
let count = 0;
const label = <Label text="0" />;

const window = (
  <Window title="Counter" size={{ width: 280, height: 160 }}>
    <VStack spacing={12} padding={20}>
      {label}
      <Button
        title="Add"
        borderRadius={14}
        shadow="0 4px 14px #00000040"
        onClick={() => {
          label.text = String(++count);
        }}
      />
    </VStack>
  </Window>
);

window.quitOnClose();
await app.run();
```

## Styling and themes

Controls accept their visual options directly or through a reusable `style`
object. The same styles work across the supported backends.

```ts
import type { ViewStyle } from "@omarcosr/bunkit";

const card = {
  backgroundColor: "#24262E",
  border: 1,
  borderColor: "#3A3D49",
  borderRadius: 16,
  shadow: "0 8px 24px #00000045",
  padding: 16,
} satisfies ViewStyle;
```

Use `Application({ theme })` or `setTheme()` to select light, dark or system
appearance. Controls also expose interaction state styling and programmatic
focus/blur/disabled control where supported by the platform.

## For contributors

```sh
git clone https://github.com/omarcosr/bunkit.git
cd bunkit
bun install
```

On macOS Apple silicon:

```sh
bun run build
bun run test
```

On Windows x64, from a Visual Studio developer shell with Desktop development
with C++ and the Windows SDK installed:

```powershell
bun run build:windows
bun run typecheck
```

Before a release, run `bun run check:package`. Release automation builds the
native bridges, stages the platform packages and checks the final tarballs
before publishing.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

---

This project is a fork of the [official BunKit project](https://github.com/scarletindustries/bunkit). Upstream attribution and license notices are retained in [NOTICE](NOTICE).
