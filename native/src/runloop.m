// runloop.m — cooperative coexistence between AppKit's run loop and Bun's.
//
// We never call -[NSApplication run]. JS owns the outer loop and calls br_pump
// repeatedly; each call blocks in mach_msg for at most `seconds` waiting for the
// next event, then drains whatever else is queued without blocking.

#import <Cocoa/Cocoa.h>
#include <mach/mach_time.h>
#include "bridge.h"

typedef void (*br_void_fn)(uint32_t, uint32_t, void*, void*);

static volatile int g_stop = 0;
static int          g_quit_after_last_window = 1;
static br_void_fn   g_stop_cb = NULL;

// ---------------------------------------------------------------------------
// Application delegate
// ---------------------------------------------------------------------------

@interface BRAppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation BRAppDelegate

// Cmd-Q and the Dock's Quit both land here. We refuse AppKit's own exit() path
// so JS gets a chance to unwind, save state and shut the loop down itself.
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)sender {
  (void)sender;
  g_stop = 1;
  if (g_stop_cb) g_stop_cb(0, 0, NULL, NULL);
  return NSTerminateCancel;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication*)sender {
  (void)sender;
  return g_quit_after_last_window ? YES : NO;
}

- (void)brNoop:(id)sender { (void)sender; }

@end

static BRAppDelegate* g_delegate = nil;

static void br_uncaught(NSException* e) {
  NSLog(@"[objcbridge] UNCAUGHT Obj-C exception: %@: %@\n%@",
        [e name], [e reason], [e callStackSymbols]);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

void br_app_init(int activationPolicy) {
  static int done = 0;
  if (done) return;
  done = 1;
  NSSetUncaughtExceptionHandler(&br_uncaught);
  [NSApplication sharedApplication];
  [NSApp setActivationPolicy:(NSApplicationActivationPolicy)activationPolicy];
  g_delegate = [[BRAppDelegate alloc] init];
  [NSApp setDelegate:g_delegate];
  [NSApp finishLaunching];
  [NSApp activateIgnoringOtherApps:YES];
}

void br_set_terminate_after_last_window(int v) { g_quit_after_last_window = v; }

void br_set_stop_callback(void* cb) { g_stop_cb = (br_void_fn)cb; }

void br_stop(void)     { g_stop = 1; }
int  br_should_stop(void) { return g_stop; }

// ---------------------------------------------------------------------------
// The pump
// ---------------------------------------------------------------------------

int br_pump(double seconds) {
  if (!NSApp) return 0;
  static int idleTicks = 0;
  int n = 0;
  @autoreleasepool {
    NSDate* deadline = seconds > 0 ? [NSDate dateWithTimeIntervalSinceNow:seconds]
                                   : [NSDate distantPast];
    NSEvent* e;
    while ((e = [NSApp nextEventMatchingMask:NSEventMaskAny
                                   untilDate:deadline
                                      inMode:NSDefaultRunLoopMode
                                     dequeue:YES])) {
      @try {
        [NSApp sendEvent:e];
      } @catch (NSException* ex) {
        NSLog(@"[objcbridge] exception in sendEvent: %@: %@", [ex name], [ex reason]);
      }
      n++;
      // Everything after the first event is drained without blocking.
      deadline = [NSDate distantPast];
    }
    // -updateWindows walks every window and is pure overhead when nothing
    // happened, which is most of the time in an idle app. Run it whenever we
    // handled events, and occasionally otherwise so cursor rects and field
    // editors still get their housekeeping.
    if (n > 0 || ++idleTicks >= 50) {
      idleTicks = 0;
      @try {
        [NSApp updateWindows];
      } @catch (NSException* ex) {
        NSLog(@"[objcbridge] exception in updateWindows: %@", [ex reason]);
      }
    }
  }
  return n;
}

// Wake a pump that is blocked in mach_msg (e.g. because JS has work to do).
void br_post_empty_event(void) {
  if (!NSApp) return;
  @autoreleasepool {
    NSEvent* e = [NSEvent otherEventWithType:NSEventTypeApplicationDefined
                                    location:NSZeroPoint
                               modifierFlags:0
                                   timestamp:0
                                windowNumber:0
                                     context:nil
                                     subtype:0
                                       data1:0
                                       data2:0];
    [NSApp postEvent:e atStart:YES];
  }
}

double br_now(void) {
  static mach_timebase_info_data_t tb;
  if (tb.denom == 0) mach_timebase_info(&tb);
  uint64_t t = mach_absolute_time();
  return (double)t * (double)tb.numer / (double)tb.denom / 1e9;
}

// Convenience used by the packaging layer: the running executable's bundle path.
const char* br_bundle_path(void) {
  return [[[NSBundle mainBundle] bundlePath] UTF8String];
}
