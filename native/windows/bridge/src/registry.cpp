// registry.cpp — see registry.h.
#include "registry.h"

namespace bk {

bk_handle ObjectRegistry::add(
    NativeType type, winrt::Windows::Foundation::IInspectable const& object) {
  const bk_handle handle = next_.fetch_add(1);
  map_.emplace(handle, NativeObject{type, object});
  return handle;
}

NativeObject* ObjectRegistry::get(bk_handle handle) {
  if (handle == BK_HANDLE_NULL) return nullptr;
  auto it = map_.find(handle);
  return it == map_.end() ? nullptr : &it->second;
}

int32_t ObjectRegistry::destroy(bk_handle handle) {
  auto it = map_.find(handle);
  if (it == map_.end()) return BK_INVALID_HANDLE;
  map_.erase(it);
  return BK_OK;
}

void ObjectRegistry::clear() { map_.clear(); }

ObjectRegistry& registry() {
  static auto* r = new ObjectRegistry();
  return *r;
}

} // namespace bk
