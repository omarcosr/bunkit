// common.h — internals shared by all winbridge translation units.
#ifndef BK_COMMON_H
#define BK_COMMON_H

#include "bunkit.h"
#include <string>

namespace bk {

// Record a UTF-8 diagnostic message as the calling thread's last error.
void set_last_error(std::string message);

// Debug logging; compiles out in release unless BK_DEBUG_LOG is defined.
void log_line(const char* line);

} // namespace bk

#endif // BK_COMMON_H
