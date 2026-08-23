// composite_controls.cpp — GroupBox, Segmented and Table.
//
// Same shape as the other control translation units: every entry point hops to
// the UI thread with dispatch_sync and reports through a captured status. The
// Table computes nothing itself: JS turns rows/columns into plain strings and
// this side only lays them out, so no data model crosses the ABI.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
#include <winrt/Microsoft.UI.Xaml.Input.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Windows.Foundation.Collections.h>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;

namespace {

constexpr char kSep1 = '\x1f'; // fields inside a record
constexpr char kSep2 = '\n';   // records

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

TextAlignment alignment_of(int32_t code) {
  if (code == 1) return TextAlignment::Center;
  if (code == 2) return TextAlignment::Right;
  return TextAlignment::Left;
}

// A Table handle maps to a Border wrapper around the root Grid; row 1 child
// of the grid is its ListView. The wrapper is what makes the table stylable
// (Grid has no Background/Border of its own).
cx::Grid grid_of(bk_handle handle) {
  auto object = bk::registry().get(handle)->object;
  if (auto border = object.try_as<cx::Border>()) return border.Child().as<cx::Grid>();
  return object.as<cx::Grid>();
}

} // namespace

namespace {

struct ColumnSpec {
  std::string title;
  double width{0};   // <= 0 -> star-sized
  double flex{1};    // star weight when width <= 0
  int32_t align{0};
  double min{0};
  double max{0};
};

std::vector<ColumnSpec> parse_columns(const std::string& raw) {
  std::vector<ColumnSpec> out;
  for (const auto& line : split(raw, kSep2)) {
    if (line.empty()) continue;
    const auto fields = split(line, kSep1);
    ColumnSpec col;
    col.title = fields.size() > 0 ? fields[0] : "";
    col.width = fields.size() > 1 ? atof(fields[1].c_str()) : 0;
    col.align = fields.size() > 2 ? atoi(fields[2].c_str()) : 0;
    col.flex = fields.size() > 3 ? atof(fields[3].c_str()) : 1;
    col.min = fields.size() > 4 ? atof(fields[4].c_str()) : 0;
    col.max = fields.size() > 5 ? atof(fields[5].c_str()) : 0;
    if (col.flex <= 0) col.flex = 1;
    out.push_back(std::move(col));
  }
  return out;
}

GridLength column_length(const ColumnSpec& c) {
  if (c.width > 0) return GridLength(c.width, GridUnitType::Pixel);
  return GridLength(c.flex, GridUnitType::Star);
}

} // namespace

extern "C" {

// --- group box ---------------------------------------------------------------

BK_EXPORT bk_handle bk_groupbox_create(const char* title, uint32_t title_len,
                                       double padding) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  const std::string t = title && title_len ? std::string(title, title_len) : "";
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Grid grid;
    grid.RowSpacing(4);
    cx::RowDefinition header_row;
    header_row.Height(GridLength(0.0, GridUnitType::Auto));
    cx::RowDefinition body_row;
    body_row.Height(GridLength(1.0, GridUnitType::Star));
    grid.RowDefinitions().Append(header_row);
    grid.RowDefinitions().Append(body_row);

    auto header = cx::TextBlock();
    header.Text(bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
    header.FontSize(12.0);
    try {
      header.Foreground(Application::Current()
                            .Resources()
                            .Lookup(winrt::box_value(L"TextFillColorSecondaryBrush"))
                            .as<Media::Brush>());
    } catch (...) {
    }
    cx::Grid::SetRow(header, 0);
    grid.Children().Append(header);

    cx::Border body;
    body.CornerRadius(CornerRadius(4, 4, 4, 4));
    body.BorderThickness(Thickness(1, 1, 1, 1));
    body.Padding(Thickness(padding, padding, padding, padding));
    try {
      body.BorderBrush(Application::Current()
                           .Resources()
                           .Lookup(winrt::box_value(L"ControlStrokeColorDefaultBrush"))
                           .as<Media::Brush>());
    } catch (...) {
    }
    cx::ContentPresenter presenter;
    body.Child(presenter);
    cx::Grid::SetRow(body, 1);
    grid.Children().Append(body);

    cx::Border shell;
    shell.Child(grid);
    out = bk::registry().add(bk::NativeType::GroupBox, shell);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_groupbox_set_content(bk_handle g, bk_handle child) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* box = bk::registry().get(g);
    if (!box || box->type != bk::NativeType::GroupBox) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto* entry = bk::registry().get(child);
    if (!entry || !entry->object) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto grid = box->object.as<cx::Border>().Child().as<cx::Grid>();
    auto body = grid.Children().GetAt(1).as<cx::Border>();
    body.Child().as<cx::ContentPresenter>().Content(
        entry->object.as<UIElement>());
    st = BK_OK;
  });
  return combine(rc, st);
}

// --- segmented ----------------------------------------------------------------

BK_EXPORT bk_handle bk_segmented_create(const char* items, uint32_t items_len,
                                        int32_t selected) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  const std::string raw = items && items_len ? std::string(items, items_len) : "";
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::SelectorBar bar;
    for (const auto& item : split(raw, kSep2)) {
      cx::SelectorBarItem it;
      it.Text(bk::utf8_to_hstring(item.data(), static_cast<uint32_t>(item.size())));
      bar.Items().Append(it);
    }
    out = bk::registry().add(bk::NativeType::Segmented, bar);
    auto& entry = *bk::registry().get(out);
    entry.token1 = bar.SelectionChanged([handle = out](auto const&, auto const&) {
      auto* e = bk::registry().get(handle);
      if (!e || e->cb1 == 0) return;
      if (e->suppress > 0) { --e->suppress; return; }
      const auto items = e->object.as<cx::SelectorBar>().Items();
      for (uint32_t i = 0; i < items.Size(); ++i) {
        if (items.GetAt(i).as<cx::SelectorBarItem>().IsSelected()) {
          bk::Event ev;
          ev.header.type = BK_EVT_SELECTION_CHANGED;
          ev.header.target = handle;
          ev.header.callback = e->cb1;
          ev.header.value1 = static_cast<int64_t>(i);
          bk::event_queue().push(std::move(ev));
          return;
        }
      }
    });
    if (selected >= 0 && static_cast<uint32_t>(selected) < bar.Items().Size()) {
      ++entry.suppress;
      bar.Items().GetAt(static_cast<uint32_t>(selected))
          .as<cx::SelectorBarItem>()
          .IsSelected(true);
    }
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_segmented_set_selected(bk_handle s, int32_t selected) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Segmented) {
      st = BK_INVALID_HANDLE;
      return;
    }
    const auto items = entry->object.as<cx::SelectorBar>().Items();
    if (selected < 0 || static_cast<uint32_t>(selected) >= items.Size()) {
      st = BK_INVALID_ARGUMENT;
      return;
    }
    auto item = items.GetAt(static_cast<uint32_t>(selected)).as<cx::SelectorBarItem>();
    if (!item.IsSelected()) {
      ++entry->suppress;
      item.IsSelected(true);
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_segmented_get_selected(bk_handle s) {
  if (require_running() != BK_OK) return -1;
  int32_t value = -1;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Segmented) return;
    const auto items = entry->object.as<cx::SelectorBar>().Items();
    for (uint32_t i = 0; i < items.Size(); ++i) {
      if (items.GetAt(i).as<cx::SelectorBarItem>().IsSelected()) {
        value = static_cast<int32_t>(i);
        return;
      }
    }
  });
  return value;
}

BK_EXPORT int32_t bk_segmented_set_callback(bk_handle s, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Segmented) st = BK_INVALID_HANDLE;
    else { entry->cb1 = cb; st = BK_OK; }
  });
  return combine(rc, st);
}

// --- table --------------------------------------------------------------------
BK_EXPORT bk_handle bk_table_create(const char* columns, uint32_t columns_len,
                                    double row_height) {
  return bk_table_create_ex(columns, columns_len, row_height, 0, 0.0);
}

// flags: 1 multiSelect, 2 headers off, 4 alternating rows, 8 monospace font.
BK_EXPORT bk_handle bk_table_create_ex(const char* columns, uint32_t columns_len,
                                       double row_height, int32_t flags,
                                       double font_size) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  const std::string raw =
      columns && columns_len ? std::string(columns, columns_len) : "";
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    const auto specs = parse_columns(raw);

    cx::Grid root;
    cx::RowDefinition head_row;
    head_row.Height(GridLength(0.0, GridUnitType::Auto));
    cx::RowDefinition list_row;
    list_row.Height(GridLength(1.0, GridUnitType::Star));
    root.RowDefinitions().Append(head_row);
    root.RowDefinitions().Append(list_row);

    cx::Grid header;
    if (flags & 2) header.Visibility(Visibility::Collapsed);
    for (const auto& spec : specs) {
      cx::ColumnDefinition def;
      def.Width(column_length(spec));
      if (spec.min > 0) def.MinWidth(spec.min);
      if (spec.max > 0) def.MaxWidth(spec.max);
      header.ColumnDefinitions().Append(def);
    }
    for (uint32_t i = 0; i < specs.size(); ++i) {
      auto text = cx::TextBlock();
      text.Text(bk::utf8_to_hstring(specs[i].title.data(),
                                    static_cast<uint32_t>(specs[i].title.size())));
      text.FontSize(12.0);
      text.TextAlignment(alignment_of(specs[i].align));
      text.Margin(Thickness(8, 4, 8, 4));
      try {
        text.Foreground(
            Application::Current()
                .Resources()
                .Lookup(winrt::box_value(L"TextFillColorSecondaryBrush"))
                .as<Media::Brush>());
      } catch (...) {
      }
      cx::Grid::SetColumn(text, static_cast<int32_t>(i));
      header.Children().Append(text);
    }
    cx::Grid::SetRow(header, 0);
    root.Children().Append(header);

    cx::ListView list;
    list.SelectionMode(flags & 1 ? cx::ListViewSelectionMode::Multiple
                                  : cx::ListViewSelectionMode::Single);
    cx::Grid::SetRow(list, 1);
    root.Children().Append(list);

    cx::Border shell;
    shell.Child(root);
    out = bk::registry().add(bk::NativeType::Table, shell);
    auto& entry = *bk::registry().get(out);
    entry.auxf = row_height;
    entry.auxf2 = font_size;
    entry.aux2 = flags;
    entry.token1 = list.SelectionChanged([handle = out](auto const&, auto const&) {
      auto* e = bk::registry().get(handle);
      if (!e || e->cb1 == 0) return;
      if (e->aux != 0) return; // aux doubles as the set_rows rebuild flag
      const auto list = grid_of(handle).Children().GetAt(1).as<cx::ListView>();
      bk::Event ev;
      ev.header.type = BK_EVT_SELECTION_CHANGED;
      ev.header.target = handle;
      ev.header.callback = e->cb1;
      ev.header.value1 = static_cast<int64_t>(list.SelectedIndex());
      bk::event_queue().push(std::move(ev));
    });
    entry.token2 = list.DoubleTapped([handle = out](auto const&, auto const&) {
      auto* e = bk::registry().get(handle);
      if (!e || e->cb2 == 0) return;
      const auto list = grid_of(handle).Children().GetAt(1).as<cx::ListView>();
      const int32_t index = list.SelectedIndex();
      if (index < 0) return;
      bk::Event ev;
      ev.header.type = BK_EVT_TABLE_DOUBLE_CLICK;
      ev.header.target = handle;
      ev.header.callback = e->cb2;
      ev.header.value1 = index;
      bk::event_queue().push(std::move(ev));
    });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_table_set_rows(bk_handle t, const char* rows,
                                    uint32_t rows_len, int32_t selected) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string raw = rows && rows_len ? std::string(rows, rows_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::Table) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto root = grid_of(t);
    const auto header = root.Children().GetAt(0).as<cx::Grid>();
    const auto list = root.Children().GetAt(1).as<cx::ListView>();

    // Rebuilds fire SelectionChanged for the collapse to no selection; the
    // rebuild flag (aux) swallows those until the final selection is in.
    entry->aux = 1;
    list.Items().Clear();
    size_t row_index = 0;
    for (const auto& line : split(raw, kSep2)) {
      const auto cells = split(line, kSep1);
      cx::Grid row;
      if ((entry->aux2 & 4) && (row_index & 1)) {
        row.Background(Media::SolidColorBrush(
            winrt::Windows::UI::Color{20, 128, 128, 128}));
      }
      for (uint32_t c = 0; c < header.ColumnDefinitions().Size(); ++c) {
        const auto& column = header.ColumnDefinitions().GetAt(c);
        cx::ColumnDefinition def;
        def.Width(column.Width());
        if (column.MinWidth() > 0) def.MinWidth(column.MinWidth());
        if (column.MaxWidth() > 0) def.MaxWidth(column.MaxWidth());
        row.ColumnDefinitions().Append(def);
        const std::string text =
            c < cells.size() ? cells[c] : std::string();
        // "\x01<handle>" embeds a live element (Table render cells).
        if (!text.empty() && text[0] == '\x01') {
          const bk_handle cell_handle = strtoull(text.c_str() + 1, nullptr, 10);
          auto* cell_entry = bk::registry().get(cell_handle);
          if (cell_entry && cell_entry->object) {
            auto presenter = cx::ContentPresenter();
            presenter.VerticalAlignment(VerticalAlignment::Center);
            presenter.Margin(Thickness(8, 3, 8, 3));
            presenter.Content(cell_entry->object);
            cx::Grid::SetColumn(presenter, static_cast<int32_t>(c));
            row.Children().Append(presenter);
          }
          continue;
        }
        auto cell = cx::TextBlock();
        cell.Text(bk::utf8_to_hstring(text.data(),
                                      static_cast<uint32_t>(text.size())));
        cell.TextAlignment(
            header.Children().GetAt(c).as<cx::TextBlock>().TextAlignment());
        cell.Margin(Thickness(8, 3, 8, 3));
        cell.VerticalAlignment(VerticalAlignment::Center);
        if (entry->auxf2 > 0) cell.FontSize(entry->auxf2);
        if (entry->aux2 & 8) {
          cell.FontFamily(winrt::Microsoft::UI::Xaml::Media::FontFamily(
              L"Cascadia Mono"));
        }
        cx::Grid::SetColumn(cell, static_cast<int32_t>(c));
        row.Children().Append(cell);
      }
      if (entry->auxf > 0) row.MinHeight(entry->auxf);
      list.Items().Append(row);
      ++row_index;
    }
    if (selected >= 0 && static_cast<uint32_t>(selected) < list.Items().Size()) {
      list.SelectedIndex(selected);
    } else {
      list.SelectedIndex(-1);
    }
    entry->aux = 0;
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_table_select(bk_handle t, int32_t index) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::Table) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto list = grid_of(t).Children().GetAt(1).as<cx::ListView>();
    if (index < 0 || static_cast<uint32_t>(index) >= list.Items().Size()) {
      list.SelectedIndex(-1);
    } else {
      list.SelectedIndex(index);
      if (list.ContainerFromIndex(static_cast<uint32_t>(index))) {
        list.ScrollIntoView(list.Items().GetAt(static_cast<uint32_t>(index)));
      }
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_table_get_selected(bk_handle t) {
  if (require_running() != BK_OK) return -1;
  int32_t value = -1;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::Table) return;
    value = grid_of(t).Children().GetAt(1).as<cx::ListView>().SelectedIndex();
  });
  return value;
}

BK_EXPORT uint32_t bk_table_selected_count(bk_handle t) {
  if (require_running() != BK_OK) return 0;
  uint32_t value = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::Table) return;
    value = static_cast<uint32_t>(
        grid_of(t).Children().GetAt(1).as<cx::ListView>()
            .SelectedItems().Size());
  });
  return value;
}

BK_EXPORT int32_t bk_table_selected_at(bk_handle t, uint32_t index) {
  if (require_running() != BK_OK) return -1;
  int32_t value = -1;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::Table) return;
    const auto list = grid_of(t).Children().GetAt(1).as<cx::ListView>();
    if (index >= list.SelectedItems().Size()) return;
    const auto picked = list.SelectedItems().GetAt(index);
    const auto items = list.Items();
    for (uint32_t i = 0; i < items.Size(); ++i) {
      if (items.GetAt(i) == picked) { value = static_cast<int32_t>(i); return; }
    }
  });
  return value;
}

BK_EXPORT int32_t bk_table_set_callbacks(bk_handle t, uint64_t cb_select,
                                         uint64_t cb_double) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::Table) st = BK_INVALID_HANDLE;
    else { entry->cb1 = cb_select; entry->cb2 = cb_double; st = BK_OK; }
  });
  return combine(rc, st);
}

} // extern "C"
