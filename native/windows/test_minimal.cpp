#include "bridge/src/bootstrap_config.h"
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Microsoft.UI.Dispatching.h>
#include <windows.h>
#include <iostream>

struct TestApp : winrt::Microsoft::UI::Xaml::ApplicationT<TestApp> {
  void OnLaunched(winrt::Microsoft::UI::Xaml::LaunchActivatedEventArgs const&) {
    try { Resources().MergedDictionaries().Append(winrt::Microsoft::UI::Xaml::Controls::XamlControlsResources()); } catch (...) {}
    auto dq = winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread();
    std::cout << "OnLaunched dq=" << (dq ? "ok" : "null") << std::endl;
    // keep dispatcher alive
  }
};

int main() {
  std::cout << "bootstrap..." << std::endl;
  HRESULT hr = MddBootstrapInitialize2(WINDOWSAPPSDK_RELEASE_MAJORMINOR, WINDOWSAPPSDK_RELEASE_VERSION_TAG_W, ::Microsoft::Windows::ApplicationModel::PackageVersion(uint64_t{0}), MddBootstrapInitializeOptions_OnNoMatch_ShowUI);
  std::cout << "bootstrap hr=0x" << std::hex << hr << std::dec << std::endl;
  if (FAILED(hr)) return 1;

  winrt::init_apartment(winrt::apartment_type::single_threaded);
  std::cout << "STA init" << std::endl;

  winrt::Microsoft::UI::Xaml::Application::Start([](auto&&) {
    std::cout << "Start callback" << std::endl;
    auto app = winrt::make<TestApp>();
    std::cout << "app made" << std::endl;
    // create window with textbox on UI thread via dispatcher
    auto dq = winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread();
    dq.TryEnqueue([]{
      try {
        std::cout << "creating window+textbox no spellcheck" << std::endl;
        winrt::Microsoft::UI::Xaml::Window w;
        winrt::Microsoft::UI::Xaml::Controls::TextBox tb;
        tb.IsSpellCheckEnabled(false);
        tb.IsTextPredictionEnabled(false);
        tb.Text(L"hello");
        w.Content(tb);
        w.Activate();
        std::cout << "window activated with textbox no spellcheck" << std::endl;
        // keep window alive via static? leak for test
        static auto keep = w;
        (void)keep;
      } catch (winrt::hresult_error const& e) {
        std::cout << "hresult_error: " << winrt::to_string(e.message()) << " 0x" << std::hex << e.code() << std::dec << std::endl;
      } catch (std::exception const& e) {
        std::cout << "std exc: " << e.what() << std::endl;
      }
    });
  });

  std::cout << "Start returned" << std::endl;
  MddBootstrapShutdown();
  return 0;
}

