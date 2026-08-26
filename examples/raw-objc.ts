// The same app without Layer 3: raw Obj-C through the objc proxy.
//
// One window, one label, a menu bar, a clean quit — written against Layer 2
// directly, to show what the ergonomic layer is actually saving you.
//
//   bun run examples/raw-objc.ts              # runs from source
//   bun run tools/bundle.ts examples/raw-objc.ts --name RawObjC
//
// It is also the bundler's test case, so it reports what it can see about its
// own bundle and — unless HELLO_STAY=1 — quits itself after a few seconds so a
// build script can run it unattended.

// the Objective-C runtime is macOS-only; fail fast with a clear message elsewhere.
if (process.platform !== "darwin") {
  console.error("bunkit: this example uses the Objective-C runtime and requires macOS.");
  process.exit(1);
}

import { objc } from "@omarcosr/bunkit/objc";
import { initApp, NSApp, quit, run } from "@omarcosr/bunkit/runtime";

// Compile-time constants: the Obj-C runtime has no idea these names exist, so
// they are spelled out here rather than looked up.
const NSWindowStyleMaskTitled = 1 << 0;
const NSWindowStyleMaskClosable = 1 << 1;
const NSWindowStyleMaskMiniaturizable = 1 << 2;
const NSWindowStyleMaskResizable = 1 << 3;
const NSBackingStoreBuffered = 2;
const NSViewMinYMargin = 1 << 3;
const NSViewMaxYMargin = 1 << 5;
const NSViewWidthSizable = 1 << 1;

initApp();

// NSBundle is the whole point of packaging: unbundled, the identifier is null
// and the menu bar says "bun".
const bundle = objc.NSBundle.mainBundle();
const bundleName = bundle.objectForInfoDictionaryKey_("CFBundleName");
const appName = bundleName ? String(bundleName) : "Hello Bundle";

const win = objc.NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
  { x: 0, y: 0, width: 420, height: 180 },
  NSWindowStyleMaskTitled |
    NSWindowStyleMaskClosable |
    NSWindowStyleMaskMiniaturizable |
    NSWindowStyleMaskResizable,
  NSBackingStoreBuffered,
  false,
);
win.setTitle_(appName);
win.setReleasedWhenClosed_(false); // JS owns this window's lifetime, not AppKit
win.center();

const label = objc.NSTextField.labelWithString_("Native AppKit, from TypeScript.");
label.setFont_(objc.NSFont.systemFontOfSize_(18));
label.sizeToFit();
const content = win.contentView().bounds();
const size = label.frame();
label.setFrame_({
  x: (content.width - size.width) / 2,
  y: (content.height - size.height) / 2,
  width: size.width,
  height: size.height,
});
// Stay centred when the window is resized.
label.setAutoresizingMask_(NSViewMinYMargin | NSViewMaxYMargin | NSViewWidthSizable);
win.contentView().addSubview_(label);

// An app with no menu bar feels broken, and Cmd-Q has to come from somewhere.
// terminate: reaches the bridge's applicationShouldTerminate:, which stops the
// pump rather than calling exit() out from under JS.
const menubar = objc.NSMenu.alloc().init();
const appItem = objc.NSMenuItem.alloc().init();
const appMenu = objc.NSMenu.alloc().init();
appMenu.addItemWithTitle_action_keyEquivalent_(`Quit ${appName}`, "terminate:", "q");
appItem.setSubmenu_(appMenu);
menubar.addItem_(appItem);
// NSApp() is typed as a plain ObjCObject, so go through send() rather than the
// proxy's generated selector names.
NSApp().send("setMainMenu:", menubar);

win.makeKeyAndOrderFront_(null);

// --- self-report, so the bundler can prove the built .app really ran --------
const seconds = Number(process.env.HELLO_SECONDS ?? 3);
setTimeout(() => {
  const frame = win.frame();
  console.log("bundlePath     ", String(bundle.bundlePath()));
  console.log(
    "bundleId       ",
    bundle.bundleIdentifier() ? String(bundle.bundleIdentifier()) : "(none)",
  );
  console.log("CFBundleName   ", bundleName ? String(bundleName) : "(none)");
  console.log("processName    ", String(objc.NSProcessInfo.processInfo().processName()));
  console.log("dylib          ", process.env.OBJCBRIDGE_DYLIB ?? "(resolved by bridge.ts)");
  console.log("window         ", `visible=${win.isVisible()} frame=${JSON.stringify(frame)}`);
  console.log("label          ", String(label.stringValue()));
  const firstMenuItem = NSApp().send("mainMenu").itemAtIndex_(0).submenu().itemAtIndex_(0);
  console.log("menu           ", String(firstMenuItem.title()));
}, 600);

if (!process.env.HELLO_STAY) {
  setTimeout(() => {
    console.log(`quitting after ${seconds}s`);
    quit();
  }, seconds * 1000);
}

await run();
win.close();
console.log("clean exit");
