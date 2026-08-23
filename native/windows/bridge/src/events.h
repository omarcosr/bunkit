// events.h — thread-safe queue carrying UI-thread events to the Bun thread.
//
// Producer: WinUI STA thread (event handlers). Consumer: Bun thread via
// bk_event_next_size()/bk_event_pop(). Plain mutex+deque; correctness over
// cleverness. Wire format is bk_event_header followed by payload_length UTF-8
// bytes, serialized into one flat byte vector per event so nothing but
// trivially-copyable data ever crosses the C ABI.
#ifndef BK_EVENTS_H
#define BK_EVENTS_H

#include "common.h"
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <mutex>
#include <string>
#include <vector>

namespace bk {

struct Event {
  bk_event_header header{};
  std::string payload; // UTF-8 bytes; may be empty

  std::vector<uint8_t> serialize() const;
};

class EventQueue {
public:
  void push(Event event);

  // Block the caller until an event arrives or the timeout elapses.
  // Returns 1 when the queue is non-empty, 0 on timeout.
  uint32_t wait(uint32_t timeout_ms);

  // Total size of the oldest queued event in bytes, or 0 when empty.
  uint32_t next_size();

  // Copy the oldest event out. Returns bytes written, 0 when empty, or
  // BK_BUFFER_TOO_SMALL with the event left queued.
  int32_t pop(void* buffer, uint32_t capacity);

private:
  std::mutex mutex_;
  std::condition_variable cv_;
  std::deque<std::vector<uint8_t>> queue_;
};

EventQueue& event_queue();

} // namespace bk

#endif // BK_EVENTS_H
