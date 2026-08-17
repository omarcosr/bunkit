<img width="128" src="https://github.com/scarletindustries.png" />

### BunKit

Real AppKit apps for macOS, written in TypeScript on Bun.

[Documentation](https://scarlet.industries)

---

![the demo app](docs/demo.png)

bunkit builds mac apps out of actual appkit — windows, tables, menus, sheets — with all of the app logic sitting in typescript. there's no webview anywhere, so the screenshot above is a real `NSTableView` with real `NSTextField`s in it.

```ts
import { Application, Window, VStack, HStack, Label, Button, TextField } from "bunkit";

const app = new Application({ name: "Hello" });

const name = new TextField({ placeholder: "Your name", grow: 1 });
const greeting = new Label({ text: "…" });

new Window({
  title: "Hello",
  size: { width: 360, height: 180 },
  content: new VStack({ spacing: 12, padding: 20 }, [
    new HStack({ spacing: 8 }, [
      name,
      new Button({ title: "Greet", primary: true, onClick: () => {
        greeting.text = `Hello, ${name.value}!`;
      }}),
    ]),
    greeting,
  ]),
}).quitOnClose();

await app.run();
```

### why?

i wanted to know if you could write a proper mac app without shipping a browser to draw it. turns out you can, and it's a lot less work than you'd think, because the objective-c runtime hands you everything you need to call it at runtime. this is also just fun.

### let me try it

you'll need macos on apple silicon, [bun](https://bun.sh), and the xcode command line tools (`xcode-select --install`).

```shell
git clone https://github.com/scarletindustries/bunkit
cd bunkit
bun install
./native/build.sh
```

`bun run hello` is about twenty lines. `bun run tour` is a task list that covers most of the api on one screen. `bun run demo` is the screenshot up top.

to turn something into an actual `.app`:

```shell
bun run bundle examples/demo.ts --name "My App" --id com.example.myapp --icon icon.png
open "dist/My App.app"
```

### how?

ask the objective-c runtime about any method and it'll give you the whole signature back:

```c
method_getTypeEncoding(class_getInstanceMethod(objc_lookUpClass("NSWindow"),
                       sel_registerName("initWithContentRect:styleMask:backing:defer:")))
// -> "@68@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16Q48Q56B64"
```

argument types, return type, struct layouts, all of it, with no headers to parse. so rather than writing a c wrapper per appkit method (and there are tens of thousands of them) there's one bridge that reads that encoding, builds an `ffi_cif` and calls `objc_msgSend` through libffi. it's around 1300 lines and it doesn't need to change when you want a class it's never heard of.

three layers sit on top:

| | | |
|---|---|---|
| `src/ui/` | layer 3 | `Window`, `VStack`, `Button`, `Table`, about 30 classes |
| `src/objc.ts` | layer 2 | `objc.NSWindow.alloc().init…()`, marshalling, delegates, blocks |
| `src/bridge.ts` | layer 1 | dlopen, packing arguments into buffers |

layer 3 is the pleasant one. when it doesn't cover what you need you drop to layer 2, which reaches all of appkit — every layer 3 wrapper has a `.native` on it for exactly that.

it goes through libffi instead of using `bun:ffi` on its own because `bun:ffi` wants the signature up front at dlopen time. it can't build one at runtime, can't pass a struct by value, and can't make a function pointer with an arbitrary signature. all three of those are needed here.

### the annoying parts

appkit runs its own nested run loop for modal dialogs, menu tracking, live resize and drags, and js is frozen the whole time it's in there. dialogs were the worst of it, so layer 3 doesn't expose `runModal*` at all: `alert`, `confirm`, `prompt`, `openFile` and `saveFile` are sheets that hand you a promise, and the pump keeps ticking underneath. menu tracking and live resize you just live with. they're bounded by someone letting go of the mouse.

pointers are `bigint`, not `number`. apple packs short strings and small numbers into the pointer itself, which pushes the value past 2^53. compare against `0n`.

arm64 only. struct returns there go through plain `objc_msgSend` with x8 holding the result pointer, so the whole `objc_msgSend_stret` family doesn't exist in the dispatcher. the build script and the bundler both refuse an intel target rather than build you something that returns structs wrong.

enum values come out of a generator rather than out of my head. `NSTextAlignment` on arm64 uses the ios ordering (left, center, right) and not appkit's older one (left, right, center), which i typed in by hand and then spent a while wondering why everything i right-aligned was centred. `tools/gen-constants.ts` recovers 5521 of them by compiling a probe against the sdk, and `tools/gen-types.ts` walks the live runtime for the classes and protocols so layer 2 autocompletes.

### where it's at

it works, and there's a decent amount of test coverage — marshalling, layout geometry, synthetic mouse and keyboard events, run loop behaviour, and a soak test for leaks.

```shell
bun test
bun run typecheck
```

a `msgSend` costs about 230ns, a callback from obj-c into js about 870ns, and idle cpu with a window open sits around 1.3%. a sixty second soak of 9.8 million calls holds flat.

still missing: notarization (it only ad-hoc signs), an npm package (the dylib has to be compiled, so that needs prebuilt binaries), and swiftui hosting.

### contributing

issues and prs welcome. run `./native/build.sh && bun run typecheck && bun test` before you open one. `CLAUDE.md` has the conventions and the traps in it.

like carder, a lot of this gets written by claude. if you want to take on something substantial, hit me up on discord (@hiett) first so we're not doing the same work twice.

### license

bunkit is licensed under the [Apache License 2.0](LICENSE). you're free to use, modify, and distribute it — including in commercial and closed-source products — provided you keep the license and attribution notices intact. the Apache license also carries an explicit patent grant. see [LICENSE](LICENSE) and [NOTICE](NOTICE) for the full terms.
