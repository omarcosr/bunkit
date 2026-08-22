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

// ---------------------------------------------------------------------------
// Object lifetime
// ---------------------------------------------------------------------------
BK_EXPORT int32_t bk_object_destroy(bk_handle handle);

// --- window ---------------------------------------------------------------
BK_EXPORT bk_handle bk_window_create(const char* title, uint32_t title_len,
                                     double width, double height);
BK_EXPORT int32_t bk_window_set_title(bk_handle w, const char* title,
                                      uint32_t title_len);
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
BK_EXPORT int32_t bk_stack_add_child(bk_handle stack, bk_handle child,
                                     double grow);

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
BK_EXPORT int32_t bk_file_open(bk_handle window, const char* title,
                               uint32_t title_len, int32_t multiple,
                               uint64_t dialog_id);

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

#ifdef __cplusplus
}
#endif
#endif // BUNKIT_H
