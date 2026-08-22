// runtime.cpp — WASDK bootstrap, the STA UI thread, and dispatch helpers.
#include "runtime.h"
#include "application.h"
#include "bootstrap_config.h"
#include <windows.h>

namespace {
// The Application instance Start creates; needed later for Exit(). Static
// WinRT object refs here are fine: they are released before DllMain teardown
// via runtime_shutdown().
winrt::Microsoft::UI::Xaml::Application g_app{nullptr};
}

namespace bk {

Runtime& Runtime::instance() {
  static Runtime rt;
  return rt;
}

void Runtime::report_native_exception(const char* context) {
  try { throw; }
  catch (const winrt::hresult_error& e) {
    set_last_error(std::string(context) + ": HRESULT 0x" +
                   [](uint32_t v) {
                     char b[16]; sprintf_s(b, "%08X", v); return std::string(b);
                   }((uint32_t)e.code().value) + " - " +
                   winrt::to_string(e.message()));
  } catch (const std::exception& e) {
    set_last_error(std::string(context) + ": " + e.what());
  } catch (...) {
    set_last_error(std::string(context) + ": unknown exception");
  }
}

void Runtime::on_ui_ready(winrt::Microsoft::UI::Dispatching::DispatcherQueue dq) {
  dispatcher_ = std::move(dq);
  ui_tid_ = std::this_thread::get_id();
  initialized_ = true;
  log_line("DispatcherQueue ready");
  if (ready_) {
    ready_->set_value(BK_OK);
    ready_.reset();
  }
}

int32_t Runtime::init() {
  if (initialized_) return BK_OK;

  // Bootstrap Windows App SDK for this (unpackaged) process. Done on the
  // calling thread: MddBootstrapInitialize2 has no apartment requirement.
  HRESULT hr = MddBootstrapInitialize2(
      WINDOWSAPPSDK_RELEASE_MAJORMINOR,
      WINDOWSAPPSDK_RELEASE_VERSION_TAG_W,
      ::Microsoft::Windows::ApplicationModel::PackageVersion(uint64_t{0}),
      MddBootstrapInitializeOptions_OnPackageIdentity_NOOP);
  if (FAILED(hr)) {
    // Self-contained fallback: if the framework DLLs were unpacked next to
    // the exe (dist/ self-contained), LoadLibrary will find them without a
    // registered package. Try that before failing.
    HMODULE h = LoadLibraryW(L"Microsoft.WindowsAppRuntime.dll");
    if (h) {
      hr = S_OK;
      bootstrap_up_ = false;
      log_line("WASDK bootstrap fallback: loaded local Microsoft.WindowsAppRuntime.dll");
    } else {
      set_last_error("MddBootstrapInitialize2 failed: HRESULT 0x" +
                     [hr] { char b[16]; sprintf_s(b, "%08lX", hr); return std::string(b); }() +
                     " - is the Windows App SDK runtime installed? (dist should contain the framework DLLs for self-contained)");
      return BK_ERROR;
    }
  } else {
    bootstrap_up_ = true;
    log_line("WASDK bootstrap OK");
  }

  ready_ = std::make_shared<std::promise<int32_t>>();
  auto ready = ready_;

  try {
    ui_thread_ = std::thread([this] { ui_main(); });
  } catch (const std::system_error& e) {
    set_last_error(std::string("failed to start UI thread: ") + e.what());
    ready_.reset();
    bootstrap_up_ = false;
    MddBootstrapShutdown();
    return BK_ERROR;
  }

  // OnLaunched signals us once XAML is up. Generous timeout: first launch of
  // the framework can take a while on cold machines.
  auto future = ready->get_future();
  auto status = future.wait_for(std::chrono::seconds(30));
  if (status != std::future_status::ready) {
    set_last_error("bk_runtime_init timed out waiting for the WinUI thread");
    return BK_ERROR;
  }
  int32_t rc = future.get();
  if (rc != BK_OK) {
    set_last_error("WinUI initialization failed on the UI thread");
    return rc;
  }
  if (!dispatcher_) {
    initialized_ = false;
    return BK_ERROR;
  }
  return BK_OK;
}

void Runtime::ui_main() {
  try {
    winrt::init_apartment(winrt::apartment_type::single_threaded);
    SetUnhandledExceptionFilter([](EXCEPTION_POINTERS* ep) -> LONG {
      char buf[512];
      sprintf_s(buf, "UI thread exception 0x%08X at %p",
                ep->ExceptionRecord->ExceptionCode, ep->ExceptionRecord->ExceptionAddress);
      bk::set_last_error(buf);
      OutputDebugStringA(buf);
      OutputDebugStringA("\n");
      return EXCEPTION_EXECUTE_HANDLER;
    });

    winrt::Microsoft::UI::Xaml::Application::Start([](auto&&) {
      g_app = winrt::make<BunKitApplication>(&Runtime::instance());
    });

    // Start() returns after Exit(); unwind the apartment and let join() reap.
    g_app = nullptr;
    winrt::clear_factory_cache();
    winrt::uninit_apartment();
    initialized_ = false;
    log_line("UI thread exiting normally");
  } catch (...) {
    initialized_ = false;
    report_native_exception("ui_main");
    if (ready_) {
      ready_->set_value(BK_ERROR);
      ready_.reset();
    }
  }
}

int32_t Runtime::shutdown() {
  const bool wasRunning = initialized_.exchange(false);
  if (!wasRunning && !ui_thread_.joinable()) return BK_OK;

  // dispatch_sync is gated on initialized_, which is already down, so post
  // the exit item directly. Required order per spec §46: refuse new work,
  // tear down UI objects on their own thread, Exit() unwinds Start, join,
  // bootstrap off.
  auto dispatcher = dispatcher_;
  std::promise<void> exited;
  auto future = exited.get_future();
  bool posted = false;
  if (dispatcher) {
    posted = dispatcher.TryEnqueue([this, &exited]() {
      if (g_app) {
        try {
          g_app.Exit();
        } catch (...) {
          report_native_exception("Application::Exit");
        }
      }
      exited.set_value();
    });
  }

  if (posted) {
    if (future.wait_for(std::chrono::seconds(10)) == std::future_status::timeout) {
      set_last_error("shutdown: UI thread ignored Application::Exit");
      return BK_ERROR;
    }
  } else {
    // Queue gone (crash or early teardown); the thread should unwind alone.
    log_line("shutdown: no live dispatcher, waiting for raw exit");
  }

  if (ui_thread_.joinable()) ui_thread_.join();
  dispatcher_ = nullptr;
  // MddBootstrapShutdown intentionally omitted for process-exit path:
  // calling it after Application::Exit on the same thread that just
  // unwound XAML can race with still-alive COM references and has been
  // observed to segfault (0xC0000005) on window-close via X.
  // The OS reclaims the package graph on process termination; for
  // bun build --compile the same applies. Keep the flag for idempotency.
  bootstrap_up_.exchange(false);
  log_line("runtime shut down");
  return BK_OK;
}

void Runtime::dispatch_async(std::function<void()>&& fn) {
  if (!initialized_) {
    set_last_error("dispatch_async called before bk_runtime_init");
    return;
  }
  // Shared holder keeps the task copyable into the const-called delegate.
  auto task = std::make_shared<std::function<void()>>(std::move(fn));
  const bool accepted = dispatcher_.TryEnqueue([task]() {
    try {
      (*task)();
    } catch (...) {
      Runtime::instance().report_native_exception("dispatch_async work item");
    }
  });
  if (!accepted) {
    set_last_error("DispatcherQueue rejected the work item (shutting down?)");
  }
}

int32_t Runtime::dispatch_sync(std::function<void()> fn) {
  if (!initialized_) return BK_NOT_INITIALIZED;
  // Re-entrancy guard: running inline avoids a guaranteed deadlock when a
  // dispatch_sync happens from inside a UI callback.
  if (std::this_thread::get_id() == ui_tid_) {
    try {
      fn();
      return BK_OK;
    } catch (...) {
      report_native_exception("dispatch_sync inline");
      return BK_ERROR;
    }
  }
  std::promise<void> done;
  auto future = done.get_future();
  std::exception_ptr captured{nullptr};
  const bool accepted = dispatcher_.TryEnqueue([&]() {
    try {
      fn();
    } catch (...) {
      captured = std::current_exception();
    }
    done.set_value();
  });
  if (!accepted) return BK_DISPATCH_FAILED;

  future.wait();
  if (captured) {
    try { std::rethrow_exception(captured); }
    catch (...) { report_native_exception("dispatch_sync work item"); }
    return BK_ERROR;
  }
  return BK_OK;
}

} // namespace bk
