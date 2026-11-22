#include "extension-registry.h"

#include <mutex>

namespace dsh_qt {
namespace {

const std::vector<std::string> kExtensionNames = {
    "table",
    "strikethrough",
    "autolink",
    "tasklist",
    "tagfilter",
};

std::once_flag g_registration;

}  // namespace

const std::vector<std::string>& AvailableExtensionNames() { return kExtensionNames; }

void EnsureCoreExtensionsRegistered() {
  std::call_once(g_registration, []() { cmark_gfm_core_extensions_ensure_registered(); });
}

std::vector<cmark_syntax_extension*> ResolveExtensions(const ExtensionOptions& options) {
  std::vector<cmark_syntax_extension*> resolved;
  if (options.commonmark_only()) return resolved;

  EnsureCoreExtensionsRegistered();

  const std::pair<const char*, bool> requested[] = {
      {"table", options.tables},
      {"strikethrough", options.strikethrough},
      {"autolink", options.autolink},
      {"tasklist", options.tasklist},
      {"tagfilter", options.tagfilter},
  };

  resolved.reserve(std::size(requested));
  for (const auto& entry : requested) {
    if (!entry.second) continue;
    cmark_syntax_extension* extension = cmark_find_syntax_extension(entry.first);
    // A toggle without a compiled-in implementation is skipped rather than
    // failing the whole parse: degraded output beats no output in the UI.
    if (extension != nullptr) resolved.push_back(extension);
  }
  return resolved;
}

cmark_llist* BuildExtensionList(const std::vector<cmark_syntax_extension*>& extensions) {
  if (extensions.empty()) return nullptr;
  cmark_mem* mem = cmark_get_default_mem_allocator();
  cmark_llist* list = nullptr;
  for (cmark_syntax_extension* extension : extensions) {
    list = cmark_llist_append(mem, list, extension);
  }
  return list;
}

void FreeExtensionList(cmark_llist* list) {
  if (list == nullptr) return;
  cmark_llist_free(cmark_get_default_mem_allocator(), list);
}

int CmarkRenderOptions(bool allow_unsafe_html, bool smart, bool hard_breaks, bool github_pre_lang) {
  int options = CMARK_OPT_DEFAULT;
  if (allow_unsafe_html) options |= CMARK_OPT_UNSAFE;
  if (smart) options |= CMARK_OPT_SMART;
  if (hard_breaks) options |= CMARK_OPT_HARDBREAKS;
  if (github_pre_lang) options |= CMARK_OPT_GITHUB_PRE_LANG;
  return options;
}

}  // namespace dsh_qt
