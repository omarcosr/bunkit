// layout.cpp — VStack/HStack: a Border (padding) wrapping a Grid.
//
// Grid over StackPanel because `grow` must work: a grown child gets a star-
// sized row/column weighted by its grow value, everything else is Auto. WinUI
// Grid has RowSpacing/ColumnSpacing, so spacing survives the switch. Children
// default to Stretch alignment and fill their cell's cross axis.
#include "common.h"
#include "registry.h"
#include "runtime.h"

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
// IVector<T>::Size/Append consume definitions live in this umbrella.
#include <winrt/Windows.Foundation.Collections.h>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;

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

GridLength main_axis_length(double grow) {
  if (grow > 0) {
    return GridLength(grow, GridUnitType::Star);
  }
  return GridLength(0.0, GridUnitType::Auto);
}

} // namespace

extern "C" {

namespace {

// The grid a stack's children live in. A scrolled stack hosts its grid inside
// a ScrollViewer, and a dashed/dotted border adds an overlay grid around that,
// so the walk digs through both wrappers.
cx::Grid grid_of_stack(bk::NativeObject* entry) {
  auto child = entry->object.as<cx::Border>().Child();
  if (auto viewer = child.try_as<cx::ScrollViewer>()) {
    return viewer.Content().as<cx::Grid>();
  }
  if (auto grid = child.try_as<cx::Grid>()) {
    for (uint32_t i = 0; i < grid.Children().Size(); ++i) {
      if (auto viewer = grid.Children().GetAt(i).try_as<cx::ScrollViewer>()) {
        return viewer.Content().as<cx::Grid>();
      }
    }
    return grid;
  }
  return child.as<cx::Grid>();
}

} // namespace

BK_EXPORT bk_handle bk_stack_create(int32_t orientation, double spacing,
                                    double pad_left, double pad_top,
                                    double pad_right, double pad_bottom) {
  return bk_stack_create_ex(orientation, spacing, pad_left, pad_top,
                            pad_right, pad_bottom, 0);
}

// scroll bit 1 = horizontal (auto), bit 2 = vertical. The grid is hosted in a
// ScrollViewer so overflowing content scrolls instead of vanishing.
BK_EXPORT bk_handle bk_stack_create_ex(int32_t orientation, double spacing,
                                       double pad_left, double pad_top,
                                       double pad_right, double pad_bottom,
                                       int32_t scroll) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Border border;
    border.Padding(Thickness(pad_left, pad_top, pad_right, pad_bottom));

    cx::Grid grid;
    if (orientation == BK_STACK_HORIZONTAL) {
      grid.ColumnSpacing(spacing);
    } else {
      orientation = BK_STACK_VERTICAL;
      grid.RowSpacing(spacing);
    }

    if (scroll) {
      cx::ScrollViewer viewer;
      viewer.HorizontalScrollBarVisibility(
          scroll & 1 ? cx::ScrollBarVisibility::Auto
                     : cx::ScrollBarVisibility::Disabled);
      viewer.VerticalScrollBarVisibility(
          scroll & 2 ? cx::ScrollBarVisibility::Auto
                     : cx::ScrollBarVisibility::Disabled);
      viewer.Content(grid);
      border.Child(viewer);
    } else {
      border.Child(grid);
    }

    out = bk::registry().add(bk::NativeType::Stack, border);
    bk::registry().get(out)->aux = orientation;
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_stack_add_child(bk_handle stack, bk_handle child,
                                     double grow) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* parent = bk::registry().get(stack);
    if (!parent || parent->type != bk::NativeType::Stack) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto* entry = bk::registry().get(child);
    if (!entry || !entry->object) {
      st = BK_INVALID_HANDLE;
      return;
    }

    auto grid = grid_of_stack(parent);
    FrameworkElement element = entry->object.as<FrameworkElement>();

    const bool horizontal = parent->aux == BK_STACK_HORIZONTAL;
    const bool center = parent->pack == 1;
    const int32_t childCount = static_cast<int32_t>(grid.Children().Size());

    // Centre-pack keeps a flexible row/column at each end so the content sits
    // mid-axis: [Star, Auto x children, Star]. Maintain that invariant as
    // children are appended.
    if (center) {
      if (childCount > 0) {
        if (horizontal) grid.ColumnDefinitions().RemoveAt(childCount + 1);
        else grid.RowDefinitions().RemoveAt(childCount + 1);
      } else {
        if (horizontal) {
          cx::ColumnDefinition lead;
          lead.Width(GridLength(1.0, GridUnitType::Star));
          grid.ColumnDefinitions().InsertAt(0, lead);
        } else {
          cx::RowDefinition lead;
          lead.Height(GridLength(1.0, GridUnitType::Star));
          grid.RowDefinitions().InsertAt(0, lead);
        }
      }
    }

    const int32_t index = childCount + (center ? 1 : 0);
    cx::RowDefinition row;
    cx::ColumnDefinition col;
    if (horizontal) {
      col.Width(main_axis_length(grow));
      grid.ColumnDefinitions().Append(col);
      cx::Grid::SetColumn(element, index);
    } else {
      row.Height(main_axis_length(grow));
      grid.RowDefinitions().Append(row);
      cx::Grid::SetRow(element, index);
    }
    grid.Children().Append(element);

    if (center) {
      if (horizontal) {
        cx::ColumnDefinition trail;
        trail.Width(GridLength(1.0, GridUnitType::Star));
        grid.ColumnDefinitions().Append(trail);
      } else {
        cx::RowDefinition trail;
        trail.Height(GridLength(1.0, GridUnitType::Star));
        grid.RowDefinitions().Append(trail);
      }
    }

    // Cross-axis alignment; fill is the default Stretch, so nothing to set.
    switch (parent->align) {
      case 0: // leading
        if (horizontal) element.VerticalAlignment(VerticalAlignment::Top);
        else element.HorizontalAlignment(HorizontalAlignment::Left);
        break;
      case 1: // center
        if (horizontal) element.VerticalAlignment(VerticalAlignment::Center);
        else element.HorizontalAlignment(HorizontalAlignment::Center);
        break;
      case 2: // trailing
        if (horizontal) element.VerticalAlignment(VerticalAlignment::Bottom);
        else element.HorizontalAlignment(HorizontalAlignment::Right);
        break;
      default:
        break;
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

// Children and their row/column definitions were appended in the same order,
// so removing index i from both keeps the remaining weights aligned.
BK_EXPORT int32_t bk_stack_remove_child(bk_handle stack, bk_handle child) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* parent = bk::registry().get(stack);
    if (!parent || parent->type != bk::NativeType::Stack) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto* entry = bk::registry().get(child);
    if (!entry || !entry->object) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto grid = grid_of_stack(parent);
    auto element = entry->object.as<FrameworkElement>();
    uint32_t count = grid.Children().Size();
    for (uint32_t i = 0; i < count; ++i) {
      if (grid.Children().GetAt(i) == element) {
        grid.Children().RemoveAt(i);
        const bool horizontal =
            parent->aux == BK_STACK_HORIZONTAL;
        // Centre-pack puts a lead star at grid 0, so the child's definition
        // sits one past its Children index.
        const uint32_t defIndex = i + (parent->pack == 1 ? 1 : 0);
        if (horizontal) {
          if (defIndex < grid.ColumnDefinitions().Size()) {
            grid.ColumnDefinitions().RemoveAt(defIndex);
          }
        } else {
          if (defIndex < grid.RowDefinitions().Size()) {
            grid.RowDefinitions().RemoveAt(defIndex);
          }
        }
        // Re-number the survivors: Grid positions children by the attached
        // Grid.Row/Column property, which removal leaves stale.
        const int32_t offset = parent->pack == 1 ? 1 : 0;
        for (uint32_t j = 0; j < grid.Children().Size(); ++j) {
          auto other = grid.Children().GetAt(j).as<FrameworkElement>();
          const int32_t pos = static_cast<int32_t>(j) + offset;
          if (horizontal) cx::Grid::SetColumn(other, pos);
          else cx::Grid::SetRow(other, pos);
        }
        st = BK_OK;
        return;
      }
    }
    st = BK_WRONG_TYPE; // not a child of this stack
  });
  return combine(rc, st);
}

// Insert a child at a 0-based position among the stack's real children. The
// centre-pack template is not maintained here — use on non-centred stacks.
BK_EXPORT int32_t bk_stack_insert_child(bk_handle stack, bk_handle child,
                                        int32_t index, double grow) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* parent = bk::registry().get(stack);
    auto* entry = bk::registry().get(child);
    if (!parent || parent->type != bk::NativeType::Stack || !entry ||
        !entry->object) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto grid = grid_of_stack(parent);
    FrameworkElement element = entry->object.as<FrameworkElement>();
    const bool horizontal = parent->aux == BK_STACK_HORIZONTAL;
    const int32_t childCount = static_cast<int32_t>(grid.Children().Size());
    if (index < 0 || index > childCount) {
      st = BK_INVALID_ARGUMENT;
      return;
    }
    const uint32_t gridIndex =
        static_cast<uint32_t>(index + (parent->pack == 1 ? 1 : 0));
    if (horizontal) {
      cx::ColumnDefinition col;
      col.Width(main_axis_length(grow));
      grid.ColumnDefinitions().InsertAt(gridIndex, col);
      cx::Grid::SetColumn(element, gridIndex);
    } else {
      cx::RowDefinition row;
      row.Height(main_axis_length(grow));
      grid.RowDefinitions().InsertAt(gridIndex, row);
      cx::Grid::SetRow(element, gridIndex);
    }
    grid.Children().InsertAt(gridIndex, element);
    // A Grid positions children by their Grid.Row/Column attached property,
    // not by Children order: everything that now sits at or past the insertion
    // point would otherwise claim the same cell. Re-number all children to
    // their Children positions (offset by the centre-pack lead star).
    const int32_t offset = parent->pack == 1 ? 1 : 0;
    for (uint32_t i = 0; i < grid.Children().Size(); ++i) {
      auto child = grid.Children().GetAt(i).as<FrameworkElement>();
      const int32_t pos = static_cast<int32_t>(i) + offset;
      if (horizontal) cx::Grid::SetColumn(child, pos);
      else cx::Grid::SetRow(child, pos);
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_stack_set_align(bk_handle stack, int32_t align) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(stack);
    if (!entry || entry->type != bk::NativeType::Stack) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->align = align;
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_stack_set_pack(bk_handle stack, int32_t pack) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(stack);
    if (!entry || entry->type != bk::NativeType::Stack) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->pack = pack;
    st = BK_OK;
  });
  return combine(rc, st);
}

} // extern "C"
