#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
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

int32_t copy_out(const std::string& value, char* buffer, uint32_t capacity) {
  const uint32_t needed = static_cast<uint32_t>(value.size());
  if (!buffer || capacity <= needed) return BK_BUFFER_TOO_SMALL;
  memcpy(buffer, value.data(), needed);
  buffer[needed] = '\0';
  return static_cast<int32_t>(needed + 1);
}

void push_value_event(bk_handle handle, uint16_t type, int64_t value,
                      std::string payload = {}) {
  auto* entry = bk::registry().get(handle);
  if (!entry || entry->cb1 == 0) return;
  bk::Event event;
  event.header.type = type;
  event.header.target = handle;
  event.header.callback = entry->cb1;
  event.header.value1 = value;
  event.payload = std::move(payload);
  bk::event_queue().push(std::move(event));
}

std::string item_title(cx::ComboBox const& combo) {
  auto item = combo.SelectedItem();
  if (!item) return {};
  try {
    return bk::hstring_to_utf8(winrt::unbox_value<winrt::hstring>(item));
  } catch (...) {
    return {};
  }
}

}

extern "C" {

BK_EXPORT bk_handle bk_checkbox_create(const char* title, uint32_t title_len,
                                       int32_t checked) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  const std::string text = title && title_len ? std::string(title, title_len) : "";
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::CheckBox box;
    box.Content(winrt::box_value(bk::utf8_to_hstring(text.data(),
                                                     static_cast<uint32_t>(text.size()))));
    box.IsChecked(checked != 0);
    out = bk::registry().add(bk::NativeType::CheckBox, box);
    auto& entry = *bk::registry().get(out);
    auto emit = [handle = out](auto const&, auto const&) {
      auto* e = bk::registry().get(handle);
      if (!e || e->suppress > 0) {
        if (e && e->suppress > 0) --e->suppress;
        return;
      }
      auto* current = bk::registry().get(handle);
      if (!current) return;
      const bool value = current->object.as<cx::CheckBox>().IsChecked().GetBoolean();
      push_value_event(handle, BK_EVT_VALUE_CHANGED, value ? 1 : 0);
    };
    entry.token1 = box.Checked(emit);
    entry.token2 = box.Unchecked(emit);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_checkbox_set_checked(bk_handle c, int32_t checked) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry || entry->type != bk::NativeType::CheckBox) {
      status = BK_INVALID_HANDLE;
      return;
    }
    ++entry->suppress;
    entry->object.as<cx::CheckBox>().IsChecked(checked != 0);
    status = BK_OK;
  });
  return combine(rc, status);
}

BK_EXPORT int32_t bk_checkbox_get_checked(bk_handle c) {
  if (require_running() != BK_OK) return 0;
  int32_t value = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry || entry->type != bk::NativeType::CheckBox) return;
    value = entry->object.as<cx::CheckBox>().IsChecked().GetBoolean() ? 1 : 0;
  });
  return value;
}

BK_EXPORT int32_t bk_checkbox_set_callback(bk_handle c, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry || entry->type != bk::NativeType::CheckBox) status = BK_INVALID_HANDLE;
    else { entry->cb1 = cb; status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT bk_handle bk_switch_create(int32_t on) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::ToggleSwitch control;
    control.IsOn(on != 0);
    out = bk::registry().add(bk::NativeType::ToggleSwitch, control);
    auto& entry = *bk::registry().get(out);
    entry.token1 = control.Toggled([handle = out](auto const&, auto const&) {
      auto* e = bk::registry().get(handle);
      if (!e) return;
      if (e->suppress > 0) { --e->suppress; return; }
      if (e->cb1 == 0) return;
      push_value_event(handle, BK_EVT_VALUE_CHANGED,
                       e->object.as<cx::ToggleSwitch>().IsOn() ? 1 : 0);
    });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_switch_set_on(bk_handle s, int32_t on) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::ToggleSwitch) status = BK_INVALID_HANDLE;
    else { entry->suppress++; entry->object.as<cx::ToggleSwitch>().IsOn(on != 0); status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT int32_t bk_switch_get_on(bk_handle s) {
  if (require_running() != BK_OK) return 0;
  int32_t value = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (entry && entry->type == bk::NativeType::ToggleSwitch) value = entry->object.as<cx::ToggleSwitch>().IsOn() ? 1 : 0;
  });
  return value;
}

BK_EXPORT int32_t bk_switch_set_callback(bk_handle s, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::ToggleSwitch) status = BK_INVALID_HANDLE;
    else { entry->cb1 = cb; status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT bk_handle bk_slider_create(double min, double max, double value) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Slider slider;
    slider.Minimum(min); slider.Maximum(max); slider.Value(value);
    out = bk::registry().add(bk::NativeType::Slider, slider);
    auto& entry = *bk::registry().get(out);
    entry.token1 = slider.ValueChanged([handle = out](auto const&, winrt::Microsoft::UI::Xaml::Controls::Primitives::RangeBaseValueChangedEventArgs const& args) {
      auto* e = bk::registry().get(handle);
       if (!e) return;
       if (e->suppress > 0) { --e->suppress; return; }
       if (e->cb1 == 0) return;
      push_value_event(handle, BK_EVT_VALUE_CHANGED, 0, std::to_string(args.NewValue()));
    });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_slider_set_value(bk_handle s, double value) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Slider) status = BK_INVALID_HANDLE;
    else { entry->suppress++; entry->object.as<cx::Slider>().Value(value); status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT double bk_slider_get_value(bk_handle s) {
  if (require_running() != BK_OK) return 0;
  double value = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (entry && entry->type == bk::NativeType::Slider) value = entry->object.as<cx::Slider>().Value();
  });
  return value;
}

BK_EXPORT int32_t bk_slider_set_callback(bk_handle s, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Slider) status = BK_INVALID_HANDLE;
    else { entry->cb1 = cb; status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT bk_handle bk_select_create(void) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::ComboBox combo;
    out = bk::registry().add(bk::NativeType::Select, combo);
    auto& entry = *bk::registry().get(out);
    entry.token1 = combo.SelectionChanged([handle = out](auto const&, cx::SelectionChangedEventArgs const&) {
      auto* e = bk::registry().get(handle);
       if (!e) return;
       if (e->suppress > 0) { --e->suppress; return; }
       if (e->cb1 == 0) return;
      const auto combo = e->object.as<cx::ComboBox>();
      push_value_event(handle, BK_EVT_SELECTION_CHANGED, combo.SelectedIndex(), item_title(combo));
    });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_select_set_items(bk_handle s, const char* items,
                                      uint32_t items_len, int32_t selected) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string raw = items && items_len ? std::string(items, items_len) : "";
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Select) { status = BK_INVALID_HANDLE; return; }
    auto combo = entry->object.as<cx::ComboBox>();
    entry->suppress++;
    combo.Items().Clear();
    size_t start = 0;
    while (start <= raw.size()) {
      const size_t end = raw.find('\n', start);
      const std::string item = raw.substr(start, end == std::string::npos ? end : end - start);
      combo.Items().Append(winrt::box_value(bk::utf8_to_hstring(item.data(), static_cast<uint32_t>(item.size()))));
      if (end == std::string::npos) break;
      start = end + 1;
    }
    combo.SelectedIndex(selected);
    status = BK_OK;
  });
  return combine(rc, status);
}

BK_EXPORT int32_t bk_select_set_selected(bk_handle s, int32_t selected) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Select) status = BK_INVALID_HANDLE;
    else { entry->suppress++; entry->object.as<cx::ComboBox>().SelectedIndex(selected); status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT int32_t bk_select_get_selected(bk_handle s) {
  if (require_running() != BK_OK) return -1;
  int32_t value = -1;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (entry && entry->type == bk::NativeType::Select) value = entry->object.as<cx::ComboBox>().SelectedIndex();
  });
  return value;
}

BK_EXPORT uint32_t bk_select_title_length(bk_handle s) {
  if (require_running() != BK_OK) return 0;
  uint32_t length = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (entry && entry->type == bk::NativeType::Select) length = static_cast<uint32_t>(item_title(entry->object.as<cx::ComboBox>()).size());
  });
  return length;
}

BK_EXPORT int32_t bk_select_copy_title(bk_handle s, char* buffer, uint32_t capacity) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_INVALID_HANDLE;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (entry && entry->type == bk::NativeType::Select) status = copy_out(item_title(entry->object.as<cx::ComboBox>()), buffer, capacity);
  });
  return status;
}

BK_EXPORT int32_t bk_select_set_callback(bk_handle s, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(s);
    if (!entry || entry->type != bk::NativeType::Select) status = BK_INVALID_HANDLE;
    else { entry->cb1 = cb; status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT bk_handle bk_textarea_create(void) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::TextBox box;
    box.AcceptsReturn(true);
    box.TextWrapping(TextWrapping::Wrap);
    cx::ScrollViewer::SetVerticalScrollBarVisibility(box, cx::ScrollBarVisibility::Auto);
    out = bk::registry().add(bk::NativeType::TextArea, box);
    auto& entry = *bk::registry().get(out);
    entry.token1 = box.TextChanged([handle = out](auto const& sender, auto const&) {
      auto* e = bk::registry().get(handle);
       if (!e) return;
       if (e->suppress > 0) { --e->suppress; return; }
       if (e->cb1 == 0) return;
      push_value_event(handle, BK_EVT_TEXT_CHANGED, 0,
                       bk::hstring_to_utf8(sender.template as<cx::TextBox>().Text()));
    });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_textarea_set_text(bk_handle t, const char* text, uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string value = text && text_len ? std::string(text, text_len) : "";
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::TextArea) status = BK_INVALID_HANDLE;
    else { entry->suppress++; entry->object.as<cx::TextBox>().Text(bk::utf8_to_hstring(value.data(), static_cast<uint32_t>(value.size()))); status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT uint32_t bk_textarea_value_length(bk_handle t) {
  if (require_running() != BK_OK) return 0;
  uint32_t length = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (entry && entry->type == bk::NativeType::TextArea) length = static_cast<uint32_t>(bk::hstring_to_utf8(entry->object.as<cx::TextBox>().Text()).size());
  });
  return length;
}

BK_EXPORT int32_t bk_textarea_copy_value(bk_handle t, char* buffer, uint32_t capacity) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_INVALID_HANDLE;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (entry && entry->type == bk::NativeType::TextArea) status = copy_out(bk::hstring_to_utf8(entry->object.as<cx::TextBox>().Text()), buffer, capacity);
  });
  return status;
}

BK_EXPORT int32_t bk_textarea_set_callback(bk_handle t, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::TextArea) status = BK_INVALID_HANDLE;
    else { entry->cb1 = cb; status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT bk_handle bk_progress_create(double max, double value, int32_t indeterminate) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::ProgressBar bar;
    bar.Maximum(max); bar.Value(value); bar.IsIndeterminate(indeterminate != 0);
    out = bk::registry().add(bk::NativeType::Progress, bar);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_progress_set_value(bk_handle p, double value) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t status = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(p);
    if (!entry || entry->type != bk::NativeType::Progress) status = BK_INVALID_HANDLE;
    else { entry->object.as<cx::ProgressBar>().Value(value); status = BK_OK; }
  });
  return combine(rc, status);
}

BK_EXPORT double bk_progress_get_value(bk_handle p) {
  if (require_running() != BK_OK) return 0;
  double value = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(p);
    if (entry && entry->type == bk::NativeType::Progress) value = entry->object.as<cx::ProgressBar>().Value();
  });
  return value;
}

BK_EXPORT bk_handle bk_separator_create(int32_t horizontal) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Border separator;
    separator.Height(horizontal ? 1 : 0);
    separator.Width(horizontal ? 0 : 1);
    out = bk::registry().add(bk::NativeType::Separator, separator);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT bk_handle bk_spacer_create(void) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Border spacer;
    spacer.MinHeight(1);
    out = bk::registry().add(bk::NativeType::Spacer, spacer);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

}
