// runtime.h — owns the WinUI STA thread and the Bun -> UI dispatch path.
#ifndef BK_RUNTIME_H
#define BK_RUNTIME_H

#include "common.h"
#include "registry.h"
#include <atomic>
#include <functional>
#include <future>
#include <thread>

#include <winrt/Microsoft.UI.Dispatching.h>
#include <winrt/Microsoft.UI.Xaml.h>

namespace bk {

struct BunKitApplication;
class Runtime {
public:
  static Runtime& instance();

  // Bootstrap WASDK, spawn the STA thread, wait for Application::Start to
  // reach OnLaunched. Idempotent.
  int32_t init();
  // Reverse everything init() did, in order. Idempotent.
  int32_t shutdown();
  bool running() const { return initialized_; }

  // Bun thread -> WinUI thread. Errors inside fn never propagate; they land in
  // report_native_exception().
  void dispatch_async(std::function<void()>&& fn);

  // Bun thread -> WinUI thread, blocking until done. Runs inline when called
  // from the UI thread itself. Returns BK_DISPATCH_FAILED instead of hanging
  // when the dispatcher is gone.
  int32_t dispatch_sync(std::function<void()> fn);

  void report_native_exception(const char* context);

private:
  friend struct BunKitApplication;
  Runtime() = default;

  void ui_main();

  // Called by BunKitApplication::OnLaunched on the UI thread.
  void on_ui_ready(winrt::Microsoft::UI::Dispatching::DispatcherQueue dq);

  std::thread ui_thread_;
  std::thread::id ui_tid_{};
  winrt::Microsoft::UI::Dispatching::DispatcherQueue dispatcher_{nullptr};
  std::shared_ptr<std::promise<int32_t>> ready_;
  std::atomic<bool> initialized_{false};
  std::atomic<bool> bootstrap_up_{false};
};

} // namespace bk

#endif // BK_RUNTIME_H
