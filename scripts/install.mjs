#!/usr/bin/env node
/**
 * `npm install` hook.
 *
 * The deal with consumers is simple: **a prebuilt binary must be enough**. So
 * this script
 *
 *   1. keeps the checkout pristine when a matching `prebuild/` binary already
 *      loads (the common case for users and for CI job that only needs to run
 *      tests against the published artifact);
 *   2. otherwise compiles from the vendored cmark-gfm sources through
 *      `scripts/build.mjs`;
 *   3. never fails the install on a platform we simply cannot build on — it
 *      prints a clear diagnostic and exits 0, because the Qt app has a degraded
 *      renderer for exactly this case. Set `DSH_QT_NAPI_STRICT_INSTALL=1` to
 *      turn that warning into a hard failure (CI does this).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const requireFromHere = createRequire(import.meta.url)
const triple = `${process.platform}-${process.arch}`
const prebuilt = join(root, 'prebuild', triple, 'qt-bridge.node')
const strict = process.env.DSH_QT_NAPI_STRICT_INSTALL === '1'

/** True when the staged prebuild loads and exposes the expected functions. */
function prebuildWorks() {
  if (!existsSync(prebuilt)) return false
  try {
    const addon = requireFromHere(prebuilt)
    return typeof addon?.parse === 'function' && typeof addon?.renderMarkdown === 'function'
  } catch (error) {
    console.warn(`[dsh-qt-napi] staged binary is unusable (${error.message}); rebuilding`)
    return false
  }
}

function main() {
  if (prebuildWorks()) {
    console.log(`[dsh-qt-napi] using prebuilt binary prebuild/${triple}/qt-bridge.node`)
    return
  }

  console.log(`[dsh-qt-napi] no usable prebuild for ${triple}; compiling from source`)
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'build.mjs')], {
    cwd: root,
    stdio: 'inherit',
  })

  if (result.status === 0 && prebuildWorks()) {
    console.log(`[dsh-qt-napi] build complete: prebuild/${triple}/qt-bridge.node`)
    return
  }

  const reason =
    result.error?.message ??
    `compilation exited with status ${result.status}. Install a C++ toolchain (build-essential / Xcode CLT / MSVC Build Tools) and retry.`
  console.warn(`[dsh-qt-napi] WARNING: could not build the native addon: ${reason}`)
  console.warn('[dsh-qt-napi] The Qt app will fall back to its degraded Markdown renderer.')
  if (strict) {
    console.error('[dsh-qt-napi] DSH_QT_NAPI_STRICT_INSTALL=1: failing instead of degrading')
    process.exit(1)
  }
}

main()
