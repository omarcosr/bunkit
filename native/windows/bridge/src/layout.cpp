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

    const int32_t index = static_cast<int32_t>(grid.Children().Size());
    const bool horizontal = parent->aux == BK_STACK_HORIZONTAL;

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
        if (horizontal && i < grid.ColumnDefinitions().Size()) {
          grid.ColumnDefinitions().RemoveAt(i);
        } else if (!horizontal && i < grid.RowDefinitions().Size()) {
          grid.RowDefinitions().RemoveAt(i);
        }
        st = BK_OK;
        return;
      }
    }
    st = BK_WRONG_TYPE; // not a child of this stack
  });
  return combine(rc, st);
}

} // extern "C"
