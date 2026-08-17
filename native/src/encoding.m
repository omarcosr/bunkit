// encoding.m — Objective-C type encoding -> libffi type tree + JS-visible layout
//
// This is the heart of the dynamic dispatch engine. Everything the bridge can
// call is described by a string obtained at runtime from method_getTypeEncoding.
// We turn that string into an ffi_cif once, memoise it, and reuse it forever.

#import <Foundation/Foundation.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "bridge.h"

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

static int is_qualifier(char c) {
  // const, in, inout, out, bycopy, byref, oneway, _Atomic, GNU register
  return c == 'r' || c == 'n' || c == 'N' || c == 'o' || c == 'O' ||
         c == 'R' || c == 'V' || c == 'A' || c == '+' || c == '|';
}

static void skip_qualifiers(const char** p) {
  while (**p && is_qualifier(**p)) (*p)++;
}

static void skip_digits(const char** p) {
  while (**p >= '0' && **p <= '9') (*p)++;
}

// Skip a balanced {...} / (...) / [...] region, cursor left just past the close.
static void skip_balanced(const char** p, char open, char close) {
  int depth = 0;
  do {
    if (**p == open) depth++;
    else if (**p == close) depth--;
    else if (**p == '\0') return;
    (*p)++;
  } while (depth > 0);
}

// ---------------------------------------------------------------------------
// Persistent allocation for ffi_type trees (never freed; bounded by the number
// of distinct struct encodings the app touches).
// ---------------------------------------------------------------------------

typedef struct type_entry {
  char*      key;
  ffi_type*  type;
  br_arg     info;
  struct type_entry* next;
} type_entry;

#define TYPE_BUCKETS 512
static type_entry* g_type_buckets[TYPE_BUCKETS];

static unsigned long djb2(const char* s, size_t n) {
  unsigned long h = 5381;
  for (size_t i = 0; i < n; i++) h = ((h << 5) + h) ^ (unsigned char)s[i];
  return h;
}

static type_entry* type_cache_get(const char* key, size_t n) {
  unsigned long h = djb2(key, n) % TYPE_BUCKETS;
  for (type_entry* e = g_type_buckets[h]; e; e = e->next) {
    if (strlen(e->key) == n && memcmp(e->key, key, n) == 0) return e;
  }
  return NULL;
}

static type_entry* type_cache_put(const char* key, size_t n, ffi_type* t, br_arg info) {
  unsigned long h = djb2(key, n) % TYPE_BUCKETS;
  type_entry* e = (type_entry*)calloc(1, sizeof(type_entry));
  e->key = (char*)malloc(n + 1);
  memcpy(e->key, key, n);
  e->key[n] = '\0';
  e->type = t;
  e->info = info;
  e->next = g_type_buckets[h];
  g_type_buckets[h] = e;
  return e;
}

// ---------------------------------------------------------------------------
// Primitive mapping
// ---------------------------------------------------------------------------

static ffi_type* prim(char c, int32_t* kind) {
  switch (c) {
    case 'c': *kind = BR_K_SINT8;  return &ffi_type_sint8;
    case 'C': *kind = BR_K_UINT8;  return &ffi_type_uint8;
    case 's': *kind = BR_K_SINT16; return &ffi_type_sint16;
    case 'S': *kind = BR_K_UINT16; return &ffi_type_uint16;
    case 'i': *kind = BR_K_SINT32; return &ffi_type_sint32;
    case 'I': *kind = BR_K_UINT32; return &ffi_type_uint32;
    // On LP64 Apple encodes `long` as 'q'; a bare 'l' therefore only appears in
    // legacy 32-bit-era encodings, where it is 32 bits wide.
    case 'l': *kind = BR_K_SINT32; return &ffi_type_sint32;
    case 'L': *kind = BR_K_UINT32; return &ffi_type_uint32;
    case 'q': *kind = BR_K_SINT64; return &ffi_type_sint64;
    case 'Q': *kind = BR_K_UINT64; return &ffi_type_uint64;
    case 'f': *kind = BR_K_FLOAT;  return &ffi_type_float;
    case 'd': *kind = BR_K_DOUBLE; return &ffi_type_double;
    // 'D' is `long double`, which on arm64 is just another name for double.
    case 'D': *kind = BR_K_DOUBLE; return &ffi_type_double;
    case 'B': *kind = BR_K_BOOL;   return &ffi_type_uint8;
    case 'v': *kind = BR_K_VOID;   return &ffi_type_void;
    case '*': *kind = BR_K_CHARPTR;return &ffi_type_pointer;
    case '@': *kind = BR_K_OBJECT; return &ffi_type_pointer;
    case '#': *kind = BR_K_CLASS;  return &ffi_type_pointer;
    case ':': *kind = BR_K_SEL;    return &ffi_type_pointer;
    case '?': *kind = BR_K_POINTER;return &ffi_type_pointer;  // bare function ptr
    default:  return NULL;
  }
}

// ---------------------------------------------------------------------------
// Aggregate construction
// ---------------------------------------------------------------------------

static ffi_type* make_aggregate(ffi_type** elems) {
  ffi_type* t = (ffi_type*)calloc(1, sizeof(ffi_type));
  t->size = 0;
  t->alignment = 0;
  t->type = FFI_TYPE_STRUCT;
  t->elements = elems;
  return t;
}

// Force libffi to compute size/alignment for an aggregate we just built.
static int finalize_aggregate(ffi_type* t) {
  ffi_cif tmp;
  ffi_type* args[1] = { t };
  if (ffi_prep_cif(&tmp, FFI_DEFAULT_ABI, 1, &ffi_type_void, args) != FFI_OK) return 0;
  return t->size > 0;
}

// Parse a single (bare) type starting at *cursor. Advances the cursor past it.
// Fills `out` with kind/size/align (offset is left untouched).
ffi_type* br_ffi_type_for(const char** cursor, br_arg* out) {
  skip_qualifiers(cursor);
  const char* start = *cursor;
  char c = **cursor;
  if (!c) return NULL;

  int32_t kind = BR_K_UNKNOWN;

  // --- block pointer: "@?" -------------------------------------------------
  if (c == '@' && (*cursor)[1] == '?') {
    *cursor += 2;
    out->kind = BR_K_BLOCK; out->size = 8; out->align = 8;
    return &ffi_type_pointer;
  }
  // --- object with class name: @"NSString" ---------------------------------
  if (c == '@' && (*cursor)[1] == '"') {
    *cursor += 2;
    while (**cursor && **cursor != '"') (*cursor)++;
    if (**cursor == '"') (*cursor)++;
    out->kind = BR_K_OBJECT; out->size = 8; out->align = 8;
    return &ffi_type_pointer;
  }
  // --- pointer: ^type ------------------------------------------------------
  if (c == '^') {
    (*cursor)++;
    br_arg inner;
    // Consume the pointee so the cursor ends up in the right place. A pointee we
    // cannot parse (e.g. ^? for a function pointer) is still a valid pointer.
    const char* save = *cursor;
    if (!br_ffi_type_for(cursor, &inner)) *cursor = save + (*save ? 1 : 0);
    out->kind = BR_K_POINTER; out->size = 8; out->align = 8;
    return &ffi_type_pointer;
  }
  // --- bitfield: bN --------------------------------------------------------
  if (c == 'b') {
    // Bitfields only appear inside a handful of Carbon-era structs. Refuse
    // rather than silently produce a wrong layout.
    return NULL;
  }
  // --- array: [Nt] ---------------------------------------------------------
  if (c == '[') {
    const char* probe = *cursor;
    skip_balanced(&probe, '[', ']');
    size_t klen = (size_t)(probe - start);
    type_entry* hit = type_cache_get(start, klen);
    if (hit) { *out = hit->info; *cursor = probe; return hit->type; }

    (*cursor)++;
    char* numEnd = NULL;
    long n = strtol(*cursor, &numEnd, 10);
    *cursor = numEnd;
    br_arg einfo = (br_arg){0};
    ffi_type* et = br_ffi_type_for(cursor, &einfo);
    if (!et || **cursor != ']') return NULL;
    (*cursor)++;
    if (n < 0 || n > 65536) return NULL;
    ffi_type** elems = (ffi_type**)calloc((size_t)n + 1, sizeof(ffi_type*));
    for (long i = 0; i < n; i++) elems[i] = et;
    ffi_type* t = make_aggregate(elems);
    if (!finalize_aggregate(t) && n > 0) return NULL;
    out->kind = BR_K_ARRAY;
    out->size = (int32_t)t->size;
    out->align = (int32_t)t->alignment;
    type_cache_put(start, klen, t, *out);
    return t;
  }
  // --- struct / union ------------------------------------------------------
  if (c == '{' || c == '(') {
    char open = c, close = (c == '{') ? '}' : ')';
    const char* probe = *cursor;
    skip_balanced(&probe, open, close);
    size_t klen = (size_t)(probe - start);
    type_entry* hit = type_cache_get(start, klen);
    if (hit) { *out = hit->info; *cursor = probe; return hit->type; }

    (*cursor)++;                       // past '{'
    while (**cursor && **cursor != '=' && **cursor != close) (*cursor)++;
    int opaque = (**cursor == close);  // "{CGContext=}" style forward decl
    if (**cursor == '=') (*cursor)++;

    ffi_type** elems = (ffi_type**)calloc(64, sizeof(ffi_type*));
    size_t cap = 64, n = 0;
    while (**cursor && **cursor != close) {
      // Named fields appear as "name"type in some encodings.
      if (**cursor == '"') {
        (*cursor)++;
        while (**cursor && **cursor != '"') (*cursor)++;
        if (**cursor == '"') (*cursor)++;
        continue;
      }
      br_arg finfo = (br_arg){0};
      ffi_type* ft = br_ffi_type_for(cursor, &finfo);
      if (!ft) { free(elems); return NULL; }
      if (ft == &ffi_type_void) continue;
      if (n + 2 >= cap) {
        cap *= 2;
        elems = (ffi_type**)realloc(elems, cap * sizeof(ffi_type*));
        memset(elems + n, 0, (cap - n) * sizeof(ffi_type*));
      }
      elems[n++] = ft;
    }
    if (**cursor == close) (*cursor)++;
    elems[n] = NULL;

    ffi_type* t;
    if (open == '(') {
      // A union is passed as an opaque blob of its largest member. libffi has no
      // union type, so synthesise a struct of one element with max size/align.
      size_t maxs = 0, maxa = 1;
      ffi_type* biggest = &ffi_type_uint8;
      for (size_t i = 0; i < n; i++) {
        if (elems[i]->size > maxs) { maxs = elems[i]->size; biggest = elems[i]; }
        if (elems[i]->alignment > maxa) maxa = elems[i]->alignment;
      }
      ffi_type** one = (ffi_type**)calloc(2, sizeof(ffi_type*));
      one[0] = biggest;
      free(elems);
      t = make_aggregate(one);
      if (!finalize_aggregate(t)) return NULL;
      out->kind = BR_K_UNION;
    } else {
      t = make_aggregate(elems);
      if (opaque || n == 0) {
        // Opaque struct referenced by value should never happen; give it 1 byte
        // so pointers-to-it still work.
        free(elems);
        ffi_type** one = (ffi_type**)calloc(2, sizeof(ffi_type*));
        one[0] = &ffi_type_uint8;
        t = make_aggregate(one);
      }
      if (!finalize_aggregate(t)) return NULL;
      out->kind = BR_K_STRUCT;
    }
    out->size = (int32_t)t->size;
    out->align = (int32_t)t->alignment;
    type_cache_put(start, klen, t, *out);
    return t;
  }

  // --- primitives ----------------------------------------------------------
  ffi_type* t = prim(c, &kind);
  if (!t) return NULL;
  (*cursor)++;
  out->kind = kind;
  out->size = (int32_t)t->size;
  out->align = (int32_t)(t->alignment ? t->alignment : 1);
  if (t == &ffi_type_void) { out->size = 0; out->align = 1; }
  return t;
}

// ---------------------------------------------------------------------------
// Full method signature cache
// ---------------------------------------------------------------------------

#define SIG_BUCKETS 1024
static br_sig* g_sig_buckets[SIG_BUCKETS];

static int32_t align_up(int32_t v, int32_t a) {
  if (a <= 1) return v;
  return (v + a - 1) & ~(a - 1);
}

br_sig* br_sig_get(const char* encoding) {
  if (!encoding || !*encoding) return NULL;
  size_t n = strlen(encoding);
  unsigned long h = djb2(encoding, n) % SIG_BUCKETS;
  for (br_sig* s = g_sig_buckets[h]; s; s = s->next) {
    if (strcmp(s->encoding, encoding) == 0) return s;
  }

  const char* p = encoding;
  br_arg rinfo = (br_arg){0};
  ffi_type* rtype = br_ffi_type_for(&p, &rinfo);
  if (!rtype) return NULL;
  skip_digits(&p);

  // Count and parse arguments.
  int cap = 16, count = 0;
  ffi_type** atypes = (ffi_type**)calloc((size_t)cap, sizeof(ffi_type*));
  br_arg*    ainfo  = (br_arg*)calloc((size_t)cap, sizeof(br_arg));
  int32_t off = 0;
  while (*p) {
    if (count >= cap) {
      cap *= 2;
      atypes = (ffi_type**)realloc(atypes, (size_t)cap * sizeof(ffi_type*));
      ainfo  = (br_arg*)realloc(ainfo, (size_t)cap * sizeof(br_arg));
    }
    br_arg info = (br_arg){0};
    ffi_type* t = br_ffi_type_for(&p, &info);
    if (!t) { free(atypes); free(ainfo); return NULL; }
    skip_digits(&p);
    off = align_up(off, info.align ? info.align : 1);
    info.offset = off;
    off += info.size ? info.size : 1;
    atypes[count] = t;
    ainfo[count] = info;
    count++;
  }

  br_sig* s = (br_sig*)calloc(1, sizeof(br_sig));
  s->encoding = strdup(encoding);
  s->rtype = rtype;
  s->atypes = atypes;
  s->args = ainfo;
  s->nargs = count;
  s->ret = rinfo;
  s->argbuf_size = align_up(off, 16);
  if (s->argbuf_size == 0) s->argbuf_size = 16;
  // libffi requires the return buffer be at least sizeof(ffi_arg) wide.
  s->retbuf_size = (int32_t)((size_t)rinfo.size > sizeof(ffi_arg)
                             ? (size_t)rinfo.size : sizeof(ffi_arg));
  s->retbuf_size = align_up(s->retbuf_size, 16);

  if (ffi_prep_cif(&s->cif, FFI_DEFAULT_ABI, (unsigned)count, rtype, atypes) != FFI_OK) {
    free(s->encoding); free(atypes); free(ainfo); free(s);
    return NULL;
  }

  s->next = g_sig_buckets[h];
  g_sig_buckets[h] = s;
  return s;
}

// ---------------------------------------------------------------------------
// Layout export for JS
// ---------------------------------------------------------------------------

int32_t br_signature_layout(const char* types, int32_t* out, int32_t cap) {
  br_sig* s = br_sig_get(types);
  if (!s) return BR_ERR_BAD_ENCODING;
  int32_t need = 6 + s->nargs * 4;
  if (cap < need) return BR_ERR_OVERFLOW;
  out[0] = s->nargs;
  out[1] = s->argbuf_size;
  out[2] = s->retbuf_size;
  out[3] = s->ret.kind;
  out[4] = s->ret.size;
  out[5] = s->ret.align;
  for (int32_t i = 0; i < s->nargs; i++) {
    out[6 + i * 4 + 0] = s->args[i].kind;
    out[6 + i * 4 + 1] = s->args[i].size;
    out[6 + i * 4 + 2] = s->args[i].align;
    out[6 + i * 4 + 3] = s->args[i].offset;
  }
  return need;
}

int32_t br_type_layout(const char* type, int32_t* out, int32_t cap) {
  if (cap < 3) return BR_ERR_OVERFLOW;
  const char* p = type;
  br_arg info = (br_arg){0};
  ffi_type* t = br_ffi_type_for(&p, &info);
  if (!t) return BR_ERR_BAD_ENCODING;
  out[0] = info.kind;
  out[1] = info.size;
  out[2] = info.align;
  return 3;
}
