// bunkit.h — public C ABI of winbridge.dll (BunKit Windows backend).
//
// This is the entire stable surface between Bun and WinUI. Everything past
// this boundary is opaque: no C++ types, no WinRT objects, no pointers JS can
// dereference. Objects cross as uint64 handles minted by the ObjectRegistry;
// strings cross as UTF-8 byte buffers owned by the caller.
//
// Threading contract (enforced inside the DLL):
//   - bk_runtime_init() starts a dedicated STA thread that owns ALL WinUI
//     objects. Bun never touches a XAML object directly.
//   - Bun -> UI crosses via DispatcherQueue::TryEnqueue (dispatch_async /
//     dispatch_sync internally).
//   - UI -> Bun crosses via a mutex-guarded EventQueue drained by
//     bk_event_next_size()/bk_event_pop() from the Bun thread.
//   - No C++ exception ever escapes these exports; failures are reported
//     through negative result codes plus bk_copy_last_error().
#ifndef BUNKIT_H
#define BUNKIT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#ifdef _WIN32
#define BK_EXPORT __declspec(dllexport)
#else
#define BK_EXPORT __attribute__((visibility("default")))
#endif

typedef uint64_t bk_handle;

// Handle 0 is permanently invalid/null. Live handles are monotonically
// increasing and never reused while stale events could still reference them.
#define BK_HANDLE_NULL ((bk_handle)0)

enum bk_result {
  BK_OK = 0,
  BK_ERROR = -1,
  BK_INVALID_HANDLE = -2,
  BK_WRONG_TYPE = -3,
  BK_NOT_INITIALIZED = -4,
  BK_DISPATCH_FAILED = -5,
  BK_INVALID_ARGUMENT = -6,
  BK_BUFFER_TOO_SMALL = -7,
};

enum bk_stack_orientation {
  BK_STACK_VERTICAL = 0,
  BK_STACK_HORIZONTAL = 1,
};

// Event types delivered through the EventQueue.
enum bk_event_type {
  BK_EVT_CLICK = 1,
  BK_EVT_TEXT_CHANGED = 2,
  BK_EVT_WINDOW_CLOSE_REQUESTED = 3,
  BK_EVT_WINDOW_CLOSED = 4,
  BK_EVT_VALUE_CHANGED = 5,
  BK_EVT_SELECTION_CHANGED = 6,
  BK_EVT_TABLE_DOUBLE_CLICK = 7,  // value1 = row index (Table only)
  BK_EVT_TEXT_SUBMIT = 8,         // Enter pressed in a TextBox (payload = text)
  BK_EVT_DIALOG_RESULT = 9,       // target = caller-minted dialog id (see below)
  BK_EVT_MENU_CLICK = 10,         // value1 = menu item id, payload = label
  BK_EVT_FILE_RESULT = 11,        // target = dialog id, payload = paths '\n'-joined
  BK_EVT_INPUT_KEY = 12,          // value1 = virtual key, value2 = 1 down / 0 up
};

// Wire format for one event: fixed little-endian header followed by an
// optional UTF-8 payload (payload_length bytes). `size` covers header+payload.
#pragma pack(push, 1)
typedef struct bk_event_header {
  uint32_t size;
  uint16_t type;
  uint16_t flags;
  uint64_t target;   // object handle the event belongs to
  uint64_t callback; // callback registry id (0 if none)
  int64_t value1;
  int64_t value2;
  uint32_t payload_length;
} bk_event_header;
#pragma pack(pop)

// ---------------------------------------------------------------------------
// Milestone 0 proof
// ---------------------------------------------------------------------------
BK_EXPORT int32_t bk_test_add(int32_t a, int32_t b);
BK_EXPORT const char* bk_version(void);

// ---------------------------------------------------------------------------
// Error storage. Last error is per-thread (the thread that made the failing
// call). Copy it out before making another call.
// ---------------------------------------------------------------------------
BK_EXPORT uint32_t bk_last_error_length(void);
BK_EXPORT int32_t bk_copy_last_error(char* buffer, uint32_t capacity);

// ---------------------------------------------------------------------------
// Runtime lifecycle. init bootstraps Windows App SDK, starts the STA UI
// thread, runs Application::Start there and publishes the DispatcherQueue.
// shutdown reverses the whole chain in order.
// ---------------------------------------------------------------------------
BK_EXPORT int32_t bk_runtime_init(void);
BK_EXPORT int32_t bk_runtime_shutdown(void);
BK_EXPORT int32_t bk_runtime_running(void);

// ---------------------------------------------------------------------------
// EventQueue (producer: WinUI STA thread, consumer: Bun thread).
// bk_event_next_size(): total byte size of the oldest queued event, 0 if
// empty. bk_event_pop(): copies the oldest event into `buffer`; returns the
// number of bytes written, 0 if the queue is empty, or BK_BUFFER_TOO_SMALL
// (event left queued — grow the buffer and retry).
// ---------------------------------------------------------------------------
BK_EXPORT uint32_t bk_event_next_size(void);
BK_EXPORT int32_t bk_event_pop(void* buffer, uint32_t capacity);
// Block until an event is queued or the timeout (ms) elapses; 1/0.
// Lets the JS loop sleep instead of polling while timers still breathe.
BK_EXPORT int32_t bk_event_wait(uint32_t timeout_ms);

// ---------------------------------------------------------------------------
// Object lifetime
// ---------------------------------------------------------------------------
BK_EXPORT int32_t bk_object_destroy(bk_handle handle);

// --- window ---------------------------------------------------------------
BK_EXPORT bk_handle bk_window_create(const char* title, uint32_t title_len,
                                     double width, double height);
BK_EXPORT int32_t bk_window_set_title(bk_handle w, const char* title,
                                      uint32_t title_len);
BK_EXPORT int32_t bk_window_set_titlebar(bk_handle w, int32_t full_size,
                                         int32_t title_visible,
                                         const char* bg, uint32_t bg_len,
                                         const char* fg, uint32_t fg_len);
// Activate AND set titlebar in one UI-thread turn (no default-colour flash).
BK_EXPORT int32_t bk_window_show_titlebar(bk_handle w, int32_t full_size,
                                          const char* bg, uint32_t bg_len,
                                          const char* fg, uint32_t fg_len);
// Chrome toggles: resizable, closable, minimizable (1 = enabled).
BK_EXPORT int32_t bk_window_set_style(bk_handle w, int32_t resizable,
                                      int32_t closable, int32_t minimizable);
// Position the window's BOTTOM-LEFT corner at (x, y) — macOS semantics —
// relative to the work area's bottom-left. Read-back is the inverse.
BK_EXPORT int32_t bk_window_set_position(bk_handle w, double x, double y);
BK_EXPORT int32_t bk_window_position(bk_handle w, double* out_x,
                                     double* out_y);
// Centre the window on its display's work area.
BK_EXPORT int32_t bk_window_center(bk_handle w);
// Window icon (titlebar + taskbar); .ico or .png path.
BK_EXPORT int32_t bk_window_set_icon(bk_handle w, const char* path,
                                     uint32_t path_len);
BK_EXPORT int32_t bk_window_show(bk_handle w);
BK_EXPORT int32_t bk_window_close(bk_handle w);
BK_EXPORT int32_t bk_window_set_content(bk_handle w, bk_handle content);
BK_EXPORT int32_t bk_window_set_close_callback(bk_handle w, uint64_t cb);

BK_EXPORT bk_handle bk_debug_window_with_textbox(const char* text, uint32_t text_len);
BK_EXPORT bk_handle bk_debug_window_with_richedit(const char* text, uint32_t text_len);
BK_EXPORT bk_handle bk_debug_window_with_xaml_textbox(const char* text, uint32_t text_len);

// --- shared control ops -----------------------------------------------------
BK_EXPORT int32_t bk_control_set_enabled(bk_handle c, int32_t enabled);
BK_EXPORT int32_t bk_control_set_visible(bk_handle c, int32_t visible);
// Post-layout pixel size (ActualWidth/ActualHeight); both outs always written
// (0 on failure). Requires a layout pass to have run on the UI thread.
BK_EXPORT int32_t bk_control_get_size(bk_handle c, double* out_w,
                                      double* out_h);

// --- label (TextBlock) ------------------------------------------------------
BK_EXPORT bk_handle bk_label_create(const char* text, uint32_t text_len);
BK_EXPORT int32_t bk_label_set_text(bk_handle l, const char* text,
                                    uint32_t text_len);
BK_EXPORT uint32_t bk_label_text_length(bk_handle l);
BK_EXPORT int32_t bk_label_copy_text(bk_handle l, char* buffer,
                                     uint32_t capacity);
BK_EXPORT int32_t bk_label_set_color(bk_handle l, const char* color,
                                     uint32_t color_len);

// --- button -----------------------------------------------------------------
BK_EXPORT bk_handle bk_button_create(const char* text, uint32_t text_len);
BK_EXPORT int32_t bk_button_set_text(bk_handle b, const char* text,
                                     uint32_t text_len);
BK_EXPORT int32_t bk_button_set_click_callback(bk_handle b, uint64_t cb);
// Fires Click as if invoked programmatically (automation-style). Used by
// tests and scripting; identical handler path to a real pointer click.
BK_EXPORT int32_t bk_button_click(bk_handle b);

// --- textbox (TextBox; PasswordBox when secure != 0) ------------------------
BK_EXPORT bk_handle bk_textbox_create(int32_t secure,
                                      const char* placeholder,
                                      uint32_t placeholder_len);
BK_EXPORT int32_t bk_textbox_set_text(bk_handle tb, const char* text,
                                      uint32_t text_len);
BK_EXPORT int32_t bk_textbox_set_placeholder(bk_handle tb, const char* text,
                                             uint32_t text_len);
BK_EXPORT int32_t bk_textbox_set_change_callback(bk_handle tb, uint64_t cb);
BK_EXPORT uint32_t bk_textbox_value_length(bk_handle tb);
BK_EXPORT int32_t bk_textbox_copy_value(bk_handle tb, char* buffer,
                                        uint32_t capacity);
// Inserts text at the caret like typing would: raises TextChanged through the
// real edit path (bk_textbox_set_text is echo-suppressed by design).
BK_EXPORT int32_t bk_textbox_insert_text(bk_handle tb, const char* text,
                                          uint32_t text_len);
// Test hook: synthesises an Enter KeyDown on the textbox, exactly like the
// input path would, and queues EVT_TEXT_SUBMIT with the current value.
BK_EXPORT int32_t bk_textbox_simulate_enter(bk_handle tb);

// --- checkbox / switch ------------------------------------------------------
BK_EXPORT bk_handle bk_checkbox_create(const char* title, uint32_t title_len,
                                       int32_t checked);
BK_EXPORT int32_t bk_checkbox_set_checked(bk_handle c, int32_t checked);
BK_EXPORT int32_t bk_checkbox_get_checked(bk_handle c);
BK_EXPORT int32_t bk_checkbox_set_callback(bk_handle c, uint64_t cb);

BK_EXPORT bk_handle bk_switch_create(int32_t on);
BK_EXPORT int32_t bk_switch_set_on(bk_handle s, int32_t on);
BK_EXPORT int32_t bk_switch_get_on(bk_handle s);
BK_EXPORT int32_t bk_switch_set_callback(bk_handle s, uint64_t cb);

// --- slider -----------------------------------------------------------------
BK_EXPORT bk_handle bk_slider_create(double min, double max, double value);
BK_EXPORT int32_t bk_slider_set_value(bk_handle s, double value);
BK_EXPORT double bk_slider_get_value(bk_handle s);
BK_EXPORT int32_t bk_slider_set_callback(bk_handle s, uint64_t cb);

// --- select -----------------------------------------------------------------
BK_EXPORT bk_handle bk_select_create(void);
BK_EXPORT int32_t bk_select_set_items(bk_handle s, const char* items,
                                      uint32_t items_len, int32_t selected);
BK_EXPORT int32_t bk_select_set_selected(bk_handle s, int32_t selected);
BK_EXPORT int32_t bk_select_get_selected(bk_handle s);
BK_EXPORT uint32_t bk_select_title_length(bk_handle s);
BK_EXPORT int32_t bk_select_copy_title(bk_handle s, char* buffer,
                                       uint32_t capacity);
BK_EXPORT int32_t bk_select_set_callback(bk_handle s, uint64_t cb);

// --- multiline text and progress -------------------------------------------
BK_EXPORT bk_handle bk_textarea_create(void);
BK_EXPORT int32_t bk_textarea_set_text(bk_handle t, const char* text,
                                       uint32_t text_len);
BK_EXPORT uint32_t bk_textarea_value_length(bk_handle t);
BK_EXPORT int32_t bk_textarea_copy_value(bk_handle t, char* buffer,
                                          uint32_t capacity);
BK_EXPORT int32_t bk_textarea_set_callback(bk_handle t, uint64_t cb);

BK_EXPORT bk_handle bk_progress_create(double max, double value,
                                       int32_t indeterminate);
BK_EXPORT int32_t bk_progress_set_value(bk_handle p, double value);
BK_EXPORT double bk_progress_get_value(bk_handle p);

BK_EXPORT bk_handle bk_separator_create(int32_t horizontal);
BK_EXPORT bk_handle bk_spacer_create(void);

// --- stacks (Border{Padding} around StackPanel, or Grid when any child
//     declares grow > 0; grow maps to star-sized rows/columns) ---------------
BK_EXPORT bk_handle bk_stack_create(int32_t orientation, double spacing,
                                    double pad_left, double pad_top,
                                    double pad_right, double pad_bottom);
// scroll bit 1 = horizontal scrollbar (auto), bit 2 = vertical; the grid is
// hosted in a ScrollViewer so overflowing content scrolls instead of clipping.
BK_EXPORT bk_handle bk_stack_create_ex(int32_t orientation, double spacing,
                                       double pad_left, double pad_top,
                                       double pad_right, double pad_bottom,
                                       int32_t scroll);
BK_EXPORT int32_t bk_stack_add_child(bk_handle stack, bk_handle child,
                                     double grow);
// Inserts a child at a 0-based position among the real children (non-centre
// stacks; grow applies to the inserted row/column).
BK_EXPORT int32_t bk_stack_insert_child(bk_handle stack, bk_handle child,
                                        int32_t index, double grow);
// Removes a child and its row/column definition, keeping the rest aligned.
BK_EXPORT int32_t bk_stack_remove_child(bk_handle stack, bk_handle child);
// align: 0 leading, 1 center, 2 trailing, 3 fill (cross axis, applies per child).
// pack: 0 start (content at the top/left), 1 center (content centred along the
// main axis), 2 fill (leftover shared out). Call before adding children.
BK_EXPORT int32_t bk_stack_set_align(bk_handle stack, int32_t align);
BK_EXPORT int32_t bk_stack_set_pack(bk_handle stack, int32_t pack);

// --- group box --------------------------------------------------------------
// Bordered panel with a header. Children replace the whole content; a second
// call replaces the first.
BK_EXPORT bk_handle bk_groupbox_create(const char* title, uint32_t title_len,
                                       double padding);
BK_EXPORT int32_t bk_groupbox_set_content(bk_handle g, bk_handle child);

// --- segmented (SelectorBar) --------------------------------------------------
// `items` is '\n'-joined segment labels.
BK_EXPORT bk_handle bk_segmented_create(const char* items, uint32_t items_len,
                                        int32_t selected);
BK_EXPORT int32_t bk_segmented_set_selected(bk_handle s, int32_t selected);
BK_EXPORT int32_t bk_segmented_get_selected(bk_handle s);
BK_EXPORT int32_t bk_segmented_set_callback(bk_handle s, uint64_t cb);

// --- table --------------------------------------------------------------------
// Columns: '\n'-joined "title<US>width<US>align<US>flex" records (US = 0x1f);
// width <= 0 means "share the spare width according to flex weight". Cells are
// computed on the JS side; `rows` in bk_table_set_rows is '\n'-joined records
// of '\x1f'-joined cell strings.
BK_EXPORT bk_handle bk_table_create(const char* columns, uint32_t columns_len,
                                    double row_height);
BK_EXPORT int32_t bk_table_set_rows(bk_handle t, const char* rows,
                                    uint32_t rows_len, int32_t selected);
BK_EXPORT int32_t bk_table_select(bk_handle t, int32_t index);
BK_EXPORT int32_t bk_table_get_selected(bk_handle t);
// cb1 = selection changed, cb2 = double click (value1 = row index).
BK_EXPORT int32_t bk_table_set_callbacks(bk_handle t, uint64_t cb_select,
                                         uint64_t cb_double);

// --- dialogs (async; result arrives as BK_EVT_DIALOG_RESULT / FILE_RESULT) ---
// `target` of the result event is the caller-minted `dialog_id`. Dialog text
// config is '\x1e'-joined: title, message, buttons..., suppressible(0/1).
BK_EXPORT int32_t bk_dialog_alert(bk_handle window, const char* cfg,
                                  uint32_t cfg_len, uint64_t dialog_id);
// cfg: '\x1e'-joined title, message, placeholder, initial value.
BK_EXPORT int32_t bk_dialog_prompt(bk_handle window, const char* cfg,
                                   uint32_t cfg_len, uint64_t dialog_id);
// Payload of FILE_RESULT is the chosen paths '\n'-joined (empty = cancelled).
// types: '\n'-joined extensions without the dot ("png\njpg"); empty = all.
BK_EXPORT int32_t bk_file_open(bk_handle window, const char* title,
                               uint32_t title_len, int32_t multiple,
                               const char* types, uint32_t types_len,
                               uint64_t dialog_id);
// Folder picker (single selection). Payload of FILE_RESULT is the path.
BK_EXPORT int32_t bk_folder_pick(bk_handle window, uint64_t dialog_id);

// --- clipboard (plain text) -----------------------------------------------------
BK_EXPORT int32_t bk_clipboard_set_text(const char* text, uint32_t len);
BK_EXPORT uint32_t bk_clipboard_text_length(void);
BK_EXPORT int32_t bk_clipboard_copy_text(char* buffer, uint32_t capacity);

// --- menu bar -----------------------------------------------------------------
// Sections '\x1e'-joined; each section is '\x1f'-joined: menu title, then
// items "label|shortcut|itemId" (empty label = separator). Clicks come back as
// BK_EVT_MENU_CLICK with value1 = itemId. Installs a MenuBar above the
// window's current content.
BK_EXPORT int32_t bk_window_set_menu(bk_handle w, const char* spec,
                                     uint32_t spec_len);

// --- misc ---------------------------------------------------------------------
BK_EXPORT int32_t bk_beep(void);

// Variant creation with macOS-parity options. `symbol` is an icon name mapped
// to Segoe Fluent Icons; empty string for none. Style numbers are shared with
// the TS layer (see src/platform/windows/backend.ts).
BK_EXPORT bk_handle bk_button_create_ex(const char* text, uint32_t text_len,
                                        int32_t primary, int32_t destructive,
                                        const char* symbol,
                                        uint32_t symbol_len);
// color: "" | "secondaryLabel". style_bits: 1 = semibold, 2 = title,
// 4 = monospace. align: 0 left, 1 center, 2 right. width <= 0 = auto.
BK_EXPORT bk_handle bk_label_create_ex(const char* text, uint32_t text_len,
                                       const char* color, uint32_t color_len,
                                       double font_size, int32_t style_bits,
                                       int32_t align, double width,
                                       double height);
BK_EXPORT int32_t bk_textbox_set_submit_callback(bk_handle tb, uint64_t cb);
BK_EXPORT int32_t bk_textarea_set_readonly(bk_handle t, int32_t readonly);
BK_EXPORT int32_t bk_textarea_set_font(bk_handle t, int32_t monospace,
                                       double font_size);
// Clamps the window's content, keeping the frame from shrinking usefully.
BK_EXPORT int32_t bk_window_set_min_size(bk_handle w, double min_width,
                                         double min_height);

// --- scroll view / containers / split / image / blur -------------------------
BK_EXPORT bk_handle bk_scrollview_create(int32_t vertical, int32_t horizontal,
                                         int32_t border);
BK_EXPORT int32_t bk_scrollview_set_content(bk_handle s, bk_handle child);
// where: 0 top, 1 bottom.
BK_EXPORT int32_t bk_scrollview_scroll_to(bk_handle s, int32_t where);

// Container: a plain Border; children stack in rows (an approximation of the
// macOS absolute-position container).
BK_EXPORT bk_handle bk_container_create(void);
BK_EXPORT int32_t bk_container_add(bk_handle c, bk_handle child);

BK_EXPORT bk_handle bk_splitview_create(void);
// panes: [0] -> pane, [1] -> content, extras append into the content grid.
BK_EXPORT int32_t bk_splitview_set_pane(bk_handle s, bk_handle pane);
BK_EXPORT int32_t bk_splitview_set_content(bk_handle s, bk_handle content);
BK_EXPORT int32_t bk_splitview_add_pane(bk_handle s, bk_handle pane);
BK_EXPORT int32_t bk_splitview_set_position(bk_handle s, double points);

BK_EXPORT bk_handle bk_imageview_create(const char* path, uint32_t path_len);
BK_EXPORT int32_t bk_imageview_set_source(bk_handle c, const char* path,
                                          uint32_t path_len);
// SVG source with a colour tint; non-SVG sources ignore the tint.
BK_EXPORT int32_t bk_imageview_set_source_ex(bk_handle c, const char* path,
                                             uint32_t path_len,
                                             const char* tint,
                                             uint32_t tint_len);

// Acrylic-backed panel (approximates NSVisualEffectView).
BK_EXPORT bk_handle bk_blurview_create(void);
BK_EXPORT int32_t bk_blurview_set_content(bk_handle b, bk_handle child);

// 1 when the OS is in dark mode; used to resolve `{ light, dark }` colours
// when the app follows the system theme.
BK_EXPORT int32_t bk_theme_is_dark(void);

// Debug: read back the BorderThickness of a registered control.
// out4 must point to 4 doubles; receives {left, top, right, bottom}.
BK_EXPORT int32_t bk_control_border_thickness(bk_handle c, double* out4);

// Debug: give a registered control programmatic keyboard focus.
BK_EXPORT int32_t bk_control_focus(bk_handle c);

// Debug: resolve a theme brush key from the application resources and copy its
// solid colour to out_hex ("RRGGBB"). Returns 1 when it resolves, else 0.
BK_EXPORT int32_t bk_debug_theme_brush(const char* key, uint32_t key_len,
                                       char* out_hex);

// --- generic view options ------------------------------------------------------
// 0 in a dimension leaves it unset. background is "#RRGGBB"/"#AARRGGBB".
BK_EXPORT int32_t bk_control_set_size(bk_handle c, double width, double height);
BK_EXPORT int32_t bk_control_set_min_size(bk_handle c, double min_width,
                                          double min_height);
BK_EXPORT int32_t bk_control_set_max_size(bk_handle c, double max_width,
                                          double max_height);
// theme: 0 default (follows system), 1 light, 2 dark. Subtree-wide. bg:
// optional hex overriding the painted page background for that mode.
BK_EXPORT int32_t bk_control_set_theme(bk_handle c, int32_t theme,
                                       const char* bg, uint32_t bg_len);
BK_EXPORT int32_t bk_control_set_tooltip(bk_handle c, const char* text,
                                         uint32_t text_len);
BK_EXPORT int32_t bk_control_set_alpha(bk_handle c, double alpha);
BK_EXPORT int32_t bk_control_set_background(bk_handle c, const char* hex,
                                            uint32_t hex_len);
// CSS-like outer shadow. hex is #AARRGGBB or #RRGGBB; offset is in
// device-independent pixels and positive y points down.
BK_EXPORT int32_t bk_control_set_shadow(bk_handle c, const char* hex,
                                         uint32_t hex_len, double offset_x,
                                         double offset_y, double blur,
                                         double opacity);
// tl/tr/br/bl: per-corner radii; pass one value four times for uniform.
BK_EXPORT int32_t bk_control_set_corner_radius4(bk_handle c, double tl,
                                                double tr, double br,
                                                double bl);
// hex as in set_background; widths: double[4] in Thickness order {left, top,
// right, bottom}; radii: double[4] {tl, tr, br, bl}.
BK_EXPORT int32_t bk_control_set_border(bk_handle c, const char* hex,
                                        uint32_t hex_len,
                                        const double* widths,
                                        const double* radii);
// style: 1 dashed, 2 dotted. Border-wrapper views (Container, stacks, Table,
// GroupBox shells) draw the pattern with a Rectangle overlay; plain Controls
// have no stroke-pattern support and fall back to solid. Per-side widths
// stroke with the largest value.
BK_EXPORT int32_t bk_control_set_border_style(bk_handle c, const char* hex,
                                              uint32_t hex_len,
                                              const double* widths,
                                              const double* radii,
                                              int32_t style);

// --- input ---------------------------------------------------------------------
// Global mouse state in screen coordinates; buttons bit 0 = left, 1 = right,
// 2 = middle, 3/4 = X1/X2. Wheel deltas need a message hook and stay 0.
BK_EXPORT int32_t bk_input_mouse(double* out_x, double* out_y,
                                 int32_t* out_buttons);
// Position relative to a window's content, plus whether the pointer is inside.
BK_EXPORT int32_t bk_input_mouse_local(bk_handle window, double* out_x,
                                       double* out_y, int32_t* out_inside);
// 1 while the virtual key is held. Poll, don't listen.
BK_EXPORT int32_t bk_input_key(int32_t vkey);
// Routes the window's keyboard as BK_EVT_INPUT_KEY (needs window focus).
BK_EXPORT int32_t bk_input_track_window(bk_handle w, uint64_t cb);

// --- snapshot / debug -----------------------------------------------------------
// Renders the element to a PNG file. RenderTargetBitmap cannot see SwapChainPanels,
// matching the macOS caveat about Metal layers. Returns written byte count or
// a negative bk_result.
BK_EXPORT int32_t bk_snapshot_view(bk_handle element, const char* path,
                                   uint32_t path_len);
// "Class (x,y WxH)\n..." walk of the visual tree, two-call protocol.
BK_EXPORT uint32_t bk_describe_length(bk_handle element);
BK_EXPORT int32_t bk_describe_copy(bk_handle element, char* buffer,
                                   uint32_t capacity);
// "view<US>parent<US>detail\n" for children spilling outside their parent.
BK_EXPORT uint32_t bk_check_layout_length(bk_handle root);
BK_EXPORT int32_t bk_check_layout_copy(bk_handle root, char* buffer,
                                       uint32_t capacity);

// --- extra pickers / menus -------------------------------------------------------
// Payload of FILE_RESULT is the chosen path (empty = cancelled).
BK_EXPORT int32_t bk_file_save(bk_handle window, const char* default_name,
                               uint32_t name_len, uint64_t dialog_id);
// Shows a context menu at the pointer. Same item spec as bk_window_set_menu;
// clicks arrive as BK_EVT_MENU_CLICK with target = the window handle.
BK_EXPORT int32_t bk_menu_popup(bk_handle window, const char* spec,
                                uint32_t spec_len);

// --- table upgrades ---------------------------------------------------------------
// flags: 1 multiSelect, 2 headers off, 4 alternating rows, 8 monospace font.
// font_size <= 0 keeps the default. Column records gain min/max fields:
// "title<US>width<US>align<US>flex<US>min<US>max". A cell value starting with
// 0x01 followed by a decimal handle embeds that element instead of text.
BK_EXPORT bk_handle bk_table_create_ex(const char* columns, uint32_t columns_len,
                                       double row_height, int32_t flags,
                                       double font_size);
BK_EXPORT uint32_t bk_table_selected_count(bk_handle t);
BK_EXPORT int32_t bk_table_selected_at(bk_handle t, uint32_t index);

// --- misc parity -------------------------------------------------------------------
// secure: also raise BK_EVT_TEXT_SUBMIT on Enter in a PasswordBox.
// textColor/placeholderColor as hex ("" = unchanged). Secure boxes take the
// text colour only.
BK_EXPORT int32_t bk_textbox_set_colors(bk_handle tb, const char* text_hex,
                                        uint32_t text_len,
                                        const char* ph_hex,
                                        uint32_t ph_len);
// Text colour for multiline areas.
BK_EXPORT int32_t bk_textarea_set_foreground(bk_handle t, const char* hex,
                                             uint32_t hex_len);
BK_EXPORT int32_t bk_passwordbox_set_submit_callback(bk_handle pb, uint64_t cb);
// 1 = RichEditBox instead of TextBox.
BK_EXPORT bk_handle bk_textarea_create_ex(int32_t rich);

#ifdef __cplusplus
}
#endif
#endif // BUNKIT_H
