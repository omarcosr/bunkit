// events.cpp — see events.h.
#include "events.h"
#include <cstring>

namespace bk {

std::vector<uint8_t> Event::serialize() const {
  bk_event_header stamped = header;
  stamped.payload_length = static_cast<uint32_t>(payload.size());
  stamped.size = static_cast<uint32_t>(sizeof(stamped) + payload.size());
  std::vector<uint8_t> bytes(sizeof(stamped) + payload.size());
  memcpy(bytes.data(), &stamped, sizeof(stamped));
  if (!payload.empty()) {
    memcpy(bytes.data() + sizeof(stamped), payload.data(), payload.size());
  }
  return bytes;
}

void EventQueue::push(Event event) {
  auto bytes = event.serialize();
  {
    std::lock_guard<std::mutex> lock(mutex_);
    queue_.push_back(std::move(bytes));
  }
  cv_.notify_one();
}

uint32_t EventQueue::wait(uint32_t timeout_ms) {
  std::unique_lock<std::mutex> lock(mutex_);
  cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
               [this] { return !queue_.empty(); });
  return queue_.empty() ? 0 : 1;
}

uint32_t EventQueue::next_size() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (queue_.empty()) return 0;
  return static_cast<uint32_t>(queue_.front().size());
}

int32_t EventQueue::pop(void* buffer, uint32_t capacity) {
  std::vector<uint8_t> bytes;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (queue_.empty()) return 0;
    if (queue_.front().size() > capacity) return BK_BUFFER_TOO_SMALL;
    bytes = std::move(queue_.front());
    queue_.pop_front();
  }
  // Serialize/copy outside the lock is impossible once moved; copy under no
  // lock because we own `bytes` now.
  memcpy(buffer, bytes.data(), bytes.size());
  return static_cast<int32_t>(bytes.size());
}

EventQueue& event_queue() {
  static EventQueue instance;
  return instance;
}

} // namespace bk
