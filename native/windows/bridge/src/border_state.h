// border_state.h — a visible 1px border for WinUI inputs, in every state.
//
// The stock WASDK TextBox/ComboBox border is a near-invisible F2F2F2 at rest
// and flips to the accent colour on focus/hover. We set an explicit neutral
// gray 1px border on the control (local property values beat the implicit
// style's setters, so this sticks) and shadow the per-state brush/thickness
// theme resources on the control so the border stays gray in every state
// instead of turning blue.
#ifndef BK_BORDER_STATE_H
#define BK_BORDER_STATE_H

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <string>

namespace bk {

// `base_key` is the template resource prefix: L"TextControlBorder" for
// TextBox/PasswordBox/RichEditBox, L"ComboBoxBorder" for ComboBox.
inline void apply_default_border(
    winrt::Microsoft::UI::Xaml::Controls::Control box,
    const wchar_t* base_key = L"TextControlBorder") {
  try {
    const winrt::Microsoft::UI::Xaml::Media::SolidColorBrush neutral(
        winrt::Windows::UI::Color{255, 0x8A, 0x8A, 0x8A});
    const winrt::Microsoft::UI::Xaml::Thickness one{1, 1, 1, 1};
    box.BorderBrush(neutral);
    box.BorderThickness(one);
    box.CornerRadius(winrt::Microsoft::UI::Xaml::CornerRadius(0));
    // Keep the focus/hover states from repainting the border accent-blue.
    auto res = box.Resources();
    for (const wchar_t* state :
         {L"Focused", L"PointerOver", L"Pressed", L"Disabled"}) {
      res.Insert(
          winrt::box_value(winrt::hstring(
              std::wstring(base_key) + L"Brush" + state)),
          winrt::box_value(neutral));
      res.Insert(
          winrt::box_value(winrt::hstring(
              std::wstring(base_key) + L"ThemeThickness" + state)),
          winrt::box_value(one));
    }
  } catch (...) {
  }
}

} // namespace bk

#endif // BK_BORDER_STATE_H
