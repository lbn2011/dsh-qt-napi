/**
 * GFM extension registry for the cmark-gfm N-API addon.
 *
 * cmark-gfm keeps its GitHub-flavoured syntax (tables, strikethrough, autolinks,
 * task lists, tag filtering) in *syntax extensions* that must be registered once
 * and then attached to a parser or handed to the HTML renderer.
 *
 * This file owns exactly that lifecycle:
 *   - `EnsureCoreExtensionsRegistered()` registers the compiled-in extensions
 *     with cmark's global registry exactly once per process (thread safe);
 *   - `ResolveExtensions()` turns the caller's feature toggles into the concrete
 *     extension pointers;
 *   - `BuildExtensionList()` / `FreeExtensionList()` wrap them in the
 *     `cmark_llist` that `cmark_render_html()` expects.
 *
 * Everything here is pure C++/cmark; no N-API types leak into this header so it
 * can be unit reasoned about independently of the binding surface.
 */
#ifndef DSH_QT_EXTENSION_REGISTRY_H_
#define DSH_QT_EXTENSION_REGISTRY_H_

#include <string>
#include <vector>

#include "cmark-gfm-core-extensions.h"
#include "cmark-gfm.h"

namespace dsh_qt {

/** Which compiled-in GFM extensions a call wants. Defaults mirror GFM itself. */
struct ExtensionOptions {
  bool tables = true;
  bool strikethrough = true;
  bool autolink = true;
  bool tasklist = true;
  bool tagfilter = true;

  /** True when every toggle is off, i.e. plain CommonMark parsing. */
  bool commonmark_only() const {
    return !tables && !strikethrough && !autolink && !tasklist && !tagfilter;
  }
};

/**
 * Names of the extensions this binary can register, in canonical order.
 *
 * Exposed to JavaScript as the addon's `supportedExtensions` property so the
 * host can report precisely what it offers instead of guessing.
 */
const std::vector<std::string>& AvailableExtensionNames();

/**
 * Registers the compiled-in GFM extensions with cmark.
 *
 * Idempotent and safe to call from the main thread, a worker thread, or both:
 * registration mutates a process-global registry, so it is guarded by
 * `std::call_once`. Never throws.
 */
void EnsureCoreExtensionsRegistered();

/**
 * Resolves the requested toggles into cmark extension pointers.
 *
 * A toggle that has no matching extension in this build is silently skipped
 * (e.g. a future extension pruned from `binding.gyp`), which keeps the addon
 * forward compatible with its own build matrix.
 */
std::vector<cmark_syntax_extension*> ResolveExtensions(const ExtensionOptions& options);

/**
 * Builds the linked list of extensions used by `cmark_render_html()`.
 *
 * Returns nullptr when `extensions` is empty (plain CommonMark rendering).
 * The caller must release the result with `FreeExtensionList()`.
 */
cmark_llist* BuildExtensionList(const std::vector<cmark_syntax_extension*>& extensions);

/** Releases a list produced by `BuildExtensionList()`. No-op for nullptr. */
void FreeExtensionList(cmark_llist* list);

/**
 * Translates the host's rendering flags into cmark option bits.
 *
 * `allow_unsafe_html` maps to `CMARK_OPT_UNSAFE`; the addon keeps it off by
 * default because chat transcripts routinely contain untrusted HTML.
 */
int CmarkRenderOptions(bool allow_unsafe_html, bool smart, bool hard_breaks, bool github_pre_lang);

}  // namespace dsh_qt

#endif  // DSH_QT_EXTENSION_REGISTRY_H_
