#!/usr/bin/env bash
# Build libobjcbridge.dylib.
#
#   ./native/build.sh            # native arch only (fast, for development)
#   ./native/build.sh universal  # arm64 + x86_64 lipo'd together
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/native/src"
OUT="$ROOT/build"
mkdir -p "$OUT"

COMMON=(
  -dynamiclib
  -fno-objc-arc            # the bridge manages retain/release explicitly
  -fobjc-exceptions
  -O2
  -g
  -Wall -Wno-unused-parameter -Wno-deprecated-declarations
  -install_name "@rpath/libobjcbridge.dylib"
  -framework Cocoa
  -framework CoreGraphics
  -framework QuartzCore
  -lffi
)

build_one() {
  local arch="$1"
  echo "  clang -arch $arch"
  clang -arch "$arch" "${COMMON[@]}" -o "$OUT/libobjcbridge-$arch.dylib" "$SRC"/*.m
}

if [[ "${1:-}" == "universal" ]]; then
  build_one arm64
  build_one x86_64
  lipo -create "$OUT/libobjcbridge-arm64.dylib" "$OUT/libobjcbridge-x86_64.dylib" \
       -output "$OUT/libobjcbridge.dylib"
  rm -f "$OUT/libobjcbridge-arm64.dylib" "$OUT/libobjcbridge-x86_64.dylib"
else
  ARCH="$(uname -m)"
  build_one "$ARCH"
  mv "$OUT/libobjcbridge-$ARCH.dylib" "$OUT/libobjcbridge.dylib"
fi

echo "built $OUT/libobjcbridge.dylib"
lipo -info "$OUT/libobjcbridge.dylib" 2>/dev/null || true
nm -gU "$OUT/libobjcbridge.dylib" | grep ' T _br_' | sed 's/.* T _/  /' | sort
