/**
 * dsh-qt-napi — cmark-gfm N-API binding (addon name: `qt-bridge`).
 *
 * The Qt host must never render chat Markdown with a browser engine, and it
 * must never take the DSH process down when the addon is missing. This addon
 * therefore exposes a *pure data* API shaped exactly like the MarkdownNode
 * contract in `dsh-qt-app/docs/PHASE-2-PLAN.md` § 3.1, plus an HTML renderer for
 * hosts that want ready-made markup:
 *
 *   parse(markdown, options?)        -> MarkdownDocument JSON object
 *   parseBlocks(markdown, options?)  -> MarkdownNode[] (the document's children)
 *   parseToJson(markdown, options?)  -> JSON string of the document
 *   renderMarkdown(markdown, opts?)  -> HTML string
 *   highlightCode(code, lang?, opts?) -> <pre><code> string (no syntax colours)
 *   escapeHtml(text)                 -> HTML entity escaped string
 *
 * Every entry point validates its arguments and reports failures as ordinary
 * JavaScript exceptions; nothing here calls `abort()`, leaks a cmark node, or
 * trusts input size. The TypeScript side (`dsh-qt-app/src/qt-bridge/napi-loader.ts`)
 * treats any throw as "addon unusable" and falls back to its degraded renderer.
 *
 * Design decisions worth knowing:
 *   - cmark-gfm is compiled *statically* into this binary (see binding.gyp), so a
 *     prebuilt .node has no external dependency and can be dropped into any
 *     Linux/macOS/Windows app bundle.
 *   - No native syntax highlighting. Per PHASE-2-PLAN decision D1 the host
 *     highlights with Shiki lazily and falls back to monospace text, so
 *     `highlightCode()` only escapes and wraps; adding a native highlighter here
 *     would duplicate that policy in the wrong layer.
 *   - Raw HTML is preserved in the AST as `html` tokens (renderers must escape
 *     it) and is *not* passed through to HTML output unless the caller opts in
 *     with `allowUnsafeHtml`.
 */
#include <napi.h>

#include <cstddef>
#include <string>
#include <vector>

#include "ast-json.h"
#include "cmark-gfm.h"
#include "extension-registry.h"

namespace {

/** Hard ceiling on one parse call; larger payloads are rejected, not truncated. */
constexpr std::size_t kMaxInputBytes = 16u * 1024u * 1024u;

/** Default AST depth limit; mirrors `AstJsonOptions::max_depth`. */
constexpr int kDefaultMaxDepth = 64;

constexpr const char* kAddonVersion = "0.1.0";

#if defined(_WIN32)
constexpr const char* kNodePlatform = "win32";
#elif defined(__APPLE__)
constexpr const char* kNodePlatform = "darwin";
#else
constexpr const char* kNodePlatform = "linux";
#endif

#if defined(__x86_64__) || defined(_M_X64)
constexpr const char* kNodeArch = "x64";
#elif defined(__aarch64__) || defined(_M_ARM64)
constexpr const char* kNodeArch = "arm64";
#elif defined(__i386__) || defined(_M_IX86)
constexpr const char* kNodeArch = "ia32";
#else
constexpr const char* kNodeArch = "unknown";
#endif

/** Reads an optional boolean member, tolerating missing keys of any type. */
bool ReadBool(const Napi::Object& options, const char* key, bool fallback) {
  if (!options.Has(key)) return fallback;
  Napi::Value value = options.Get(key);
  return value.IsBoolean() ? value.As<Napi::Boolean>().Value() : fallback;
}

/** Reads an optional non-negative integer member. */
int ReadInt(const Napi::Object& options, const char* key, int fallback) {
  if (!options.Has(key)) return fallback;
  Napi::Value value = options.Get(key);
  if (!value.IsNumber()) return fallback;
  const double number = value.As<Napi::Number>().DoubleValue();
  if (number < 0) return fallback;
  return static_cast<int>(number);
}

/** Everything a single call needs, derived from the caller's options object. */
struct CallOptions {
  dsh_qt::ExtensionOptions extensions;
  dsh_qt::AstJsonOptions ast;
  int render_options = CMARK_OPT_DEFAULT;
};

/**
 * Parses `options` into {@link CallOptions}.
 *
 * Unknown keys are ignored on purpose: the TypeScript side passes its whole
 * `MarkdownOptions` (which also carries UI-only fields such as `theme`), and a
 * newer host must not break an older addon.
 */
CallOptions ReadCallOptions(const Napi::Value& value) {
  CallOptions result;
  if (!value.IsObject()) return result;

  const Napi::Object options = value.As<Napi::Object>();
  result.extensions.tables = ReadBool(options, "enableTables", true);
  result.extensions.strikethrough = ReadBool(options, "enableStrikethrough", true);
  result.extensions.autolink = ReadBool(options, "enableAutolink", true);
  result.extensions.tasklist = ReadBool(options, "enableTasklist", true);
  result.extensions.tagfilter = ReadBool(options, "enableTagfilter", true);
  result.ast.max_depth = ReadInt(options, "maxDepth", kDefaultMaxDepth);
  result.ast.annotate_unknown = ReadBool(options, "annotateUnknown", true);
  result.render_options = dsh_qt::CmarkRenderOptions(ReadBool(options, "allowUnsafeHtml", false),
                                                    ReadBool(options, "smart", false),
                                                    ReadBool(options, "hardBreaks", false),
                                                    ReadBool(options, "githubPreLang", true));
  return result;
}

/**
 * Owns a parsed cmark document and the parser that produced it.
 *
 * cmark hands ownership of the finished document to the caller, so both the
 * document and the parser must be released; doing it in a destructor makes the
 * early-return paths in the entry points exception safe.
 */
class ParsedDocument {
 public:
  ParsedDocument(const std::string& markdown, const CallOptions& options) {
    extensions_ = dsh_qt::ResolveExtensions(options.extensions);
    // CMARK_OPT_SMART is a *parse-time* option: cmark rewrites quotes/dashes while
    // building inline nodes, so it must reach the parser and not only the renderer.
    // The other bits (UNSAFE, HARDBREAKS, GITHUB_PRE_LANG) are ignored by the
    // parser and read again at render time.
    parser_ = cmark_parser_new(options.render_options);
    if (parser_ == nullptr) return;

    for (cmark_syntax_extension* extension : extensions_) {
      cmark_parser_attach_syntax_extension(parser_, extension);
    }
    cmark_parser_feed(parser_, markdown.c_str(), markdown.size());
    document_ = cmark_parser_finish(parser_);
  }

  ~ParsedDocument() {
    if (document_ != nullptr) cmark_node_free(document_);
    if (parser_ != nullptr) cmark_parser_free(parser_);
  }

  ParsedDocument(const ParsedDocument&) = delete;
  ParsedDocument& operator=(const ParsedDocument&) = delete;

  /** The parsed document, or nullptr when cmark could not allocate a parser. */
  cmark_node* document() const { return document_; }

  /** Extensions that were attached to the parser; reuse them for rendering. */
  const std::vector<cmark_syntax_extension*>& extensions() const { return extensions_; }

 private:
  cmark_parser* parser_ = nullptr;
  cmark_node* document_ = nullptr;
  std::vector<cmark_syntax_extension*> extensions_;
};

/** True when `text` fits the input budget. */
bool WithinBudget(std::size_t length) { return length <= kMaxInputBytes; }

/**
 * Fetches argument `index` as a string.
 *
 * Throws a `TypeError` (visible to the caller as a normal JS exception) and
 * returns false when the value is missing or of the wrong type.
 */
bool GetStringArg(const Napi::CallbackInfo& info, std::size_t index, const char* label, std::string* out) {
  Napi::Env env = info.Env();
  if (info.Length() <= index || !info[index].IsString()) {
    Napi::TypeError::New(env, std::string(label) + " must be a string").ThrowAsJavaScriptException();
    return false;
  }
  *out = info[index].As<Napi::String>().Utf8Value();
  if (!WithinBudget(out->size())) {
    Napi::RangeError::New(env, std::string(label) + " exceeds the 16 MiB parse budget")
        .ThrowAsJavaScriptException();
    return false;
  }
  return true;
}

/** Converts a std::string to a V8 string without letting an exception escape. */
Napi::String ToJsString(Napi::Env env, const std::string& value) { return Napi::String::New(env, value); }

/** Escapes text for HTML text-node and attribute contexts. */
std::string EscapeHtml(const std::string& text) {
  std::string escaped;
  escaped.reserve(text.size() + (text.size() / 8));
  for (const char character : text) {
    switch (character) {
      case '&':
        escaped += "&amp;";
        break;
      case '<':
        escaped += "&lt;";
        break;
      case '>':
        escaped += "&gt;";
        break;
      case '"':
        escaped += "&quot;";
        break;
      case '\'':
        escaped += "&#39;";
        break;
      default:
        escaped += character;
        break;
    }
  }
  return escaped;
}

// --- exported entry points ---------------------------------------------------

/** `parse(markdown, options?) -> { type: "document", children: [...] }` */
Napi::Value Parse(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    std::string markdown;
    if (!GetStringArg(info, 0, "markdown", &markdown)) return env.Null();

    const CallOptions options = ReadCallOptions(info.Length() > 1 ? info[1] : env.Undefined());
    ParsedDocument parsed(markdown, options);
    if (parsed.document() == nullptr) {
      Napi::Error::New(env, "cmark-gfm failed to allocate a document").ThrowAsJavaScriptException();
      return env.Null();
    }
    return dsh_qt::DocumentToJs(env, parsed.document(), options.ast);
  } catch (const std::exception& error) {
    Napi::Error::New(env, std::string("parse() failed: ") + error.what()).ThrowAsJavaScriptException();
    return env.Null();
  } catch (...) {
    Napi::Error::New(env, "parse() failed with an unknown error").ThrowAsJavaScriptException();
    return env.Null();
  }
}

/** `parseBlocks(markdown, options?) -> MarkdownNode[]` */
Napi::Value ParseBlocks(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Value document = Parse(info);
  if (!document.IsObject()) return Napi::Array::New(env);
  return document.As<Napi::Object>().Get("children");
}

/** `parseToJson(markdown, options?) -> string` (UTF-8 JSON of the document) */
Napi::Value ParseToJson(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Value document = Parse(info);
  if (!document.IsObject()) return Napi::String::New(env, "{\"type\":\"document\",\"children\":[]}");

  Napi::Value json = env.Global().Get("JSON");
  Napi::Object json_object = json.As<Napi::Object>();
  Napi::Function stringify = json_object.Get("stringify").As<Napi::Function>();
  return stringify.Call(json_object, {document});
}

/** `renderMarkdown(markdown, options?) -> string` */
Napi::Value RenderMarkdown(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    std::string markdown;
    if (!GetStringArg(info, 0, "markdown", &markdown)) return env.Null();

    const CallOptions options = ReadCallOptions(info.Length() > 1 ? info[1] : env.Undefined());
    ParsedDocument parsed(markdown, options);
    if (parsed.document() == nullptr) {
      Napi::Error::New(env, "cmark-gfm failed to allocate a document").ThrowAsJavaScriptException();
      return env.Null();
    }

    cmark_llist* extensions = dsh_qt::BuildExtensionList(parsed.extensions());
    char* html = cmark_render_html(parsed.document(), options.render_options, extensions);
    dsh_qt::FreeExtensionList(extensions);
    if (html == nullptr) {
      Napi::Error::New(env, "cmark-gfm failed to render HTML").ThrowAsJavaScriptException();
      return env.Null();
    }
    Napi::String result = Napi::String::New(env, html);
    cmark_get_default_mem_allocator()->free(html);
    return result;
  } catch (const std::exception& error) {
    Napi::Error::New(env, std::string("renderMarkdown() failed: ") + error.what()).ThrowAsJavaScriptException();
    return env.Null();
  } catch (...) {
    Napi::Error::New(env, "renderMarkdown() failed with an unknown error").ThrowAsJavaScriptException();
    return env.Null();
  }
}

/**
 * `highlightCode(code, language?, options?) -> string`
 *
 * Deliberately performs **no highlighting**: decision D1 puts highlighting in
 * the host's lazily loaded Shiki instance. This function only produces the
 * structurally correct, fully escaped `pre > code` wrapper so the Qt side has a
 * stable element to decorate, and so code blocks stay readable (monospace,
 * preserved whitespace) when no highlighter is loaded.
 */
Napi::Value HighlightCode(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  try {
    std::string code;
    if (!GetStringArg(info, 0, "code", &code)) return env.Null();

    std::string language;
    if (info.Length() > 1 && info[1].IsString()) {
      language = info[1].As<Napi::String>().Utf8Value();
    }

    // Highlighting itself belongs to the host (decision D1); only the wrapper
    // options are honoured here.
    Napi::Object code_options = info.Length() > 2 && info[2].IsObject() ? info[2].As<Napi::Object>()
                                                                       : Napi::Object::New(env);
    const bool line_numbers = ReadBool(code_options, "lineNumbers", false);

    std::string html = "<pre class=\"dsh-qt-code";
    if (line_numbers) html += " line-numbers";
    html += "\"><code";
    if (!language.empty()) {
      html += " class=\"language-";
      html += EscapeHtml(language);
      html += "\"";
      html += " data-language=\"";
      html += EscapeHtml(language);
      html += "\"";
    }
    html += ">";
    html += EscapeHtml(code);
    html += "</code></pre>";
    return ToJsString(env, html);
  } catch (const std::exception& error) {
    Napi::Error::New(env, std::string("highlightCode() failed: ") + error.what()).ThrowAsJavaScriptException();
    return env.Null();
  } catch (...) {
    Napi::Error::New(env, "highlightCode() failed with an unknown error").ThrowAsJavaScriptException();
    return env.Null();
  }
}

/** `escapeHtml(text) -> string` */
Napi::Value EscapeHtmlExport(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string text;
  if (!GetStringArg(info, 0, "text", &text)) return env.Null();
  return ToJsString(env, EscapeHtml(text));
}

/** `parseInline(markdown, options?) -> MarkdownNode[]` (block-level result) */
Napi::Value ParseInline(const Napi::CallbackInfo& info) {
  return ParseBlocks(info);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  dsh_qt::EnsureCoreExtensionsRegistered();

  exports.Set("parse", Napi::Function::New(env, Parse, "parse"));
  exports.Set("parseBlocks", Napi::Function::New(env, ParseBlocks, "parseBlocks"));
  exports.Set("parseInline", Napi::Function::New(env, ParseInline, "parseInline"));
  exports.Set("parseToJson", Napi::Function::New(env, ParseToJson, "parseToJson"));
  exports.Set("renderMarkdown", Napi::Function::New(env, RenderMarkdown, "renderMarkdown"));
  exports.Set("highlightCode", Napi::Function::New(env, HighlightCode, "highlightCode"));
  exports.Set("escapeHtml", Napi::Function::New(env, EscapeHtmlExport, "escapeHtml"));

  exports.Set("version", ToJsString(env, kAddonVersion));
  exports.Set("cmarkVersion", ToJsString(env, CMARK_GFM_VERSION_STRING));
  exports.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  exports.Set("platform", ToJsString(env, kNodePlatform));
  exports.Set("arch", ToJsString(env, kNodeArch));

  const std::vector<std::string>& names = dsh_qt::AvailableExtensionNames();
  Napi::Array supported = Napi::Array::New(env, names.size());
  for (std::size_t index = 0; index < names.size(); ++index) {
    supported.Set(static_cast<uint32_t>(index), ToJsString(env, names[index]));
  }
  exports.Set("supportedExtensions", supported);
  return exports;
}

}  // namespace

NODE_API_MODULE(qt_bridge, Init)
