// bootstrap_config.h — pins the Windows App SDK runtime family MddBootstrap
// activates. Defined here rather than on the compiler command line because the
// empty wide-string tag cannot survive cmd batch escaping.
#pragma once

#include <windows.h>

#ifndef WINDOWSAPPSDK_RELEASE_MAJORMINOR
#define WINDOWSAPPSDK_RELEASE_MAJORMINOR 0x00010007
#endif

#ifndef WINDOWSAPPSDK_RELEASE_VERSION_TAG_W
#define WINDOWSAPPSDK_RELEASE_VERSION_TAG_W L""
#endif

// Minimum acceptable build within the family; 0 lets the bootstrapper pick
// the newest installed 1.8.x. The header's default argument wants a
// PackageVersion, not a raw integer.
#ifndef WINDOWSAPPSDK_RUNTIME_VERSION_UINT64
#define WINDOWSAPPSDK_RUNTIME_VERSION_UINT64 \
  ::Microsoft::Windows::ApplicationModel::PackageVersion(uint64_t{0})
#endif

#include <MddBootstrap.h>
