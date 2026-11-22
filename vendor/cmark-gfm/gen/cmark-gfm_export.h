/*
 * cmark-gfm_export.h — hand-maintained replacement for the CMake-generated
 * export header (upstream uses GenerateExportHeader.cmake).
 *
 * The addon links cmark-gfm **statically** into a single .node binary, so no
 * symbol is ever exported across a shared-library boundary. Keeping the macro
 * empty on every platform is therefore correct, and it removes the need for
 * __declspec(dllexport)/visibility attributes that only make sense for a DLL.
 */
#ifndef CMARK_GFM_EXPORT_H
#define CMARK_GFM_EXPORT_H

#ifndef CMARK_GFM_EXPORT
  #define CMARK_GFM_EXPORT
#endif

#ifndef CMARK_GFM_NO_EXPORT
  #define CMARK_GFM_NO_EXPORT
#endif

#endif
