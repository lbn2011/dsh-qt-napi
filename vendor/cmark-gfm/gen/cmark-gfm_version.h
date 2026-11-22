/*
 * cmark-gfm_version.h — hand-maintained replacement for the CMake-generated
 * file (upstream: src/cmark-gfm_version.h.in).
 *
 * Values mirror PROJECT_VERSION_* in the upstream CMakeLists.txt of the
 * vendored revision (see PROVENANCE.md). Bump them together with the vendor
 * refresh; `src/cmark-binding.cc` exposes CMARK_GFM_VERSION_STRING as the
 * addon's `cmarkVersion` property so drift is visible at runtime.
 */
#ifndef CMARK_GFM_VERSION_H
#define CMARK_GFM_VERSION_H

#define CMARK_GFM_VERSION ((0 << 24) | (29 << 16) | (0 << 8) | 14)
#define CMARK_GFM_VERSION_STRING "0.29.0.gfm.14"

#endif
