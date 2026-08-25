// registry.h — handle -> WinUI object table. UI-thread-only by contract.
//
// JavaScript sees uint64 handles; this map is the only place they become
// IInspectable references. All access happens on the WinUI STA thread (via
// Runtime::dispatch_*), so no locking is needed. Handles are monotonic and
// never reused.
#ifndef BK_REGISTRY_H
#define BK_REGISTRY_H

#include "common.h"
#include <atomic>
#include <unordered_map>
#include <winrt/Windows.Foundation.h>

namespace bk {

enum class NativeType : uint8_t {
  Window = 1,
  Label,
  Button,
  TextBox,
  SecureTextBox,
  Stack,
  CheckBox,
  ToggleSwitch,
  Slider,
  Select,
  TextArea,
  Progress,
  Separator,
  Spacer,
  GroupBox,
  Segmented,
  Table,
  Container,
  GridView,
  ScrollView,
  SplitView,
  ImageView,
  BlurView,
  RichTextArea,
};

struct NativeObject {
  NativeType type{};
  winrt::Windows::Foundation::IInspectable object{nullptr};

  // Per-type extras. Only meaningful while `object` is alive on the UI thread.
  winrt::event_token close_token{}; // Window
  winrt::event_token closing_token{}; // Window: AppWindow Closing guard
  winrt::event_token token1{};      // Button click / TextBox text change
  winrt::event_token token2{};      // PasswordBox password change
  winrt::event_token token3{};      // PasswordBox submit KeyDown
  uint64_t cb1{0};                  // callback id for token1's event
  uint64_t cb2{0};                  // second callback (Table double click, TextBox submit)
  winrt::event_token state_hover_entered_token{};
  winrt::event_token state_hover_exited_token{};
  winrt::event_token state_hover_moved_token{};
  winrt::event_token state_focus_gained_token{};
  winrt::event_token state_focus_lost_token{};
  winrt::event_token state_pressed_token{};
  winrt::event_token state_released_token{};
  uint64_t cb3{0};                  // interaction-state callback id
  bool state_attached{false};
  bool state_hover_active{false};
  winrt::event_token shadow_size_token{};
  winrt::event_token shadow_layout_token{};
  winrt::event_token shadow_loaded_token{};
  uint64_t shadow_generation{0};
  winrt::Windows::Foundation::IInspectable shadow_visual{nullptr};
  winrt::Windows::Foundation::IInspectable shadow_drop_shadow{nullptr};
  winrt::Windows::Foundation::IInspectable shadow_mask_visual{nullptr};
  winrt::Windows::Foundation::IInspectable shadow_mask_surface{nullptr};
  winrt::Windows::Foundation::IInspectable shadow_mask_brush{nullptr};
  winrt::Windows::Foundation::IInspectable shadow_mask_shape{nullptr};
  int32_t aux{0};                   // Stack: bk_stack_orientation
  int32_t suppress{0};              // >0 while a programmatic set is in flight
  int32_t align{0};                 // Stack: 0 leading, 1 center, 2 trailing, 3 fill
  int32_t pack{0};                  // Stack: 0 start, 1 center, 2 fill
  int32_t window_flags{0};          // Window: bit 1 = not closable
  double auxf{0};                   // Table: row height
  double auxf2{0};                  // Table: font size
  int32_t aux2{0};                  // Table flags: 1 multi, 4 alt rows, 8 mono
  winrt::Windows::Foundation::IInspectable extra{nullptr}; // per-type holder
};

class ObjectRegistry {
public:
  bk_handle add(NativeType type, winrt::Windows::Foundation::IInspectable const& object);

  // Null when the handle is stale/unknown; callers check type afterwards.
  NativeObject* get(bk_handle handle);

  int32_t destroy(bk_handle handle);
  void clear();

private:
  std::unordered_map<bk_handle, NativeObject> map_;
  std::atomic<uint64_t> next_{1};
};

// Lives as long as the DLL. Only touch it from the UI thread.
ObjectRegistry& registry();

} // namespace bk

#endif // BK_REGISTRY_H
