// dispatch.m — objc_msgSend via libffi, with exception containment.

#import <Foundation/Foundation.h>
#include <objc/runtime.h>
#include <objc/message.h>
#include <string.h>
#include <stdlib.h>
#include <alloca.h>
#include "bridge.h"

const char* br_version(void) { return "objcbridge 0.1.1"; }

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

void* br_class(const char* name)      { return (void*)objc_lookUpClass(name); }
void* br_metaclass(const char* name)  { return (void*)objc_getMetaClass(name); }
void* br_selector(const char* name)   { return (void*)sel_registerName(name); }
const char* br_selector_name(void* s) { return s ? sel_getName((SEL)s) : ""; }

const char* br_method_signature(void* cls, void* sel, int instance) {
  if (!cls || !sel) return NULL;
  Method m = instance ? class_getInstanceMethod((Class)cls, (SEL)sel)
                      : class_getClassMethod((Class)cls, (SEL)sel);
  return m ? method_getTypeEncoding(m) : NULL;
}

const char* br_protocol_method_signature(const char* protoName, void* sel,
                                         int required, int instance) {
  Protocol* p = objc_getProtocol(protoName);
  if (!p || !sel) return NULL;
  struct objc_method_description d =
      protocol_getMethodDescription(p, (SEL)sel, required ? YES : NO,
                                    instance ? YES : NO);
  return d.types;
}

const char* br_object_class_name(void* obj) {
  return obj ? object_getClassName((__bridge id)obj) : "nil";
}

void* br_object_class(void* obj) {
  return obj ? (void*)object_getClass((__bridge id)obj) : NULL;
}

int br_responds(void* obj, void* sel) {
  if (!obj || !sel) return 0;
  return class_respondsToSelector(object_getClass((__bridge id)obj), (SEL)sel) ? 1 : 0;
}

int br_class_responds(void* cls, void* sel, int instance) {
  if (!cls || !sel) return 0;
  Class c = instance ? (Class)cls : object_getClass((id)cls);
  return class_respondsToSelector(c, (SEL)sel) ? 1 : 0;
}

int br_is_kind_of(void* obj, void* cls) {
  if (!obj || !cls) return 0;
  for (Class c = object_getClass((__bridge id)obj); c; c = class_getSuperclass(c))
    if (c == (Class)cls) return 1;
  return 0;
}

const char* br_class_super_name(void* cls) {
  if (!cls) return NULL;
  Class s = class_getSuperclass((Class)cls);
  return s ? class_getName(s) : NULL;
}

// Newline-separated "selector\ttypes" pairs; returns bytes needed (may exceed cap).
int br_copy_method_list(void* cls, int instance, char* out, int cap) {
  if (!cls) return 0;
  Class c = instance ? (Class)cls : object_getClass((id)cls);
  unsigned n = 0;
  Method* list = class_copyMethodList(c, &n);
  int need = 0, w = 0;
  for (unsigned i = 0; i < n; i++) {
    const char* sn = sel_getName(method_getName(list[i]));
    const char* ty = method_getTypeEncoding(list[i]);
    if (!ty) ty = "";
    int len = (int)(strlen(sn) + 1 + strlen(ty) + 1);
    need += len;
    if (w + len < cap) w += snprintf(out + w, (size_t)(cap - w), "%s\t%s\n", sn, ty);
  }
  free(list);
  if (cap > 0) out[w < cap ? w : cap - 1] = '\0';
  return need + 1;
}

int br_copy_class_list(char* out, int cap) {
  unsigned n = 0;
  Class* list = objc_copyClassList(&n);
  int need = 0, w = 0;
  for (unsigned i = 0; i < n; i++) {
    const char* cn = class_getName(list[i]);
    int len = (int)strlen(cn) + 1;
    need += len;
    if (w + len < cap) w += snprintf(out + w, (size_t)(cap - w), "%s\n", cn);
  }
  free(list);
  if (cap > 0) out[w < cap ? w : cap - 1] = '\0';
  return need + 1;
}

int br_copy_protocol_method_list(const char* protoName, char* out, int cap) {
  Protocol* p = objc_getProtocol(protoName);
  if (!p) return 0;
  int need = 0, w = 0;
  for (int req = 0; req < 2; req++) {
    unsigned n = 0;
    struct objc_method_description* d =
        protocol_copyMethodDescriptionList(p, req ? YES : NO, YES, &n);
    for (unsigned i = 0; i < n; i++) {
      const char* sn = sel_getName(d[i].name);
      const char* ty = d[i].types ? d[i].types : "";
      int len = (int)(strlen(sn) + strlen(ty) + 4);
      need += len;
      if (w + len < cap)
        w += snprintf(out + w, (size_t)(cap - w), "%s\t%s\t%d\n", sn, ty, req);
    }
    free(d);
  }
  if (cap > 0) out[w < cap ? w : cap - 1] = '\0';
  return need + 1;
}

void* br_dlsym(const char* name) {
  extern void* dlsym(void*, const char*);
  return dlsym((void*)-2 /* RTLD_DEFAULT */, name);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

// Fills argptrs[i] with argbuf + args[i].offset.
static inline void build_argptrs(br_sig* s, void* argbuf, void** argptrs) {
  char* base = (char*)argbuf;
  for (int32_t i = 0; i < s->nargs; i++) argptrs[i] = base + s->args[i].offset;
}

static char* describe_exception(NSException* e) {
  @try {
    NSString* d = [NSString stringWithFormat:@"%@: %@", [e name], [e reason]];
    const char* u = [d UTF8String];
    return u ? strdup(u) : strdup("Objective-C exception");
  } @catch (...) {
    return strdup("Objective-C exception (undescribable)");
  }
}

int br_call_function(void* fn, const char* types, void* argbuf, void* retbuf, char** err);

int br_msgsend(void* target, void* sel, const char* types,
               void* argbuf, void* retbuf, char** err) {
  if (err) *err = NULL;
  br_sig* s = br_sig_get(types);
  if (!s) return BR_ERR_BAD_ENCODING;
  if (s->nargs < 2) return BR_ERR_BAD_ENCODING;

  // Slots 0 and 1 (self, _cmd) are owned by us, not by JS.
  *(void**)((char*)argbuf + s->args[0].offset) = target;
  *(void**)((char*)argbuf + s->args[1].offset) = sel;

  void** argptrs = (void**)alloca(sizeof(void*) * (size_t)s->nargs);
  build_argptrs(s, argbuf, argptrs);

  if (s->ret.size > 0) memset(retbuf, 0, (size_t)s->retbuf_size);

  // arm64 has no objc_msgSend_stret or _fpret: struct returns use x8 and libffi
  // handles them, so there is exactly one entry point.
  @try {
    ffi_call(&s->cif, FFI_FN(objc_msgSend), retbuf, argptrs);
  } @catch (NSException* e) {
    if (err) *err = describe_exception(e);
    return BR_ERR_EXCEPTION;
  } @catch (id other) {
    if (err) *err = strdup("non-NSException Objective-C throw");
    return BR_ERR_EXCEPTION;
  }
  return BR_OK;
}

int br_msgsend_super(void* target, void* superclass, void* sel, const char* types,
                     void* argbuf, void* retbuf, char** err) {
  if (err) *err = NULL;
  br_sig* s = br_sig_get(types);
  if (!s) return BR_ERR_BAD_ENCODING;
  if (s->nargs < 2) return BR_ERR_BAD_ENCODING;

  struct objc_super sup;
  sup.receiver = (__bridge id)target;
  sup.super_class = (Class)superclass;

  *(void**)((char*)argbuf + s->args[0].offset) = &sup;
  *(void**)((char*)argbuf + s->args[1].offset) = sel;

  void** argptrs = (void**)alloca(sizeof(void*) * (size_t)s->nargs);
  build_argptrs(s, argbuf, argptrs);
  if (s->ret.size > 0) memset(retbuf, 0, (size_t)s->retbuf_size);

  @try {
    ffi_call(&s->cif, FFI_FN(objc_msgSendSuper), retbuf, argptrs);
  } @catch (NSException* e) {
    if (err) *err = describe_exception(e);
    return BR_ERR_EXCEPTION;
  } @catch (id other) {
    if (err) *err = strdup("non-NSException Objective-C throw");
    return BR_ERR_EXCEPTION;
  }
  return BR_OK;
}

// ---------------------------------------------------------------------------
// Plain C functions
//
// Enums and C functions are the two things runtime introspection cannot give
// you. dlsym finds the symbol; this calls it with a signature JS supplies.
// ---------------------------------------------------------------------------

int br_call_function(void* fn, const char* types, void* argbuf, void* retbuf, char** err) {
  if (err) *err = NULL;
  if (!fn) return BR_ERR_NIL_TARGET;
  br_sig* s = br_sig_get(types);
  if (!s) return BR_ERR_BAD_ENCODING;

  void** argptrs = (void**)alloca(sizeof(void*) * (size_t)(s->nargs ? s->nargs : 1));
  build_argptrs(s, argbuf, argptrs);
  if (s->ret.size > 0) memset(retbuf, 0, (size_t)s->retbuf_size);

  @try {
    ffi_call(&s->cif, FFI_FN(fn), retbuf, argptrs);
  } @catch (NSException* e) {
    if (err) *err = describe_exception(e);
    return BR_ERR_EXCEPTION;
  }
  return BR_OK;
}
