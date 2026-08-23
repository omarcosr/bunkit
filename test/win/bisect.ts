// Isolates which tree shape stows the XAML layout. Usage:
//   bun run test/win/bisect.ts <case 1..5>
import { assert, load } from "./lib.ts";

const kase = Number(process.argv[2] ?? "1");
const { lib, cstr } = load();

assert(lib.symbols.bk_runtime_init() === 0, "init");
const win = lib.symbols.bk_window_create(cstr("bisect" + kase), 9, 320, 220);

let content = 0n;
if (kase === 1) {
  content = lib.symbols.bk_stack_create(0, 4, 10, 10, 10, 10);
} else {
  const vbox = lib.symbols.bk_stack_create(0, 4, 10, 10, 10, 10);
  let child = 0n;
  if (kase === 2) child = lib.symbols.bk_label_create(cstr("L"), 1);
  if (kase === 3) child = lib.symbols.bk_button_create(cstr("B"), 1);
  if (kase === 4) child = lib.symbols.bk_textbox_create(0, cstr(""), 0);
  if (kase === 5) {
    const hbox = lib.symbols.bk_stack_create(1, 4, 0, 0, 0, 0);
    const tb = lib.symbols.bk_textbox_create(0, cstr(""), 0);
    const btn = lib.symbols.bk_button_create(cstr("B"), 1);
    assert(lib.symbols.bk_stack_add_child(hbox, tb, 1) === 0, "h+tb");
    assert(lib.symbols.bk_stack_add_child(hbox, btn, 0) === 0, "h+btn");
    child = hbox;
  }
  assert(child !== 0n, "child created");
  assert(lib.symbols.bk_stack_add_child(vbox, child, 0) === 0, "vbox+child");
  content = vbox;
}
assert(content !== 0n, "content");
assert(lib.symbols.bk_window_set_content(win, content) === 0, "set_content");
assert(lib.symbols.bk_window_show(win) === 0, "show");

setTimeout(() => {
  console.log(`ALIVE_${kase}`);
  assert(lib.symbols.bk_runtime_shutdown() === 0, "shutdown");
  process.exit(0);
}, 1800);
