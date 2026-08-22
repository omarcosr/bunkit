// dialogs.cpp — alert / prompt / file-open as async ContentDialogs and pickers.
//
// Never blocking: each call lands on the UI thread, shows the dialog with
// ShowAsync/PickAsync, and the completion handler pushes a BK_EVT_DIALOG_RESULT
// or BK_EVT_FILE_RESULT whose `target` is the caller-minted dialog id. The
// dialog objects live exactly as long as the completion lambda that captures
// them, so no registry entry is needed.
#include "common.h"
#include "events.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <windows.h>

#include <vector>

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Controls.Primitives.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Storage.Pickers.h>
#include <winrt/Windows.Storage.h>
#include <Shobjidl.h>
#include <microsoft.ui.xaml.window.h>

using namespace winrt::Microsoft::UI::Xaml;
namespace cx = winrt::Microsoft::UI::Xaml::Controls;

namespace {

constexpr char kCfg = '\x1e'; // config field separator

std::vector<std::string> split(const std::string& s, char sep) {
  std::vector<std::string> out;
  size_t start = 0;
  while (start <= s.size()) {
    const size_t end = s.find(sep, start);
    out.push_back(s.substr(start, end == std::string::npos ? end : end - start));
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return out;
}

int32_t require_running() {
  if (!bk::Runtime::instance().running()) {
    bk::set_last_error("runtime not initialized (call bk_runtime_init first)");
    return BK_NOT_INITIALIZED;
  }
  return BK_OK;
}

void push_dialog_event(uint64_t dialog_id, uint16_t type, int64_t button,
                       int64_t suppressed, std::string payload = {}) {
  bk::Event ev;
  ev.header.type = type;
  ev.header.target = dialog_id;
  ev.header.value1 = button;
  ev.header.value2 = suppressed;
  ev.payload = std::move(payload);
  bk::event_queue().push(std::move(ev));
}

XamlRoot root_of(bk_handle window) {
  auto* entry = bk::registry().get(window);
  if (!entry || entry->type != bk::NativeType::Window || !entry->object) {
    return nullptr;
  }
  auto content = entry->object.as<Window>().Content();
  return content ? content.XamlRoot() : nullptr;
}

} // namespace

extern "C" {

// cfg: title<RS>message<RS>button0<RS>button1<RS>button2<RS>suppressible(0/1)
BK_EXPORT int32_t bk_dialog_alert(bk_handle window, const char* cfg,
                                  uint32_t cfg_len, uint64_t dialog_id) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string raw = cfg && cfg_len ? std::string(cfg, cfg_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    const auto fields = split(raw, kCfg);
    if (fields.empty()) { st = BK_INVALID_ARGUMENT; return; }
    const XamlRoot root = root_of(window);
    if (!root) {
      bk::set_last_error("dialog needs a window with content");
      st = BK_ERROR;
      return;
    }

    cx::ContentDialog dialog;
    dialog.XamlRoot(root);
    dialog.Title(winrt::box_value(bk::utf8_to_hstring(
        fields[0].data(), static_cast<uint32_t>(fields[0].size()))));

    cx::StackPanel body;
    body.Spacing(12);
    if (fields.size() > 1 && !fields[1].empty()) {
      auto message = cx::TextBlock();
      message.Text(bk::utf8_to_hstring(fields[1].data(),
                                       static_cast<uint32_t>(fields[1].size())));
      message.TextWrapping(TextWrapping::Wrap);
      body.Children().Append(message);
    }
    const bool suppressible = fields.size() > 5 && fields[5] == "1";
    cx::CheckBox suppression;
    if (suppressible) {
      suppression.Content(winrt::box_value(L"Don't ask again"));
      body.Children().Append(suppression);
    }
    if (body.Children().Size() > 0) dialog.Content(body);

    // ContentDialog offers exactly three slots; extra buttons are dropped.
    if (fields.size() > 2 && !fields[2].empty())
      dialog.PrimaryButtonText(bk::utf8_to_hstring(
          fields[2].data(), static_cast<uint32_t>(fields[2].size())));
    if (fields.size() > 3 && !fields[3].empty())
      dialog.SecondaryButtonText(bk::utf8_to_hstring(
          fields[3].data(), static_cast<uint32_t>(fields[3].size())));
    if (fields.size() > 4 && !fields[4].empty())
      dialog.CloseButtonText(bk::utf8_to_hstring(
          fields[4].data(), static_cast<uint32_t>(fields[4].size())));
    else if (!dialog.PrimaryButtonText().empty())
      dialog.CloseButtonText(L"");

    auto op = dialog.ShowAsync();
    op.Completed([dialog, suppression, suppressible, dialog_id](
                     winrt::Windows::Foundation::IAsyncOperation<
                         cx::ContentDialogResult> const& op,
                     winrt::Windows::Foundation::AsyncStatus) {
      int64_t button = -1;
      try {
        const auto r = op.GetResults();
        if (r == cx::ContentDialogResult::Primary) button = 0;
        else if (r == cx::ContentDialogResult::Secondary) button = 1;
        else button = 2;
      } catch (...) {
      }
      const int64_t suppressed =
          suppressible && suppression.IsChecked().GetBoolean() ? 1 : 0;
      push_dialog_event(dialog_id, BK_EVT_DIALOG_RESULT, button, suppressed);
    });
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}

// cfg: title<RS>message<RS>placeholder<RS>initial value
BK_EXPORT int32_t bk_dialog_prompt(bk_handle window, const char* cfg,
                                   uint32_t cfg_len, uint64_t dialog_id) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string raw = cfg && cfg_len ? std::string(cfg, cfg_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    const auto fields = split(raw, kCfg);
    if (fields.empty()) { st = BK_INVALID_ARGUMENT; return; }
    const XamlRoot root = root_of(window);
    if (!root) {
      bk::set_last_error("dialog needs a window with content");
      st = BK_ERROR;
      return;
    }

    cx::ContentDialog dialog;
    dialog.XamlRoot(root);
    dialog.Title(winrt::box_value(bk::utf8_to_hstring(
        fields[0].data(), static_cast<uint32_t>(fields[0].size()))));
    dialog.PrimaryButtonText(L"OK");
    dialog.CloseButtonText(L"Cancel");

    cx::StackPanel body;
    body.Spacing(12);
    if (fields.size() > 1 && !fields[1].empty()) {
      auto message = cx::TextBlock();
      message.Text(bk::utf8_to_hstring(fields[1].data(),
                                       static_cast<uint32_t>(fields[1].size())));
      message.TextWrapping(TextWrapping::Wrap);
      body.Children().Append(message);
    }
    cx::TextBox input;
    if (fields.size() > 2 && !fields[2].empty()) {
      input.PlaceholderText(bk::utf8_to_hstring(
          fields[2].data(), static_cast<uint32_t>(fields[2].size())));
    }
    if (fields.size() > 3 && !fields[3].empty()) {
      input.Text(bk::utf8_to_hstring(fields[3].data(),
                                     static_cast<uint32_t>(fields[3].size())));
    }
    body.Children().Append(input);
    dialog.Content(body);

    auto op = dialog.ShowAsync();
    op.Completed([dialog, input, dialog_id](
                     winrt::Windows::Foundation::IAsyncOperation<
                         cx::ContentDialogResult> const& op,
                     winrt::Windows::Foundation::AsyncStatus) {
      bool ok = false;
      std::string text;
      try {
        ok = op.GetResults() == cx::ContentDialogResult::Primary;
        text = bk::hstring_to_utf8(input.Text());
      } catch (...) {
      }
      push_dialog_event(dialog_id, BK_EVT_DIALOG_RESULT, ok ? 0 : -1, 0, text);
    });
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}

BK_EXPORT int32_t bk_file_open(bk_handle window, const char* title,
                               uint32_t title_len, int32_t multiple,
                               uint64_t dialog_id) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  const std::string t = title && title_len ? std::string(title, title_len) : "";
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    winrt::Windows::Storage::Pickers::FileOpenPicker picker;
    picker.FileTypeFilter().Append(L"*");
    (void)t; // the picker has no title property; nothing to map it onto

    // Desktop pickers refuse to show on WinUI 3 without an owner window.
    if (auto* entry = bk::registry().get(window)) {
      try {
        HWND hwnd{};
        entry->object.as<Window>().as<::IWindowNative>()->get_WindowHandle(&hwnd);
        if (hwnd) picker.as<::IInitializeWithWindow>()->Initialize(hwnd);
      } catch (...) {
        // Best effort: picker may still show if the shell is lenient.
      }
    }

    using StorageFile = winrt::Windows::Storage::StorageFile;
    using SingleOp = winrt::Windows::Foundation::IAsyncOperation<StorageFile>;
    using MultiOp = winrt::Windows::Foundation::IAsyncOperation<
        winrt::Windows::Foundation::Collections::IVectorView<StorageFile>>;
    auto finish = [dialog_id](std::string paths) {
      push_dialog_event(dialog_id, BK_EVT_FILE_RESULT,
                        paths.empty() ? 0 : 1, 0, paths);
    };
    if (multiple) {
      picker.PickMultipleFilesAsync().Completed(
          [finish](MultiOp const& op,
                   winrt::Windows::Foundation::AsyncStatus) {
            std::string paths;
            try {
              for (auto&& file : op.GetResults()) {
                if (!paths.empty()) paths += '\n';
                paths += bk::hstring_to_utf8(file.Path());
              }
            } catch (...) {
            }
            finish(std::move(paths));
          });
    } else {
      picker.PickSingleFileAsync().Completed(
          [finish](SingleOp const& op,
                   winrt::Windows::Foundation::AsyncStatus) {
            std::string paths;
            try {
              if (auto file = op.GetResults()) {
                paths = bk::hstring_to_utf8(file.Path());
              }
            } catch (...) {
            }
            finish(std::move(paths));
          });
    }
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}

BK_EXPORT int32_t bk_beep(void) {
  MessageBeep(MB_ICONASTERISK);
  return BK_OK;
}

} // extern "C"
