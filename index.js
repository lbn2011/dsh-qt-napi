/**
 * dsh-qt-napi — public entry point.
 *
 * Loads the `qt-bridge` native addon and re-exports its API with a small,
 * boring wrapper:
 *
 *   - discovery is explicit and diagnosable (`resolveBinding()`, `loadErrors`);
 *   - a missing or ABI-incompatible binary never crashes the host: every
 *     exported function throws a single descriptive `DshQtNapiUnavailableError`
 *     so `dsh-qt-app`'s loader can fall back to its degraded renderer;
 *   - the module shape (`renderMarkdown` + `highlightCode` + `version`) matches
 *     what `dsh-qt-app/src/qt-bridge/napi-loader.ts` validates, so both a
 *     `require('dsh-qt-napi')` package-entry load and a direct `.node` load work.
 *
 * Discovery order (first hit wins, mirroring the TypeScript loader):
 *   1. `DSH_QT_NAPI_PATH` (absolute path to a .node file, or to this package)
 *   2. `prebuild/<platform>-<arch>/qt-bridge.node`   (shipped binaries)
 *   3. `build/Release/qt-bridge.node`                (local node-gyp build)
 *   4. `build/Debug/qt-bridge.node`
 */
'use strict'

const { existsSync } = require('node:fs')
const { createRequire } = require('node:module')
const { join, resolve } = require('node:path')

/** Binary basename; must match `NAPI_BINARY_NAME` in dsh-qt-app/src/constants.ts. */
const BINARY_NAME = 'qt-bridge'

/** Environment override understood by both this package and the Qt app. */
const PATH_ENV = 'DSH_QT_NAPI_PATH'

const packageRoot = __dirname
const requireFromHere = createRequire(__filename)

/** `linux-x64`, `win32-arm64`, `darwin-x64`, … — the prebuild directory layout. */
function prebuildTriple(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`
}

/** Ordered candidate paths for this platform. */
function candidatePaths(options = {}) {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const env = options.env ?? process.env
  const root = options.packageRoot ?? packageRoot

  const candidates = []
  const fromEnv = env[PATH_ENV]
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    const resolved = resolve(fromEnv)
    // Accept either an explicit .node file or a package directory.
    candidates.push(resolved.endsWith('.node') ? resolved : join(resolved, 'prebuild', prebuildTriple(platform, arch), `${BINARY_NAME}.node`))
  }
  candidates.push(join(root, 'prebuild', prebuildTriple(platform, arch), `${BINARY_NAME}.node`))
  candidates.push(join(root, 'build', 'Release', `${BINARY_NAME}.node`))
  candidates.push(join(root, 'build', 'Debug', `${BINARY_NAME}.node`))
  return [...new Set(candidates)]
}

/** Error raised by every exported function when no addon could be loaded. */
class DshQtNapiUnavailableError extends Error {
  constructor(details) {
    super(
      `dsh-qt-napi: no usable ${BINARY_NAME}.node for ${process.platform}-${process.arch}. ` +
        `Tried: ${details.attempted.join(', ') || '(none)'}. ` +
        `Run "npm run build" in dsh-qt-napi, or set ${PATH_ENV}.` +
        (details.lastError ? ` Last error: ${details.lastError.message}` : ''),
    )
    this.name = 'DshQtNapiUnavailableError'
    this.code = 'DSH_QT_NAPI_UNAVAILABLE'
    this.attempted = details.attempted
    if (details.lastError) this.cause = details.lastError
  }
}

/**
 * Loads the addon.
 *
 * Never throws: the outcome is always an object, so index-level consumers (and
 * tests) can inspect `available`/`loadErrors` without try/catch.
 */
function loadBinding(options = {}) {
  const attempted = []
  let lastError
  let lastMissing

  for (const candidate of candidatePaths(options)) {
    attempted.push(candidate)
    if (!existsSync(candidate)) {
      lastMissing = new Error(`binding not found at ${candidate}`)
      continue
    }
    try {
      const addon = requireFromHere(candidate)
      if (typeof addon?.parse !== 'function' || typeof addon?.renderMarkdown !== 'function') {
        lastError = new Error(`${candidate} does not look like the qt-bridge addon (missing parse/renderMarkdown)`)
        continue
      }
      return { addon, bindingPath: candidate, source: candidateSource(candidate, options), attempted, available: true }
    } catch (error) {
      // A binary that exists but will not dlopen (missing symbol, ABI mismatch,
      // wrong architecture) is the interesting failure: keep it, do not let a
      // later "not found" overwrite it.
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  return {
    addon: undefined,
    bindingPath: undefined,
    source: 'unavailable',
    attempted,
    available: false,
    lastError: lastError ?? lastMissing,
  }
}

/** Labels where a path came from, for diagnostics. */
function candidateSource(candidate, options = {}) {
  const env = options.env ?? process.env
  const fromEnv = env[PATH_ENV]
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    const resolved = resolve(fromEnv)
    const prebuildCandidate = join(resolved, 'prebuild', prebuildTriple(), `${BINARY_NAME}.node`)
    if (candidate === resolved || candidate === prebuildCandidate) return 'env'
  }
  return candidate.includes(`${BINARY_NAME}.node`) && candidate.includes('prebuild') ? 'prebuild' : 'local-build'
}

const loaded = loadBinding()

/** Thin wrapper: forwards to the addon or throws the descriptive unavailable error. */
function call(name, args) {
  if (!loaded.available) throw new DshQtNapiUnavailableError(loaded)
  return loaded.addon[name](...args)
}

/**
 * Parses Markdown into the MarkdownNode document contract:
 * `{ type: 'document', children: MarkdownNode[] }`.
 *
 * @param {string} markdown
 * @param {object} [options] see `index.d.ts`
 */
function parse(markdown, options) {
  return call('parse', [markdown, options])
}

/** Parses Markdown and returns only the block-level `MarkdownNode[]`. */
function parseBlocks(markdown, options) {
  return call('parseBlocks', [markdown, options])
}

/** Same as {@link parse} but returns the document as a JSON string. */
function parseToJson(markdown, options) {
  return call('parseToJson', [markdown, options])
}

/**
 * Renders Markdown to HTML with cmark-gfm (GitHub flavoured).
 *
 * Required by `dsh-qt-app`'s `isNapiBridge()` check, together with
 * {@link highlightCode}.
 */
function renderMarkdown(markdown, options) {
  return call('renderMarkdown', [markdown, options])
}

/**
 * Wraps `code` in an escaped `pre > code` element.
 *
 * No syntax colours: per PHASE-2-PLAN decision D1 highlighting is the host's
 * job (lazily loaded Shiki), so this only guarantees structure and escaping.
 */
function highlightCode(code, language, options) {
  return call('highlightCode', [code, language, options])
}

/** HTML-escapes text (`& < > " '`). */
function escapeHtml(text) {
  return call('escapeHtml', [text])
}

module.exports = {
  // Loading state (useful for diagnostics and for the Qt host's status page).
  get available() {
    return loaded.available
  },
  get bindingPath() {
    return loaded.bindingPath
  },
  get source() {
    return loaded.source
  },
  get loadErrors() {
    return loaded.attempted
  },
  get lastLoadError() {
    return loaded.lastError
  },
  prebuildTriple,
  candidatePaths,
  loadBinding,
  DshQtNapiUnavailableError,

  // Parsing / rendering surface.
  parse,
  parseBlocks,
  parseInline: parseBlocks,
  parseToJson,
  renderMarkdown,
  highlightCode,
  escapeHtml,

  // Metadata mirrored from the addon when present.
  get version() {
    return loaded.available ? loaded.addon.version : 'unavailable'
  },
  get cmarkVersion() {
    return loaded.available ? loaded.addon.cmarkVersion : 'unavailable'
  },
  get supportedExtensions() {
    return loaded.available ? loaded.addon.supportedExtensions : []
  },
}
