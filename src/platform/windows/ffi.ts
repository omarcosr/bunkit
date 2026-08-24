// src/platform/windows/ffi.ts — loads winbridge.dll via bun:ffi.
import { dlopen, FFIType, suffix } from "bun:ffi";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type NativeHandle = bigint;

const here = dirname(fileURLToPath(import.meta.url));

function findWinBridge(): string {
  const candidates = [
    process.env.WINBRIDGE_DLL,
    resolve(here, "../../build/winbridge.dll"),
    resolve(here, "../../../build/winbridge.dll"),
    resolve(dirname(process.execPath), "winbridge.dll"),
    resolve(process.cwd(), "build/winbridge.dll"),
    `winbridge.${suffix}`,
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    `winbridge.dll not found. Run bun run build:windows first.\nLooked in:\n  ${candidates.join("\n  ")}`,
  );
}

let _path: string | null = null;
function getPath(): string {
  if (_path) return _path;
  if (process.platform !== "win32") throw new Error("winbridge requested on non-Windows");
  _path = findWinBridge();
  return _path;
}

const U64 = FFIType.u64;
const I32 = FFIType.i32;
const U32 = FFIType.u32;
const F64 = FFIType.f64;
const I64 = FFIType.i64;
const PTR = FFIType.ptr;
const CSTR = FFIType.cstring;

let _lib: any = null;
function getLib(): any {
  if (_lib) return _lib;
  _lib = dlopen(getPath(), {
  bk_test_add: { args: ["i32", "i32"], returns: "i32" },
  bk_version: { args: [], returns: "ptr" },
  bk_last_error_length: { args: [], returns: "u32" },
  bk_copy_last_error: { args: ["ptr", "u32"], returns: "i32" },

  bk_runtime_init: { args: [], returns: "i32" },
  bk_runtime_shutdown: { args: [], returns: "i32" },
  bk_runtime_running: { args: [], returns: "i32" },

  bk_event_next_size: { args: [], returns: "u32" },
  bk_event_pop: { args: ["ptr", "u32"], returns: "i32" },

  bk_object_destroy: { args: ["u64"], returns: "i32" },

  bk_window_create: { args: ["ptr", "u32", "f64", "f64"], returns: "u64" },
  bk_window_set_title: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_window_show: { args: ["u64"], returns: "i32" },
  bk_window_close: { args: ["u64"], returns: "i32" },
  bk_window_set_content: { args: ["u64", "u64"], returns: "i32" },

  bk_label_create: { args: ["ptr", "u32"], returns: "u64" },
  bk_label_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_label_text_length: { args: ["u64"], returns: "u32" },
  bk_label_copy_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_label_set_color: { args: ["u64", "ptr", "u32"], returns: "i32" },

  bk_button_create: { args: ["ptr", "u32"], returns: "u64" },
  bk_button_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_button_set_click_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_button_click: { args: ["u64"], returns: "i32" },

  bk_textbox_create: { args: ["i32", "ptr", "u32"], returns: "u64" },
  bk_textbox_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textbox_set_placeholder: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textbox_set_change_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_textbox_value_length: { args: ["u64"], returns: "u32" },
  bk_textbox_copy_value: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textbox_insert_text: { args: ["u64", "ptr", "u32"], returns: "i32" },

  bk_checkbox_create: { args: ["ptr", "u32", "i32"], returns: "u64" },
  bk_checkbox_set_checked: { args: ["u64", "i32"], returns: "i32" },
  bk_checkbox_get_checked: { args: ["u64"], returns: "i32" },
  bk_checkbox_set_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_switch_create: { args: ["i32"], returns: "u64" },
  bk_switch_set_on: { args: ["u64", "i32"], returns: "i32" },
  bk_switch_get_on: { args: ["u64"], returns: "i32" },
  bk_switch_set_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_slider_create: { args: ["f64", "f64", "f64"], returns: "u64" },
  bk_slider_set_value: { args: ["u64", "f64"], returns: "i32" },
  bk_slider_get_value: { args: ["u64"], returns: "f64" },
  bk_slider_set_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_select_create: { args: [], returns: "u64" },
  bk_select_set_items: { args: ["u64", "ptr", "u32", "i32"], returns: "i32" },
  bk_select_set_selected: { args: ["u64", "i32"], returns: "i32" },
  bk_select_get_selected: { args: ["u64"], returns: "i32" },
  bk_select_title_length: { args: ["u64"], returns: "u32" },
  bk_select_copy_title: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_select_set_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_textarea_create: { args: [], returns: "u64" },
  bk_textarea_set_text: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textarea_value_length: { args: ["u64"], returns: "u32" },
  bk_textarea_copy_value: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_textarea_set_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_progress_create: { args: ["f64", "f64", "i32"], returns: "u64" },
  bk_progress_set_value: { args: ["u64", "f64"], returns: "i32" },
  bk_progress_get_value: { args: ["u64"], returns: "f64" },
  bk_separator_create: { args: ["i32"], returns: "u64" },
  bk_spacer_create: { args: [], returns: "u64" },

  bk_control_set_enabled: { args: ["u64", "i32"], returns: "i32" },
  bk_control_set_visible: { args: ["u64", "i32"], returns: "i32" },
  bk_control_get_size: { args: ["u64", "ptr", "ptr"], returns: "i32" },

  bk_stack_create: { args: ["i32", "f64", "f64", "f64", "f64", "f64"], returns: "u64" },
  bk_stack_create_ex: { args: ["i32", "f64", "f64", "f64", "f64", "f64", "i32"], returns: "u64" },
  bk_stack_add_child: { args: ["u64", "u64", "f64"], returns: "i32" },
  bk_stack_remove_child: { args: ["u64", "u64"], returns: "i32" },
  bk_stack_set_align: { args: ["u64", "i32"], returns: "i32" },
  bk_stack_set_pack: { args: ["u64", "i32"], returns: "i32" },
  bk_imageview_set_source: { args: ["u64", "ptr", "u32"], returns: "i32" },

  bk_groupbox_create: { args: ["ptr", "u32", "f64"], returns: "u64" },
  bk_groupbox_set_content: { args: ["u64", "u64"], returns: "i32" },
  bk_segmented_create: { args: ["ptr", "u32", "i32"], returns: "u64" },
  bk_segmented_set_selected: { args: ["u64", "i32"], returns: "i32" },
  bk_segmented_get_selected: { args: ["u64"], returns: "i32" },
  bk_segmented_set_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_table_create: { args: ["ptr", "u32", "f64"], returns: "u64" },
  bk_table_set_rows: { args: ["u64", "ptr", "u32", "i32"], returns: "i32" },
  bk_table_select: { args: ["u64", "i32"], returns: "i32" },
  bk_table_get_selected: { args: ["u64"], returns: "i32" },
  bk_table_set_callbacks: { args: ["u64", "u64", "u64"], returns: "i32" },
  bk_dialog_alert: { args: ["u64", "ptr", "u32", "u64"], returns: "i32" },
  bk_dialog_prompt: { args: ["u64", "ptr", "u32", "u64"], returns: "i32" },
  bk_file_open: { args: ["u64", "ptr", "u32", "i32", "ptr", "u32", "u64"], returns: "i32" },
  bk_folder_pick: { args: ["u64", "u64"], returns: "i32" },
  bk_clipboard_set_text: { args: ["ptr", "u32"], returns: "i32" },
  bk_clipboard_text_length: { args: [], returns: "u32" },
  bk_clipboard_copy_text: { args: ["ptr", "u32"], returns: "i32" },
  bk_event_wait: { args: ["u32"], returns: "i32" },
  bk_window_set_menu: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_beep: { args: [], returns: "i32" },
  bk_button_create_ex: { args: ["ptr", "u32", "i32", "i32", "ptr", "u32"], returns: "u64" },
  bk_label_create_ex: { args: ["ptr", "u32", "ptr", "u32", "f64", "i32", "i32", "f64", "f64"], returns: "u64" },
  bk_textbox_set_submit_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_textbox_simulate_enter: { args: ["u64"], returns: "i32" },
  bk_textarea_set_readonly: { args: ["u64", "i32"], returns: "i32" },
  bk_textarea_set_font: { args: ["u64", "i32", "f64"], returns: "i32" },
  bk_window_set_min_size: { args: ["u64", "f64", "f64"], returns: "i32" },

  bk_scrollview_create: { args: ["i32", "i32", "i32"], returns: "u64" },
  bk_scrollview_set_content: { args: ["u64", "u64"], returns: "i32" },
  bk_scrollview_scroll_to: { args: ["u64", "i32"], returns: "i32" },
  bk_container_create: { args: [], returns: "u64" },
  bk_container_add: { args: ["u64", "u64"], returns: "i32" },
  bk_splitview_create: { args: [], returns: "u64" },
  bk_splitview_set_pane: { args: ["u64", "u64"], returns: "i32" },
  bk_splitview_set_content: { args: ["u64", "u64"], returns: "i32" },
  bk_splitview_add_pane: { args: ["u64", "u64"], returns: "i32" },
  bk_splitview_set_position: { args: ["u64", "f64"], returns: "i32" },
  bk_imageview_create: { args: ["ptr", "u32"], returns: "u64" },
  bk_blurview_create: { args: [], returns: "u64" },
  bk_blurview_set_content: { args: ["u64", "u64"], returns: "i32" },
  bk_theme_is_dark: { args: [], returns: "i32" },
  bk_control_set_size: { args: ["u64", "f64", "f64"], returns: "i32" },
  bk_control_set_min_size: { args: ["u64", "f64", "f64"], returns: "i32" },
  bk_control_set_max_size: { args: ["u64", "f64", "f64"], returns: "i32" },
  bk_control_set_theme: { args: ["u64", "i32", "ptr", "u32"], returns: "i32" },
  bk_control_set_tooltip: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_control_set_alpha: { args: ["u64", "f64"], returns: "i32" },
  bk_control_set_background: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_control_set_corner_radius4: { args: ["u64", "f64", "f64", "f64", "f64"], returns: "i32" },
  bk_control_set_border: { args: ["u64", "ptr", "u32", "ptr", "ptr"], returns: "i32" },
  bk_control_set_border_style: { args: ["u64", "ptr", "u32", "ptr", "ptr", "i32"], returns: "i32" },
  bk_input_mouse: { args: ["ptr", "ptr", "ptr"], returns: "i32" },
  bk_input_mouse_local: { args: ["u64", "ptr", "ptr", "ptr"], returns: "i32" },
  bk_input_key: { args: ["i32"], returns: "i32" },
  bk_input_track_window: { args: ["u64", "u64"], returns: "i32" },
  bk_snapshot_view: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_describe_length: { args: ["u64"], returns: "u32" },
  bk_describe_copy: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_check_layout_length: { args: ["u64"], returns: "u32" },
  bk_check_layout_copy: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_file_save: { args: ["u64", "ptr", "u32", "u64"], returns: "i32" },
  bk_menu_popup: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_control_border_thickness: { args: ["u64", "ptr"], returns: "i32" },
  bk_control_focus: { args: ["u64"], returns: "i32" },
  bk_debug_theme_brush: { args: ["ptr", "u32", "ptr"], returns: "i32" },
  bk_debug_window_with_textbox: { args: ["ptr", "u32"], returns: "u64" },
  bk_debug_window_with_richedit: { args: ["ptr", "u32"], returns: "u64" },
  bk_debug_window_with_xaml_textbox: { args: ["ptr", "u32"], returns: "u64" },
  bk_table_create_ex: { args: ["ptr", "u32", "f64", "i32", "f64"], returns: "u64" },
  bk_table_selected_count: { args: ["u64"], returns: "u32" },
  bk_table_selected_at: { args: ["u64", "u32"], returns: "i32" },
  bk_textbox_set_colors: { args: ["u64", "ptr", "u32", "ptr", "u32"], returns: "i32" },
  bk_textarea_set_foreground: { args: ["u64", "ptr", "u32"], returns: "i32" },
  bk_passwordbox_set_submit_callback: { args: ["u64", "u64"], returns: "i32" },
  bk_textarea_create_ex: { args: ["i32"], returns: "u64" },
  }).symbols as Record<string, (...args: any[]) => any>;
  return _lib;
}

export const winLib: any = new Proxy({} as any, {
  get(_t: any, prop: string) {
    return (getLib() as any)[prop];
  },
});

export function winBridgePath(): string {
  return getPath();
}
