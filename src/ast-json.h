/**
 * cmark AST -> MarkdownNode JSON conversion.
 *
 * The host renders chat bubbles from a small, renderer-agnostic tree described
 * in `dsh-qt-app/docs/PHASE-2-PLAN.md` § 3.1. This file is the native half of
 * that contract: it walks a cmark node tree and produces plain JavaScript
 * objects of exactly the shape the TypeScript side produces via
 * `MarkdownNode#toJSON()`, so both engines are interchangeable.
 *
 * Token mapping (cmark node -> contract token):
 *
 *   DOCUMENT            -> document      { children }
 *   PARAGRAPH           -> paragraph     { children }
 *   HEADING             -> heading       { level, children }
 *   BLOCK_QUOTE         -> blockquote    { children }
 *   LIST                -> list          { ordered, start?, items: Node[][] }
 *   ITEM                -> (flattened into the owning list's `items`)
 *   CODE_BLOCK          -> code          { value, inline: false, language? }
 *   CODE (inline)       -> code          { value, inline: true }
 *   HTML_BLOCK/_INLINE  -> html          { value }
 *   TEXT                -> text          { value }
 *   SOFTBREAK/LINEBREAK -> text          { value: "\n" }
 *   EMPH                -> emphasis      { children }
 *   STRONG              -> strong        { children }
 *   strike (extension)  -> strikethrough { children }
 *   LINK                -> link          { href, title?, children }
 *   IMAGE               -> link          { href, title?, image: true, children }
 *   THEMATIC_BREAK      -> thematicBreak {}
 *   TABLE (extension)   -> table         { header: Node[][], rows: Node[][][], align? }
 *   TASKLIST (extension)-> list          { ordered, items, taskChecked?: bool[] }
 *   everything else     -> paragraph | html, plus a `rawType` diagnostic
 *
 * Table alignment: cmark-gfm does expose it after all, through
 * `cmark_gfm_extensions_get_table_alignments()` (0 = none, 'l'/'c'/'r'). Every
 * table carries `align` as an array of `'left' | 'center' | 'right' | null` with
 * one entry per column, mirroring the pure-TS fallback parser exactly so a
 * renderer can consume either parser's output unchanged.
 *
 * The extension node types (CMARK_NODE_TABLE/_ROW/_CELL, strike node) are `extern`
 * variables that cmark-gfm assigns during `cmark_gfm_core_extensions_ensure_registered()`,
 * and their headers declare them with C++ linkage. `ast-json.cc` therefore
 * declares them inside an `extern "C"` block instead of including `table.h` /
 * `strikethrough.h`, and the registry must be initialised before the first
 * `Parse`/`Render` call (`EnsureCoreExtensionsRegistered()` does that).
 */
#ifndef DSH_QT_AST_JSON_H_
#define DSH_QT_AST_JSON_H_

#include <napi.h>

#include "cmark-gfm.h"

namespace dsh_qt {

/** Conversion limits; both exist so a hostile document cannot exhaust memory. */
struct AstJsonOptions {
  /** Deeper subtrees are flattened to text instead of converted. */
  int max_depth = 64;
  /** Attach `rawType` to nodes the contract has no token for (diagnostics). */
  bool annotate_unknown = true;
};

/**
 * Converts one cmark node into its contract JSON object.
 *
 * `depth` is the distance from the document root; callers pass 0.
 * Structural helper nodes (list items, table rows/cells) are represented by
 * their parents rather than by this function.
 */
Napi::Value NodeToJs(Napi::Env env, cmark_node* node, const AstJsonOptions& options, int depth);

/**
 * Converts a parsed cmark document into the contract's root object:
 * `{ type: "document", children: [...] }`.
 *
 * Returns an empty document object when `document` is null.
 */
Napi::Object DocumentToJs(Napi::Env env, cmark_node* document, const AstJsonOptions& options);

}  // namespace dsh_qt

#endif  // DSH_QT_AST_JSON_H_
