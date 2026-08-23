// input.cpp — keyboard and mouse as pollable state.
//
// The macOS Input uses an app-local NSEvent monitor; WinUI has no equivalent
// that sees keys before the focused control, so key *events* come from the
// tracked window's root (requires focus) while everything else — buttons,
// pointer position, async key state — is global Win32. Wheel deltas would need
// a message hook and are left at zero.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"

#include <windows.h>
#include <microsoft.ui.xaml.window.h>

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Input.h>

using namespace winrt::Microsoft::UI::Xaml;

namespace {

int32_t require_running() {
  if (!bk::Runtime::instance().running()) {
    bk::set_last_error("runtime not initialized (call bk_runtime_init first)");
    return BK_NOT_INITIALIZED;
  }
  return BK_OK;
}

inline int32_t combine(int32_t dispatch_rc, int32_t body_status) {
  return dispatch_rc == BK_OK ? body_status : dispatch_rc;
}

HWND window_hwnd(bk::NativeObject* entry) {
  HWND hwnd{};
  try {
    entry->object.as<Window>().as<::IWindowNative>()->get_WindowHandle(&hwnd);
  } catch (...) {
  }
  return hwnd;
}

} // namespace

extern "C" {

BK_EXPORT int32_t bk_input_mouse(double* out_x, double* out_y,
                                 int32_t* out_buttons) {
  if (!out_x || !out_y || !out_buttons) return BK_INVALID_ARGUMENT;
  POINT p{};
  if (!GetCursorPos(&p)) {
    *out_x = 0; *out_y = 0; *out_buttons = 0;
    return BK_ERROR;
  }
  *out_x = static_cast<double>(p.x);
  *out_y = static_cast<double>(p.y);
  int32_t buttons = 0;
  if (GetAsyncKeyState(VK_LBUTTON) & 0x8000) buttons |= 1;
  if (GetAsyncKeyState(VK_RBUTTON) & 0x8000) buttons |= 2;
  if (GetAsyncKeyState(VK_MBUTTON) & 0x8000) buttons |= 4;
  if (GetAsyncKeyState(VK_XBUTTON1) & 0x8000) buttons |= 8;
  if (GetAsyncKeyState(VK_XBUTTON2) & 0x8000) buttons |= 16;
  *out_buttons = buttons;
  return BK_OK;
}

BK_EXPORT int32_t bk_input_mouse_local(bk_handle window, double* out_x,
                                       double* out_y, int32_t* out_inside) {
  if (!out_x || !out_y || !out_inside) return BK_INVALID_ARGUMENT;
  *out_x = 0; *out_y = 0; *out_inside = 0;
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;

  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(window);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    const HWND hwnd = window_hwnd(entry);
    if (!hwnd) { st = BK_ERROR; return; }
    POINT p{};
    if (!GetCursorPos(&p)) { st = BK_ERROR; return; }
    if (!ScreenToClient(hwnd, &p)) { st = BK_ERROR; return; }
    RECT client{};
    GetClientRect(hwnd, &client);
    *out_x = static_cast<double>(p.x);
    *out_y = static_cast<double>(p.y);
    *out_inside = p.x >= client.left && p.x <= client.right &&
                  p.y >= client.top && p.y <= client.bottom ? 1 : 0;
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_input_key(int32_t vkey) {
  return (GetAsyncKeyState(static_cast<int>(vkey)) & 0x8000) ? 1 : 0;
}

BK_EXPORT int32_t bk_input_track_window(bk_handle w, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto win = entry->object.as<Window>();
    // Attach lazily to the content root once it exists; the tokens live for
    // the window's lifetime so one track call is enough.
    if (entry->token3.value != 0) {
      entry->cb2 = cb;
      st = BK_OK;
      return;
    }
    auto content = win.Content();
    if (!content) {
      bk::set_last_error("input tracking needs window content first");
      st = BK_ERROR;
      return;
    }
    auto emit = [handle = w](int32_t vkey, bool down, bool repeat) {
      auto* e = bk::registry().get(handle);
      if (!e || e->cb2 == 0) return;
      if (repeat) return; // auto-repeat would re-fire pressed() forever
      bk::Event ev;
      ev.header.type = BK_EVT_INPUT_KEY;
      ev.header.target = handle;
      ev.header.callback = e->cb2;
      ev.header.value1 = vkey;
      ev.header.value2 = down ? 1 : 0;
      bk::event_queue().push(std::move(ev));
    };
    // XAML Window is not a UIElement; keyboard bubbles through the content.
    auto root = content.as<FrameworkElement>();
    entry->token3 = root.KeyDown(
        [emit](auto const&,
               winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& args) {
          emit(static_cast<int32_t>(args.Key()), true,
               args.KeyStatus().WasKeyDown);
        });
    root.KeyUp([emit](auto const&,
                     winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& args) {
      emit(static_cast<int32_t>(args.Key()), false, false);
    });
    entry->cb2 = cb;
    st = BK_OK;
  });
  return combine(rc, st);
}

} // extern "C"
