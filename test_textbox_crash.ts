import { load } from './test/win/lib.ts';
const { lib, cstr } = load();
lib.symbols.bk_runtime_init();
const win = lib.symbols.bk_window_create(cstr('t'), 1, 320, 200);
const tb = lib.symbols.bk_textbox_create(0, cstr(''), 0);
lib.symbols.bk_window_set_content(win, tb);
lib.symbols.bk_window_show(win);
setTimeout(()=>{}, 10000);
