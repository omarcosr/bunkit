// dllmain.cpp — deliberately boring.
//
// Per project policy NOTHING meaningful happens here: no COM init, no WinRT,
// no Windows App SDK, no threads, no XAML objects. All initialization goes
// through bk_runtime_init(), called explicitly from TypeScript after dlopen.
#include <windows.h>

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID) {
  return TRUE;
}
