#include "common.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Markup.h>
#include <winrt/Microsoft.UI.Text.h>
#include <winrt/Windows.Foundation.Collections.h>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;

extern "C" {
BK_EXPORT bk_handle bk_debug_window_with_textbox(const char* text, uint32_t len) {
  if (!bk::Runtime::instance().running()) return 0;
  std::string t = (text && len) ? std::string(text, len) : std::string();
  bk_handle out = 0;
  bk::Runtime::instance().dispatch_sync([&]{
    Window w;
    cx::TextBox tb;
    try { tb.IsSpellCheckEnabled(false); tb.IsTextPredictionEnabled(false); } catch(...){}
    tb.Text(winrt::hstring(L"hello bg"));
    w.Content(tb);
    w.Activate();
    out = bk::registry().add(bk::NativeType::Window, w);
  });
  return out;
}
BK_EXPORT bk_handle bk_debug_window_with_richedit(const char* text, uint32_t len) {
  if (!bk::Runtime::instance().running()) return 0;
  std::string t = (text && len) ? std::string(text, len) : std::string();
  bk_handle out = 0;
  bk::Runtime::instance().dispatch_sync([&]{
    Window w;
    cx::RichEditBox re;
    if (!t.empty()) {
      winrt::hstring h = bk::utf8_to_hstring(t.data(), (uint32_t)t.size());
      re.Document().SetText(winrt::Microsoft::UI::Text::TextSetOptions::None, h);
    }
    w.Content(re);
    w.Activate();
    out = bk::registry().add(bk::NativeType::Window, w);
    auto rh = bk::registry().add(bk::NativeType::TextBox, re.as<winrt::Windows::Foundation::IInspectable>());
    (void)rh;
  });
  return out;
}
BK_EXPORT bk_handle bk_debug_window_with_xaml_textbox(const char* text, uint32_t len) {
  if (!bk::Runtime::instance().running()) return 0;
  bk_handle out = 0;
  bk::Runtime::instance().dispatch_sync([&]{
    Window w;
    // Use XamlReader to let the parser resolve the default style via Application resources
    auto xaml = winrt::hstring(L"<TextBox xmlns=\"http://schemas.microsoft.com/winfx/2006/xaml/presentation\" Text=\"hello\" />");
    auto obj = winrt::Microsoft::UI::Xaml::Markup::XamlReader::Load(xaml);
    auto tb = obj.as<cx::TextBox>();
    w.Content(tb);
    w.Activate();
    out = bk::registry().add(bk::NativeType::Window, w);
    auto th = bk::registry().add(bk::NativeType::TextBox, tb.as<winrt::Windows::Foundation::IInspectable>());
    (void)th;
  });
  return out;
}
}
