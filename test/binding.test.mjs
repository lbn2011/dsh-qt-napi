/**
 * Contract tests for the native binding.
 *
 * These assert the shape promised by PHASE-2-PLAN §3.1 — the same shape the
 * pure-TS fallback parser produces — plus the failure modes a host must be able
 * to rely on (typed errors, bounded depth, no crashes on hostile input).
 *
 * Run with: npm test   (node --test test/*.test.mjs)
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// `index.js` is CommonJS (it must be loadable by `require()` from the Qt app's
// loader), so named-import extraction does not work for getter-backed exports.
import napi from '../index.js'

const {
  DshQtNapiUnavailableError,
  candidatePaths,
  escapeHtml,
  highlightCode,
  loadBinding,
  parse,
  parseBlocks,
  parseToJson,
  prebuildTriple,
  renderMarkdown,
  supportedExtensions,
  version,
} = napi

/** Fails loudly instead of skipping: a missing binding is a build failure. */
assert.equal(napi.available, true, `native binding unavailable: ${napi.lastLoadError?.message}`)

/** Returns the block-level children of a parsed document. */
function blocks(markdown, options) {
  const doc = parse(markdown, options)
  assert.equal(doc.type, 'document')
  return doc.children
}

/** Parses `markdown` and returns its single top-level block. */
function block(markdown, options) {
  const list = blocks(markdown, options)
  assert.equal(list.length, 1, `expected exactly one block, got ${list.length}`)
  return list[0]
}

/** Parses `markdown` as one paragraph and returns its inline children. */
function inlines(markdown, options) {
  const node = block(markdown, options)
  assert.equal(node.type, 'paragraph')
  return node.children
}

/** Maximum node depth in an AST (document = 1). */
function depth(node) {
  const children = Array.isArray(node.children) ? node.children : []
  const itemChildren = Array.isArray(node.items) ? node.items.flat() : []
  const all = [...children, ...itemChildren]
  return 1 + (all.length === 0 ? 0 : Math.max(...all.map(depth)))
}

describe('metadata', () => {
  it('reports an addon version', () => {
    assert.match(version, /^\d+\.\d+\.\d+/)
  })

  it('reports the bundled cmark-gfm version', () => {
    assert.match(napi.cmarkVersion, /^\d+\.\d+\.\d+(\.gfm\.\d+)?$/)
  })

  it('advertises the GFM extensions it can enable', () => {
    assert.deepEqual(
      [...supportedExtensions].map((name) => name.toLowerCase()).sort(),
      ['autolink', 'strikethrough', 'table', 'tagfilter', 'tasklist'],
    )
  })

  it('exposes the binary it loaded', () => {
    assert.match(napi.bindingPath, /qt-bridge\.node$/)
  })
})

describe('parse: block structure', () => {
  it('returns an empty document for empty input', () => {
    assert.deepEqual(parse(''), { type: 'document', children: [] })
  })

  it('returns an empty document for whitespace-only input', () => {
    assert.deepEqual(parse('   \n\t\n  '), { type: 'document', children: [] })
  })

  it('parses ATX headings at every level', () => {
    for (let level = 1; level <= 6; level += 1) {
      const node = block(`${'#'.repeat(level)} title`)
      assert.equal(node.type, 'heading')
      assert.equal(node.level, level)
      assert.equal(node.children[0].value, 'title')
    }
  })

  it('does not treat a hash without a space as a heading', () => {
    assert.equal(block('#hashtag').type, 'paragraph')
  })

  it('parses setext headings', () => {
    const node = block('Title\n=====')
    assert.equal(node.type, 'heading')
    assert.equal(node.level, 1)
  })

  it('parses thematic breaks', () => {
    assert.equal(block('---').type, 'thematicBreak')
  })

  it('parses fenced code blocks with a language', () => {
    const node = block('```ts\nconst a = 1\n```')
    assert.equal(node.type, 'code')
    assert.equal(node.inline, false)
    assert.equal(node.language, 'ts')
    assert.equal(node.value, 'const a = 1')
  })

  it('parses a fence without a language', () => {
    const node = block('```\nplain\n```')
    assert.equal(node.type, 'code')
    assert.equal(node.language, undefined)
  })

  it('treats an unterminated fence as code to end of input', () => {
    const node = block('```js\nlet x = 1')
    assert.equal(node.type, 'code')
    assert.equal(node.value, 'let x = 1')
  })

  it('parses blockquotes', () => {
    const node = block('> quoted')
    assert.equal(node.type, 'blockquote')
    assert.equal(node.children[0].type, 'paragraph')
    assert.equal(node.children[0].children[0].value, 'quoted')
  })

  it('parses nested blockquotes', () => {
    const node = block('> a\n>\n> > b')
    assert.equal(node.children.at(-1).type, 'blockquote')
  })

  it('flattens soft line breaks into a single text token', () => {
    assert.deepEqual(inlines('a\nb'), [{ type: 'text', value: 'a\nb' }])
  })

  it('keeps raw HTML in the AST as html tokens', () => {
    const node = block('<div>raw</div>')
    assert.equal(node.type, 'html')
    assert.match(node.value, /^<div>raw<\/div>/)
  })
})

describe('parse: lists', () => {
  it('parses unordered lists with block items', () => {
    const node = block('- one\n- two')
    assert.equal(node.type, 'list')
    assert.equal(node.ordered, false)
    assert.equal(node.items.length, 2)
    assert.equal(node.items[1][0].children[0].value, 'two')
  })

  it('records the start ordinal of ordered lists', () => {
    const node = block('3. three\n4. four')
    assert.equal(node.ordered, true)
    assert.equal(node.start, 3)
    assert.equal(node.items.length, 2)
  })

  it('omits start for lists beginning at 1', () => {
    // The fallback parser omits it too: `start` is only interesting when it is
    // not the implicit 1.
    assert.equal(block('1. one').start, undefined)
  })

  it('nests lists inside list items', () => {
    const node = block('- outer\n  - inner')
    const nested = node.items[0].find((child) => child.type === 'list')
    assert.ok(nested, 'expected a nested list inside the first item')
    assert.equal(nested.items[0][0].children[0].value, 'inner')
  })

  it('reports task-list checkbox state per item', () => {
    const node = block('- [x] done\n- [ ] todo')
    assert.deepEqual(node.taskChecked, [true, false])
    assert.equal(node.items.length, 2)
  })

  it('does not report taskChecked for ordinary lists', () => {
    assert.equal(block('- plain').taskChecked, undefined)
  })
})

describe('parse: inline structure', () => {
  it('parses emphasis', () => {
    assert.deepEqual(inlines('*it*'), [{ type: 'emphasis', children: [{ type: 'text', value: 'it' }] }])
  })

  it('parses strong', () => {
    assert.deepEqual(inlines('**bold**'), [{ type: 'strong', children: [{ type: 'text', value: 'bold' }] }])
  })

  it('parses nested emphasis inside strong', () => {
    const strong = inlines('**bold *and italic***')[0]
    assert.equal(strong.type, 'strong')
    assert.equal(strong.children[0].value, 'bold ')
    assert.equal(strong.children[1].type, 'emphasis')
  })

  it('parses strikethrough', () => {
    assert.equal(inlines('~~gone~~')[0].type, 'strikethrough')
  })

  it('parses inline code without interpreting its content', () => {
    assert.deepEqual(inlines('`a *b*`'), [{ type: 'code', value: 'a *b*', inline: true }])
  })

  it('parses links with href and title', () => {
    const link = inlines('[label](https://example.com "T")')[0]
    assert.equal(link.type, 'link')
    assert.equal(link.href, 'https://example.com')
    assert.equal(link.title, 'T')
    assert.deepEqual(link.children, [{ type: 'text', value: 'label' }])
  })

  it('degrades images to links flagged with image: true', () => {
    const image = inlines('![alt](pic.png)')[0]
    assert.equal(image.type, 'link')
    assert.equal(image.image, true)
    assert.equal(image.href, 'pic.png')
  })

  it('autolinks bare URLs through the GFM extension', () => {
    const link = inlines('see https://example.com/x')[1]
    assert.equal(link.type, 'link')
    assert.equal(link.href, 'https://example.com/x')
  })

  it('honours enableAutolink: false', () => {
    const nodes = inlines('see https://example.com/x', { enableAutolink: false })
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].type, 'text')
  })
})

describe('parse: tables', () => {
  it('parses a GFM table into header and rows', () => {
    const table = block('| a | b |\n|---|---|\n| 1 | 2 |')
    assert.equal(table.type, 'table')
    assert.equal(table.header.length, 2)
    assert.equal(table.rows.length, 1)
    assert.equal(table.rows[0][1][0].value, '2')
  })

  it('reports column alignment', () => {
    const table = block('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')
    assert.deepEqual(table.align, ['left', 'center', 'right'])
  })

  it('reports null for every unaligned column', () => {
    assert.deepEqual(block('| a |\n|---|\n| 1 |').align, [null])
  })

  it('honours enableTables: false', () => {
    assert.equal(block('| a |\n|---|\n| 1 |', { enableTables: false }).type, 'paragraph')
  })
})

describe('parse: robustness and bounds', () => {
  it('rejects non-string input with a TypeError', () => {
    for (const bad of [42, null, undefined, {}, [], Symbol('x')]) {
      assert.throws(() => parse(bad), TypeError)
    }
  })

  it('rejects input larger than 16 MiB with a RangeError', () => {
    assert.throws(() => parse('a'.repeat(16 * 1024 * 1024 + 1)), RangeError)
  })

  it('bounds AST depth through maxDepth', () => {
    const document = parse(`${'>'.repeat(200)} deep`, { maxDepth: 4 })
    assert.ok(depth(document) <= 6, `depth ${depth(document)} exceeded the configured bound`)
  })

  it('survives adversarial delimiter runs without a pathological slowdown', () => {
    const started = Date.now()
    for (const hostile of ['*'.repeat(20000), '`'.repeat(5000), '['.repeat(5000), '_'.repeat(20000), '~~'.repeat(10000)]) {
      const document = parse(hostile)
      assert.equal(document.type, 'document')
    }
    const elapsed = Date.now() - started
    assert.ok(elapsed < 5000, `adversarial inputs took ${elapsed}ms`)
  })

  it('returns block-level children from parseBlocks', () => {
    assert.deepEqual(parseBlocks('# h\n\np').map((node) => node.type), ['heading', 'paragraph'])
  })

  it('serialises the document as JSON from parseToJson', () => {
    const markdown = '# h\n\n- a\n- b\n'
    assert.deepEqual(JSON.parse(parseToJson(markdown)), parse(markdown))
  })
})

describe('renderMarkdown', () => {
  it('renders headings and lists as HTML', () => {
    const html = renderMarkdown('# t\n\n- a\n- b\n')
    assert.match(html, /<h1>t<\/h1>/)
    assert.match(html, /<li>a<\/li>/)
  })

  it('renders GFM tables', () => {
    const html = renderMarkdown('| a |\n|---|\n| 1 |')
    assert.match(html, /<table>/)
    assert.match(html, /<td>1<\/td>/)
  })

  it('drops raw HTML by default', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    assert.doesNotMatch(html, /<script>/)
    assert.match(html, /raw HTML omitted/)
  })

  it('passes raw HTML through only when allowUnsafeHtml is set', () => {
    assert.match(renderMarkdown('<b>hi</b>', { allowUnsafeHtml: true }), /<b>hi<\/b>/)
  })

  it('applies the GFM tag filter to script tags even with allowUnsafeHtml', () => {
    assert.doesNotMatch(renderMarkdown('<script>a</script>', { allowUnsafeHtml: true }), /<script>/)
  })

  it('renders soft breaks as <br> when hardBreaks is set', () => {
    assert.match(renderMarkdown('a\nb', { hardBreaks: true }), /a<br \/>\nb/)
  })

  it('applies smart punctuation only when enabled', () => {
    assert.match(renderMarkdown('"q" -- x', { smart: true }), /\u201cq\u201d \u2013 x/)
    assert.match(renderMarkdown('"q"'), /&quot;q&quot;/)
  })

  it('marks fenced code with the language class', () => {
    assert.match(renderMarkdown('```js\nx\n```'), /class="language-js"/)
  })
})

describe('highlightCode', () => {
  it('wraps code in a pre/code pair and escapes it', () => {
    const html = highlightCode('if (a < b) {}', 'js')
    assert.match(html, /^<pre class="dsh-qt-code"><code class="language-js" data-language="js">/)
    assert.match(html, /a &lt; b/)
  })

  it('omits the language class when none is given', () => {
    assert.match(highlightCode('x'), /<code>x<\/code>/)
  })

  it('adds a line-numbers marker on request', () => {
    assert.match(highlightCode('x', 'js', { lineNumbers: true }), /class="dsh-qt-code line-numbers"/)
  })

  it('performs no syntax highlighting (D1: the host owns colours)', () => {
    assert.doesNotMatch(highlightCode('const a = 1', 'js'), /<span/)
  })
})

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  })

  it('leaves ordinary text alone', () => {
    assert.equal(escapeHtml('plain text — ok'), 'plain text — ok')
  })
})

describe('discovery and failure handling', () => {
  it('prefers DSH_QT_NAPI_PATH over the staged prebuild', () => {
    const paths = candidatePaths({ env: { DSH_QT_NAPI_PATH: '/tmp/override/node' } })
    assert.equal(paths[0], '/tmp/override/node/prebuild/' + prebuildTriple() + '/qt-bridge.node')
    assert.match(paths[1], /prebuild/)
  })

  it('accepts a direct .node path in DSH_QT_NAPI_PATH', () => {
    const paths = candidatePaths({ env: { DSH_QT_NAPI_PATH: '/tmp/x/qt-bridge.node' } })
    assert.equal(paths[0], '/tmp/x/qt-bridge.node')
  })

  it('orders prebuild before a local build', () => {
    const paths = candidatePaths({ env: {} })
    const prebuild = paths.findIndex((p) => p.includes('prebuild'))
    const local = paths.findIndex((p) => p.includes('build/Release'))
    assert.ok(prebuild >= 0 && local >= 0 && prebuild < local)
  })

  it('reports an unavailable binding instead of throwing', () => {
    const result = loadBinding({ packageRoot: '/nonexistent/dsh-qt-napi-root', env: {} })
    assert.equal(result.available, false)
    assert.equal(result.bindingPath, undefined)
    assert.ok(result.lastError instanceof Error)
    assert.match(result.lastError.message, /binding not found/)
    assert.ok(result.attempted.length >= 2)
  })

  it('exposes a typed error for the unavailable case', () => {
    assert.equal(typeof DshQtNapiUnavailableError, 'function')
    const error = new DshQtNapiUnavailableError({ attempted: ['/x/qt-bridge.node'], lastError: new Error('boom') })
    assert.equal(error.code, 'DSH_QT_NAPI_UNAVAILABLE')
    assert.match(error.message, /DSH_QT_NAPI_PATH/)
    assert.match(error.message, /boom/)
  })
})
