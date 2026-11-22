/*
 * config.h — hand-maintained replacement for the CMake-generated file.
 *
 * Upstream cmark-gfm generates src/config.h from src/config.h.in through
 * `#cmakedefine` substitutions. This package builds cmark-gfm from binding.gyp
 * (node-gyp) instead of CMake, so the same three probes are resolved here, by
 * hand, for every supported platform. Keep this file in sync with the upstream
 * template when the vendored sources are refreshed.
 *
 * Resolved values:
 *   HAVE_STDBOOL_H       1 on every platform we support (C99/C++11 toolchains)
 *   HAVE___BUILTIN_EXPECT 1 on GCC/Clang, 0 on MSVC
 *   HAVE___ATTRIBUTE__    1 on GCC/Clang, 0 on MSVC
 */
#ifndef CMARK_CONFIG_H
#define CMARK_CONFIG_H

#ifdef __cplusplus
extern "C" {
#endif

#define HAVE_STDBOOL_H 1

#ifdef HAVE_STDBOOL_H
  #include <stdbool.h>
#elif !defined(__cplusplus)
  typedef char bool;
#endif

#if defined(_MSC_VER)
  /* MSVC has neither __builtin_expect nor __attribute__. */
  /* #undef HAVE___BUILTIN_EXPECT */
  /* #undef HAVE___ATTRIBUTE__ */
#else
  #define HAVE___BUILTIN_EXPECT 1
  #define HAVE___ATTRIBUTE__ 1
#endif

#ifdef HAVE___ATTRIBUTE__
  #define CMARK_ATTRIBUTE(list) __attribute__ (list)
#else
  #define CMARK_ATTRIBUTE(list)
#endif

#ifndef CMARK_INLINE
  #if defined(_MSC_VER) && !defined(__cplusplus)
    #define CMARK_INLINE __inline
  #else
    #define CMARK_INLINE inline
  #endif
#endif

/* MSVC before 2015 lacked C99 snprintf; every compiler we target (MSVC 2015+,
 * GCC, Clang) provides it, so the upstream fallback block is intentionally
 * dropped rather than reproduced. */

#ifdef __cplusplus
}
#endif

#endif
