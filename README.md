<img width="128" src="https://github.com/scarletindustries.png" />

### BunKit

Real AppKit apps for macOS, written in TypeScript on Bun.

[Documentation](https://scarlet.industries)

---

> this is an experimental project. the mass majority of the code was written by claude. no promises made. it works and it's tested, but it's early — don't put anything load-bearing on it yet.

![the demo app](docs/demo.png)

no webview, no html, no electron. that's a real `NSTableView`, real `NSTextField`s and a real menu bar, driven entirely from typescript.

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

### let me try it

needs macos on apple silicon, [bun](https://bun.sh), and the xcode command line tools (`xcode-select --install`).

```shell
git clone https://github.com/scarletindustries/bunkit
cd bunkit
bun install
./native/build.sh

bun run hello    # 20 lines
bun run tour     # a task list — the whole api on one screen
bun run demo     # the screenshot above
```

and to ship it as a real `.app`:

```shell
bun run bundle examples/demo.ts --name "My App" --id com.example.myapp --icon icon.png
open "dist/My App.app"
```

### how?

the objective-c runtime can hand you the complete type signature of any method — argument types, return type, struct layouts — at runtime:

```c
method_getTypeEncoding(class_getInstanceMethod(objc_lookUpClass("NSWindow"),
                       sel_registerName("initWithContentRect:styleMask:backing:defer:")))
// -> "@68@0:8{CGRect={CGPoint=dd}{CGSize=dd}}16Q48Q56B64"
```

so instead of hand-writing a c wrapper per appkit method, there's **one** generic bridge that parses that encoding, builds an `ffi_cif`, and calls `objc_msgSend` through libffi. 1,300 lines, 54 exported symbols, and it never grows when you want a new appkit class.

three layers sit on top of it:

| | | |
|---|---|---|
| `src/ui/` | layer 3 | `Window`, `VStack`, `Button`, `Table` — about 30 classes |
| `src/objc.ts` | layer 2 | `objc.NSWindow.alloc().init…()`, marshalling, delegates, blocks |
| `src/bridge.ts` | layer 1 | dlopen, argument packing |

anything layer 3 doesn't wrap drops through — every wrapper has `.native`, and `objc.AnyClass` reaches the rest of appkit.

libffi rather than `bun:ffi` directly because `bun:ffi` needs a fixed signature at dlopen time: it can't build a call signature at runtime, can't pass structs by value, and can't mint function pointers with arbitrary signatures. all three are needed here.

### things that will bite you

**appkit spins its own nested run loop** during modal dialogs, menu tracking, live window resize and drag sessions — and javascript is frozen for the duration. dialogs are the big one, so layer 3 never exposes `runModal*`: `alert`, `confirm`, `prompt`, `openFile` and `saveFile` are all sheets that return promises, and the pump keeps running. menu tracking and live resize are bounded by human interaction.

**objective-c pointers are `bigint`, never `number`.** apple packs short strings, small numbers and dates directly into the pointer, which puts them past 2^53. compare against `0n`.

**arm64 only, on purpose.** on arm64 every struct return goes through plain `objc_msgSend` with `x8` as the indirect result register, so the whole `objc_msgSend_stret` family doesn't exist in the dispatcher. the build script and the bundler both refuse anything else rather than silently returning structs wrongly.

**enum values are generated, not typed in.** `NSTextAlignment` on arm64 uses the ios ordering (left, center, right) rather than appkit's historical (left, right, center) — get that wrong by hand and everything you right-align silently centres. `tools/gen-constants.ts` recovers 5,521 values by asking clang; `tools/gen-types.ts` walks the live runtime for 3,035 classes and 465 protocols so layer 2 autocompletes.

### where it's at

| | |
|---|---|
| `msgSend` | 229 ns (263 ns returning a struct) |
| obj-c → js callback | 870 ns |
| idle cpu, window open | 1.3% |
| 60s soak, 9.8M calls | flat memory |

```shell
bun test         # 9 suites: marshalling, layout, synthetic input, run loop, soak
bun run typecheck
```

not done yet: notarization (ad-hoc signing only), no npm package (the dylib has to be compiled first), no swiftui hosting.

### contributing

issues and prs welcome. run `./native/build.sh && bun run typecheck && bun test` first. `CLAUDE.md` has the conventions and the traps.

like carder, a lot of this gets written by claude — if you want to take on something substantial, hit me up on discord (@hiett) first so we're not doing the same work twice.

### license

bunkit is licensed under the [Apache License 2.0](LICENSE). you're free to use, modify, and distribute it — including in commercial and closed-source products — provided you keep the license and attribution notices intact. the Apache license also carries an explicit patent grant. see [LICENSE](LICENSE) and [NOTICE](NOTICE) for the full terms.
