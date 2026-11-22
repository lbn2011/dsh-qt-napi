/**
 * Integration tests against the *host*'s loader.
 *
 * The Qt app does not `require('dsh-qt-napi')` directly: it goes through
 * `dsh-qt-app/src/qt-bridge/napi-loader.ts`, which has its own discovery order,
 * its own structural check (`isNapiBridge`) and a degraded fallback. This suite
 * runs the compiled loader against this package so the two sides cannot drift.
 *
 * The cross-parser test at the bottom is the important one: it asserts that the
 * native parser and `dsh-qt-app`'s pure-TS fallback parser produce the same AST
 * for a representative document, which is what makes them interchangeable.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import napi from '../index.js'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageRoot, '..')
const triple = `${process.platform}-${process.arch}`
const prebuilt = join(packageRoot, 'prebuild', triple, 'qt-bridge.node')

const loaderPath = join(repoRoot, 'dsh-qt-app', 'lib', 'qt-bridge', 'napi-loader.js')
const fallbackParserPath = join(repoRoot, 'dsh-qt-app', 'lib', 'markdown', 'fallback-parser.js')
const haveLoader = existsSync(loaderPath)

/** Loads the host loader, or fails with a pointer to the build command. */
async function loadHostLoader() {
  assert.ok(haveLoader, `missing ${loaderPath}; run "pnpm -C dsh-qt-app build" first`)
  return import(loaderPath)
}

/** Awaits a value that may or may not be a promise. */
async function settled(value) {
  return await Promise.resolve(value)
}

describe('host loader integration', () => {
  it('loads this package through an explicit .node path', async () => {
    const { loadNapiModule } = await loadHostLoader()
    const result = loadNapiModule({ explicitPath: prebuilt, env: {} })
    assert.equal(result.degraded, false, `loader fell back: ${result.error?.message}`)
    assert.equal(result.source, 'explicit')
    const html = await settled(result.bridge.renderMarkdown('# hi'))
    assert.match(html, /<h1>hi<\/h1>/)
  })

  it('loads this package through DSH_QT_NAPI_PATH pointing at the binary', async () => {
    const { loadNapiModule } = await loadHostLoader()
    const result = loadNapiModule({ env: { DSH_QT_NAPI_PATH: prebuilt }, searchRoots: [] })
    assert.equal(result.degraded, false, `loader fell back: ${result.error?.message}`)
    assert.equal(result.source, 'env')
  })

  it('loads this package when DSH_QT_NAPI_PATH points at the package directory', async () => {
    const { loadNapiModule } = await loadHostLoader()
    // require() of a directory resolves the package main, i.e. index.js.
    const result = loadNapiModule({ env: { DSH_QT_NAPI_PATH: packageRoot }, searchRoots: [] })
    assert.equal(result.degraded, false, `loader fell back: ${result.error?.message}`)
    assert.equal(result.source, 'env')
    assert.equal(typeof result.bridge.highlightCode, 'function')
  })

  it('loads this package as a package entry point', async () => {
    const { loadNapiModule } = await loadHostLoader()
    const result = loadNapiModule({ explicitPath: join(packageRoot, 'index.js'), env: {} })
    assert.equal(result.degraded, false, `loader fell back: ${result.error?.message}`)
    const html = await settled(result.bridge.renderMarkdown('**strong**'))
    assert.match(html, /<strong>strong<\/strong>/)
  })

  it('is discovered as a sibling checkout by the loader search roots', async () => {
    const { loadNapiModule } = await loadHostLoader()
    const result = loadNapiModule({ env: {}, searchRoots: [repoRoot] })
    assert.equal(result.degraded, false, `loader fell back: ${result.error?.message}`)
    assert.equal(result.source, 'local-build')
  })

  it('degrades to the fallback bridge when nothing is found', async () => {
    const { loadNapiModule } = await loadHostLoader()
    const missing = join(packageRoot, 'does-not-exist', 'qt-bridge.node')
    const result = loadNapiModule({ env: { DSH_QT_NAPI_PATH: missing }, searchRoots: [], packageName: 'no-such-pkg' })
    assert.equal(result.degraded, true)
    assert.equal(result.source, 'fallback')
    assert.ok(result.attempted.includes(missing), 'the env path should be in the attempt log')
    const html = await settled(result.bridge.renderMarkdown('# x'))
    assert.match(html, /dsh-qt-fallback/)
  })

  it('satisfies the loader’s isNapiBridge structural check', async () => {
    const { isNapiBridge } = await loadHostLoader()
    assert.equal(isNapiBridge(napi), true)
    assert.equal(isNapiBridge({ renderMarkdown() {} }), false)
  })
})

describe('cross-parser AST parity', () => {
  /** Sorts object keys so payload comparison ignores emission order. */
  function canonical(value) {
    return JSON.stringify(value, (_key, raw) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
      return Object.fromEntries(Object.keys(raw).sort().map((key) => [key, raw[key]]))
    })
  }

  const samples = {
    'headings and inlines': '# Title\n\nA *para* with **bold**, `code` and [link](https://e.com "t").\n',
    lists: '- one\n- two\n  - nested\n\n1. first\n2. second\n',
    'code blocks': '```js\nconst a = 1\n```\n\n```\nplain\n```\n',
    tables: '| a | b |\n|:--|--:|\n| 1 | 2 |\n',
    quotes: '> quoted\n>\n> > nested\n',
    strikethrough: '~~gone~~ and text\n',
  }

  it('matches the pure-TS fallback parser block for block', async (t) => {
    if (!existsSync(fallbackParserPath)) {
      t.skip(`missing ${fallbackParserPath}; run "pnpm -C dsh-qt-app build" first`)
      return
    }
    const fallback = await import(fallbackParserPath)
    for (const [name, markdown] of Object.entries(samples)) {
      const native = canonical(napi.parse(markdown))
      const pure = canonical(fallback.parseMarkdown(markdown).toJSON())
      assert.equal(native, pure, `ASTs differ for "${name}"`)
    }
  })

  it('differs from the fallback only on GFM extras, and says so', async (t) => {
    if (!existsSync(fallbackParserPath)) {
      t.skip(`missing ${fallbackParserPath}; run "pnpm -C dsh-qt-app build" first`)
      return
    }
    const fallback = await import(fallbackParserPath)
    const markdown = '- [x] done\n- [ ] todo\n'

    // Native: GFM task-list extension reports checkbox state per item.
    const native = napi.parse(markdown).children[0]
    assert.deepEqual(native.taskChecked, [true, false])
    assert.equal(native.items[0][0].children[0].value, 'done')

    // Fallback: no task-list support, so the marker stays in the text and
    // `taskChecked` is absent. This is the *only* known AST divergence and it is
    // additive: a renderer that ignores `taskChecked` renders both identically.
    const pure = fallback.parseMarkdown(markdown).toJSON().children[0]
    assert.equal(pure.taskChecked, undefined)
    assert.equal(pure.items[0][0].children[0].value, '[x] done')

    // Bare-URL autolinking is the second (and last) divergence: cmark-gfm links
    // it through the autolink extension, the fallback leaves it as text.
    const nativeAutolink = napi.parse('see https://example.com/x').children[0].children
    assert.equal(nativeAutolink[1].type, 'link')
    const pureAutolink = fallback.parseMarkdown('see https://example.com/x').toJSON().children[0].children
    assert.equal(pureAutolink.length, 1)
    assert.equal(pureAutolink[0].type, 'text')
  })
})
