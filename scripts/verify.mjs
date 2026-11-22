#!/usr/bin/env node
/**
 * Self-check for the native addon: loads the binding the same way consumers do
 * and exercises every exported entry point with a few representative samples.
 *
 * This is intentionally *not* the unit-test suite (`test/*.test.mjs`, which uses
 * node:test and covers the contract in depth). `verify` answers one question
 * for a machine that may have no test runner wired up: "does this binary, as
 * shipped, actually parse and render?"
 *
 * Exit 0 = every check passed. Exit 1 = first failure, with context.
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromHere = createRequire(import.meta.url)

let checks = 0
const failures = []

/** Records one assertion. */
function check(name, fn) {
  checks += 1
  try {
    const detail = fn()
    console.log(`  ok  ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    failures.push({ name, error })
    console.error(`  FAIL ${name}: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function main() {
  console.log('[dsh-qt-napi] verify\n')

  let napi
  try {
    napi = requireFromHere(join(root, 'index.js'))
  } catch (error) {
    console.error(`[dsh-qt-napi] cannot load index.js: ${error.message}`)
    process.exit(1)
  }

  console.log(`  binding: ${napi.available ? napi.bindingPath : 'UNAVAILABLE'} (source: ${napi.source})`)
  if (!napi.available) {
    console.error(`[dsh-qt-napi] last load error: ${napi.lastLoadError?.message ?? 'unknown'}`)
    console.error('[dsh-qt-napi] run "npm run build" first')
    process.exit(1)
  }

  // --- metadata -----------------------------------------------------------
  check('addon reports a version', () => {
    assert(/^\d+\.\d+\.\d+/.test(napi.version), `unexpected version ${JSON.stringify(napi.version)}`)
    return `v${napi.version} (cmark-gfm ${napi.cmarkVersion})`
  })

  check('platform/arch match the host', () => {
    const addon = napi.loadBinding().addon
    assert(addon.platform === process.platform, `addon built for ${addon.platform}, host ${process.platform}`)
    assert(addon.arch === process.arch, `addon built for ${addon.arch}, host ${process.arch}`)
    return `${addon.platform}-${addon.arch}`
  })

  check('GitHub extensions are registered', () => {
    const names = napi.supportedExtensions.map((n) => n.toLowerCase())
    for (const required of ['table', 'strikethrough', 'autolink', 'tasklist', 'tagfilter']) {
      assert(names.includes(required), `missing extension ${required} (have ${names.join(', ')})`)
    }
    return names.join(', ')
  })

  // --- parse: the MarkdownNode contract -----------------------------------
  check('parse("# test") yields a document with one level-1 heading', () => {
    const doc = napi.parse('# test')
    assert(doc && doc.type === 'document', `expected document, got ${doc?.type}`)
    assert(Array.isArray(doc.children) && doc.children.length === 1, `expected 1 child, got ${doc.children?.length}`)
    const heading = doc.children[0]
    assert(heading.type === 'heading', `expected heading, got ${heading.type}`)
    assert(heading.level === 1, `expected level 1, got ${heading.level}`)
    assert(heading.children[0].value === 'test', `expected text "test", got ${JSON.stringify(heading.children[0].value)}`)
    return `${doc.children.length} block`
  })

  check('parse preserves nested inline structure', () => {
    const doc = napi.parse('**bold _and italic_**')
    const para = doc.children[0]
    assert(para.type === 'paragraph', `expected paragraph, got ${para.type}`)
    const strong = para.children.find((n) => n.type === 'strong')
    assert(strong, 'no strong node')
    assert(strong.children.some((n) => n.type === 'emphasis'), 'no nested emphasis inside strong')
    return `${strong.children.length} inline children`
  })

  check('parse reports GFM tables with alignment', () => {
    const doc = napi.parse('| a | b |\n|:--|--:|\n| 1 | 2 |')
    const table = doc.children.find((n) => n.type === 'table')
    assert(table, 'no table node')
    assert(Array.isArray(table.align) && table.align.length === 2, `align=${JSON.stringify(table.align)}`)
    assert(table.align[0] === 'left' && table.align[1] === 'right', `unexpected align ${JSON.stringify(table.align)}`)
    return `align=${table.align.join('/')}`
  })

  check('parse accepts an explicit "commonmark only" option set', () => {
    const options = {
      enableTables: false,
      enableStrikethrough: false,
      enableAutolink: false,
      enableTasklist: false,
      enableTagfilter: false,
    }
    const doc = napi.parse('| a | b |\n|---|---|\n| 1 | 2 |', options)
    assert(!doc.children.some((n) => n.type === 'table'), 'table parsed although tables were disabled')
    return 'tables disabled honoured'
  })

  check('parse rejects non-string input with a TypeError', () => {
    try {
      napi.parse(42)
    } catch (error) {
      assert(error instanceof TypeError, `expected TypeError, got ${error.constructor.name}`)
      return 'TypeError'
    }
    throw new Error('non-string input was accepted')
  })

  check('parse rejects oversized input with a RangeError', () => {
    const big = 'a'.repeat(16 * 1024 * 1024 + 1)
    try {
      napi.parse(big)
    } catch (error) {
      assert(error instanceof RangeError, `expected RangeError, got ${error.constructor.name}`)
      return 'RangeError at 16 MiB'
    }
    throw new Error('oversized input was accepted')
  })

  // --- render -------------------------------------------------------------
  check('renderMarkdown produces GitHub-flavoured HTML', () => {
    const html = napi.renderMarkdown('# title\n\n- one\n- two\n')
    assert(html.includes('<h1>title</h1>'), `missing <h1> in ${JSON.stringify(html)}`)
    assert(html.includes('<li>one</li>'), 'missing list item')
    return `${html.length} bytes`
  })

  check('renderMarkdown omits raw HTML by default', () => {
    // cmark's safe default (CMARK_OPT_UNSAFE off) is to *drop* raw HTML and
    // leave a comment, which is stronger than escaping it.
    const html = napi.renderMarkdown('<script>alert(1)</script>')
    assert(!html.includes('<script>'), 'raw script tag passed through')
    assert(html.includes('raw HTML omitted'), `expected the omission comment, got ${JSON.stringify(html)}`)
    return 'omitted'
  })

  check('renderMarkdown passes raw HTML through only with allowUnsafeHtml', () => {
    const html = napi.renderMarkdown('<b>hi</b>', { allowUnsafeHtml: true })
    assert(html.includes('<b>hi</b>'), `expected raw HTML with allowUnsafeHtml, got ${JSON.stringify(html)}`)
    return 'opt-in only'
  })

  check('highlightCode wraps code in <pre><code> without colours', () => {
    const html = napi.highlightCode('const a = 1 < 2', 'js')
    assert(html.startsWith('<pre'), `unexpected prefix ${JSON.stringify(html.slice(0, 20))}`)
    assert(html.includes('language-js'), 'missing language class')
    assert(html.includes('1 &lt; 2'), `code was not escaped: ${JSON.stringify(html)}`)
    return `${html.length} bytes`
  })

  check('escapeHtml covers the five dangerous characters', () => {
    const escaped = napi.escapeHtml(`&<>"'`)
    assert(escaped === '&amp;&lt;&gt;&quot;&#39;', `unexpected ${JSON.stringify(escaped)}`)
    return escaped
  })

  // --- summary ------------------------------------------------------------
  const failed = failures.length
  console.log(`\n[dsh-qt-napi] ${checks - failed}/${checks} checks passed`)
  if (failed > 0) {
    console.error(`[dsh-qt-napi] ${failed} check(s) FAILED`)
    process.exit(1)
  }
  console.log('[dsh-qt-napi] verify OK')
}

main()
