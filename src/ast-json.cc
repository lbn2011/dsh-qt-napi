#include "ast-json.h"

#include <string>

#include "cmark-gfm-core-extensions.h"

// Extension node types are process-global variables that the GFM extensions
// assign during registration. `table.h` / `strikethrough.h` declare them with
// C++ linkage, which does not match their C definitions, so they are declared
// here with explicit C linkage instead of including those headers.
extern "C" {
extern cmark_node_type CMARK_NODE_TABLE;
extern cmark_node_type CMARK_NODE_TABLE_ROW;
extern cmark_node_type CMARK_NODE_TABLE_CELL;
extern cmark_node_type CMARK_NODE_STRIKETHROUGH;
}

namespace dsh_qt {
namespace {

/** Literal payload of a node, or "" when it has none (cmark returns null). */
std::string LiteralOf(cmark_node* node) {
  const char* literal = cmark_node_get_literal(node);
  return literal == nullptr ? std::string() : std::string(literal);
}

/**
 * Fenced/indented code literal without cmark's trailing newline.
 *
 * cmark always keeps the line terminator of the last code line; the pure-TS
 * fallback parser in `dsh-qt-app` strips it. Since both parsers must be
 * interchangeable (PHASE-2-PLAN §3.1), the native side follows the fallback and
 * removes exactly one trailing newline.
 */
std::string CodeLiteralOf(cmark_node* node) {
  std::string value = LiteralOf(node);
  if (!value.empty() && value.back() == '\n') value.pop_back();
  return value;
}

Napi::Object MakeToken(Napi::Env env, const char* type) {
  Napi::Object object = Napi::Object::New(env);
  object.Set("type", Napi::String::New(env, type));
  return object;
}

Napi::Object MakeText(Napi::Env env, const std::string& value) {
  Napi::Object object = MakeToken(env, "text");
  object.Set("value", Napi::String::New(env, value));
  return object;
}

Napi::Object MakeHtml(Napi::Env env, const std::string& value) {
  Napi::Object object = MakeToken(env, "html");
  object.Set("value", Napi::String::New(env, value));
  return object;
}

/**
 * Concatenates every literal below `node`.
 *
 * Used for two safety valves: the depth limit and nodes the contract has no
 * token for. Losing structure is always better than losing text.
 */
std::string FlattenText(cmark_node* node) {
  std::string text;
  for (cmark_node* child = cmark_node_first_child(node); child != nullptr; child = cmark_node_next(child)) {
    cmark_node_type type = cmark_node_get_type(child);
    if (type == CMARK_NODE_TEXT || type == CMARK_NODE_CODE || type == CMARK_NODE_CODE_BLOCK) {
      text += LiteralOf(child);
    } else if (type == CMARK_NODE_SOFTBREAK || type == CMARK_NODE_LINEBREAK) {
      text += '\n';
    } else {
      text += FlattenText(child);
    }
  }
  return text;
}

/** Collects a node's children, merging adjacent text/break nodes into one token. */
Napi::Array CollectChildren(Napi::Env env, cmark_node* parent, const AstJsonOptions& options, int depth) {
  Napi::Array children = Napi::Array::New(env);
  uint32_t index = 0;
  std::string pending;
  bool has_pending = false;

  auto flush = [&]() {
    if (!has_pending) return;
    children.Set(index++, MakeText(env, pending));
    pending.clear();
    has_pending = false;
  };

  for (cmark_node* child = cmark_node_first_child(parent); child != nullptr; child = cmark_node_next(child)) {
    const cmark_node_type type = cmark_node_get_type(child);
    if (type == CMARK_NODE_TEXT) {
      pending += LiteralOf(child);
      has_pending = true;
      continue;
    }
    if (type == CMARK_NODE_SOFTBREAK || type == CMARK_NODE_LINEBREAK) {
      pending += '\n';
      has_pending = true;
      continue;
    }
    flush();
    children.Set(index++, NodeToJs(env, child, options, depth + 1));
  }
  flush();
  return children;
}

/** `[["left"], ["center"], null]`-style alignment array for a table node. */
Napi::Array AlignmentsOf(Napi::Env env, cmark_node* table, uint16_t columns) {
  Napi::Array align = Napi::Array::New(env);
  const uint8_t* alignments = cmark_gfm_extensions_get_table_alignments(table);
  for (uint16_t column = 0; column < columns; ++column) {
    const uint8_t value = alignments == nullptr ? 0 : alignments[column];
    if (value == 'l') {
      align.Set(column, Napi::String::New(env, "left"));
    } else if (value == 'c') {
      align.Set(column, Napi::String::New(env, "center"));
    } else if (value == 'r') {
      align.Set(column, Napi::String::New(env, "right"));
    } else {
      align.Set(column, env.Null());
    }
  }
  return align;
}

/** Cell children of one table row, as `MarkdownJSON[][]`. */
Napi::Array RowCells(Napi::Env env, cmark_node* row, const AstJsonOptions& options, int depth) {
  Napi::Array cells = Napi::Array::New(env);
  uint32_t index = 0;
  for (cmark_node* cell = cmark_node_first_child(row); cell != nullptr; cell = cmark_node_next(cell)) {
    if (cmark_node_get_type(cell) != CMARK_NODE_TABLE_CELL) continue;
    cells.Set(index++, CollectChildren(env, cell, options, depth + 1));
  }
  return cells;
}

Napi::Object TableToJs(Napi::Env env, cmark_node* node, const AstJsonOptions& options, int depth) {
  Napi::Object table = MakeToken(env, "table");
  Napi::Array header = Napi::Array::New(env);
  Napi::Array rows = Napi::Array::New(env);
  uint32_t body_index = 0;
  bool header_taken = false;

  for (cmark_node* row = cmark_node_first_child(node); row != nullptr; row = cmark_node_next(row)) {
    if (cmark_node_get_type(row) != CMARK_NODE_TABLE_ROW) continue;
    const bool is_header = cmark_gfm_extensions_get_table_row_is_header(row) != 0;
    if (is_header && !header_taken) {
      header = RowCells(env, row, options, depth);
      header_taken = true;
      continue;
    }
    rows.Set(body_index++, RowCells(env, row, options, depth));
  }

  const uint16_t columns = cmark_gfm_extensions_get_table_columns(node);
  if (columns > 0) {
    // Always emitted, with `null` for unaligned columns, because the pure-TS
    // fallback parser does the same; a renderer can then read `align[i]` without
    // branching on whether the field exists.
    table.Set("align", AlignmentsOf(env, node, columns));
  }

  table.Set("header", header);
  table.Set("rows", rows);
  return table;
}

Napi::Object ListToJs(Napi::Env env, cmark_node* node, const AstJsonOptions& options, int depth) {
  Napi::Object list = MakeToken(env, "list");
  const bool ordered = cmark_node_get_list_type(node) == CMARK_ORDERED_LIST;
  list.Set("ordered", Napi::Boolean::New(env, ordered));
  if (ordered) {
    // `start` is only part of the contract when it is not the implicit 1, so that
    // the payload stays identical to `dsh-qt-app`'s pure-TS fallback parser.
    const int start = cmark_node_get_list_start(node);
    if (start > 1) list.Set("start", Napi::Number::New(env, start));
  }

  Napi::Array items = Napi::Array::New(env);
  Napi::Array checked = Napi::Array::New(env);
  uint32_t index = 0;
  bool task_list = false;

  for (cmark_node* item = cmark_node_first_child(node); item != nullptr; item = cmark_node_next(item)) {
    if (cmark_node_get_type(item) != CMARK_NODE_ITEM) continue;
    items.Set(index, CollectChildren(env, item, options, depth + 1));
    // Task-list state lives on the item; expose it beside `items` so a QML
    // checkbox can be rendered without a second walk of the tree.
    if (cmark_gfm_extensions_get_tasklist_item_checked(item)) {
      checked.Set(index, Napi::Boolean::New(env, true));
      task_list = true;
    } else {
      checked.Set(index, Napi::Boolean::New(env, false));
    }
    ++index;
  }

  list.Set("items", items);
  if (task_list) list.Set("taskChecked", checked);
  return list;
}

Napi::Object ContainerToJs(Napi::Env env, cmark_node* node, const char* type, const AstJsonOptions& options, int depth) {
  Napi::Object object = MakeToken(env, type);
  object.Set("children", CollectChildren(env, node, options, depth));
  return object;
}

Napi::Object UnknownToJs(Napi::Env env, cmark_node* node, const AstJsonOptions& options, int depth) {
  const char* raw = cmark_node_get_type_string(node);
  Napi::Object object;
  if (cmark_node_first_child(node) != nullptr) {
    object = ContainerToJs(env, node, "paragraph", options, depth);
  } else {
    object = MakeHtml(env, LiteralOf(node));
  }
  if (options.annotate_unknown && raw != nullptr) object.Set("rawType", Napi::String::New(env, raw));
  return object;
}

}  // namespace

Napi::Value NodeToJs(Napi::Env env, cmark_node* node, const AstJsonOptions& options, int depth) {
  if (node == nullptr) return MakeHtml(env, std::string());

  if (depth > options.max_depth) return MakeText(env, FlattenText(node));

  switch (cmark_node_get_type(node)) {
    case CMARK_NODE_TEXT:
      return MakeText(env, LiteralOf(node));
    case CMARK_NODE_SOFTBREAK:
    case CMARK_NODE_LINEBREAK:
      return MakeText(env, "\n");
    case CMARK_NODE_PARAGRAPH:
      return ContainerToJs(env, node, "paragraph", options, depth);
    case CMARK_NODE_BLOCK_QUOTE:
      return ContainerToJs(env, node, "blockquote", options, depth);
    case CMARK_NODE_EMPH:
      return ContainerToJs(env, node, "emphasis", options, depth);
    case CMARK_NODE_STRONG:
      return ContainerToJs(env, node, "strong", options, depth);
    case CMARK_NODE_HTML_BLOCK:
    case CMARK_NODE_HTML_INLINE:
      return MakeHtml(env, LiteralOf(node));
    case CMARK_NODE_CODE: {
      Napi::Object code = MakeToken(env, "code");
      code.Set("value", Napi::String::New(env, LiteralOf(node)));
      code.Set("inline", Napi::Boolean::New(env, true));
      return code;
    }
    case CMARK_NODE_CODE_BLOCK: {
      Napi::Object code = MakeToken(env, "code");
      code.Set("value", Napi::String::New(env, CodeLiteralOf(node)));
      code.Set("inline", Napi::Boolean::New(env, false));
      const char* language = cmark_node_get_fence_info(node);
      if (language != nullptr && *language != '\0') code.Set("language", Napi::String::New(env, language));
      return code;
    }
    case CMARK_NODE_HEADING: {
      Napi::Object heading = MakeToken(env, "heading");
      int level = cmark_node_get_heading_level(node);
      if (level < 1 || level > 6) level = 1;
      heading.Set("level", Napi::Number::New(env, level));
      heading.Set("children", CollectChildren(env, node, options, depth));
      return heading;
    }
    case CMARK_NODE_THEMATIC_BREAK:
      return MakeToken(env, "thematicBreak");
    case CMARK_NODE_LINK:
    case CMARK_NODE_IMAGE: {
      Napi::Object link = MakeToken(env, "link");
      const char* href = cmark_node_get_url(node);
      link.Set("href", Napi::String::New(env, href == nullptr ? "" : href));
      const char* title = cmark_node_get_title(node);
      if (title != nullptr && *title != '\0') link.Set("title", Napi::String::New(env, title));
      if (cmark_node_get_type(node) == CMARK_NODE_IMAGE) link.Set("image", Napi::Boolean::New(env, true));
      link.Set("children", CollectChildren(env, node, options, depth));
      return link;
    }
    case CMARK_NODE_LIST:
      return ListToJs(env, node, options, depth);
    case CMARK_NODE_DOCUMENT:
      return ContainerToJs(env, node, "document", options, depth);
    default:
      break;
  }

  // Extension nodes carry process-global type ids; compare rather than switch
  // because their values are only known after registration.
  const cmark_node_type type = cmark_node_get_type(node);
  if (type != CMARK_NODE_NONE) {
    if (type == CMARK_NODE_STRIKETHROUGH) return ContainerToJs(env, node, "strikethrough", options, depth);
    if (type == CMARK_NODE_TABLE) return TableToJs(env, node, options, depth);
    if (type == CMARK_NODE_TABLE_ROW || type == CMARK_NODE_TABLE_CELL) {
      return ContainerToJs(env, node, "paragraph", options, depth);
    }
  }

  return UnknownToJs(env, node, options, depth);
}

Napi::Object DocumentToJs(Napi::Env env, cmark_node* document, const AstJsonOptions& options) {
  if (document == nullptr) {
    Napi::Object empty = MakeToken(env, "document");
    empty.Set("children", Napi::Array::New(env));
    return empty;
  }
  Napi::Object root = MakeToken(env, "document");
  root.Set("children", CollectChildren(env, document, options, 0));
  return root;
}

}  // namespace dsh_qt
