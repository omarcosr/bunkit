#include "bridge/src/bootstrap_config.h"
#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Microsoft.UI.Dispatching.h>
#include <windows.h>
#include <iostream>
#include <thread>
#include <future>

struct BgApp : winrt::Microsoft::UI::Xaml::ApplicationT<BgApp> {
  BgApp(std::promise<void>* p) : promise_(p) {}
  void OnLaunched(winrt::Microsoft::UI::Xaml::LaunchActivatedEventArgs const&) {
    try { Resources().MergedDictionaries().Append(winrt::Microsoft::UI::Xaml::Controls::XamlControlsResources()); } catch(...) {}
    auto dq = winrt::Microsoft::UI::Dispatching::DispatcherQueue::GetForCurrentThread();
    std::cout << "BgApp OnLaunched dq=" << (dq ? "ok" : "null") << std::endl;
    dq.TryEnqueue([this]{
      try {
        std::cout << "creating window+textbox on bg thread" << std::endl;
        winrt::Microsoft::UI::Xaml::Window w;
        winrt::Microsoft::UI::Xaml::Controls::TextBox tb;
        tb.IsSpellCheckEnabled(false);
        tb.IsTextPredictionEnabled(false);
        tb.Text(L"hello bg");
        w.Content(tb);
        w.Activate();
        std::cout << "window activated bg" << std::endl;
        static auto keep = w;
        (void)keep;
        promise_->set_value();
      } catch (winrt::hresult_error const& e) {
        std::cout << "hresult_error bg: " << winrt::to_string(e.message()) << std::endl;
        promise_->set_value();
      }
    });
  }
  std::promise<void>* promise_;
};

int main() {
  std::cout << "bg test bootstrap..." << std::endl;
  HRESULT hr = MddBootstrapInitialize2(WINDOWSAPPSDK_RELEASE_MAJORMINOR, WINDOWSAPPSDK_RELEASE_VERSION_TAG_W, ::Microsoft::Windows::ApplicationModel::PackageVersion(uint64_t{0}), MddBootstrapInitializeOptions_OnNoMatch_ShowUI);
  std::cout << "hr=0x" << std::hex << hr << std::dec << std::endl;
  std::promise<void> launched;
  auto fut = launched.get_future();
  std::thread ui([&]{
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    winrt::Microsoft::UI::Xaml::Application::Start([&](auto&&){
      auto app = winrt::make<BgApp>(&launched);
      std::cout << "bg app made" << std::endl;
    });
    std::cout << "bg Start returned" << std::endl;
    winrt::uninit_apartment();
  });
  if (fut.wait_for(std::chrono::seconds(5)) == std::future_status::timeout) {
    std::cout << "timeout waiting for window" << std::endl;
  } else {
    std::cout << "window created, waiting 4s" << std::endl;
    std::this_thread::sleep_for(std::chrono::seconds(4));
    std::cout << "ALIVE_bg" << std::endl;
  }
  // need to exit app
  ui.detach();
  std::cout << "EXIT_bg_test" << std::endl;
  MddBootstrapShutdown();
  return 0;
}
