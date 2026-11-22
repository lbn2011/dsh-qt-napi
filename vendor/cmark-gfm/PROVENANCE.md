# Vendored cmark-gfm provenance
#
# This directory contains a *partial* vendored copy of github/cmark-gfm, the
# CommonMark + GitHub Flavored Markdown reference implementation written in C.
# It is compiled directly into the `qt-bridge` N-API addon (see ../../binding.gyp),
# so the addon is a single self-contained .node binary with no runtime shared
# library dependency (no system libcmark-gfm, no DLL, no /usr/lib/libcmark-gfm.so).

## Upstream

| field           | value                                                  |
| --------------- | ------------------------------------------------------ |
| repository      | https://github.com/github/cmark-gfm                    |
| revision        | `7fe8904ee31fa24b772ae565c4908b1394850de6` (master)    |
| revision date   | 2026-11-18                                             |
| version         | `0.29.0.gfm.14` (PROJECT_VERSION_* in upstream CMakeLists.txt) |
| license         | BSD-2-Clause — see `COPYING`                           |

## Version note (important)

The t11 contract asks for "cmark-gfm 0.30+". **cmark-gfm has no 0.30 release
line**: its tags are `0.29.0.gfm.1` … `0.29.0.gfm.14`, and upstream master
still reports `PROJECT_VERSION 0.29.0.gfm.14`. (The `0.30`/`0.31` versions
belong to `commonmark/cmark`, the upstream project cmark-gfm forked from.)
`0.29.0.gfm.14` is therefore the newest cmark-gfm that exists, and it is what
is vendored here. Refreshing to a "0.30" tag is not possible until upstream
cuts one; `cmarkVersion` on the addon makes the pinned version observable at
runtime so drift is easy to audit.

## What is vendored

`src/` — 44 files (22 `.c`): the parser core, AST, HTML renderer, extension
framework and generated scanners (`scanners.c`, `entities.inc`,
`case_fold_switch.inc`), all copied verbatim.

Two of them are needed for symbol reasons, not convenience:

| file        | why it cannot be dropped                                                                 |
| ----------- | ---------------------------------------------------------------------------------------- |
| `cmark.c`   | defines `CMARK_DEFAULT_MEM_ALLOCATOR`, `cmark_version*()` and the `CMARK_NODE_LAST_BLOCK` / `CMARK_NODE_LAST_INLINE` globals that `node.c`, `blocks.c`, `registry.c`, `plugin.c` and `syntax_extension.c` reference. Omitting it links but fails to `dlopen` (`undefined symbol: CMARK_DEFAULT_MEM_ALLOCATOR`). |
| `scanners.c`| re2c-generated; holds `scan_link_title` and friends used by `inlines.c`. Omitting it links but fails to `dlopen` (`undefined symbol: _scan_link_title`). |

`extensions/` — 14 files: `core-extensions.c` (registry) plus the GFM
extensions this addon registers: `table.c`, `strikethrough.c`, `autolink.c`,
`tasklist.c`, `tagfilter.c`, and the generated `ext_scanners.c`.

`gen/` — three headers that upstream *generates with CMake*, hand-written here
because this package builds with node-gyp instead:

- `config.h` (from `src/config.h.in`) — resolved for GCC/Clang and MSVC
- `cmark-gfm_export.h` (from CMake's `GenerateExportHeader`) — empty `CMARK_GFM_EXPORT`
  because the library is linked statically into the addon
- `cmark-gfm_version.h` (from `src/cmark-gfm_version.h.in`) — pinned version numbers

## What is deliberately not vendored

| upstream file(s)                                             | reason                                        |
| ------------------------------------------------------------ | --------------------------------------------- |
| `src/main.c`                                                 | CLI entry point (`main()`), not a library file |
| `src/commonmark.c`, `man.c`, `latex.c`, `xml.c`, `plaintext.c` | alternative renderers we do not expose        |
| `test/`, `api_test/`, `benchmarks/`, `man/`, `changelog.txt`, `build/`, `.github/` | upstream test/fuzz/CI assets, not needed to build |
| `src/libcmark-gfm.pc.in`, `*.h.in`, `CMakeLists.txt`         | CMake/packaging inputs replaced by `binding.gyp` |

## Refreshing the vendored copy

```sh
git clone --depth 1 https://github.com/github/cmark-gfm /tmp/cmark-gfm
# copy src/*.c src/*.h src/*.inc (minus the exclusions above) -> vendor/cmark-gfm/src
# copy extensions/*.c extensions/*.h                             -> vendor/cmark-gfm/extensions
# update gen/cmark-gfm_version.h to the new PROJECT_VERSION_GFM
# update the revision table above
pnpm -C .. build && node ..\scripts\verify.mjs   # or: npm --prefix .. run build
```

The addon's `cmarkVersion` property reports `CMARK_GFM_VERSION_STRING`, so a
stale `gen/cmark-gfm_version.h` is caught by the test suite.
