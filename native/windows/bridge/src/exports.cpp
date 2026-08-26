// exports.cpp — C ABI entry points. Every export catches everything; no C++
// exception ever crosses back into Bun. Implementation lives in dedicated
// translation units; this file stays the try/catch boundary.
#include "common.h"
#include "events.h"
#include "runtime.h"
#include <cstring>

using namespace bk;

template <typename Fn>
static inline int32_t guard(Fn&& fn) {
  try {
    return fn();
  } catch (const winrt::hresult_error& e) {
    set_last_error(std::string("winbridge: HRESULT 0x") +
                   [](uint32_t v) { char b[16]; sprintf_s(b, "%08X", v); return std::string(b); }(
                       (uint32_t)e.code().value) +
                   " - " + winrt::to_string(e.message()));
    return BK_ERROR;
  } catch (const std::exception& e) {
    set_last_error(std::string("winbridge: ") + e.what());
    return BK_ERROR;
  } catch (...) {
    set_last_error("winbridge: unknown native exception");
    return BK_ERROR;
  }
}

extern "C" {

// --- milestone 0 -----------------------------------------------------------

BK_EXPORT int32_t bk_test_add(int32_t a, int32_t b) { return a + b; }

BK_EXPORT const char* bk_version(void) {
  return "winbridge 0.1.1 (bunkit windows)";
}

// --- runtime -----------------------------------------------------------------

BK_EXPORT int32_t bk_runtime_init(void) {
  return guard([] { return Runtime::instance().init(); });
}

BK_EXPORT int32_t bk_runtime_shutdown(void) {
  return guard([] { return Runtime::instance().shutdown(); });
}

BK_EXPORT int32_t bk_runtime_running(void) {
  return Runtime::instance().running() ? 1 : 0;
}

// --- events ------------------------------------------------------------------

BK_EXPORT uint32_t bk_event_next_size(void) { return event_queue().next_size(); }

BK_EXPORT int32_t bk_event_wait(uint32_t timeout_ms) {
  return static_cast<int32_t>(event_queue().wait(timeout_ms));
}

BK_EXPORT int32_t bk_event_pop(void* buffer, uint32_t capacity) {
  if (buffer == nullptr && capacity > 0) return BK_INVALID_ARGUMENT;
  return guard([&] { return event_queue().pop(buffer, capacity); });
}

} // extern "C"
