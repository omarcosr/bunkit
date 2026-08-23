// snapshot.cpp — render a XAML element to PNG, dump the visual tree, and find
// children spilling outside their parents.
//
// RenderTargetBitmap replays XAML composition the way cacheDisplayInRect:
// replays AppKit drawing — including the same blind spot: a SwapChainPanel's
// content is not part of it. bk_snapshot_view blocks the caller until the
// render completes; the awaits run on the UI thread, the wait happens on the
// Bun thread, so nobody deadlocks.
#include "common.h"
#include "registry.h"
#include "runtime.h"
#include "strings.h"

#include <windows.h>

#include <winrt/Microsoft.UI.Xaml.h>
#include <winrt/Microsoft.UI.Xaml.Controls.h>
#include <winrt/Microsoft.UI.Xaml.Media.h>
#include <winrt/Microsoft.UI.Xaml.Media.Imaging.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Imaging.h>
#include <winrt/Windows.Storage.Streams.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <future>
#include <memory>
#include <string>

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

winrt::Windows::Foundation::IInspectable element_of(bk_handle h) {
  auto* entry = bk::registry().get(h);
  return entry ? entry->object : nullptr;
}

// Render + encode on the UI thread as one coroutine; the Bun thread waits on
// this promise. fire_and_forget keeps exceptions from crossing the ABI.
winrt::fire_and_forget render_png(UIElement element,
                                  std::shared_ptr<std::promise<int32_t>> done,
                                  std::wstring path) {
  try {
    const auto width = static_cast<int32_t>(
        std::ceil(element.as<FrameworkElement>().ActualWidth()));
    const auto height = static_cast<int32_t>(
        std::ceil(element.as<FrameworkElement>().ActualHeight()));
    if (width < 1 || height < 1) {
      done->set_value(BK_INVALID_ARGUMENT);
      co_return;
    }
    winrt::Microsoft::UI::Xaml::Media::Imaging::RenderTargetBitmap bitmap;
    co_await bitmap.RenderAsync(element, width, height);
    auto pixels = co_await bitmap.GetPixelsAsync();

    winrt::Windows::Storage::Streams::InMemoryRandomAccessStream stream;
    auto encoder = co_await winrt::Windows::Graphics::Imaging::BitmapEncoder::CreateAsync(
        winrt::Windows::Graphics::Imaging::BitmapEncoder::PngEncoderId(), stream);
    encoder.SetPixelData(
        winrt::Windows::Graphics::Imaging::BitmapPixelFormat::Bgra8,
        winrt::Windows::Graphics::Imaging::BitmapAlphaMode::Premultiplied,
        static_cast<uint32_t>(bitmap.PixelWidth()),
        static_cast<uint32_t>(bitmap.PixelHeight()), 96.0, 96.0,
        std::vector<uint8_t>(pixels.data(),
                             pixels.data() + pixels.Length()));
    co_await encoder.FlushAsync();

    // Drain the stream back out into plain bytes.
    stream.Seek(0);
    winrt::Windows::Storage::Streams::DataReader reader(stream);
    co_await reader.LoadAsync(static_cast<uint32_t>(stream.Size()));
    auto bytes = reader.ReadBuffer(static_cast<uint32_t>(stream.Size()));
    std::vector<uint8_t> png(bytes.data(), bytes.data() + bytes.Length());

    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr,
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) {
      done->set_value(BK_ERROR);
      co_return;
    }
    DWORD written = 0;
    WriteFile(file, png.data(), static_cast<DWORD>(png.size()), &written,
              nullptr);
    CloseHandle(file);
    done->set_value(static_cast<int32_t>(written));
  } catch (...) {
    done->set_value(BK_ERROR);
  }
}

// Depth-first visual-tree walk. fn returns a string per element, or "".
std::string walk_tree(FrameworkElement root, int32_t depth,
                      std::string (*fn)(FrameworkElement, FrameworkElement, int32_t)) {
  std::string out;
  const auto count = Media::VisualTreeHelper::GetChildrenCount(root);
  for (int32_t i = 0; i < count; ++i) {
    auto child = Media::VisualTreeHelper::GetChild(root, i)
                     .try_as<FrameworkElement>();
    if (!child) continue;
    out += fn(child, root, depth);
    out += walk_tree(child, depth + 1, fn);
  }
  return out;
}

} // namespace

namespace {

std::string class_name_of(winrt::Windows::Foundation::IInspectable const& value) {
  try {
    return winrt::to_string(winrt::get_class_name(value));
  } catch (...) {
    return "Element";
  }
}

std::string describe_one(FrameworkElement child, FrameworkElement parent,
                         int32_t depth) {
  winrt::Windows::Foundation::Point offset{0, 0};
  try {
    offset = child.TransformToVisual(parent).TransformPoint({0.0f, 0.0f});
  } catch (...) {
    // Detached or not-yet-loaded elements have no transform.
  }
  char line[512];
  snprintf(line, sizeof(line), "%*s%s (%.0f,%.0f %.0fx%.0f)\n", depth * 2, "",
           class_name_of(child).c_str(),
           offset.X, offset.Y, child.ActualWidth(), child.ActualHeight());
  return line;
}

std::string layout_one(FrameworkElement child, FrameworkElement parent,
                       int32_t /*depth*/) {
  winrt::Windows::Foundation::Point offset{0, 0};
  try {
    offset = child.TransformToVisual(parent).TransformPoint({0.0f, 0.0f});
  } catch (...) {
    return "";
  }
  const double pw = parent.ActualWidth(), ph = parent.ActualHeight();
  std::string detail;
  const auto over = [&](double px, const char* what) {
    char buf[64];
    snprintf(buf, sizeof(buf), "%.1fpx past the %s", px, what);
    if (!detail.empty()) detail += ", ";
    detail += buf;
  };
  if (offset.X < -0.5) over(-offset.X, "left");
  if (offset.Y < -0.5) over(-offset.Y, "top");
  if (offset.X + child.ActualWidth() > pw + 0.5)
    over(offset.X + child.ActualWidth() - pw, "right");
  if (offset.Y + child.ActualHeight() > ph + 0.5)
    over(offset.Y + child.ActualHeight() - ph, "bottom");
  if (detail.empty()) return "";
  return class_name_of(child) + std::string("\x1f") +
         class_name_of(parent) + std::string("\x1f") + detail +
         std::string("\n");
}

template <typename F>
int32_t collect(bk_handle root, F produce, std::string* out) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  int32_t st = BK_ERROR;
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto object = element_of(root);
    if (!object) { st = BK_INVALID_HANDLE; return; }
    FrameworkElement start{nullptr};
    // A Window handle maps to its content, like macOS' contentView.
    if (auto win = object.try_as<Window>()) {
      auto content = win.Content();
      if (!content) { st = BK_ERROR; return; }
      start = content.as<FrameworkElement>();
    } else {
      start = object.as<FrameworkElement>();
    }
    *out = produce(start);
    st = BK_OK;
  });
  return rc == BK_OK ? st : rc;
}

} // namespace

extern "C" {

BK_EXPORT int32_t bk_snapshot_view(bk_handle element, const char* path,
                                   uint32_t path_len) {
  if (require_running() != BK_OK) return BK_NOT_INITIALIZED;
  if (!path || path_len == 0) return BK_INVALID_ARGUMENT;
  const std::wstring wide(winrt::to_hstring(std::string(path, path_len)));

  auto done = std::make_shared<std::promise<int32_t>>();
  auto future = done->get_future();
  const int32_t rc = bk::Runtime::instance().dispatch_sync([&] {
    auto object = element_of(element);
    if (!object) {
      done->set_value(BK_INVALID_HANDLE);
      return;
    }
    if (auto win = object.try_as<Window>()) {
      auto content = win.Content();
      if (!content) { done->set_value(BK_ERROR); return; }
      render_png(content.as<UIElement>(), done, wide);
      return;
    }
    render_png(object.as<UIElement>(), done, wide);
  });
  if (rc != BK_OK) return rc;
  return future.get();
}


BK_EXPORT uint32_t bk_describe_length(bk_handle element) {
  std::string out;
  if (collect(element,
              [](FrameworkElement start) {
                char header[512];
                snprintf(header, sizeof(header), "%s (%.0fx%.0f)\n",
                         class_name_of(start).c_str(),
                         start.ActualWidth(), start.ActualHeight());
                return header + walk_tree(start, 1, describe_one);
              },
              &out) != BK_OK) {
    return 0;
  }
  return static_cast<uint32_t>(out.size() + 1);
}

BK_EXPORT int32_t bk_describe_copy(bk_handle element, char* buffer,
                                   uint32_t capacity) {
  std::string out;
  const int32_t rc = collect(element,
                             [](FrameworkElement start) {
                               char header[512];
                               snprintf(header, sizeof(header), "%s (%.0fx%.0f)\n",
                                        class_name_of(start).c_str(),
                                        start.ActualWidth(), start.ActualHeight());
                               return header + walk_tree(start, 1, describe_one);
                             },
                             &out);
  if (rc != BK_OK) return rc;
  if (!buffer || capacity <= out.size()) return BK_BUFFER_TOO_SMALL;
  memcpy(buffer, out.data(), out.size());
  buffer[out.size()] = '\0';
  return static_cast<int32_t>(out.size() + 1);
}

BK_EXPORT uint32_t bk_check_layout_length(bk_handle root) {
  std::string out;
  if (collect(root,
              [](FrameworkElement start) {
                return walk_tree(start, 0, layout_one);
              },
              &out) != BK_OK) {
    return 0;
  }
  return static_cast<uint32_t>(out.size() + 1);
}

BK_EXPORT int32_t bk_check_layout_copy(bk_handle root, char* buffer,
                                       uint32_t capacity) {
  std::string out;
  const int32_t rc = collect(root,
                             [](FrameworkElement start) {
                               return walk_tree(start, 0, layout_one);
                             },
                             &out);
  if (rc != BK_OK) return rc;
  if (!buffer || capacity <= out.size()) return BK_BUFFER_TOO_SMALL;
  memcpy(buffer, out.data(), out.size());
  buffer[out.size()] = '\0';
  return static_cast<int32_t>(out.size() + 1);
}

} // extern "C"
