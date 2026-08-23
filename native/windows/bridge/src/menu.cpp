// menu.cpp — window menu bar (MenuBar above the window content) and context
// menus at the pointer.
//
// Windows menus belong to windows, not to the application, so the macOS app
// menu is projected onto each window that asks for one. Shortcuts are display +
// accelerator both: "cmd+n" from JS maps to Ctrl+N.
//
// Item spec (shared by bar and popup): sections joined by \x1e; each section
// starts with its title (menu bar only), then items joined by \x1f. Every item
// is "depth|label|shortcut|itemId"; an empty label is a separator; an item
// immediately followed by deeper items becomes a MenuFlyoutSubItem.
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

#include <windows.h>
#include <microsoft.ui.xaml.window.h>

#include <algorithm>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;
namespace wfc = winrt::Windows::Foundation::Collections;

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

struct ParsedItem {
  int depth{};
  std::string label;
  std::string shortcut;
  long long id{};
};

void push_click(bk_handle window, long long id, const std::string& label) {
  bk::Event ev;
  ev.header.type = BK_EVT_MENU_CLICK;
  ev.header.target = window;
  ev.header.value1 = id;
  ev.payload = label;
  bk::event_queue().push(std::move(ev));
}

// Builds one nesting level into `into`, consuming items from `idx` while they
// sit at `depth`; deeper runs recurse as MenuFlyoutSubItems.
void fill_level(wfc::IVector<cx::MenuFlyoutItemBase> const& into,
                const std::vector<ParsedItem>& items, size_t& idx, int depth,
                bk_handle window) {
  while (idx < items.size()) {
    const auto& it = items[idx];
    if (it.depth < depth) return; // parent level resumes
    if (it.depth > depth) {       // orphaned run without a header; skip
      ++idx;
      continue;
    }
    ++idx;

    if (it.label.empty()) {
      into.Append(cx::MenuFlyoutSeparator());
      continue;
    }

    if (idx < items.size() && items[idx].depth > depth) {
      cx::MenuFlyoutSubItem sub;
      sub.Text(bk::utf8_to_hstring(it.label.data(),
                                   static_cast<uint32_t>(it.label.size())));
      fill_level(sub.Items(), items, idx, depth + 1, window);
      into.Append(sub);
      continue;
    }

    auto item = cx::MenuFlyoutItem();
    item.Text(bk::utf8_to_hstring(it.label.data(),
                                  static_cast<uint32_t>(it.label.size())));
    if (!it.shortcut.empty()) {
      const char key = it.shortcut[it.shortcut.size() - 1];
      if (key != '+' && key != '-') {
        auto accel = winrt::Microsoft::UI::Xaml::Input::KeyboardAccelerator();
        accel.Key(winrt::Windows::System::VirtualKey(
            static_cast<int32_t>(toupper(static_cast<unsigned char>(key)))));
        accel.Modifiers(winrt::Windows::System::VirtualKeyModifiers::Control);
        item.KeyboardAccelerators().Append(accel);
      }
    }
    if (it.id != 0) {
      item.Click([handle = window, id = it.id, label = it.label](
                     auto const&, auto const&) { push_click(handle, id, label); });
    }
    into.Append(item);
  }
}

std::vector<ParsedItem> parse_items(const std::string& joined) {
  std::vector<ParsedItem> out;
  for (const auto& field : split(joined, kField)) {
    const auto parts = split(field, '|');
    if (parts.size() < 4) continue; // malformed record
    ParsedItem it;
    it.depth = atoi(parts[0].c_str());
    it.label = parts[1];
    it.shortcut = parts[2];
    it.id = strtoll(parts[3].c_str(), nullptr, 10);
    out.push_back(std::move(it));
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
      auto items = parse_items(section.substr(fields[0].size() + 1));
      size_t idx = 0;
      fill_level(menu.Items(), items, idx, 0, w);
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


// Context menu at the pointer. ShowAt wants a point in the target element's
// space, so read the live cursor: screen px -> client px -> DIPs (the XAML
// coordinate space scales with the monitor's rasterization scale).
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

    POINT pt{};
    if (!GetCursorPos(&pt)) { st = BK_ERROR; return; }
    HWND hwnd{};
    try {
      entry->object.as<Window>().as<::IWindowNative>()->get_WindowHandle(&hwnd);
    } catch (...) {
    }
    if (hwnd && !ScreenToClient(hwnd, &pt)) { st = BK_ERROR; return; }

    float scale = 1.0f;
    try {
      if (root.XamlRoot()) {
        scale = static_cast<float>(root.XamlRoot().RasterizationScale());
      }
    } catch (...) {
    }
    scale = std::max(1.0f, scale);

    cx::MenuFlyout flyout;
    auto parsed = parse_items(raw);
    size_t idx = 0;
    fill_level(flyout.Items(), parsed, idx, 0, window);
    const winrt::Windows::Foundation::Point pos{
        static_cast<float>(pt.x) / scale,
        static_cast<float>(pt.y) / scale};
    flyout.ShowAt(root.as<FrameworkElement>(), pos);
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}

} // extern "C"
