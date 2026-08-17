// memory.m — retain/release across the FFI boundary, autorelease pools, and
// NSString fast paths (the single most common marshalling in any AppKit app).

#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>
#include "bridge.h"

void* br_retain(void* obj) {
  if (!obj) return NULL;
  return (void*)CFRetain((CFTypeRef)obj);
}

void br_release(void* obj) {
  if (!obj) return;
  CFRelease((CFTypeRef)obj);
}

void br_autorelease(void* obj) {
  if (!obj) return;
  [(__bridge id)obj autorelease];
}

long br_retain_count(void* obj) {
  if (!obj) return 0;
  return (long)CFGetRetainCount((CFTypeRef)obj);
}

// A stack of pools so JS can bracket tight loops as well as pump iterations.
#define POOL_MAX 64
static void* g_pools[POOL_MAX];
static int   g_pool_top = 0;

void br_autorelease_pool_push(void) {
  if (g_pool_top >= POOL_MAX) return;
  g_pools[g_pool_top++] = (void*)[[NSAutoreleasePool alloc] init];
}

void br_autorelease_pool_pop(void) {
  if (g_pool_top <= 0) return;
  NSAutoreleasePool* p = (NSAutoreleasePool*)g_pools[--g_pool_top];
  [p drain];
}

// Drain and replace the outermost pool.
//
// A long-lived app makes most of its Obj-C calls *between* pumps, and every +0
// autoreleased return from AppKit lands in whatever pool is innermost. That is
// the process-lifetime base pool unless something recycles it, so without this
// an app that touches AppKit in a loop grows without bound. Only ever recycles
// the base pool, so an explicit withPool() nesting is never drained out of turn.
int br_autorelease_pool_recycle(void) {
  if (g_pool_top != 1) return 0;
  NSAutoreleasePool* p = (NSAutoreleasePool*)g_pools[0];
  [p drain];
  g_pools[0] = (void*)[[NSAutoreleasePool alloc] init];
  return 1;
}

int br_autorelease_pool_depth(void) { return g_pool_top; }

void br_free(void* p) { free(p); }

// ---------------------------------------------------------------------------
// NSString
// ---------------------------------------------------------------------------

// Returns a +1 string. JS owns it and releases via its finalizer.
void* br_nsstring(const char* utf8, int32_t len) {
  if (!utf8) return NULL;
  NSString* s;
  if (len < 0) {
    s = [[NSString alloc] initWithUTF8String:utf8];
  } else {
    s = [[NSString alloc] initWithBytes:utf8 length:(NSUInteger)len
                               encoding:NSUTF8StringEncoding];
  }
  return (void*)s;
}

// Borrowed pointer valid until the next autorelease pool drain.
const char* br_nsstring_utf8(void* s) {
  if (!s) return NULL;
  id o = (__bridge id)s;
  if (![o isKindOfClass:[NSString class]]) return NULL;
  return [(NSString*)o UTF8String];
}

int32_t br_nsstring_len(void* s) {
  if (!s) return 0;
  id o = (__bridge id)s;
  if (![o isKindOfClass:[NSString class]]) return -1;
  return (int32_t)[(NSString*)o lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
}
