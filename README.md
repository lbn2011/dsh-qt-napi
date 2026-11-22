# dsh-qt-napi

Native N-API addon that gives the DSH Qt profile a **real Markdown parser**: cmark-gfm
(CommonMark + GitHub extensions) compiled from vendored C source and exposed to
Node/Cordis as `parse()`, `renderMarkdown()` and friends.

It replaces the "escape everything into a `<pre>`" placeholder that the Qt host
falls back to when no native module is present, and it exists so that Qt needs
**no browser engine** to render Markdown.

## Why a native addon

| Option | Verdict |
| --- | --- |
| `marked`/`markdown-it` (JS) | Works, but re-implements GFM in JS and bloats the plugin bundle; the Qt profile already ships a C++ toolchain. |
| `cmark-gfm` via the C CLI | Spawning a process per message is ~5–10 ms of fork/exec per render. |
| **This addon (N-API)** | In-process, no fork, ~0.1 ms for typical messages, and the *same* AST contract as the pure-TS fallback parser. |

`dsh-qt-app` treats a missing addon as a soft failure: it renders
`<pre class="dsh-qt-fallback">` instead. So installing this package is always a
performance/quality upgrade, never a hard dependency.

## The AST contract

`parse()` returns plain JSON — no native handles, no cycles — matching
`dsh-qt-app/src/markdown/types.ts` (PHASE-2-PLAN §3.1):

```
document            { children: Node[] }
paragraph           { children: Node[] }
heading             { level: 1..6, children: Node[] }
text                { value }
strong              { children: Node[] }
emphasis            { children: Node[] }
strikethrough       { children: Node[] }
code                { value, inline, language? }
link                { href, title?, image?, children: Node[] }
list                { ordered, start?, items: Node[][], taskChecked?: boolean[] }
blockquote          { children: Node[] }
thematicBreak       {}
table               { header: Node[][], rows: Node[][][], align: (…|null)[] }
html                { value }
```

Two parsers implement it — this addon and `dsh-qt-app`'s pure-TS fallback — and
`test/loader-integration.test.mjs` asserts they agree block for block. The only
sanctioned divergences are additive GFM features the fallback lacks: task-list
`taskChecked` and bare-URL autolinking.

Rendering never trusts the document: raw HTML is *dropped* by default
(`allowUnsafeHtml: true` opts in) and the GFM tag filter strips `<script>`,
`<iframe>`, …

## Build

Requirements: Node ≥ 18, a C++17 toolchain, Python 3 (node-gyp).

```sh
npm install          # staged prebuild, or compiles when none matches
npm run build        # force a rebuild + stage prebuild/<platform>-<arch>/qt-bridge.node
npm test             # node --test test/*.test.mjs
npm run verify       # load the shipped binary and exercise every entry point
```

`DSH_QT_NAPI_STRICT_INSTALL=1` turns a failed compile into an install failure
(CI uses it); by default a compile failure only warns, since the host can degrade.

```sh
node -e "console.log(require('./index.js').parse('# hi'))"   # smoke test
```

## Usage

```js
const { parse, renderMarkdown, highlightCode } = require('dsh-qt-napi')

parse('# hi')                                   // MarkdownNode document
renderMarkdown('| a |\n|---|\n| 1 |')           // GitHub-flavoured HTML
highlightCode('const a = 1', 'js')              // <pre><code>…, escaped
```

Discovery order (mirrors `dsh-qt-app`'s loader): `DSH_QT_NAPI_PATH` →
`prebuild/<platform>-<arch>/qt-bridge.node` → `build/Release` → `build/Debug`.
`available`, `bindingPath`, `source` and `lastLoadError` are exported for
diagnostics; every function throws `DshQtNapiUnavailableError` when nothing loaded.

## Error handling

| Input | Behaviour |
| --- | --- |
| not a string | `TypeError` |
| > 16 MiB | `RangeError` |
| deeply nested (e.g. 200 `>`) | depth-bounded via `maxDepth` (default 64) |
| hostile delimiter runs | bounded scan, no quadratic blowup (see tests) |
| no binary | `DshQtNapiUnavailableError`, host falls back |

## Syntax highlighting

**None.** Per PHASE-2-PLAN decision D1, `highlightCode()` guarantees structure
and escaping only; the Qt host lazily loads Shiki and falls back to plain
monospace above `maxHighlightChars`. Keeping colours out of the addon avoids
shipping two highlighter engines.

## Vendored dependencies

`vendor/cmark-gfm/` is cmark-gfm 0.29.0.gfm.14 (BSD-2-Clause, see
`vendor/cmark-gfm/COPYING` and `vendor/cmark-gfm/PROVENANCE.md` for the exact
commit, the file list and the refresh procedure).

> Note: there is **no cmark-gfm 0.30.x** — that version line belongs to
> `commonmark/cmark`. 0.29.0.gfm.14 is the newest cmark-gfm release.

## CI

`.github/workflows/build-napi.yml` builds and tests on Ubuntu, Windows and macOS
and uploads `prebuild/<triple>/qt-bridge.node` artifacts. The workflow lives here
because this package is destined to become its own repository; wiring it into the
root repository's workflows is a packaging decision (see the task record).

macOS builds are currently unvalidated: the shared GitHub Actions budget
cancels `macos-14` runs at the queue with
`The configuration 'macos-14-arm64-us-default' is not supported`.
