/**
 * Type definitions for `dsh-qt-napi`.
 *
 * The AST types here are the *same* contract that `dsh-qt-app/src/markdown/types.ts`
 * implements for the pure-TS fallback parser (PHASE-2-PLAN §3.1), transcribed to
 * TypeScript for the native side. A consumer must be able to swap the native
 * parser for the fallback without touching its rendering code, so any change
 * here needs the matching change there.
 */

/** Bumped only for breaking AST/API changes. */
export declare const version: string

/** cmark-gfm version string, e.g. `"0.29.0.gfm.14"`. */
export declare const cmarkVersion: string

/** Names of the GFM extensions this build can enable. */
export declare const supportedExtensions: readonly string[]

/** Absolute path of the loaded `.node` binary, or `undefined` if none loaded. */
export declare const bindingPath: string | undefined

/** How the binary was found: env override, staged prebuild, or a local build. */
export declare const source: 'env' | 'prebuild' | 'local-build' | 'unavailable'

/** `true` when a usable addon was loaded. */
export declare const available: boolean

/** Candidate paths that were tried, in order (diagnostics only). */
export declare const loadErrors: readonly string[]

/** The last error seen while loading, if loading failed. */
export declare const lastLoadError: Error | undefined

// --- AST ------------------------------------------------------------------

export type MarkdownTokenType =
  | 'document'
  | 'paragraph'
  | 'heading'
  | 'text'
  | 'strong'
  | 'emphasis'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'list'
  | 'blockquote'
  | 'thematicBreak'
  | 'table'
  | 'html'

/** Pipe-table column alignment; `null` means "no explicit alignment". */
export type TableAlignment = 'left' | 'center' | 'right' | null

export interface DocumentNode {
  type: 'document'
  children: MarkdownNode[]
}

export interface ParagraphNode {
  type: 'paragraph'
  children: MarkdownNode[]
}

export interface HeadingNode {
  type: 'heading'
  /** 1–6. */
  level: number
  children: MarkdownNode[]
}

export interface TextNode {
  type: 'text'
  /** Escaped-free literal text; soft/hard breaks appear as `"\n"`. */
  value: string
}

export interface StrongNode {
  type: 'strong'
  children: MarkdownNode[]
}

export interface EmphasisNode {
  type: 'emphasis'
  children: MarkdownNode[]
}

export interface StrikethroughNode {
  type: 'strikethrough'
  children: MarkdownNode[]
}

export interface CodeNode {
  type: 'code'
  /** Raw code, never HTML-escaped by the parser. */
  value: string
  /** `true` for `` `inline` `` code, `false` for fenced/indented blocks. */
  inline: boolean
  /** Info-string language of a fenced block, when present. */
  language?: string
}

export interface LinkNode {
  type: 'link'
  href: string
  title?: string
  /** Images degrade to links with this flag set (Qt renders them as links). */
  image?: true
  children: MarkdownNode[]
}

export interface ListNode {
  type: 'list'
  ordered: boolean
  /** First ordinal of an ordered list, when it is not 1. */
  start?: number
  /** Each item is a list of blocks. */
  items: MarkdownNode[][]
  /** Per-item checkbox state, present only for task lists. */
  taskChecked?: boolean[]
}

export interface BlockquoteNode {
  type: 'blockquote'
  children: MarkdownNode[]
}

export interface ThematicBreakNode {
  type: 'thematicBreak'
}

export interface TableNode {
  type: 'table'
  /** Header row cells. */
  header: MarkdownNode[][]
  /** Body rows, each an array of rows, each a row's cells. */
  rows: MarkdownNode[][][]
  /** One entry per column; omitted when no column is aligned. */
  align?: TableAlignment[]
}

export interface HtmlNode {
  type: 'html'
  /** Raw HTML source. Renderers must escape or drop it; never inject it. */
  value: string
}

export type MarkdownNode =
  | DocumentNode
  | ParagraphNode
  | HeadingNode
  | TextNode
  | StrongNode
  | EmphasisNode
  | StrikethroughNode
  | CodeNode
  | LinkNode
  | ListNode
  | BlockquoteNode
  | ThematicBreakNode
  | TableNode
  | HtmlNode

export interface MarkdownDocument extends DocumentNode {}

// --- options --------------------------------------------------------------

/** Options accepted by every parsing/rendering entry point. */
export interface DshQtNapiOptions {
  /** GFM tables (default `true`). */
  enableTables?: boolean
  /** GFM strikethrough (default `true`). */
  enableStrikethrough?: boolean
  /** GFM autolinks (default `true`). */
  enableAutolink?: boolean
  /** GFM task lists (default `true`). */
  enableTasklist?: boolean
  /** GFM tag filter, i.e. drop `<script>`/`<iframe>` etc. (default `true`). */
  enableTagfilter?: boolean
  /** Maximum AST depth before subtrees are flattened to text (default 64). */
  maxDepth?: number
  /** Annotate unrecognised nodes with `rawType` (default `true`). */
  annotateUnknown?: boolean
  /** Render raw HTML instead of dropping it (default `false`). */
  allowUnsafeHtml?: boolean
  /** Typographic "smart" punctuation (default `false`). */
  smart?: boolean
  /** Turn soft line breaks into `<br>` (default `false`). */
  hardBreaks?: boolean
  /** `class="language-x"` on `<pre>` as GitHub does (default `false`). */
  githubPreLang?: boolean
}

export interface HighlightCodeOptions {
  /** Render `<pre class="… line-numbers">`. */
  lineNumbers?: boolean
}

// --- entry points ---------------------------------------------------------

/**
 * Parses Markdown into the `MarkdownNode` document contract.
 *
 * @throws {TypeError} when `markdown` is not a string.
 * @throws {RangeError} when `markdown` exceeds 16 MiB.
 * @throws {DshQtNapiUnavailableError} when no native binding is loaded.
 */
export declare function parse(markdown: string, options?: DshQtNapiOptions): MarkdownDocument

/** Parses Markdown and returns only the top-level blocks. */
export declare function parseBlocks(markdown: string, options?: DshQtNapiOptions): MarkdownNode[]

/** Alias of {@link parseBlocks}, mirroring the fallback parser's name. */
export declare const parseInline: typeof parseBlocks

/** Same as {@link parse} but returns a JSON string (handy for IPC / caching). */
export declare function parseToJson(markdown: string, options?: DshQtNapiOptions): string

/** Renders Markdown to GitHub-flavoured HTML. */
export declare function renderMarkdown(markdown: string, options?: DshQtNapiOptions): string

/**
 * Wraps `code` in an escaped `pre > code` element.
 *
 * Deliberately performs no syntax highlighting: per PHASE-2-PLAN decision D1 the
 * host loads Shiki lazily and falls back to plain monospace text.
 */
export declare function highlightCode(
  code: string,
  language?: string,
  options?: HighlightCodeOptions,
): string

/** Escapes `& < > " '`. */
export declare function escapeHtml(text: string): string

// --- discovery ------------------------------------------------------------

/** `linux-x64`, `win32-arm64`, … — the prebuild directory layout. */
export declare function prebuildTriple(platform?: string, arch?: string): string

/** Ordered candidate paths for the current (or given) platform. */
export declare function candidatePaths(options?: {
  platform?: string
  arch?: string
  env?: Record<string, string | undefined>
  packageRoot?: string
}): string[]

export interface LoadResult {
  addon: Record<string, unknown> | undefined
  bindingPath: string | undefined
  source: 'env' | 'prebuild' | 'local-build' | 'unavailable'
  attempted: string[]
  available: boolean
  lastError?: Error
}

/** Loads the addon without throwing; inspect `available`/`lastError`. */
export declare function loadBinding(options?: {
  platform?: string
  arch?: string
  env?: Record<string, string | undefined>
  packageRoot?: string
}): LoadResult

/** Thrown by every entry point when no native binding could be loaded. */
export declare class DshQtNapiUnavailableError extends Error {
  readonly name: 'DshQtNapiUnavailableError'
  readonly code: 'DSH_QT_NAPI_UNAVAILABLE'
  readonly attempted: string[]
  readonly cause?: Error
}
