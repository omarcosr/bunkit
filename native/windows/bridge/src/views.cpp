// views.cpp — ScrollView, Container, SplitView, ImageView, BlurView and the
// generic view-option setters shared by every control.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"
#include "system.h"

#include <windows.h>

#include <winrt/Microsoft.UI.Dispatching.h>
#include <winrt/Microsoft.UI.Xaml.Input.h>
#include <winrt/Microsoft.UI.Input.h>
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Markup.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
#include <winrt/Microsoft.UI.Xaml.Shapes.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Microsoft.UI.Composition.h>
#include <winrt/Microsoft.UI.Xaml.Hosting.h>
#include <winrt/Microsoft.UI.Xaml.Media.Imaging.h>
#include <winrt/Windows.Foundation.Collections.h>

#include <algorithm>
#include <cctype>
#include <fstream>
#include <regex>
#include <cmath>
#include <cstdlib>
#include <string>

using namespace winrt::Microsoft::UI::Xaml;
namespace hosting = winrt::Microsoft::UI::Xaml::Hosting;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;
namespace shp = winrt::Microsoft::UI::Xaml::Shapes;
namespace comp = winrt::Microsoft::UI::Composition;

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
void update_shadow_mask_radius(bk_handle handle,
                               CornerRadius const& corners) {
  auto* entry = bk::registry().get(handle);
  if (!entry || !entry->shadow_mask_shape) return;
  const float radius = static_cast<float>(std::max(
      std::max(corners.TopLeft, corners.TopRight),
      std::max(corners.BottomRight, corners.BottomLeft)));
  try {
    entry->shadow_mask_shape
        .as<comp::CompositionRoundedRectangleGeometry>()
        .CornerRadius({radius, radius});
  } catch (...) {
  }
}
constexpr int32_t BK_STATE_HOVER = 1;
constexpr int32_t BK_STATE_FOCUS = 2;
constexpr int32_t BK_STATE_PRESSED = 3;

void emit_control_state(bk_handle handle, int32_t state, bool active) {
  auto* entry = bk::registry().get(handle);
  if (!entry || entry->cb3 == 0) return;
  bk::Event ev;
  ev.header.type = BK_EVT_CONTROL_STATE;
  ev.header.target = handle;
  ev.header.callback = entry->cb3;
  ev.header.value1 = state;
  ev.header.value2 = active ? 1 : 0;
  bk::event_queue().push(std::move(ev));
}

void emit_control_hover_state(bk_handle handle, bool active) {
  auto* entry = bk::registry().get(handle);
  if (!entry || entry->cb3 == 0) return;
  if (entry->state_hover_active == active) return;
  entry->state_hover_active = active;
  emit_control_state(handle, BK_STATE_HOVER, active);
}

void emit_control_hover_exit_now(bk_handle handle) {
  auto* entry = bk::registry().get(handle);
  if (!entry || entry->cb3 == 0) return;
  bool over = false;
  try {
    if (auto button = entry->object.try_as<cx::Primitives::ButtonBase>()) {
      over = button.IsPointerOver();
    }
  } catch (...) {
  }
  if (!over) emit_control_hover_state(handle, false);
}

void emit_control_hover_exit(bk_handle handle) {
  auto* entry = bk::registry().get(handle);
  if (!entry || entry->cb3 == 0) return;
  try {
    auto dependency = entry->object.as<DependencyObject>();
    auto queue = dependency.DispatcherQueue();
    if (queue && queue.TryEnqueue(
          winrt::Microsoft::UI::Dispatching::DispatcherQueueHandler(
            [handle]() { emit_control_hover_exit_now(handle); }))) {
      return;
    }
  } catch (...) {
  }
  emit_control_hover_exit_now(handle);
}

// WinUI's default Button template paints an inner ContentPresenter and
// replaces its brush in PointerOver/Pressed/Disabled. Keep those ThemeResource
// keys aligned with the brush controlled by Bunkit, otherwise the template can
// cover a custom Control.Background while the border still looks correct.
void sync_button_background_resources(cx::Control const& control,
                                      Media::SolidColorBrush const& brush) {
  try {
    auto resources = control.Resources();
    for (auto const* key : {
           L"ButtonBackground", L"ButtonBackgroundPointerOver",
           L"ButtonBackgroundPressed", L"ButtonBackgroundDisabled",
           L"AccentButtonBackground", L"AccentButtonBackgroundPointerOver",
           L"AccentButtonBackgroundPressed", L"AccentButtonBackgroundDisabled",
         }) {
      resources.Insert(winrt::box_value(key), brush);
    }
  } catch (...) {
  }
}

void sync_button_border_resources(cx::Control const& control,
                                  Media::SolidColorBrush const& brush) {
  try {
    auto resources = control.Resources();
    for (auto const* key : {
           L"ButtonBorderBrush", L"ButtonBorderBrushPointerOver",
           L"ButtonBorderBrushPressed", L"ButtonBorderBrushDisabled",
           L"AccentButtonBorderBrush", L"AccentButtonBorderBrushPointerOver",
           L"AccentButtonBorderBrushPressed", L"AccentButtonBorderBrushDisabled",

         }) {
      resources.Insert(winrt::box_value(key), brush);
    }
  } catch (...) {
  }
}

// Declarative Bunkit states are applied from JS. The stock WinUI Button
// template has its own PointerOver/Pressed/Disabled storyboards which replace
// the inner ContentPresenter brushes after the Control properties are set.
// Use a template without those storyboards when a Button opts into states.
void apply_interaction_button_template(cx::Button const& button) {
  try {
    if (!button.Background()) {
      button.Background(Media::SolidColorBrush(
          winrt::Windows::UI::Color{0, 0, 0, 0}));
    }
    const auto xaml = winrt::hstring(
        LR"XAML(<ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Button"><ContentPresenter Background="{TemplateBinding Background}" Foreground="{TemplateBinding Foreground}" BackgroundSizing="{TemplateBinding BackgroundSizing}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" Content="{TemplateBinding Content}" ContentTemplate="{TemplateBinding ContentTemplate}" ContentTransitions="{TemplateBinding ContentTransitions}" CornerRadius="{TemplateBinding CornerRadius}" Padding="{TemplateBinding Padding}" HorizontalContentAlignment="{TemplateBinding HorizontalContentAlignment}" VerticalContentAlignment="{TemplateBinding VerticalContentAlignment}" /></ControlTemplate>)XAML");
    button.Template(
        winrt::Microsoft::UI::Xaml::Markup::XamlReader::Load(xaml)
            .as<cx::ControlTemplate>());
  } catch (...) {
  }
}
winrt::Windows::Foundation::IInspectable element_of(bk_handle h) {
  auto* entry = bk::registry().get(h);
  return entry ? entry->object : nullptr;
}

// True when `el` already carries an explicit Background on any of the three
// element kinds the bridge paints (Control, Panel, Border).
bool has_explicit_background(FrameworkElement const& el) {
  try {
    if (el.as<cx::Control>().Background()) return true;
  } catch (...) {
  }
  try {
    if (el.as<cx::Panel>().Background()) return true;
  } catch (...) {
  }
  try {
    if (el.as<cx::Border>().Background()) return true;
  } catch (...) {
  }
  return false;
}

// GridView track spec: comma-separated entries, each "auto", "fill", or a
// fixed number of pixels ("120"). "fill" is the CSS fr unit (star sizing).
std::vector<GridLength> parse_tracks(const char* spec) {
  std::vector<GridLength> out;
  if (!spec || !*spec) return out;
  std::string s(spec);
  size_t pos = 0;
  for (;;) {
    const size_t comma = s.find(',', pos);
    std::string tok = s.substr(pos, comma == std::string::npos ? std::string::npos : comma - pos);
    // trim whitespace
    const size_t b = tok.find_first_not_of(" \t");
    const size_t e = tok.find_last_not_of(" \t");
    tok = (b == std::string::npos) ? "" : tok.substr(b, e - b + 1);
    if (tok == "auto" || tok.empty()) {
      out.push_back(GridLength(0.0, GridUnitType::Auto));
    } else if (tok == "fill") {
      out.push_back(GridLength(1.0, GridUnitType::Star));
    } else {
      out.push_back(GridLength(strtod(tok.c_str(), nullptr), GridUnitType::Pixel));
    }
    if (comma == std::string::npos) break;
    pos = comma + 1;
  }
  return out;
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
      viewer.BorderThickness(Thickness(1, 1, 1, 1));
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

// --- GridView ---------------------------------------------------------------

BK_EXPORT bk_handle bk_gridview_create(const char* columns, const char* rows,
                                       double row_spacing, double col_spacing) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Border border;
    cx::Grid grid;
    if (row_spacing > 0) grid.RowSpacing(row_spacing);
    if (col_spacing > 0) grid.ColumnSpacing(col_spacing);
    for (const GridLength& w : parse_tracks(columns)) {
      cx::ColumnDefinition def;
      def.Width(w);
      grid.ColumnDefinitions().Append(def);
    }
    for (const GridLength& h : parse_tracks(rows)) {
      cx::RowDefinition def;
      def.Height(h);
      grid.RowDefinitions().Append(def);
    }
    border.Child(grid);
    out = bk::registry().add(bk::NativeType::GridView, border);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_gridview_add(bk_handle grid, bk_handle child,
                                  int32_t row, int32_t col,
                                  int32_t row_span, int32_t col_span) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(grid);
    auto element = element_of(child);
    if (!entry || entry->type != bk::NativeType::GridView || !element) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto grid_el = entry->object.as<cx::Border>().Child().as<cx::Grid>();
    auto fe = element.as<FrameworkElement>();
    cx::Grid::SetRow(fe, row);
    cx::Grid::SetColumn(fe, col);
    cx::Grid::SetRowSpan(fe, row_span > 0 ? row_span : 1);
    cx::Grid::SetColumnSpan(fe, col_span > 0 ? col_span : 1);
    grid_el.Children().Append(fe.as<UIElement>());
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

// Rewrite an SVG document's fill/stroke colours to `tint` ("#RRGGBB").
// Handles fill=".."/stroke=".." attributes and fill:/stroke: inside style
// attributes; "none" is preserved. Good enough for icon-style SVGs.
static std::string tint_svg(const std::string& svg, const std::string& tint) {
  std::string out;
  const auto tinted = [&](const std::string& value) {
    return value == "none" || value.empty() ? "" : tint;
  };
  // 1) fill=".." / stroke=".." attributes
  {
    const std::regex attr_re("(fill|stroke)=\"([^\"]*)\"");
    auto begin = std::sregex_iterator(svg.begin(), svg.end(), attr_re);
    size_t last = 0;
    for (auto it = begin; it != std::sregex_iterator(); ++it) {
      out += svg.substr(last, it->position() - last);
      const std::string value = (*it)[2].str();
      const std::string t = tinted(value);
      out += t.empty() ? it->str() : (*it)[1].str() + "=\"" + t + "\"";
      last = it->position() + it->length();
    }
    out += svg.substr(last);
  }
  // 2) fill:/stroke: inside style=".." (not fill-rule: etc.)
  {
    const std::regex style_re("(fill|stroke):([^;\"']*)");
    std::string styled;
    auto b2 = std::sregex_iterator(out.begin(), out.end(), style_re);
    size_t last = 0;
    for (auto it = b2; it != std::sregex_iterator(); ++it) {
      styled += out.substr(last, it->position() - last);
      const std::string value = (*it)[2].str();
      const std::string t = tinted(value);
      styled += t.empty() ? it->str() : (*it)[1].str() + ":" + t;
      last = it->position() + it->length();
    }
    styled += out.substr(last);
    out = styled;
  }
  return out;
}

// Write an SVG document to a unique temp file; returns the file path.
static std::string write_temp_svg(const std::string& content) {
  wchar_t tmp[MAX_PATH];
  if (!GetTempPathW(MAX_PATH, tmp)) return "";
  uint32_t h = 2166136261u;
  for (const char c : content) {
    h ^= static_cast<uint8_t>(c);
    h *= 16777619u;
  }
  const std::wstring path =
      std::wstring(tmp) + L"bunkit-tint-" + std::to_wstring(h) + L".svg";
  FILE* f = _wfopen(path.c_str(), L"wb");
  if (!f) return "";
  fwrite(content.data(), 1, content.size(), f);
  fclose(f);
  char narrow[MAX_PATH];
  const int n = WideCharToMultiByte(CP_UTF8, 0, path.c_str(), -1, narrow,
                                    MAX_PATH, nullptr, nullptr);
  return n > 0 ? std::string(narrow, n - 1) : "";
}

void set_image_source(cx::Image const& image, const std::string& p) {
  // WinRT wants an absolute URI. Relative paths are resolved against the
  // current directory first — file:///icons/x.svg would otherwise mean
  // <drive>:\icons\x.svg instead of ./icons/x.svg.
  std::wstring wide = winrt::to_hstring(p).c_str();
  // Resolve relative paths against the current directory first —
  // file:///icons/x.svg would otherwise mean <drive>:\icons\x.svg.
  if (wide.find(L"://") == std::wstring::npos &&
      wide.rfind(L"file:///", 0) != 0) {
    wchar_t absolute[MAX_PATH];
    if (GetFullPathNameW(wide.c_str(), MAX_PATH, absolute, nullptr) > 0) {
      wide = absolute;
    }
  }
  for (auto& ch : wide) if (ch == L'\\') ch = L'/';
  if (wide.rfind(L"file:///", 0) != 0 && wide.rfind(L"http", 0) != 0) {
    wide = L"file:///" + wide;
  }
  try {
    const auto uri = winrt::Windows::Foundation::Uri(wide);
    // SVG files decode through SvgImageSource; everything else is a bitmap.
    const bool svg = p.size() > 4 &&
                     (p.compare(p.size() - 4, 4, ".svg") == 0 ||
                      p.compare(p.size() - 4, 4, ".SVG") == 0);
    if (svg) {
      winrt::Microsoft::UI::Xaml::Media::Imaging::SvgImageSource source;
      source.UriSource(uri);
      source.OpenFailed(
          [p](winrt::Windows::Foundation::IInspectable const&,
              winrt::Microsoft::UI::Xaml::Media::Imaging::
                  SvgImageSourceFailedEventArgs const& args) {
            bk::set_last_error(
                "svg failed to decode: " + p + " -> status " +
                std::to_string(
                    static_cast<int32_t>(args.Status())));
          });
      image.Source(source);
      return;
    }
    winrt::Microsoft::UI::Xaml::Media::Imaging::BitmapImage source;
    source.UriSource(uri);
    source.ImageFailed([p](winrt::Windows::Foundation::IInspectable const&,
                           winrt::Microsoft::UI::Xaml::ExceptionRoutedEventArgs const& args) {
      bk::set_last_error("image failed to decode: " + p + " -> " +
                         winrt::to_string(args.ErrorMessage()));
    });
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

// Source with an optional tint for SVG files: the document's fill/stroke
// colours are rewritten to `tint` and the result is loaded from a temp file.
// Non-SVG sources ignore the tint.
BK_EXPORT int32_t bk_imageview_set_source_ex(bk_handle c, const char* path,
                                             uint32_t path_len,
                                             const char* tint,
                                             uint32_t tint_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (!path || path_len == 0) return BK_INVALID_ARGUMENT;
  const std::string p(path, path_len);
  const std::string t = tint && tint_len ? std::string(tint, tint_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry || entry->type != bk::NativeType::ImageView) {
      st = BK_INVALID_HANDLE;
      return;
    }
    const bool svg = p.size() > 4 &&
                     (p.compare(p.size() - 4, 4, ".svg") == 0 ||
                      p.compare(p.size() - 4, 4, ".SVG") == 0);
    if (svg && !t.empty()) {
      std::ifstream file(p, std::ios::binary);
      const std::string content((std::istreambuf_iterator<char>(file)),
                                std::istreambuf_iterator<char>());
      if (content.empty()) {
        bk::set_last_error("svg could not be read: " + p);
        st = BK_INVALID_ARGUMENT;
        return;
      }
      const std::string path = write_temp_svg(tint_svg(content, t));
      if (path.empty()) {
        bk::set_last_error("svg tint: temp file could not be written");
        st = BK_ERROR;
        return;
      }
      set_image_source(image_of(entry), path);
      st = BK_OK;
      return;
    }
    set_image_source(image_of(entry), p);
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

namespace {

// Controls, Panels (Grids/Stacks) and Borders can all take a Background.
bool paint_element_background(FrameworkElement const& el,
                              winrt::Windows::UI::Color color) {
  try {
    el.as<cx::Control>().Background(Media::SolidColorBrush(color));
    return true;
  } catch (...) {
  }
  try {
    el.as<cx::Panel>().Background(Media::SolidColorBrush(color));
    return true;
  } catch (...) {
  }
  try {
    el.as<cx::Border>().Background(Media::SolidColorBrush(color));
    return true;
  } catch (...) {
  }
  return false;
}

} // namespace

// theme: 0 default (follows system), 1 light, 2 dark. bg (optional hex)
// overrides the painted page background for that mode. Applies to the whole
// subtree of the element — the window content root themes the window.
BK_EXPORT int32_t bk_control_set_theme(bk_handle c, int32_t theme,
                                       const char* bg, uint32_t bg_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto object = element_of(c);
    if (!object) { st = BK_INVALID_HANDLE; return; }
    FrameworkElement target{nullptr};
    // A Window handle maps to its content (Window is not a FrameworkElement).
    if (auto win = object.try_as<Window>()) {
      auto content = win.Content();
      if (!content) { st = BK_ERROR; return; }
      target = content.as<FrameworkElement>();
    } else {
      target = object.as<FrameworkElement>();
    }
    try {
      ElementTheme mapped = ElementTheme::Default;
      if (theme == 1) mapped = ElementTheme::Light;
      else if (theme == 2) mapped = ElementTheme::Dark;
      target.RequestedTheme(mapped);
      // Repaint the subtree root: XAML content roots are transparent, so
      // without this the old system backdrop keeps showing through after a
      // theme flip. An explicit hex wins; otherwise light pages are white,
      // dark pages near-black, and the "default" theme follows the OS. A root
      // that already carries its own background (e.g. an adaptive
      // `{ light, dark }` colour) is left alone.
      winrt::Windows::UI::Color body{};
      if (bg && bg_len) {
        const std::string digits =
            bg[0] == '#' ? std::string(bg + 1, bg_len - 1) : std::string(bg, bg_len);
        const auto value = static_cast<uint32_t>(std::stoul(digits, nullptr, 16));
        body.A = 255;
        body.R = digits.size() > 6 ? static_cast<uint8_t>((value >> 24) & 0xFF)
                                   : static_cast<uint8_t>((value >> 16) & 0xFF);
        body.G = static_cast<uint8_t>((value >> 8) & 0xFF);
        body.B = static_cast<uint8_t>(value & 0xFF);
        if (digits.size() > 6) body.R = static_cast<uint8_t>((value >> 16) & 0xFF);
        paint_element_background(target, body);
      } else if (!has_explicit_background(target)) {
        if (theme == 2 || (theme == 0 && bk::system_dark_mode())) {
          body = winrt::Windows::UI::Color{255, 0x1C, 0x1C, 0x1C};
        } else {
          body = winrt::Windows::UI::Color{255, 255, 255, 255};
        }
        paint_element_background(target, body);
      }
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
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
BK_EXPORT int32_t bk_control_set_cursor(bk_handle c, int32_t shape) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    try {
      auto protected_element = element.as<IUIElementProtected>();
      if (shape < 0) {
        protected_element.ProtectedCursor(
            winrt::Microsoft::UI::Input::InputCursor{nullptr});
      } else {
        const auto cursor =
            winrt::Microsoft::UI::Input::InputSystemCursor::Create(
                static_cast<winrt::Microsoft::UI::Input::InputSystemCursorShape>(
                    shape));
        protected_element.ProtectedCursor(cursor);
      }
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
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
    if (s.empty()) {
      try {
        auto control = element.as<cx::Control>();
        auto* entry = bk::registry().get(c);
        if (entry && entry->state_attached &&
            control.try_as<cx::Primitives::ButtonBase>()) {
          control.Background(Media::SolidColorBrush(
              winrt::Windows::UI::Color{0, 0, 0, 0}));
        } else {
          control.Background(nullptr);
        }
        st = BK_OK;
        return;
      } catch (...) {
      }
      try {
        element.as<cx::Border>().Background(nullptr);
        st = BK_OK;
        return;
      } catch (...) {
      }
      try {
        element.as<cx::Panel>().Background(nullptr);
        st = BK_OK;
        return;
      } catch (...) {
        st = BK_WRONG_TYPE;
        return;
      }
    }
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
      auto control = element.as<cx::Control>();
      const Media::SolidColorBrush brush(color);
      control.Background(brush);
      if (control.try_as<cx::Primitives::ButtonBase>()) {
        sync_button_background_resources(control, brush);
      }
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
      return;
    } catch (...) {
    }
    try {
      // Stacks are plain Grids (Panel) — they take a Background like any Panel.
      element.as<cx::Panel>().Background(Media::SolidColorBrush(color));
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}
// Composition DropShadow is hosted by a sibling SpriteVisual. Its rounded mask
// is rendered by an off-tree ShapeVisual captured in a VisualSurface, so no
// XAML element is added beside the target to paint or participate in layout.
// The sibling is inserted below the element so the shadow stays behind native
// content such as a Button label.
BK_EXPORT int32_t bk_control_set_shadow(bk_handle c, const char* hex,
                                        uint32_t hex_len, double offset_x,
                                        double offset_y, double blur,
                                        double opacity) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string s = hex && hex_len ? std::string(hex, hex_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    try {
      const auto ui = element.as<UIElement>();
      const auto element_visual =
          hosting::ElementCompositionPreview::GetElementVisual(ui);
      const auto compositor = element_visual.Compositor();
      const auto framework = element.as<FrameworkElement>();
      auto entry = bk::registry().get(c);
      if (!entry) { st = BK_INVALID_HANDLE; return; }

      const auto clear_shadow = [&] {
        ++entry->shadow_generation;
        if (entry->shadow_size_token.value != 0) {
          try { framework.SizeChanged(entry->shadow_size_token); } catch (...) {}
          entry->shadow_size_token = {};
        }
        if (entry->shadow_layout_token.value != 0) {
          try { framework.LayoutUpdated(entry->shadow_layout_token); } catch (...) {}
          entry->shadow_layout_token = {};
        }
        if (entry->shadow_loaded_token.value != 0) {
          try { framework.Loaded(entry->shadow_loaded_token); } catch (...) {}
          entry->shadow_loaded_token = {};
        }
        if (entry->shadow_visual) {
          try {
            const auto visual = entry->shadow_visual.as<comp::Visual>();
            if (const auto parent = visual.Parent()) {
              parent.Children().Remove(visual);
            }
          } catch (...) {}
          entry->shadow_visual = nullptr;
          entry->shadow_drop_shadow = nullptr;
        }
        entry->shadow_mask_visual = nullptr;
        entry->shadow_mask_surface = nullptr;
        entry->shadow_mask_brush = nullptr;
        entry->shadow_mask_shape = nullptr;
        entry->shadow_sync = {};
      };
      if (s.empty()) {
        hosting::ElementCompositionPreview::SetElementChildVisual(ui, nullptr);
        clear_shadow();
        st = BK_OK;
        return;
      }

      const std::string digits = (!s.empty() && s[0] == '#')
          ? s.substr(1) : s;
      if (digits.size() != 6 && digits.size() != 8) {
        st = BK_INVALID_ARGUMENT;
        return;
      }
      const uint32_t value = static_cast<uint32_t>(
          std::stoul(digits, nullptr, 16));
      winrt::Windows::UI::Color color;
      if (digits.size() == 8) {
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
      bool can_update_shadow = false;
      if (entry->shadow_visual && entry->shadow_drop_shadow && entry->shadow_mask_brush) {
        try {
          const auto current_parent = hosting::ElementCompositionPreview::GetElementVisual(ui).Parent();
          const auto shadow_parent = entry->shadow_visual.as<comp::Visual>().Parent();
          can_update_shadow = current_parent && shadow_parent == current_parent;
        } catch (...) {}
      }
      if (can_update_shadow) {
        try {
          auto dropShadow = entry->shadow_drop_shadow.as<comp::DropShadow>();
          dropShadow.Mask(entry->shadow_mask_brush.as<comp::CompositionBrush>());
          entry->shadow_visual.as<comp::SpriteVisual>().Shadow(dropShadow);
          dropShadow.Color(color);
          dropShadow.Offset({static_cast<float>(offset_x), static_cast<float>(offset_y), 0.0f});
          dropShadow.BlurRadius(static_cast<float>(std::max(0.0, blur)));
          dropShadow.Opacity(static_cast<float>(std::clamp(opacity, 0.0, 1.0)));
          st = BK_OK;
          return;
        } catch (...) {}
      }
      hosting::ElementCompositionPreview::SetElementChildVisual(ui, nullptr);
      clear_shadow();
      const uint64_t shadow_generation = ++entry->shadow_generation;

      auto shadowVisual = compositor.CreateSpriteVisual();
      shadowVisual.Size(element_visual.Size());
      shadowVisual.Offset(element_visual.Offset());

      CornerRadius corner{};
      try {
        corner = element.as<cx::Control>().CornerRadius();
      } catch (...) {
        try { corner = element.as<cx::Border>().CornerRadius(); } catch (...) {}
      }
      const float cornerRadius = static_cast<float>(std::max(
          std::max(corner.TopLeft, corner.TopRight),
          std::max(corner.BottomRight, corner.BottomLeft)));
      auto maskGeometry = compositor.CreateRoundedRectangleGeometry();
      maskGeometry.Size(element_visual.Size());
      maskGeometry.CornerRadius({cornerRadius, cornerRadius});
      auto maskShape = compositor.CreateSpriteShape(maskGeometry);
      maskShape.FillBrush(compositor.CreateColorBrush(
          winrt::Windows::UI::Color{255, 255, 255, 255}));
      auto maskVisual = compositor.CreateShapeVisual();
      maskVisual.Size(element_visual.Size());
      maskVisual.Shapes().Append(maskShape);
      auto maskSurface = compositor.CreateVisualSurface();
      maskSurface.SourceVisual(maskVisual);
      maskSurface.SourceSize(element_visual.Size());
      auto maskBrush = compositor.CreateSurfaceBrush(maskSurface);
      auto dropShadow = compositor.CreateDropShadow();
      dropShadow.Color(color);
      dropShadow.Offset({static_cast<float>(offset_x),
                         static_cast<float>(offset_y), 0.0f});
      dropShadow.BlurRadius(static_cast<float>(std::max(0.0, blur)));
      dropShadow.Opacity(static_cast<float>(
          std::clamp(opacity, 0.0, 1.0)));
      dropShadow.Mask(maskBrush);
      const auto sync_visual =
          [shadowVisual, ui, maskVisual, maskGeometry, maskSurface,
           framework, entry, maskBrush, dropShadow, shadow_generation] {
        if (entry->shadow_generation != shadow_generation) return;
        const auto current_element_visual =
            hosting::ElementCompositionPreview::GetElementVisual(ui);
        const auto visual_size = current_element_visual.Size();
        const auto actual_width = framework.ActualWidth();
        const auto actual_height = framework.ActualHeight();
        const float width = actual_width > 0.0
            ? static_cast<float>(actual_width) : visual_size.x;
        const float height = actual_height > 0.0
            ? static_cast<float>(actual_height) : visual_size.y;
        maskGeometry.Size({width, height});
        CornerRadius currentCorner{};
        if (auto control = ui.try_as<cx::Control>()) {
          currentCorner = control.CornerRadius();
        } else if (auto border = ui.try_as<cx::Border>()) {
          currentCorner = border.CornerRadius();
        }
        const float currentCornerRadius = static_cast<float>(std::max(
            std::max(currentCorner.TopLeft, currentCorner.TopRight),
            std::max(currentCorner.BottomRight, currentCorner.BottomLeft)));
        maskGeometry.CornerRadius(
            {currentCornerRadius, currentCornerRadius});
        maskVisual.Size({width, height});
        maskSurface.SourceSize({width, height});
        const auto parent = current_element_visual.Parent();
        if (!parent) return;
        const auto panel = framework.Parent().try_as<cx::Panel>();
        const auto current_parent = shadowVisual.Parent();
        if (current_parent && current_parent != parent) {
          current_parent.Children().Remove(shadowVisual);
        }
        if (!shadowVisual.Parent()) {
          parent.Children().InsertBelow(shadowVisual, current_element_visual);
        }
        shadowVisual.Size({width, height});
        if (panel) {
          try {
            const auto point = framework.TransformToVisual(panel).TransformPoint({0.0, 0.0});
            shadowVisual.Offset({static_cast<float>(point.X),
                                 static_cast<float>(point.Y), 0.0f});
          } catch (...) {
            shadowVisual.Offset(current_element_visual.Offset());
          }
        } else {
          shadowVisual.Offset(current_element_visual.Offset());
        }
        // A visual can be created before its XAML element is attached. Reset
        // the mask and set Shadow again after attachment and final geometry so
        // the compositor paints the first visible frame.
        dropShadow.Mask(maskBrush.as<comp::CompositionBrush>());
        shadowVisual.Shadow(dropShadow);
      };
      sync_visual();
      entry->shadow_size_token = framework.SizeChanged(
          [sync_visual](auto const&, auto const&) { sync_visual(); });
      entry->shadow_layout_token = framework.LayoutUpdated(
          [sync_visual](auto const&, auto const&) { sync_visual(); });
      entry->shadow_loaded_token = framework.Loaded(
          [sync_visual](auto const&, auto const&) { sync_visual(); });

      shadowVisual.Shadow(dropShadow);
      entry->shadow_visual = shadowVisual;
      entry->shadow_drop_shadow = dropShadow;
      entry->shadow_mask_visual = maskVisual;
      entry->shadow_mask_surface = maskSurface;
      entry->shadow_mask_brush = maskBrush;
      entry->shadow_mask_shape = maskGeometry;
      entry->shadow_sync = sync_visual;
      sync_visual();
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

// widths: double[4] in Thickness order {left, top, right, bottom}; radii:
// double[4] {tl, tr, br, bl}. Buffers instead of trailing doubles: bun:ffi
// corrupts the last f64 in 8-argument signatures on win64. Thickness and
// CornerRadius are plain aggregates — Thickness(w) would zero three of the
// four sides, so every field is always set explicitly.
BK_EXPORT int32_t bk_control_set_border(bk_handle c, const char* hex,
                                        uint32_t hex_len,
                                        const double* widths,
                                        const double* radii) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (widths == nullptr || radii == nullptr) return BK_INVALID_ARGUMENT;
  const double l = widths[0], t = widths[1], r = widths[2], b = widths[3];
  const double tl = radii[0], tr = radii[1], br = radii[2], bl = radii[3];
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
    const CornerRadius radius{tl, tr, br, bl};
    const Thickness thickness{l, t, r, b};
    try {
      auto control = element.as<cx::Control>();
      control.BorderBrush(brush);
      if (control.try_as<cx::Primitives::ButtonBase>()) {
        sync_button_border_resources(control, brush);
      }
      control.BorderThickness(thickness);
      control.CornerRadius(radius);
      update_shadow_mask_radius(c, radius);
      st = BK_OK;
      return;
    } catch (...) {
    }
    try {
      auto border = element.as<cx::Border>();
      border.BorderBrush(brush);
      border.BorderThickness(thickness);
      border.CornerRadius(radius);
      update_shadow_mask_radius(c, radius);
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

// style: 1 dashed, 2 dotted. XAML borders cannot stroke a dash pattern, so
// Border-based views get a Rectangle overlay whose StrokeDashArray draws it;
// plain Controls have no equivalent and fall back to solid. A Rectangle also
// has a uniform StrokeThickness, so per-side widths stroke with the largest
// requested value. widths: double[4] in Thickness order {left, top, right,
// bottom}.
BK_EXPORT int32_t bk_control_set_border_style(bk_handle c, const char* hex,
                                              uint32_t hex_len,
                                              const double* widths,
                                              const double* radii,
                                              int32_t style) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (widths == nullptr || radii == nullptr) return BK_INVALID_ARGUMENT;
  const double l = widths[0], t = widths[1], r = widths[2], b = widths[3];
  const double tl = radii[0], tr = radii[1], br = radii[2], bl = radii[3];
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
    const double widest = std::max(std::max(l, t), std::max(r, b));
    const double w = widest > 0 ? widest : 1.0;
    try {
      auto border = element.as<cx::Border>();
      // Hide the solid border; the overlay draws the pattern instead.
      border.BorderThickness(Thickness{});

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
      // A Rectangle only has uniform RadiusX/Y, so a per-corner pattern
      // overlay rounds with the largest requested value.
      const double radius = std::max(std::max(tl, tr), std::max(br, bl));
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
      st = bk_control_set_border(c, hex, hex_len, widths, radii);
    }
  });
  return combine(rc, st);
}

// tl/tr/br/bl: per-corner radii; pass the same value four times for uniform.
// CornerRadius is a plain aggregate — CornerRadius(r) would zero three of the
// four corners, so every field is always set explicitly.
BK_EXPORT int32_t bk_control_set_corner_radius4(bk_handle c, double tl,
                                                double tr, double br,
                                                double bl) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    const CornerRadius radius{tl, tr, br, bl};
    try {
      element.as<cx::Control>().CornerRadius(radius);
      update_shadow_mask_radius(c, radius);
      st = BK_OK;
    } catch (...) {
      try {
        element.as<cx::Border>().CornerRadius(radius);
        update_shadow_mask_radius(c, radius);
        st = BK_OK;
      } catch (...) {
        st = BK_WRONG_TYPE;
      }
    }
  });
  return combine(rc, st);
}

// Whether the OS is in dark mode (AppsUseLightTheme = 0). Used to resolve
// `{ light, dark }` colours when the app follows the system theme.
BK_EXPORT int32_t bk_theme_is_dark(void) {
  return bk::system_dark_mode() ? 1 : 0;
}

// Debug: report whether the XAML app theme was seeded dark and whether a
// window carries a SystemBackdrop. Returns (app_dark << 1) | has_backdrop.
BK_EXPORT int32_t bk_debug_app_setup(bk_handle w) {
  int32_t out = 0;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    try {
      if (winrt::Microsoft::UI::Xaml::Application::Current().RequestedTheme() ==
          winrt::Microsoft::UI::Xaml::ApplicationTheme::Dark) {
        out |= 2;
      }
    } catch (...) {
    }
    if (w) {
      auto* entry = bk::registry().get(w);
      if (entry && entry->type == bk::NativeType::Window) {
        try {
          if (entry->object.as<Window>().SystemBackdrop()) out |= 1;
        } catch (...) {
        }
      }
    }
  });
  return rc == BK_OK ? out : -1;
}

// Debug helper: read back the BorderThickness of any registered control.
// out4 receives {left, top, right, bottom} on success.
BK_EXPORT int32_t bk_control_border_thickness(bk_handle c, double* out4) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    winrt::Microsoft::UI::Xaml::Thickness t;
    if (auto control = element.try_as<cx::Control>()) { t = control.BorderThickness(); }
    else if (auto border = element.try_as<cx::Border>()) { t = border.BorderThickness(); }
    else { st = BK_WRONG_TYPE; return; }
    out4[0] = t.Left; out4[1] = t.Top; out4[2] = t.Right; out4[3] = t.Bottom;
    st = BK_OK;
  });
  return combine(rc, st);
}

// Give a registered control programmatic keyboard focus (FocusState::Programmatic).
BK_EXPORT int32_t bk_control_focus(bk_handle c) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    auto control = element.try_as<cx::Control>();
    if (!control) { st = BK_WRONG_TYPE; return; }
    control.Focus(winrt::Microsoft::UI::Xaml::FocusState::Programmatic);
    st = BK_OK;
  });
  return combine(rc, st);
}

// Debug: resolve a theme brush key from the application resources and copy its
// solid colour to out_hex ("RRGGBB"). Returns 1 when the key resolves to a
// SolidColorBrush, 0 otherwise.
BK_EXPORT int32_t bk_debug_theme_brush(const char* key, uint32_t key_len,
                                       char* out_hex) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string k = key && key_len ? std::string(key, key_len) : "";
  int32_t found = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    try {
      auto brush = winrt::Microsoft::UI::Xaml::Application::Current()
                       .Resources()
                       .Lookup(winrt::box_value(
                           winrt::hstring(bk::utf8_to_hstring(k.data(),
                                                               k.size()))))
                       .as<Media::SolidColorBrush>();
      auto color = brush.Color();
      char hex[8];
      snprintf(hex, sizeof(hex), "%02X%02X%02X", color.R, color.G, color.B);
      memcpy(out_hex, hex, 7);
      found = 1;
    } catch (...) {
    }
  });
  return found;
}

// Clear keyboard focus from the control. WinUI exposes Unfocused as the
// neutral FocusState for this operation.
BK_EXPORT int32_t bk_control_blur(bk_handle c) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto element = element_of(c);
    if (!element) { st = BK_INVALID_HANDLE; return; }
    auto control = element.try_as<cx::Control>();
    if (!control) { st = BK_WRONG_TYPE; return; }
    control.Focus(FocusState::Unfocused);
    st = BK_OK;
  });
  return combine(rc, st);
}

// Register interaction events once. The callback id is read at dispatch time,
// so replacing or clearing the JS listener never requires detaching WinUI
// handlers.
BK_EXPORT int32_t bk_control_set_state_callback(bk_handle c, uint64_t callback) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry) { st = BK_INVALID_HANDLE; return; }
    auto control = entry->object.try_as<cx::Control>();
    if (!control) { st = BK_WRONG_TYPE; return; }
    entry->cb3 = callback;
    if (callback == 0) {
      entry->state_hover_active = false;
      st = BK_OK;
      return;
    }
    if (entry->state_attached) {
      st = BK_OK;
      return;
    }

    auto element = control.as<UIElement>();
    entry->state_hover_entered_token = element.PointerEntered(
        [handle = c](auto const&, auto const&) {
          emit_control_hover_state(handle, true);
        });
    if (auto button = control.try_as<cx::Button>()) {
      apply_interaction_button_template(button);
    }
    if (control.try_as<cx::Primitives::ButtonBase>()) {
      entry->state_hover_moved_token = element.PointerMoved(
          [handle = c](auto const&, auto const&) {
            emit_control_hover_state(handle, true);
          });
    }
    entry->state_hover_exited_token = element.PointerExited(
        [handle = c](auto const&, auto const&) {
          emit_control_hover_exit(handle);
        });
    entry->state_focus_gained_token = element.GotFocus(
        [handle = c](auto const&, auto const&) {
          emit_control_state(handle, BK_STATE_FOCUS, true);
        });
    entry->state_focus_lost_token = element.LostFocus(
        [handle = c](auto const&, auto const&) {
          emit_control_state(handle, BK_STATE_FOCUS, false);
        });
    entry->state_pressed_token = element.PointerPressed(
        [handle = c](auto const&, auto const&) {
          emit_control_state(handle, BK_STATE_PRESSED, true);
        });
    entry->state_released_token = element.PointerReleased(
        [handle = c](auto const&, auto const&) {
          emit_control_state(handle, BK_STATE_PRESSED, false);
        });
    entry->state_attached = true;
    st = BK_OK;
  });
  return combine(rc, st);
}
} // extern "C"
