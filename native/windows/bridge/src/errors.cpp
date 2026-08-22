// errors.cpp — per-thread last-error storage backing bk_copy_last_error().
//
// Storage lives in TLS owned by this DLL, so the pointer Bun hands us never
// needs to be freed and can never dangle across threads.
#include "common.h"

namespace {
thread_local std::string t_last_error;
} // namespace

namespace bk {

void set_last_error(std::string message) { t_last_error = std::move(message); }

void log_line(const char* line) {
#ifdef BK_DEBUG_LOG
  OutputDebugStringA("[BunKit WinUI] ");
  OutputDebugStringA(line);
  OutputDebugStringA("\n");
#else
  (void)line;
#endif
}

} // namespace bk

// --- exported ---------------------------------------------------------------

BK_EXPORT uint32_t bk_last_error_length(void) {
  return static_cast<uint32_t>(t_last_error.size());
}

BK_EXPORT int32_t bk_copy_last_error(char* buffer, uint32_t capacity) {
  if (buffer == nullptr && capacity > 0) return BK_INVALID_ARGUMENT;
  const uint32_t needed = static_cast<uint32_t>(t_last_error.size());
  if (needed == 0) {
    if (buffer != nullptr && capacity > 0) buffer[0] = '\0';
    return BK_OK;
  }
  // Returned value is the number of bytes copied INCLUDING the NUL, so a
  // caller that passes capacity == length() still gets a truncated but
  // terminated string plus an honest signal to retry with a larger buffer.
  const uint32_t copy = (capacity > needed) ? needed : (capacity ? capacity - 1 : 0);
  if (buffer == nullptr || capacity == 0) return static_cast<int32_t>(needed) + 1;
  memcpy(buffer, t_last_error.data(), copy);
  buffer[copy] = '\0';
  if (needed >= capacity) return static_cast<int32_t>(needed) + 1;
  return static_cast<int32_t>(copy) + 1;
}
