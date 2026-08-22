// application.h — the Application-derived class WinUI requires.
//
// Application::Start needs *an* Application instance; we have no XAML compiler
// and no VS template, so this is declared by hand. All real work happens in
// OnLaunched: capture the thread's DispatcherQueue, publish it to Runtime and
// release the waiting Bun thread. Start keeps pumping until Exit().
#ifndef BK_APPLICATION_H
#define BK_APPLICATION_H

#include "runtime.h"
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Markup.h>
#include <winrt/Microsoft.UI.Xaml.XamlTypeInfo.h>
#include <winrt/Windows.Foundation.Collections.h>

namespace bk {

struct BunKitApplication
    : winrt::Microsoft::UI::Xaml::ApplicationT<
          BunKitApplication,
          winrt::Microsoft::UI::Xaml::Markup::IXamlMetadataProvider> {
  explicit BunKitApplication(Runtime* runtime) : runtime_(runtime) {}

  void OnLaunched(winrt::Microsoft::UI::Xaml::LaunchActivatedEventArgs const&) {
    try {
      winrt::Microsoft::UI::Xaml::XamlTypeInfo::XamlControlsXamlMetaDataProvider::Initialize();
    } catch (...) {
    }
    try {
      Resources().MergedDictionaries().Append(
          winrt::Microsoft::UI::Xaml::Controls::XamlControlsResources());
    } catch (...) {
    }
    auto dq =
        winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread();
    if (!dq) {
      set_last_error("OnLaunched: no DispatcherQueue on the UI thread");
    }
    runtime_->on_ui_ready(std::move(dq));
  }

  winrt::Microsoft::UI::Xaml::Markup::IXamlType GetXamlType(
      winrt::Windows::UI::Xaml::Interop::TypeName const& type) {
    return m_provider.GetXamlType(type);
  }
  winrt::Microsoft::UI::Xaml::Markup::IXamlType GetXamlType(
      winrt::hstring const& fullName) {
    return m_provider.GetXamlType(fullName);
  }
  winrt::com_array<winrt::Microsoft::UI::Xaml::Markup::XmlnsDefinition>
  GetXmlnsDefinitions() {
    return m_provider.GetXmlnsDefinitions();
  }

private:
  Runtime* runtime_;
  winrt::Microsoft::UI::Xaml::XamlTypeInfo::XamlControlsXamlMetaDataProvider
      m_provider;
};

} // namespace bk

#endif // BK_APPLICATION_H
