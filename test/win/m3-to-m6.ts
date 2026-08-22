// Milestones 3-6: click events, label roundtrip, textbox value/TextChanged,
// and stack layout with grow. Run: bun run test/win/m3-to-m6.ts
import { load } from "./lib.ts";

const { lib, cstr, assert, drain, waitForEvent, getSize, EVT_CLICK, EVT_TEXT_CHANGED } = load();

assert(lib.symbols.bk_runtime_init() === 0, "runtime init");

const win = lib.symbols.bk_window_create(cstr("M3-M6"), 6, 400, 300);
assert(win !== 0n, "window created");

const vbox = lib.symbols.bk_stack_create(0, 12, 20, 20, 20, 20);
assert(vbox !== 0n, "vbox");
const hbox = lib.symbols.bk_stack_create(1, 8, 0, 0, 0, 0);
assert(hbox !== 0n, "hbox");

const input = lib.symbols.bk_textbox_create(0, cstr("Type something"), 14);
assert(input !== 0n, "textbox");
const btn = lib.symbols.bk_button_create(cstr("Click me"), 8);
assert(btn !== 0n, "button");
const label = lib.symbols.bk_label_create(cstr("Not clicked"), 11);
assert(label !== 0n, "label");

assert(lib.symbols.bk_stack_add_child(vbox, hbox, 0) === 0, "vbox+hbox");
assert(lib.symbols.bk_stack_add_child(hbox, input, 1) === 0, "hbox+input grow=1");
assert(lib.symbols.bk_stack_add_child(hbox, btn, 0) === 0, "hbox+btn");
assert(lib.symbols.bk_stack_add_child(vbox, label, 0) === 0, "vbox+label");

assert(lib.symbols.bk_window_set_content(win, vbox) === 0, "content=vbox");
assert(lib.symbols.bk_window_show(win) === 0, "show");

// --- M5a: programmatic set is echo-suppressed ------------------------------
assert(lib.symbols.bk_textbox_set_text(input, cstr("seed"), 4) === 0, "set seed");
await Bun.sleep(150);
const echoed = drain().filter((e) => e.type === EVT_TEXT_CHANGED && e.target === input);
assert(echoed.length === 0, `set_text must not echo (${echoed.length} events)`);

// --- callback registry (what src/platform/windows will do for real) --------
const handlers = new Map<bigint, () => void>();
handlers.set(42n, () => {
  const vlen = lib.symbols.bk_textbox_value_length(input);
  const vbuf = Buffer.alloc(vlen + 1);
  lib.symbols.bk_textbox_copy_value(input, vbuf, vlen + 1);
  const value = vbuf.toString("utf8", 0, vlen);
  console.log("[click] textbox value:", JSON.stringify(value));
  const msg = `Hello ${value}!`;
  lib.symbols.bk_label_set_text(label, cstr(msg), Buffer.byteLength(msg));
});
handlers.set(7n, () => {});

assert(lib.symbols.bk_button_set_click_callback(btn, 42n) === 0, "click cb");
assert(lib.symbols.bk_textbox_set_change_callback(input, 7n) === 0, "change cb");

// --- M3+M4: WinUI click -> queue -> Bun -> JS handler -> label --------------
assert(lib.symbols.bk_button_click(btn) === 0, "programmatic click");
const clickEv = await waitForEvent(
  (e) => e.type === EVT_CLICK && e.target === btn && e.callback === 42n,
  3000,
);
assert(clickEv !== null, "CLICK event delivered to Bun with callback id");
handlers.get(clickEv!.callback)!();

const llen = lib.symbols.bk_label_text_length(label);
const lbuf = Buffer.alloc(llen + 1);
lib.symbols.bk_label_copy_text(label, lbuf, llen + 1);
const labelText = lbuf.toString("utf8", 0, llen);
console.log("label after click:", JSON.stringify(labelText));
assert(labelText === "Hello seed!", `M4 roundtrip, got ${JSON.stringify(labelText)}`);
console.log("M3 OK (click -> Bun) + M4 OK (JS -> label)");

// --- M5b: insert_text follows the real edit path (TextChanged fires) --------
assert(lib.symbols.bk_textbox_set_text(input, cstr(""), 0) === 0, "clear for M5");
await Bun.sleep(50);
drain(); // clear is echo-suppressed in ideal impl; drain any stray event
assert(lib.symbols.bk_textbox_insert_text(input, cstr("Hello "), 6) === 0, "insert 1");
await Bun.sleep(30);
assert(lib.symbols.bk_textbox_insert_text(input, cstr("Windows"), 7) === 0, "insert 2");
const changes: string[] = [];
{
  const deadline = Date.now() + 3000;
  while (changes.length < 2 && Date.now() < deadline) {
    for (const e of drain()) {
      if (e.type === EVT_TEXT_CHANGED && e.target === input) changes.push(e.text);
    }
    if (changes.length < 2) await Bun.sleep(10);
  }
}
console.log("textchanged payloads:", JSON.stringify(changes));
assert(changes[0] === "Hello ", `first payload, got ${JSON.stringify(changes[0])}`);
assert(changes[1] === "Hello Windows", `second accumulates state, got ${JSON.stringify(changes[1])}`);
console.log("M5 OK (TextChanged order preserved)");

// --- UTF-8 spot check -------------------------------------------------------
const utf8 = "Olá ação çãõ 🙂🚀 こんにちは 你好";
lib.symbols.bk_label_set_text(label, cstr(utf8), Buffer.byteLength(utf8));
const ulen = lib.symbols.bk_label_text_length(label);
const ubuf = Buffer.alloc(ulen + 1);
lib.symbols.bk_label_copy_text(label, ubuf, ulen + 1);
assert(ubuf.toString("utf8", 0, ulen) === utf8, `utf8 roundtrip, got ${JSON.stringify(ubuf.toString("utf8", 0, ulen))}`);
console.log("UTF-8 OK");

// --- M6: layout ran; star column absorbs slack ------------------------------
await Bun.sleep(700);
const [tw] = getSize(input);
const [bw] = getSize(btn);
const [vw, vh] = getSize(vbox);
console.log(`sizes: textbox=${tw.toFixed(1)} button=${bw.toFixed(1)} vbox=${vw.toFixed(1)}x${vh.toFixed(1)}`);
assert(vw > 100 && vh > 60, `stack laid out inside window (${vw}x${vh})`);
assert(tw > bw, `grow=1 textbox (${tw}) wider than auto button (${bw})`);
console.log("M6 OK (Grid star sizing)");

// --- teardown ---------------------------------------------------------------
for (const h of [input, btn, label, hbox, vbox]) {
  assert(lib.symbols.bk_object_destroy(h) === 0, `destroy ${h}`);
}
assert(lib.symbols.bk_window_close(win) === 0, "close");
assert((await waitForEvent((e) => e.type === 4 && e.target === win, 3000)) !== null, "closed event");
assert(lib.symbols.bk_object_destroy(win) === 0, "destroy window");
assert(lib.symbols.bk_runtime_shutdown() === 0, "shutdown");
console.log("MILESTONES 3-6 OK");
process.exit(0);
