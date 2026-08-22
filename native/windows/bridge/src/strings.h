// strings.h — UTF-8 <-> winrt::hstring at the ABI edge.
#ifndef BK_STRINGS_H
#define BK_STRINGS_H

#include <string>
#include <winrt/base.h>

namespace bk {

inline winrt::hstring utf8_to_hstring(const char* data, uint32_t length) {
  if (!data || length == 0) return winrt::hstring{};
  return winrt::to_hstring(std::string_view{data, length});
}

inline std::string hstring_to_utf8(winrt::hstring const& value) {
  return winrt::to_string(value);
}

} // namespace bk

#endif // BK_STRINGS_H
