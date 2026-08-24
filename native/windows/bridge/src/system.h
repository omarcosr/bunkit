// system.h — OS-level helpers shared across the bridge.
#ifndef BK_SYSTEM_H
#define BK_SYSTEM_H

#include <windows.h>

namespace bk {

// Whether the OS is in dark mode (AppsUseLightTheme = 0). Used to resolve
// `{ light, dark }` colours and to seed the XAML app theme so dark-mode
// windows do not flash white on their first frame.
inline bool system_dark_mode() {
  DWORD value = 1;
  DWORD size = sizeof(value);
  LONG rc = RegGetValueW(
      HKEY_CURRENT_USER,
      L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
      L"AppsUseLightTheme", RRF_RT_REG_DWORD, nullptr, &value, &size);
  return rc == ERROR_SUCCESS && value == 0;
}

} // namespace bk

#endif // BK_SYSTEM_H
