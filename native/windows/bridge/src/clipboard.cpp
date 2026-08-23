// clipboard.cpp — plain text in and out of the Windows clipboard.
//
// Win32 instead of the WinRT Clipboard class: synchronous (the JS side gets a
// plain function, not a promise), no package identity requirements, and
// user32/advapi32 were already linked.
#include "common.h"

#include <windows.h>

namespace {

int wide_length(const char* utf8, int utf8_len) {
  return MultiByteToWideChar(CP_UTF8, 0, utf8, utf8_len, nullptr, 0);
}

} // namespace

extern "C" {

BK_EXPORT int32_t bk_clipboard_set_text(const char* text, uint32_t len) {
  if (!text || len == 0) return BK_INVALID_ARGUMENT;
  const int wlen = wide_length(text, static_cast<int>(len));
  if (wlen <= 0) return BK_ERROR;

  // +1 for the NUL the clipboard contract expects.
  HGLOBAL global = GlobalAlloc(GMEM_MOVEABLE,
                               static_cast<size_t>(wlen + 1) * sizeof(wchar_t));
  if (!global) return BK_ERROR;
  auto* dst = static_cast<wchar_t*>(GlobalLock(global));
  if (!dst) {
    GlobalFree(global);
    return BK_ERROR;
  }
  MultiByteToWideChar(CP_UTF8, 0, text, static_cast<int>(len), dst, wlen);
  dst[wlen] = L'\0';
  GlobalUnlock(global);

  if (!OpenClipboard(nullptr)) {
    GlobalFree(global);
    return BK_ERROR;
  }
  EmptyClipboard();
  // The system owns `global` on success; free it ourselves on failure only.
  const HANDLE placed = SetClipboardData(CF_UNICODETEXT, global);
  CloseClipboard();
  if (!placed) {
    GlobalFree(global);
    return BK_ERROR;
  }
  return BK_OK;
}

BK_EXPORT uint32_t bk_clipboard_text_length(void) {
  if (!OpenClipboard(nullptr)) return 0;
  const wchar_t* src = static_cast<const wchar_t*>(GetClipboardData(CF_UNICODETEXT));
  uint32_t bytes = 0;
  if (src) {
    bytes = static_cast<uint32_t>(
        WideCharToMultiByte(CP_UTF8, 0, src, -1, nullptr, 0, nullptr, nullptr));
    if (bytes > 0) bytes -= 1; // exclude the NUL, callers add their own
  }
  CloseClipboard();
  return bytes;
}

BK_EXPORT int32_t bk_clipboard_copy_text(char* buffer, uint32_t capacity) {
  if (!buffer || capacity == 0) return BK_INVALID_ARGUMENT;
  if (!OpenClipboard(nullptr)) return BK_ERROR;
  const wchar_t* src = static_cast<const wchar_t*>(GetClipboardData(CF_UNICODETEXT));
  int32_t written = 0;
  if (src) {
    const int bytes = WideCharToMultiByte(
        CP_UTF8, 0, src, -1, buffer, static_cast<int>(capacity), nullptr, nullptr);
    written = bytes > 0 ? bytes - 1 : BK_BUFFER_TOO_SMALL;
    if (bytes == 0 && GetLastError() == ERROR_INSUFFICIENT_BUFFER) {
      written = BK_BUFFER_TOO_SMALL;
    }
  }
  CloseClipboard();
  return written;
}

} // extern "C"
