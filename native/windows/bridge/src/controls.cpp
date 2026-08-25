// controls.cpp â€” Button, Label(TextBlock), TextBox/PasswordBox behind handles.
//
// Event handlers attach once at creation, capture only their own handle, and
// read the CURRENT callback id from the registry entry when they fire. That
// makes re-registering a JS callback a plain field write (cb1 = id) and lets
// cb1 == 0 mean "no listener" without detaching anything. The `suppress`
// counter keeps programmatic text sets from echoing back as TextChanged.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"
#include "border_state.h"

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Documents.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Microsoft.UI.Xaml.Input.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Windows.UI.Text.h>
#include <winrt/Windows.System.h>
// Consume definitions for IButtonBase::Click live in this umbrella.
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
#include <winrt/Microsoft.UI.Xaml.Automation.Peers.h>
// IInvokeProvider::Invoke consume definitions live in this umbrella.
#include <winrt/Microsoft.UI.Xaml.Automation.Provider.h>

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

int32_t copy_out(const std::string& s, char* buffer, uint32_t capacity) {
  const uint32_t needed = static_cast<uint32_t>(s.size());
  if (buffer == nullptr || capacity <= needed) return BK_BUFFER_TOO_SMALL;
  memcpy(buffer, s.data(), needed);
  buffer[needed] = '\0';
  return static_cast<int32_t>(needed + 1); // bytes written including NUL
}

} // namespace

extern "C" {

// --- button -----------------------------------------------------------------

BK_EXPORT bk_handle bk_button_create(const char* text, uint32_t text_len) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc2 = bk::Runtime::instance().dispatch_sync([&] {
    cx::Button button;
    if (!t.empty()) {
      button.Content(winrt::box_value(bk::utf8_to_hstring(
          t.data(), static_cast<uint32_t>(t.size()))));
    }
    out = bk::registry().add(bk::NativeType::Button, button);

    auto& entry = *bk::registry().get(out);
    entry.token1 = button.Click(
        [handle = out](winrt::Windows::Foundation::IInspectable const&,
                       winrt::Windows::Foundation::IInspectable const&) {
          auto* e = bk::registry().get(handle);
          if (!e || e->cb1 == 0) return;
          bk::Event ev;
          ev.header.type = BK_EVT_CLICK;
          ev.header.target = handle;
          ev.header.callback = e->cb1;
          bk::event_queue().push(std::move(ev));
        });
  });
  return rc2 == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_button_set_text(bk_handle b, const char* text,
                                     uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(b);
    if (!entry || entry->type != bk::NativeType::Button) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->object.as<cx::Button>().Content(winrt::box_value(
        bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size()))));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_button_set_click_callback(bk_handle b, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(b);
    if (!entry || entry->type != bk::NativeType::Button) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->cb1 = cb;
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_button_click(bk_handle b) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(b);
    if (!entry || entry->type != bk::NativeType::Button) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      // No RaiseEvent in WinUI3: automation peers are the supported way to
      // synthesize a click, and they run the same OnClick path as a pointer.
      auto button = entry->object.as<cx::Button>();
      winrt::Microsoft::UI::Xaml::Automation::Peers::ButtonAutomationPeer peer(
          button);
      peer.Invoke();
      st = BK_OK;
    } catch (...) {
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

// --- label ------------------------------------------------------------------

namespace {

// Labels register their Border shell, not the bare TextBlock: Grid has no
// Background/Border either, and the shell is what makes labels stylable.
cx::TextBlock label_text_of(bk::NativeObject* e) {
  return e->object.as<cx::Border>().Child().as<cx::TextBlock>();
}

} // namespace

BK_EXPORT bk_handle bk_label_create(const char* text, uint32_t text_len) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto text = cx::TextBlock();
    text.Text(bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
    cx::Border shell;
    shell.Child(text);
    out = bk::registry().add(bk::NativeType::Label, shell);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_label_set_text(bk_handle l, const char* text,
                                    uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(l);
    if (!entry || entry->type != bk::NativeType::Label) {
      st = BK_INVALID_HANDLE;
      return;
    }
    label_text_of(entry).Text(
        bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT uint32_t bk_label_text_length(bk_handle l) {
  if (require_running() != BK_OK) return 0;
  uint32_t len = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(l);
    if (!entry || entry->type != bk::NativeType::Label) return;
    len = static_cast<uint32_t>(
        bk::hstring_to_utf8(label_text_of(entry).Text()).size());
  });
  return len;
}

BK_EXPORT int32_t bk_label_copy_text(bk_handle l, char* buffer,
                                     uint32_t capacity) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_BUFFER_TOO_SMALL;
  std::string s;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(l);
    if (!entry || entry->type != bk::NativeType::Label) {
      st = BK_INVALID_HANDLE;
      return;
    }
    s = bk::hstring_to_utf8(label_text_of(entry).Text());
    st = copy_out(s, buffer, capacity);
  });
  return combine(rc, st);
}

// --- textbox / secure textbox -----------------------------------------------

BK_EXPORT bk_handle bk_textbox_create(int32_t secure,
                                      const char* placeholder,
                                      uint32_t placeholder_len) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  std::string p =
      (placeholder && placeholder_len)
          ? std::string(placeholder, placeholder_len)
          : std::string();
  bk_handle out = BK_HANDLE_NULL;
  const bk::NativeType type =
      secure ? bk::NativeType::SecureTextBox : bk::NativeType::TextBox;

  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    if (secure) {
      cx::PasswordBox box;
      bk::apply_default_border(box);
      if (!p.empty()) {
        box.PlaceholderText(bk::utf8_to_hstring(
            p.data(), static_cast<uint32_t>(p.size())));
      }
      out = bk::registry().add(type, box);
      auto& entry = *bk::registry().get(out);
      entry.token3 = box.KeyDown(
          [handle = out](winrt::Windows::Foundation::IInspectable const& sender,
                         winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& args) {
            if (args.Key() != winrt::Windows::System::VirtualKey::Enter) return;
            auto* e = bk::registry().get(handle);
            if (!e || e->cb2 == 0) return;
            bk::Event ev;
            ev.header.type = BK_EVT_TEXT_SUBMIT;
            ev.header.target = handle;
            ev.header.callback = e->cb2;
            ev.payload =
                bk::hstring_to_utf8(sender.as<cx::PasswordBox>().Password());
            bk::event_queue().push(std::move(ev));
          });
      entry.token1 = box.PasswordChanged(
          [handle = out](winrt::Windows::Foundation::IInspectable const&,
                         winrt::Windows::Foundation::IInspectable const&) {
            auto* e = bk::registry().get(handle);
            if (!e || e->cb1 == 0) return;
            if (e->suppress > 0) {
              e->suppress--;
              return;
            }
            try {
              bk::Event ev;
              ev.header.type = BK_EVT_TEXT_CHANGED;
              ev.header.target = handle;
              ev.header.callback = e->cb1;
              ev.payload = bk::hstring_to_utf8(
                  e->object.as<cx::PasswordBox>().Password());
              bk::event_queue().push(std::move(ev));
            } catch (...) {
            }
          });
    } else {
      cx::TextBox box;
      bk::apply_default_border(box);
      try {
        box.IsSpellCheckEnabled(false);
        box.IsTextPredictionEnabled(false);
      } catch (...) {
      }
      if (!p.empty()) {
        box.PlaceholderText(bk::utf8_to_hstring(
            p.data(), static_cast<uint32_t>(p.size())));
      }
      out = bk::registry().add(type, box);
      auto& entry = *bk::registry().get(out);
      entry.token2 = box.KeyDown(
          [handle = out](winrt::Windows::Foundation::IInspectable const& sender,
                         winrt::Microsoft::UI::Xaml::Input::KeyRoutedEventArgs const& args) {
            if (args.Key() != winrt::Windows::System::VirtualKey::Enter) return;
            auto* e = bk::registry().get(handle);
            if (!e || e->cb2 == 0) return;
            bk::Event ev;
            ev.header.type = BK_EVT_TEXT_SUBMIT;
            ev.header.target = handle;
            ev.header.callback = e->cb2;
            ev.payload =
                bk::hstring_to_utf8(sender.as<cx::TextBox>().Text());
            bk::event_queue().push(std::move(ev));
          });
      entry.token1 = box.TextChanged(
          [handle = out](winrt::Windows::Foundation::IInspectable const& sender,
                         winrt::Microsoft::UI::Xaml::Controls::TextChangedEventArgs const&) {
            auto* e = bk::registry().get(handle);
            if (!e || e->cb1 == 0) return;
            if (e->suppress > 0) {
              e->suppress--;
              return;
            }
            bk::Event ev;
            ev.header.type = BK_EVT_TEXT_CHANGED;
            ev.header.target = handle;
            ev.header.callback = e->cb1;
            try {
              ev.payload = bk::hstring_to_utf8(
                  sender.as<cx::TextBox>().Text());
            } catch (...) {
              return;
            }
            bk::event_queue().push(std::move(ev));
          });
    }
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_textbox_set_text(bk_handle tb, const char* text,
                                      uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry ||
        !(entry->type == bk::NativeType::TextBox ||
          entry->type == bk::NativeType::SecureTextBox)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    std::string cur;
    try {
      if (entry->type == bk::NativeType::SecureTextBox) {
        cur = bk::hstring_to_utf8(entry->object.as<cx::PasswordBox>().Password());
      } else {
        cur = bk::hstring_to_utf8(entry->object.as<cx::TextBox>().Text());
      }
    } catch (...) {
      cur = "";
    }
    bool will_change = cur != t;
    if (will_change) ++entry->suppress;
    try {
      if (entry->type == bk::NativeType::SecureTextBox) {
        entry->object.as<cx::PasswordBox>().Password(
            bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
      } else {
        entry->object.as<cx::TextBox>().Text(
            bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
      }
      st = BK_OK;
    } catch (...) {
      if (will_change && entry->suppress > 0) --entry->suppress;
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_textbox_set_placeholder(bk_handle tb, const char* text,
                                             uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry ||
        !(entry->type == bk::NativeType::TextBox ||
          entry->type == bk::NativeType::SecureTextBox)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto ph = bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size()));
    if (entry->type == bk::NativeType::SecureTextBox) {
      entry->object.as<cx::PasswordBox>().PlaceholderText(ph);
    } else {
      entry->object.as<cx::TextBox>().PlaceholderText(ph);
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_textbox_set_change_callback(bk_handle tb, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry ||
        !(entry->type == bk::NativeType::TextBox ||
          entry->type == bk::NativeType::SecureTextBox)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->cb1 = cb;
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT uint32_t bk_textbox_value_length(bk_handle tb) {
  if (require_running() != BK_OK) return 0;
  uint32_t len = 0;
  bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry) return;
    if (entry->type == bk::NativeType::SecureTextBox) {
      len = static_cast<uint32_t>(bk::hstring_to_utf8(
                                       entry->object.as<cx::PasswordBox>()
                                           .Password())
                                       .size());
    } else if (entry->type == bk::NativeType::TextBox) {
      len = static_cast<uint32_t>(bk::hstring_to_utf8(
                                      entry->object.as<cx::TextBox>().Text())
                                      .size());
    }
  });
  return len;
}

BK_EXPORT int32_t bk_textbox_copy_value(bk_handle tb, char* buffer,
                                        uint32_t capacity) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_BUFFER_TOO_SMALL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry) {
      st = BK_INVALID_HANDLE;
      return;
    }
    if (entry->type == bk::NativeType::SecureTextBox) {
      st = copy_out(
          bk::hstring_to_utf8(entry->object.as<cx::PasswordBox>().Password()),
          buffer, capacity);
    } else if (entry->type == bk::NativeType::TextBox) {
      st = copy_out(
          bk::hstring_to_utf8(entry->object.as<cx::TextBox>().Text()), buffer,
          capacity);
    } else {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_textbox_insert_text(bk_handle tb, const char* text,
                                         uint32_t text_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  std::string t = (text && text_len) ? std::string(text, text_len)
                                     : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry || entry->type != bk::NativeType::TextBox) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      auto box = entry->object.as<cx::TextBox>();
      auto cur = bk::hstring_to_utf8(box.Text());
      auto next = cur + t;
      if (entry->cb1 != 0) ++entry->suppress;
      const auto caret = static_cast<int32_t>(cur.size());
      box.Select(caret, 0);
      box.SelectedText(
          bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
      if (entry->cb1 != 0) {
        bk::Event ev;
        ev.header.type = BK_EVT_TEXT_CHANGED;
        ev.header.target = tb;
        ev.header.callback = entry->cb1;
        ev.payload = next;
        bk::event_queue().push(std::move(ev));
      }
      st = BK_OK;
    } catch (...) {
      if (entry->cb1 != 0 && entry->suppress > 0) --entry->suppress;
      st = BK_ERROR;
    }
  });
  return combine(rc, st);
}

// --- shared control ops -----------------------------------------------------

BK_EXPORT int32_t bk_control_set_enabled(bk_handle c, int32_t enabled) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      entry->object.as<cx::Control>().IsEnabled(enabled != 0);
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE; // e.g. TextBlock is not a Control
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_get_enabled(bk_handle c) {
  if (require_running() != BK_OK) return 0;
  int32_t out = 0;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry) return;
    try {
      out = entry->object.as<cx::Control>().IsEnabled() ? 1 : 0;
    } catch (...) {
    }
  });
  return rc == BK_OK ? out : 0;
}

BK_EXPORT int32_t bk_control_set_visible(bk_handle c, int32_t visible) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      entry->object.as<FrameworkElement>().Visibility(
          visible ? Visibility::Visible : Visibility::Collapsed);
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_control_get_size(bk_handle c, double* out_w,
                                      double* out_h) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (out_w == nullptr || out_h == nullptr) return BK_INVALID_ARGUMENT;
  *out_w = 0;
  *out_h = 0;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(c);
    if (!entry) {
      st = BK_INVALID_HANDLE;
      return;
    }
    try {
      auto element = entry->object.as<FrameworkElement>();
      *out_w = element.ActualWidth();
      *out_h = element.ActualHeight();
      st = BK_OK;
    } catch (...) {
      st = BK_WRONG_TYPE;
    }
  });
  return combine(rc, st);
}

// --- text colours -----------------------------------------------------------------

namespace {

bool parse_hex_color(const std::string& raw, winrt::Windows::UI::Color& out) {
  try {
    const std::string digits = (!raw.empty() && raw[0] == '#') ? raw.substr(1) : raw;
    const auto value = static_cast<uint32_t>(std::stoul(digits, nullptr, 16));
    out.A = 255;
    if (digits.size() > 6) { // #AARRGGBB
      out.A = static_cast<uint8_t>((value >> 24) & 0xFF);
      out.R = static_cast<uint8_t>((value >> 16) & 0xFF);
    } else {
      out.R = static_cast<uint8_t>((value >> 16) & 0xFF);
    }
    out.G = static_cast<uint8_t>((value >> 8) & 0xFF);
    out.B = static_cast<uint8_t>(value & 0xFF);
    return true;
  } catch (...) {
    return false;
  }
}

} // namespace

// textColor/placeholderColor as hex; pass an empty string to leave a colour
// unchanged. PasswordBoxes take the text colour only (no PlaceholderForeground
// on the secure template).
BK_EXPORT int32_t bk_textbox_set_colors(bk_handle tb, const char* text_hex,
                                        uint32_t text_len,
                                        const char* ph_hex,
                                        uint32_t ph_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string t = text_hex && text_len ? std::string(text_hex, text_len) : "";
  const std::string p = ph_hex && ph_len ? std::string(ph_hex, ph_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry || (entry->type != bk::NativeType::TextBox &&
                   entry->type != bk::NativeType::SecureTextBox)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    winrt::Windows::UI::Color color{};
    if (!t.empty()) {
      if (!parse_hex_color(t, color)) { st = BK_INVALID_ARGUMENT; return; }
      try {
        entry->object.as<cx::Control>().Foreground(
            Media::SolidColorBrush(color));
      } catch (...) {
        st = BK_WRONG_TYPE;
        return;
      }
    }
    if (!p.empty() && entry->type == bk::NativeType::TextBox) {
      if (!parse_hex_color(p, color)) { st = BK_INVALID_ARGUMENT; return; }
      entry->object.as<cx::TextBox>().PlaceholderForeground(
          Media::SolidColorBrush(color));
    }
    st = BK_OK;
  });
  return combine(rc, st);
}
BK_EXPORT int32_t bk_textbox_reset_placeholder_color(bk_handle tb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry || (entry->type != bk::NativeType::TextBox &&
                   entry->type != bk::NativeType::SecureTextBox)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    if (entry->type == bk::NativeType::TextBox) {
      entry->object.as<cx::TextBox>().ClearValue(
          cx::TextBox::PlaceholderForegroundProperty());
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

// --- option variants (macOS parity) ------------------------------------------

namespace {

// Subset of SF Symbols used by the examples, mapped to Segoe MDL2 Assets
// (present on every Windows 10+; Fluent Icons is not).
wchar_t fluent_glyph(const std::string& name) {
  if (name == "plus") return 0xE710;
  if (name == "folder") return 0xE8B7;
  if (name == "gear") return 0xE713;
  if (name == "trash") return 0xE74D;
  if (name == "pencil") return 0xE70F;
  return 0;
}

winrt::Microsoft::UI::Xaml::Media::Brush resource_brush(const wchar_t* key) {
  try {
    return Application::Current()
        .Resources()
        .Lookup(winrt::box_value(key))
        .as<winrt::Microsoft::UI::Xaml::Media::Brush>();
  } catch (...) {
    return nullptr;
  }
}

// AppKit colour names -> nearest theme brush; any other string is parsed as
// hex (#RRGGBB or #AARRGGBB). An empty string yields a null brush (leave the
// foreground untouched). Shared by Label and Button foregrounds.
Media::Brush resolve_foreground_brush(const std::string& c) {
  if (c.empty()) return nullptr;
  winrt::Windows::UI::Color color{};
  if (c[0] == '#') {
    if (parse_hex_color(c, color)) {
      return Media::SolidColorBrush(color);
    }
    return nullptr;
  }
  const wchar_t* brush_key = nullptr;
  if (c == "secondaryLabel" || c == "placeholderText") {
    brush_key = L"TextFillColorSecondaryBrush";
  } else if (c == "tertiaryLabel") {
    brush_key = L"TextFillColorTertiaryBrush";
  } else if (c == "quaternaryLabel") {
    brush_key = L"TextFillColorDisabledBrush";
  } else if (c == "label" || c == "textColor") {
    brush_key = L"TextFillColorPrimaryBrush";
  } else if (c == "systemRed") {
    brush_key = L"SystemFillColorCriticalBrush";
  } else if (c == "systemYellow" || c == "systemOrange") {
    brush_key = L"SystemFillColorCautionBrush";
  } else if (c == "systemGreen") {
    brush_key = L"SystemFillColorSuccessBrush";
  } else if (c == "systemGray" || c == "systemBrown") {
    brush_key = L"TextFillColorSecondaryBrush";
  } else {
    // Blue/purple/teal/pink and link -> the accent colour.
    brush_key = L"AccentFillColorDefaultBrush";
  }
  if (auto brush = resource_brush(brush_key)) {
    return brush;
  }
  return nullptr;
}

void apply_label_brush(cx::TextBlock label, const std::string& c) {
  if (auto brush = resolve_foreground_brush(c)) {
    label.Foreground(brush);
  }
}

} // namespace

BK_EXPORT bk_handle bk_button_create_ex(const char* text, uint32_t text_len,
                                        int32_t primary, int32_t destructive,
                                        const char* symbol,
                                        uint32_t symbol_len) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  std::string t = (text && text_len) ? std::string(text, text_len) : std::string();
  std::string sym = (symbol && symbol_len) ? std::string(symbol, symbol_len) : std::string();
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    cx::Button button;
    if (primary) {
      try {
        button.Style(Application::Current()
                         .Resources()
                         .Lookup(winrt::box_value(L"AccentButtonStyle"))
                         .as<Style>());
      } catch (...) {
      }
    }
    if (destructive) {
      if (auto danger = resource_brush(L"SystemFillColorDangerBrush")) {
        button.Foreground(danger);
      }
    }
    const wchar_t glyph = fluent_glyph(sym);
    if (glyph && !t.empty()) {
      // One TextBlock with "glyph  title" in Segoe MDL2 Assets. A lone PUA
      // glyph as the entire Text fail-fasts XAML text analysis on some builds
      // (0xC0000409); the glyph mixed with regular letters does not, and
      // DirectWrite falls back per-run for the letters at render time.
      auto content = cx::TextBlock();
      content.FontFamily(winrt::Microsoft::UI::Xaml::Media::FontFamily(
          L"Segoe MDL2 Assets"));
      std::wstring text(&glyph, 1);
      text += L"  ";
      text += bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size()));
      content.Text(std::wstring_view(text.data(), text.size()));
      content.FontSize(13.0);
      button.Content(content);
    } else if (glyph) {
      // Icon-only: a lone PUA glyph as the whole Text crashes text analysis
      // on some builds, so icon-only buttons degrade to the plain title
      // (the examples never use symbol without a title).
      if (!t.empty()) {
        button.Content(winrt::box_value(bk::utf8_to_hstring(
            t.data(), static_cast<uint32_t>(t.size()))));
      }
    } else if (!t.empty()) {
      button.Content(winrt::box_value(bk::utf8_to_hstring(
          t.data(), static_cast<uint32_t>(t.size()))));
    }
    out = bk::registry().add(bk::NativeType::Button, button);
    auto& entry = *bk::registry().get(out);
    entry.token1 = button.Click(
        [handle = out](winrt::Windows::Foundation::IInspectable const&,
                       winrt::Windows::Foundation::IInspectable const&) {
          auto* e = bk::registry().get(handle);
          if (!e || e->cb1 == 0) return;
          bk::Event ev;
          ev.header.type = BK_EVT_CLICK;
          ev.header.target = handle;
          ev.header.callback = e->cb1;
          bk::event_queue().push(std::move(ev));
        });
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

// Title colour: hex (#RRGGBB / #AARRGGBB) or an AppKit-style semantic name.
// Applies to the Button's Foreground (template-bound for plain titles, and
// inherited by a symbol button's TextBlock content).
BK_EXPORT int32_t bk_button_set_color(bk_handle b, const char* color,
                                      uint32_t color_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string c = color && color_len ? std::string(color, color_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(b);
    if (!entry || entry->type != bk::NativeType::Button) {
      st = BK_INVALID_HANDLE;
      return;
    }
    if (auto brush = resolve_foreground_brush(c)) {
      entry->object.as<cx::Button>().Foreground(brush);
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

// Title font. style_bits: 1 semibold, 2 title (semibold, default 20pt),
// 4 monospace — the same vocabulary as labels. Symbol buttons keep their
// text in a TextBlock with an explicit FontSize, so those get the properties
// directly as well (the Button's own font properties template-bind to the
// ContentPresenter for plain string content).
BK_EXPORT int32_t bk_button_set_font(bk_handle b, double font_size,
                                     int32_t style_bits) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(b);
    if (!entry || entry->type != bk::NativeType::Button) {
      st = BK_INVALID_HANDLE;
      return;
    }
    auto button = entry->object.as<cx::Button>();
    if (font_size > 0) button.FontSize(font_size);
    if (style_bits & 2) {
      button.FontSize(font_size > 0 ? font_size : 20.0);
      button.FontWeight(winrt::Windows::UI::Text::FontWeights::SemiBold());
    } else if (style_bits & 1) {
      button.FontWeight(winrt::Windows::UI::Text::FontWeights::SemiBold());
    }
    if (style_bits & 4) {
      button.FontFamily(winrt::Microsoft::UI::Xaml::Media::FontFamily(L"Cascadia Mono"));
    }
    if (auto tb = button.Content().try_as<cx::TextBlock>()) {
      if (font_size > 0) tb.FontSize(font_size);
      if (style_bits & 1 || style_bits & 2) {
        tb.FontWeight(winrt::Windows::UI::Text::FontWeights::SemiBold());
      }
      if (style_bits & 4) {
        tb.FontFamily(winrt::Microsoft::UI::Xaml::Media::FontFamily(L"Cascadia Mono"));
      }
    }
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT bk_handle bk_label_create_ex(const char* text, uint32_t text_len,
                                       const char* color, uint32_t color_len,
                                       double font_size, int32_t style_bits,
                                       int32_t align, double width,
                                       double height) {
  if (require_running() != BK_OK) return BK_HANDLE_NULL;
  std::string t = (text && text_len) ? std::string(text, text_len) : std::string();
  std::string c = (color && color_len) ? std::string(color, color_len) : std::string();
  bk_handle out = BK_HANDLE_NULL;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto label = cx::TextBlock();
    label.Text(bk::utf8_to_hstring(t.data(), static_cast<uint32_t>(t.size())));
    apply_label_brush(label, c);
    if (font_size > 0) label.FontSize(font_size);
    // style_bits: 1 semibold, 2 title, 4 monospace
    if (style_bits & 2) {
      label.FontSize(font_size > 0 ? font_size : 20.0);
      label.FontWeight(winrt::Windows::UI::Text::FontWeights::SemiBold());
    } else if (style_bits & 1) {
      label.FontWeight(winrt::Windows::UI::Text::FontWeights::SemiBold());
    }
    if (style_bits & 4) {
      label.FontFamily(winrt::Microsoft::UI::Xaml::Media::FontFamily(L"Cascadia Mono"));
    }
    if (align == 1) label.TextAlignment(TextAlignment::Center);
    else if (align == 2) label.TextAlignment(TextAlignment::Right);
    // Width/height belong to the shell; everything visual stays on the text.
    cx::Border shell;
    shell.Child(label);
    if (width > 0) shell.Width(width);
    if (height > 0) shell.Height(height);
    out = bk::registry().add(bk::NativeType::Label, shell);
  });
  return rc == BK_OK ? out : BK_HANDLE_NULL;
}

BK_EXPORT int32_t bk_label_set_color(bk_handle l, const char* color,
                                     uint32_t color_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string c = (color && color_len) ? std::string(color, color_len)
                                             : std::string();
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(l);
    if (!entry || entry->type != bk::NativeType::Label) {
      st = BK_INVALID_HANDLE;
      return;
    }
    apply_label_brush(label_text_of(entry), c);
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_passwordbox_set_submit_callback(bk_handle pb, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(pb);
    if (!entry || entry->type != bk::NativeType::SecureTextBox) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->cb2 = cb;
    st = BK_OK;
  });
  return combine(rc, st);
}

// Text colour for multiline areas (TextBox-backed TextArea and RichEditBox).
BK_EXPORT int32_t bk_textarea_set_foreground(bk_handle t, const char* hex,
                                             uint32_t hex_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string h = hex && hex_len ? std::string(hex, hex_len) : "";
  if (h.empty()) return BK_INVALID_ARGUMENT;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || (entry->type != bk::NativeType::TextArea &&
                   entry->type != bk::NativeType::RichTextArea)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    winrt::Windows::UI::Color color{};
    if (!parse_hex_color(h, color)) { st = BK_INVALID_ARGUMENT; return; }
    entry->object.as<cx::Control>().Foreground(Media::SolidColorBrush(color));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_textbox_set_submit_callback(bk_handle tb, uint64_t cb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry || entry->type != bk::NativeType::TextBox) {
      st = BK_INVALID_HANDLE;
      return;
    }
    entry->cb2 = cb;
    st = BK_OK;
  });
  return combine(rc, st);
}

// Test hook: queue EVT_TEXT_SUBMIT with the current value, the same event the
// real Enter KeyDown handler produces. Lets tests exercise the whole JS path
// (registry -> event queue -> dispatch) without synthesizing keyboard input.
BK_EXPORT int32_t bk_textbox_simulate_enter(bk_handle tb) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(tb);
    if (!entry || (entry->type != bk::NativeType::TextBox &&
                   entry->type != bk::NativeType::SecureTextBox)) {
      st = BK_INVALID_HANDLE;
      return;
    }
    if (entry->cb2 == 0) {
      st = BK_OK;
      return;
    }
    bk::Event ev;
    ev.header.type = BK_EVT_TEXT_SUBMIT;
    ev.header.target = tb;
    ev.header.callback = entry->cb2;
    if (entry->type == bk::NativeType::SecureTextBox) {
      ev.payload = bk::hstring_to_utf8(entry->object.as<cx::PasswordBox>().Password());
    } else {
      ev.payload = bk::hstring_to_utf8(entry->object.as<cx::TextBox>().Text());
    }
    bk::event_queue().push(std::move(ev));
    st = BK_OK;
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_textarea_set_readonly(bk_handle t, int32_t readonly) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::TextArea) st = BK_INVALID_HANDLE;
    else {
      entry->object.as<cx::TextBox>().IsReadOnly(readonly != 0);
      st = BK_OK;
    }
  });
  return combine(rc, st);
}

BK_EXPORT int32_t bk_textarea_set_font(bk_handle t, int32_t monospace,
                                       double font_size) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto* entry = bk::registry().get(t);
    if (!entry || entry->type != bk::NativeType::TextArea) st = BK_INVALID_HANDLE;
    else {
      auto box = entry->object.as<cx::TextBox>();
      if (monospace) {
        box.FontFamily(winrt::Microsoft::UI::Xaml::Media::FontFamily(L"Cascadia Mono"));
      }
      if (font_size > 0) box.FontSize(font_size);
      st = BK_OK;
    }
  });
  return combine(rc, st);
}

} // extern "C"
