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

#include <windows.h>
#include <unknwn.h>
#include <algorithm>
#include <fstream>
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Composition.SystemBackdrops.h>
#include <winrt/Microsoft.UI.Windowing.h>

using namespace winrt::Microsoft::UI::Xaml;

// The WinUI 3 Window implements IWindowNative — the supported way to reach
// the Win32 HWND (needed for WM_SETICON, which AppWindow.SetIcon does not
// apply for unpackaged apps).
struct __declspec(uuid("EECDBF0E-BAE9-4CB6-A68E-9598E1CB57BB"))
IWindowNative : public IUnknown {
  virtual HRESULT __stdcall get_WindowHandle(HWND* hWnd) = 0;
};

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

// Apply the AppWindowTitleBar customisation. `full_size` extends the content
// under the titlebar; bg/fg are optional "#RRGGBB" colours for the Windows 11
// titlebar (empty = leave set). Runs on the UI thread, so it is safe to call
// right after Activate() in the same dispatch — the first painted frame then
// already carries the custom colours (no default-colour flash).
bool apply_titlebar(Window const& win, int32_t full_size, const char* bg,
                    uint32_t bg_len, const char* fg, uint32_t fg_len) {
  try {
    auto titleBar = win.AppWindow().TitleBar();
    if (full_size) titleBar.ExtendsContentIntoTitleBar(true);
    const auto parse = [](const char* s, uint32_t len)
        -> winrt::Windows::UI::Color {
      if (!s || !len) return winrt::Windows::UI::Color{0, 0, 0, 0};
      const std::string hex = (s[0] == '#') ? std::string(s + 1, len - 1)
                                            : std::string(s, len);
      const auto value = static_cast<uint32_t>(std::stoul(hex, nullptr, 16));
      return winrt::Windows::UI::Color{255,
                                       static_cast<uint8_t>((value >> 16) & 0xFF),
                                       static_cast<uint8_t>((value >> 8) & 0xFF),
                                       static_cast<uint8_t>(value & 0xFF)};
    };
    const auto background = parse(bg, bg_len);
    const auto foreground = parse(fg, fg_len);
    const auto shade = [](winrt::Windows::UI::Color c, double f) {
      return winrt::Windows::UI::Color{255,
          static_cast<uint8_t>(std::clamp(c.R * f, 0.0, 255.0)),
          static_cast<uint8_t>(std::clamp(c.G * f, 0.0, 255.0)),
          static_cast<uint8_t>(std::clamp(c.B * f, 0.0, 255.0))};
    };
    if (background.A != 0) {
      titleBar.BackgroundColor(background);
      // Match the caption buttons to the titlebar; hover/pressed shade it.
      titleBar.ButtonBackgroundColor(background);
      titleBar.ButtonHoverBackgroundColor(shade(background, 1.15));
      titleBar.ButtonPressedBackgroundColor(shade(background, 0.85));
    }
    if (foreground.A != 0) {
      titleBar.ForegroundColor(foreground);
      titleBar.ButtonForegroundColor(foreground);
      titleBar.ButtonHoverForegroundColor(foreground);
      titleBar.ButtonPressedForegroundColor(foreground);
    }
    return true;
  } catch (...) {
    return false;
  }
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
    // No SystemBackdrop on purpose: the Application RequestedTheme (seeded in
    // OnLaunched) already gives the window a dark first frame, and Mica/acrylic
    // would sample the desktop wallpaper — a light wallpaper would flash light
    // before the content composes.
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

// Titlebar customisation (AppWindowTitleBar), for runtime changes after the
// window is up. `title_visible` is accepted for API parity but has no effect
// on WASDK 1.7 (no IsVisible on AppWindowTitleBar).
BK_EXPORT int32_t bk_window_set_titlebar(bk_handle w, int32_t full_size,
                                         int32_t title_visible,
                                         const char* bg, uint32_t bg_len,
                                         const char* fg, uint32_t fg_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    (void)title_visible;
    st = apply_titlebar(entry->object.as<Window>(), full_size, bg, bg_len,
                        fg, fg_len)
             ? BK_OK
             : BK_ERROR;
  });
  return combine(rc, st);
}

// Window chrome toggles (macOS parity): resizable/closable/minimizable map to
// the OverlappedPresenter flags. maximizable rides along with resizable, like
// the macOS zoom button.
BK_EXPORT int32_t bk_window_set_style(bk_handle w, int32_t resizable,
                                      int32_t closable, int32_t minimizable) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      auto win = entry->object.as<Window>();
      auto appWindow = win.AppWindow();
      auto presenter = appWindow.Presenter();
      auto overlapped =
          presenter.try_as<winrt::Microsoft::UI::Windowing::OverlappedPresenter>();
      if (!overlapped) {
        st = BK_WRONG_TYPE;
        return;
      }
      overlapped.IsResizable(resizable != 0);
      overlapped.IsMaximizable(resizable != 0);
      overlapped.IsMinimizable(minimizable != 0);
      // WASDK 1.7 has no IsClosable on the presenter, so a non-closable
      // window hides the whole titlebar chrome (no close button at all) and
      // keeps a top drag strip; Alt+F4 is still cancelled by the Closing
      // guard, and the programmatic bk_window_close clears the flag first.
      entry->window_flags = closable != 0 ? 0 : 1;
      if (closable == 0) {
        auto titleBar = appWindow.TitleBar();
        titleBar.ExtendsContentIntoTitleBar(true);
        titleBar.SetDragRectangles(
            {winrt::Windows::Graphics::RectInt32{0, 0, 100000, 32}});
      }
      if (entry->closing_token.value == 0) {
        entry->closing_token = appWindow.Closing(
            [handle = w](winrt::Microsoft::UI::Windowing::AppWindow const&,
                         winrt::Microsoft::UI::Windowing::
                             AppWindowClosingEventArgs const& args) {
              auto* e = bk::registry().get(handle);
              if (e && (e->window_flags & 1)) args.Cancel(true);
            });
      }
      st = BK_OK;
    } catch (...) {
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

// Position the window's BOTTOM-LEFT corner at (x, y) — the macOS frame-origin
// semantics. WinUI uses a top-left origin, so convert through the display's
// work area and the window's own height. (x, y) are relative to the work
// area's bottom-left corner.
BK_EXPORT int32_t bk_window_set_position(bk_handle w, double x, double y) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      auto appWindow = entry->object.as<Window>().AppWindow();
      const auto work = winrt::Microsoft::UI::Windowing::DisplayArea::
          GetFromWindowId(appWindow.Id(),
                          winrt::Microsoft::UI::Windowing::
                              DisplayAreaFallback::Nearest)
              .WorkArea();
      const auto size = appWindow.Size();
      const int32_t topLeftX = work.X + static_cast<int32_t>(x);
      const int32_t topLeftY =
          work.Y + (work.Height - size.Height) - static_cast<int32_t>(y);
      appWindow.Move({topLeftX, topLeftY});
      st = BK_OK;
    } catch (...) {
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

// Read back the bottom-left corner of the window (inverse of the above).
BK_EXPORT int32_t bk_window_position(bk_handle w, double* out_x,
                                     double* out_y) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      auto appWindow = entry->object.as<Window>().AppWindow();
      const auto work = winrt::Microsoft::UI::Windowing::DisplayArea::
          GetFromWindowId(appWindow.Id(),
                          winrt::Microsoft::UI::Windowing::
                              DisplayAreaFallback::Nearest)
              .WorkArea();
      const auto size = appWindow.Size();
      const auto pos = appWindow.Position();
      *out_x = pos.X - work.X;
      *out_y = work.Y + (work.Height - size.Height) - pos.Y;
      st = BK_OK;
    } catch (...) {
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

// Centre the window on its display's work area.
BK_EXPORT int32_t bk_window_center(bk_handle w) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      auto appWindow = entry->object.as<Window>().AppWindow();
      const auto work = winrt::Microsoft::UI::Windowing::DisplayArea::
          GetFromWindowId(appWindow.Id(),
                          winrt::Microsoft::UI::Windowing::
                              DisplayAreaFallback::Nearest)
              .WorkArea();
      const auto size = appWindow.Size();
      appWindow.Move({work.X + (work.Width - size.Width) / 2,
                      work.Y + (work.Height - size.Height) / 2});
      st = BK_OK;
    } catch (...) {
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

// Show the window AND apply the titlebar customisation in a single UI-thread
// turn, so the first painted frame already carries the custom colours instead
// of flashing the default titlebar first. bg/fg as in bk_window_set_titlebar.
BK_EXPORT int32_t bk_window_show_titlebar(bk_handle w, int32_t full_size,
                                          const char* bg, uint32_t bg_len,
                                          const char* fg, uint32_t fg_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto win = entry->object.as<Window>();
    win.Activate();
    st = apply_titlebar(win, full_size, bg, bg_len, fg, fg_len) ? BK_OK
                                                                : BK_ERROR;
  });
  return combine(rc, st);
}

// Window icon (titlebar on Win10, taskbar + Alt+Tab everywhere). SetIcon from
// AppWindow does not stick for unpackaged apps, so this goes through Win32:
// LoadImage for .ico, a PNG wrapped in an ICO container for .png, and
// WM_SETICON for both small and big variants.
BK_EXPORT int32_t bk_window_set_icon(bk_handle w, const char* path,
                                     uint32_t path_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (!path || path_len == 0) return BK_INVALID_ARGUMENT;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      const std::string p(path, path_len);
      std::string lower = p;
      for (auto& ch : lower) ch = static_cast<char>(tolower(ch));

      HICON icon = nullptr;
      std::wstring wide = winrt::to_hstring(p).c_str();
      // Resolve relative paths against the current directory (the bun CWD)
      // so `icon="icons/sparkle.ico"` works from the project root.
      {
        wchar_t absolute[MAX_PATH];
        if (GetFullPathNameW(wide.c_str(), MAX_PATH, absolute, nullptr) > 0) {
          wide = absolute;
        }
      }
      if (lower.size() > 4 && lower.compare(lower.size() - 4, 4, ".ico") == 0) {
        icon = static_cast<HICON>(LoadImageW(
            nullptr, wide.c_str(), IMAGE_ICON, 0, 0,
            LR_LOADFROMFILE | LR_DEFAULTSIZE));
      } else if (lower.size() > 4 &&
                 lower.compare(lower.size() - 4, 4, ".png") == 0) {
        // PNG: wrap the bytes in a minimal ICO container (Vista+ loads
        // PNG-compressed icons) and decode with CreateIconFromResourceEx.
        std::ifstream file(wide.c_str(), std::ios::binary);
        const std::vector<uint8_t> png((std::istreambuf_iterator<char>(file)),
                                       std::istreambuf_iterator<char>());
        if (png.size() < 8) {
          bk::set_last_error("window icon could not be read: " + p);
          st = BK_INVALID_ARGUMENT;
          return;
        }
        std::vector<uint8_t> ico{0, 0, 1, 0, 1, 0};  // reserved, type=icon, count=1
        ico.insert(ico.end(), {0, 0, 0, 0});          // width/height 0 = 256
        ico.insert(ico.end(), {0, 0});                // colours, reserved
        ico.insert(ico.end(), {1, 0});                // planes
        ico.insert(ico.end(), {32, 0});               // bpp
        const uint32_t size = static_cast<uint32_t>(png.size());
        for (int shift = 0; shift < 32; shift += 8)
          ico.push_back(static_cast<uint8_t>((size >> shift) & 0xFF));
        const uint32_t offset = 22;
        for (int shift = 0; shift < 32; shift += 8)
          ico.push_back(static_cast<uint8_t>((offset >> shift) & 0xFF));
        ico.insert(ico.end(), png.begin(), png.end());
        icon = static_cast<HICON>(CreateIconFromResourceEx(
            const_cast<uint8_t*>(ico.data()), static_cast<uint32_t>(ico.size()),
            TRUE, 0x00030000, 0, 0, LR_DEFAULTCOLOR));
      }
      if (!icon) {
        FILE* dbg = fopen("C:\\Users\\marco\\AppData\\Local\\Temp\\icon_debug.txt", "a");
        if (dbg) { fprintf(dbg, "load failed for: %s\n", p.c_str()); fclose(dbg); }
        bk::set_last_error("window icon could not be loaded: " + p +
                           " (use .ico or .png)");
        st = BK_INVALID_ARGUMENT;
        return;
      }
      // HWND via IWindowNative, then set both icon variants.
      IWindowNative* native = nullptr;
      const HRESULT hr = winrt::get_unknown(entry->object)->QueryInterface(
          __uuidof(IWindowNative), reinterpret_cast<void**>(&native));
      if (FAILED(hr) || !native) {
        FILE* dbg = fopen("C:\\Users\\marco\\AppData\\Local\\Temp\\icon_debug.txt", "a");
        if (dbg) {
          fprintf(dbg, "IWindowNative query failed: hr=%08X\n",
                  static_cast<unsigned>(hr));
          fclose(dbg);
        }
        bk::set_last_error("window icon: no HWND available");
        st = BK_ERROR;
        return;
      }
      HWND hwnd = nullptr;
      native->get_WindowHandle(&hwnd);
      native->Release();
      if (!hwnd) {
        bk::set_last_error("window icon: HWND is null");
        st = BK_ERROR;
        return;
      }
      SendMessageW(hwnd, WM_SETICON, ICON_SMALL, reinterpret_cast<LPARAM>(icon));
      SendMessageW(hwnd, WM_SETICON, ICON_BIG, reinterpret_cast<LPARAM>(icon));
      // The taskbar reads the icon from the window class as well.
      SetClassLongPtrW(hwnd, GCLP_HICONSM, reinterpret_cast<LONG_PTR>(icon));
      st = BK_OK;
    } catch (winrt::hresult_error const& e) {
      bk::set_last_error("window icon failed: " + winrt::to_string(e.message()));
      st = BK_ERROR;
    } catch (...) {
      bk::set_last_error("window icon failed with an unexpected error");
      st = BK_ERROR;
    }
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
    // A non-closable window lets the programmatic close through.
    entry->window_flags &= ~1;
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
