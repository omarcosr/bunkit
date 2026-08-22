// window.cpp — Microsoft.UI.Xaml.Window behind bk_window_* handles.
//
// Every function runs its real work on the UI thread through dispatch_sync,
// which discards lambda return values, so bodies report their outcome through
// a captured `st` and the export returns dispatch_rc == BK_OK ? st : dispatch_rc.
// The Closed handler pushes an event rather than calling JavaScript.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Windowing.h>

using namespace winrt::Microsoft::UI::Xaml;

namespace {

int32_t require_running() {
  if (!bk::Runtime::instance().running()) {
    bk::set_last_error("runtime not initialized (call bk_runtime_init first)");
    return BK_NOT_INITIALIZED;
  }
  return BK_OK;
}

// Shared tail: dispatch failures outrank the body's own status.
inline int32_t combine(int32_t dispatch_rc, int32_t body_status) {
  return dispatch_rc == BK_OK ? body_status : dispatch_rc;
}

} // namespace

extern "C" {

BK_EXPORT bk_handle bk_window_create(const char* title, uint32_t title_len,
                                     double width, double height) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  std::string t = (title && title_len) ? std::string(title, title_len)
                                       : std::string();
  bk_handle out = BK_HANDLE_NULL;

  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    Window w;
    if (!t.empty()) {
      w.Title(bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
    }
    if (width > 0 && height > 0) {
      w.AppWindow().Resize({static_cast<int32_t>(width),
                            static_cast<int32_t>(height)});
    }
    out = bk::registry().add(bk::NativeType::Window, w);

    auto& entry = *bk::registry().get(out);
    entry.close_token = w.Closed(
        [handle = out](winrt::Windows::Foundation::IInspectable const&,
                       winrt::Windows::Foundation::IInspectable const&) {
          bk::Event e;
          e.header.type = BK_EVT_WINDOW_CLOSED;
          e.header.target = handle;
          bk::event_queue().push(std::move(e));
        });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_window_set_title(bk_handle w, const char* title,
                                      uint32_t title_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  std::string t = (title && title_len) ? std::string(title, title_len)
                                       : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<Window>().Title(
        bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_window_show(bk_handle w) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<Window>().Activate();
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_window_close(bk_handle w) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    // Close() raises Closed, which pushes WINDOW_CLOSED for Bun and leaves
    // the registry entry alive (matching macOS setReleasedWhenClosed(false)).
    entry->object.as<Window>().Close();
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_window_set_content(bk_handle w, bk_handle content) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* win = bk::registry().get(w);
    if (!win || win->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto* child = bk::registry().get(content);
    if (!child) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      win->object.as<Window>().Content(
          child->object.as<winrt::Microsoft::UI::Xaml::UIElement>());
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_window_set_min_size(bk_handle w, double min_width,
                                         double min_height) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* win = bk::registry().get(w);
    if (!win || win->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    // XAML Window has no MinWidth; clamping the content is the closest
    // equivalent (the frame can still shrink by its chrome).
    if (auto content = win->object.as<Window>().Content()) {
      auto element = content.as<FrameworkElement>();
      if (min_width > 0) element.MinWidth(min_width);
      if (min_height > 0) element.MinHeight(min_height);
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_object_destroy(bk_handle handle) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(handle);
    if (!entry) {
      st = BK_INVALID_HANDLE;
      return;
    }
    if (entry->type == bk::NativeType::Window && entry->close_token.value != 0) {
      try {
        entry->object.as<Window>().Closed(entry->close_token);
      } catch (...) {
        // Object may already be gone; teardown must not throw across ABI.
      }
    }
    st = static_cast<int32_t>(bk::registry().destroy(handle));
  });
  return combine(rc, st);
}

} // extern "C"
