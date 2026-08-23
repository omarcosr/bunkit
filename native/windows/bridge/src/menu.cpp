// menu.cpp — window menu bar (MenuBar above the window content).
//
// Windows menus belong to windows, not to the application, so the macOS app
// menu is projected onto each window that asks for one. Shortcuts are display +
// accelerator both: "cmd+n" from JS maps to Ctrl+N.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Input.h>
#include <winrt/Microsoft.UI.Input.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.System.h>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;

namespace {

constexpr char kSection = '\x1e'; // between menus
constexpr char kField = '\x1f';   // inside one menu

std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> out;
  size_t start = 0;
  while (start <= s.size()) {
    const size_t end = s.find(sep, start);
    out.push_back(s.substr(start, end == std::string::npos ? end : end - start));
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return out;
}

} // namespace

extern "C" {

BK_EXPORT int32_t bk_window_set_menu(bk_handle w, const char* spec,
                                     uint32_t spec_len) {
  if (!bk::Runtime::instance().running()) return BK_NOT_INITIALIZED;
  const std::string raw = spec && spec_len ? std::string(spec, spec_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(w);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto win = entry->object.as<Window>();
    FrameworkElement existing =
        win.Content() ? win.Content().as<FrameworkElement>() : nullptr;

    cx::MenuBar bar;
    for (const auto& section : split(raw, kSection)) {
      const auto fields = split(section, kField);
      if (fields.empty() || fields[0].empty()) continue;
      cx::MenuBarItem menu;
      menu.Title(bk::utf8_to_hstring(fields[0].data(),
                                    static_cast<uint32_t>(fields[0].size())));
      for (size_t i = 1; i < fields.size(); ++i) {
        const auto parts = split(fields[i], '|');
        if (parts.empty() || parts[0].empty()) {
          menu.Items().Append(cx::MenuFlyoutSeparator());
          continue;
        }
        auto item = cx::MenuFlyoutItem();
        item.Text(bk::utf8_to_hstring(parts[0].data(),
                                      static_cast<uint32_t>(parts[0].size())));
        const int64_t item_id = parts.size() > 2 ? strtoll(parts[2].c_str(), nullptr, 10) : 0;
        if (parts.size() > 1 && !parts[1].empty()) {
          const char key = parts[1][parts[1].size() - 1];
          if (key != '+' && key != '-') {
            auto accel = winrt::Microsoft::UI::Xaml::Input::KeyboardAccelerator();
            accel.Key(winrt::Windows::System::VirtualKey(
                static_cast<int32_t>(toupper(static_cast<unsigned char>(key)))));
            accel.Modifiers(winrt::Windows::System::VirtualKeyModifiers::Control);
            item.KeyboardAccelerators().Append(accel);
          }
        }
        item.Click([handle = w, item_id, label = parts[0]](
                       auto const&, auto const&) {
          bk::Event ev;
          ev.header.type = BK_EVT_MENU_CLICK;
          ev.header.target = handle;
          ev.header.value1 = item_id;
          ev.payload = label;
          bk::event_queue().push(std::move(ev));
        });
        menu.Items().Append(item);
      }
      bar.Items().Append(menu);
    }

    cx::Grid host;
    cx::RowDefinition menu_row;
    menu_row.Height(GridLength(0.0, GridUnitType::Auto));
    cx::RowDefinition body_row;
    body_row.Height(GridLength(1.0, GridUnitType::Star));
    host.RowDefinitions().Append(menu_row);
    host.RowDefinitions().Append(body_row);
    cx::Grid::SetRow(bar, 0);
    host.Children().Append(bar);
    if (existing) {
      cx::Grid::SetRow(existing, 1);
      host.Children().Append(existing);
    }
    win.Content(host);
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}


// Context menu at the pointer. The flyout needs a point in a UIElement's own
// space, so the window root tracks the last pointer position lazily.
namespace {
winrt::Windows::Foundation::Point g_last_point{0, 0};
void track_pointer(Window const& win) {
  static bool hooked = false;
  if (hooked) return;
  if (!win.Content()) return;
  hooked = true;
  win.Content().as<FrameworkElement>().PointerMoved(
      [](auto const&, winrt::Microsoft::UI::Xaml::Input::PointerRoutedEventArgs const& args) {
        g_last_point = args.GetCurrentPoint(
            args.OriginalSource().as<FrameworkElement>()).Position();
      });
}
} // namespace

BK_EXPORT int32_t bk_menu_popup(bk_handle window, const char* spec,
                                uint32_t spec_len) {
  if (!bk::Runtime::instance().running()) return BK_NOT_INITIALIZED;
  const std::string raw = spec && spec_len ? std::string(spec, spec_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(window);
    if (!entry || entry->type != bk::NativeType::Window) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto win = entry->object.as<Window>();
    auto root = win.Content();
    if (!root) { st = BK_ERROR; return; }
    track_pointer(win);

    // Same "label|shortcut|itemId" fields as the menu bar, ''-joined.
    cx::MenuFlyout flyout;
    for (const auto& field : split(raw, kField)) {
      const auto parts = split(field, '|');
      if (parts.empty() || parts[0].empty()) {
        flyout.Items().Append(cx::MenuFlyoutSeparator());
        continue;
      }
      auto item = cx::MenuFlyoutItem();
      item.Text(bk::utf8_to_hstring(parts[0].data(),
                                    static_cast<uint32_t>(parts[0].size())));
      const int64_t item_id = parts.size() > 2 ? strtoll(parts[2].c_str(), nullptr, 10) : 0;
      item.Click([handle = window, item_id, label = parts[0]](
                     auto const&, auto const&) {
        bk::Event ev;
        ev.header.type = BK_EVT_MENU_CLICK;
        ev.header.target = handle;
        ev.header.value1 = item_id;
        ev.payload = label;
        bk::event_queue().push(std::move(ev));
      });
      flyout.Items().Append(item);
    }
    flyout.ShowAt(root.as<FrameworkElement>(), g_last_point);
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}

} // extern "C"
