// views.cpp — ScrollView, Container, SplitView, ImageView, BlurView and the
// generic view-option setters shared by every control.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Shapes.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Microsoft.UI.Xaml.Media.Imaging.h>
#include <winrt/Windows.Foundation.Collections.h>

#include <cmath>
#include <cstdlib>
#include <string>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;
namespace shp = winrt::Microsoft::UI::Xaml::Shapes;

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

winrt::Windows::Foundation::IInspectable element_of(bk_handle h) {
  auto* entry = bk::registry().get(h);
  return entry ? entry->object : nullptr;
}

} // namespace

extern "C" {

BK_EXPORT bk_handle bk_scrollview_create(int32_t vertical, int32_t horizontal,
                                         int32_t border) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::ScrollViewer viewer;
    viewer.VerticalScrollBarVisibility(
        vertical ? cx::ScrollBarVisibility::Auto : cx::ScrollBarVisibility::Disabled);
    viewer.HorizontalScrollBarVisibility(
        horizontal ? cx::ScrollBarVisibility::Auto : cx::ScrollBarVisibility::Disabled);
    if (border) {
      viewer.BorderThickness(Thickness(1));
      try {
        viewer.BorderBrush(Application::Current()
                               .Resources()
                               .Lookup(winrt::box_value(L"ControlStrokeColorDefaultBrush"))
                               .as<Media::Brush>());
      } catch (...) {
      }
    }
    out = bk::registry().add(bk::NativeType::ScrollView, viewer);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_scrollview_set_content(bk_handle s, bk_handle child) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    auto element = element_of(child);
    if (!entry || entry->type != bk::NativeType::ScrollView || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<cx::ScrollViewer>().Content(element.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_scrollview_scroll_to(bk_handle s, int32_t where) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::ScrollView) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto viewer = entry->object.as<cx::ScrollViewer>();
    const double y = where == 0 ? 0.0
                                : viewer.ExtentHeight() - viewer.ViewportHeight();
    viewer.ChangeView(nullptr, std::max(0.0, y), true);
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT bk_handle bk_container_create(void) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Border border;
    border.Child(cx::Grid());
    out = bk::registry().add(bk::NativeType::Container, border);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_container_add(bk_handle c, bk_handle child) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    auto element = element_of(child);
    if (!entry || entry->type != bk::NativeType::Container || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto grid = entry->object.as<cx::Border>().Child().as<cx::Grid>();
    cx::RowDefinition row;
    row.Height(GridLength(0.0, GridUnitType::Auto));
    grid.RowDefinitions().Append(row);
    cx::Grid::SetRow(element.as<FrameworkElement>(),
                     static_cast<int32_t>(grid.RowDefinitions().Size() - 1));
    grid.Children().Append(element.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT bk_handle bk_splitview_create(void) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::SplitView split;
    // NSSplitView semantics: the pane is always part of the layout, not a
    // collapsible overlay like the WinUI default.
    split.DisplayMode(cx::SplitViewDisplayMode::Inline);
    split.IsPaneOpen(true);
    out = bk::registry().add(bk::NativeType::SplitView, split);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_splitview_set_pane(bk_handle s, bk_handle pane) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    auto element = element_of(pane);
    if (!entry || entry->type != bk::NativeType::SplitView || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<cx::SplitView>().Pane(element.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_splitview_set_content(bk_handle s, bk_handle content) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    auto element = element_of(content);
    if (!entry || entry->type != bk::NativeType::SplitView || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<cx::SplitView>().Content(element.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_splitview_add_pane(bk_handle s, bk_handle pane) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    auto element = element_of(pane);
    if (!entry || entry->type != bk::NativeType::SplitView || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    // SplitView holds one pane; extras go into a stacked content grid.
    auto split = entry->object.as<cx::SplitView>();
    auto existing = split.Content().try_as<cx::Grid>();
    cx::Grid grid;
    if (existing) {
      grid = existing;
    } else {
      split.Content(grid);
    }
    cx::ColumnDefinition col;
    col.Width(GridLength(1.0, GridUnitType::Star));
    grid.ColumnDefinitions().Append(col);
    cx::Grid::SetColumn(element.as<FrameworkElement>(),
                        static_cast<int32_t>(grid.ColumnDefinitions().Size() - 1));
    grid.Children().Append(element.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_splitview_set_position(bk_handle s, double points) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::SplitView) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<cx::SplitView>().OpenPaneLength(points);
    st = BK_OK;
  });
  return combine(rc, st);
}

namespace {

// Images register a Border shell so background/border styling applies; the
// Image itself is the only child.
cx::Image image_of(bk::NativeObject* e) {
  return e->object.as<cx::Border>().Child().as<cx::Image>();
}

void set_image_source(cx::Image const& image, const std::string& p) {
  // WinRT wants a URI; absolute paths become file:/// with forward slashes.
  std::wstring wide = winrt::to_hstring(p).c_str();
  for (auto& ch : wide) if (ch == L'\\') ch = L'/';
  if (wide.rfind(L"file:///", 0) != 0 && wide.rfind(L"http", 0) != 0) {
    wide = L"file:///" + wide;
  }
  try {
    winrt::Microsoft::UI::Xaml::Media::Imaging::BitmapImage source;
    source.UriSource(winrt::Windows::Foundation::Uri(wide));
    image.Source(source);
  } catch (...) {
    bk::set_last_error("image source could not be resolved: " + p);
  }
}

} // namespace

BK_EXPORT bk_handle bk_imageview_create(const char* path, uint32_t path_len) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  const std::string p = path && path_len ? std::string(path, path_len) : "";
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto image = cx::Image();
    if (!p.empty()) set_image_source(image, p);
    cx::Border shell;
    shell.Child(image);
    out = bk::registry().add(bk::NativeType::ImageView, shell);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_imageview_set_source(bk_handle c, const char* path,
                                          uint32_t path_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (!path || path_len == 0) return BK_INVALID_ARGUMENT;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry || entry->type != bk::NativeType::ImageView) {
      st = BK_INVALID_HANDLE;
      return;
    }
    set_image_source(image_of(entry), std::string(path, path_len));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT bk_handle bk_blurview_create(void) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Border border;
    Media::AcrylicBrush acrylic;
    acrylic.TintColor(winrt::Windows::UI::Color{255, 240, 240, 240});
    acrylic.TintOpacity(0.6);
    acrylic.FallbackColor(winrt::Windows::UI::Color{255, 240, 240, 240});
    try {
      border.Background(acrylic);
    } catch (...) {
      // No composition backdrop available: a flat translucent panel instead.
      border.Background(Media::SolidColorBrush(
          winrt::Windows::UI::Color{160, 240, 240, 240}));
    }
    out = bk::registry().add(bk::NativeType::BlurView, border);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_blurview_set_content(bk_handle b, bk_handle child) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(b);
    auto element = element_of(child);
    if (!entry || entry->type != bk::NativeType::BlurView || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<cx::Border>().Child(element.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

// --- generic view options ------------------------------------------------------

BK_EXPORT int32_t bk_control_set_size(bk_handle c, double width, double height) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    try {
      auto fe = element.as<FrameworkElement>();
      if (width > 0) fe.Width(width);
      if (height > 0) fe.Height(height);
      st = BK_OK;
    } catch (...) { st = BK_WRONG_TYPE; }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_min_size(bk_handle c, double min_width,
                                          double min_height) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    try {
      auto fe = element.as<FrameworkElement>();
      if (min_width > 0) fe.MinWidth(min_width);
      if (min_height > 0) fe.MinHeight(min_height);
      st = BK_OK;
    } catch (...) { st = BK_WRONG_TYPE; }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_max_size(bk_handle c, double max_width,
                                          double max_height) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    try {
      auto fe = element.as<FrameworkElement>();
      if (max_width > 0) fe.MaxWidth(max_width);
      if (max_height > 0) fe.MaxHeight(max_height);
      st = BK_OK;
    } catch (...) { st = BK_WRONG_TYPE; }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_tooltip(bk_handle c, const char* text,
                                         uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string t = text && text_len ? std::string(text, text_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    cx::ToolTipService::SetToolTip(
        element.as<FrameworkElement>(),
        winrt::box_value(bk::utf8_to_hstring(t.data(),
                                             static_cast<uint32_t>(t.size()))));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_alpha(bk_handle c, double alpha) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    element.as<UIElement>().Opacity(alpha);
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_background(bk_handle c, const char* hex,
                                            uint32_t hex_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string s = hex && hex_len ? std::string(hex, hex_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    uint32_t value = 0;
    try {
      // "#RRGGBB" and "#AARRGGBB" both carry the CSS prefix.
      const std::string digits = (!s.empty() && s[0] == '#') ? s.substr(1) : s;
      value = static_cast<uint32_t>(std::stoul(digits, nullptr, 16));
    } catch (...) {
      st = BK_INVALID_ARGUMENT;
      return;
    }
    winrt::Windows::UI::Color color;
    if (s.size() > 8) { // #AARRGGBB or AARRGGBB
      color.A = (value >> 24) & 0xFF;
      color.R = (value >> 16) & 0xFF;
      color.G = (value >> 8) & 0xFF;
      color.B = value & 0xFF;
    } else { // RRGGBB
      color.A = 255;
      color.R = (value >> 16) & 0xFF;
      color.G = (value >> 8) & 0xFF;
      color.B = value & 0xFF;
    }
    try {
      element.as<cx::Control>().Background(Media::SolidColorBrush(color));
      st = BK_OK;
      return;
    } catch (...) {
    }
    try {
      auto border = element.as<cx::Border>();
      // Acrylic-backed views (BlurView): tint the acrylic rather than
      // replacing it, which is what setBackground over NSVisualEffectView
      // amounts to on macOS.
      if (auto acrylic = border.Background().try_as<Media::AcrylicBrush>()) {
        acrylic.TintColor(color);
        acrylic.FallbackColor(color);
        st = BK_OK;
        return;
      }
      border.Background(Media::SolidColorBrush(color));
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_border(bk_handle c, const char* hex,
                                        uint32_t hex_len, double width,
                                        double radius) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string s = hex && hex_len ? std::string(hex, hex_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    uint32_t value = 0;
    try {
      // "#RRGGBB" and "#AARRGGBB" both carry the CSS prefix.
      const std::string digits = (!s.empty() && s[0] == '#') ? s.substr(1) : s;
      value = static_cast<uint32_t>(std::stoul(digits, nullptr, 16));
    } catch (...) {
      st = BK_INVALID_ARGUMENT;
      return;
    }
    winrt::Windows::UI::Color color;
    if (s.size() > 8) { // #AARRGGBB or AARRGGBB
      color.A = (value >> 24) & 0xFF;
      color.R = (value >> 16) & 0xFF;
      color.G = (value >> 8) & 0xFF;
      color.B = value & 0xFF;
    } else { // RRGGBB
      color.A = 255;
      color.R = (value >> 16) & 0xFF;
      color.G = (value >> 8) & 0xFF;
      color.B = value & 0xFF;
    }
    const Media::SolidColorBrush brush(color);
    try {
      auto control = element.as<cx::Control>();
      control.BorderBrush(brush);
      if (width > 0) control.BorderThickness(Thickness(width));
      if (radius > 0) control.CornerRadius(CornerRadius(radius));
      st = BK_OK;
      return;
    } catch (...) {
    }
    try {
      auto border = element.as<cx::Border>();
      border.BorderBrush(brush);
      if (width > 0) border.BorderThickness(Thickness(width));
      if (radius > 0) border.CornerRadius(CornerRadius(radius));
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

// style: 1 dashed, 2 dotted. XAML borders cannot stroke a dash pattern, so
// Border-based views get a Rectangle overlay whose StrokeDashArray draws it;
// plain Controls have no equivalent and fall back to solid.
BK_EXPORT int32_t bk_control_set_border_style(bk_handle c, const char* hex,
                                              uint32_t hex_len, double width,
                                              double radius, int32_t style) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string s = hex && hex_len ? std::string(hex, hex_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    uint32_t value = 0;
    try {
      const std::string digits = (!s.empty() && s[0] == '#') ? s.substr(1) : s;
      value = static_cast<uint32_t>(std::stoul(digits, nullptr, 16));
    } catch (...) {
      st = BK_INVALID_ARGUMENT;
      return;
    }
    winrt::Windows::UI::Color color;
    if (s.size() > 8) {
      color.A = (value >> 24) & 0xFF;
      color.R = (value >> 16) & 0xFF;
      color.G = (value >> 8) & 0xFF;
      color.B = value & 0xFF;
    } else {
      color.A = 255;
      color.R = (value >> 16) & 0xFF;
      color.G = (value >> 8) & 0xFF;
      color.B = value & 0xFF;
    }
    const double w = width > 0 ? width : 1.0;
    try {
      auto border = element.as<cx::Border>();
      // Hide the solid border; the overlay draws the pattern instead.
      border.BorderThickness(Thickness(0));

      // The overlay joins whatever grid hosts the content — including the
      // one inside a ScrollViewer on scrolled stacks.
      cx::Grid target{nullptr};
      auto child = border.Child();
      if (auto viewer = child.try_as<cx::ScrollViewer>()) {
        target = viewer.Content().as<cx::Grid>();
      } else if (auto grid = child.try_as<cx::Grid>()) {
        target = grid;
      }
      if (!target) {
        // Arbitrary content: a host grid carries it plus the overlay.
        cx::Grid host;
        if (child) host.Children().Append(child);
        border.Child(host);
        target = host;
      }

      shp::Rectangle overlay;
      overlay.StrokeThickness(w);
      overlay.Stroke(Media::SolidColorBrush(color));
      if (radius > 0) {
        overlay.RadiusX(radius);
        overlay.RadiusY(radius);
      }
      // Dash lengths are multiples of the stroke width, like CSS.
      const double unit = w;
      overlay.StrokeDashArray().Append(style == 2 ? unit : unit * 4);
      overlay.StrokeDashArray().Append(unit * 3);
      overlay.IsHitTestVisible(false);
      overlay.Stretch(Media::Stretch::Fill);
      target.Children().Append(overlay);
      st = BK_OK;
    } catch (...) {
      // Not a Border: solid is the only honest fallback.
      st = bk_control_set_border(c, hex, hex_len, width, radius);
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_set_corner_radius(bk_handle c, double radius) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    try {
      element.as<cx::Control>().CornerRadius(CornerRadius(radius));
      st = BK_OK;
    } catch (...) {
      try {
        element.as<cx::Border>().CornerRadius(CornerRadius(radius));
        st = BK_OK;
      } catch (...) {
        st = BK_WRONG_TYPE;
      }
    }
  });
  return combine(rc, st);
}

} // extern "C"
