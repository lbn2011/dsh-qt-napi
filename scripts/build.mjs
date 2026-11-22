#!/usr/bin/env node
/**
 * Builds the `qt-bridge` addon with node-gyp and stages the binary where the
 * discovery code (and the Qt app's loader) expects it:
 *
 *   build/Release/qt-bridge.node            <- node-gyp output
 *   prebuild/<platform>-<arch>/qt-bridge.node  <- staged copy shipped to users
 *
 * Usage:
 *   node scripts/build.mjs            # release build + stage prebuild
 *   node scripts/build.mjs --debug    # debug build (not staged)
 *   node scripts/build.mjs --no-stage # build only
 *
 * Why a script instead of a raw `node-gyp rebuild`: the prebuild staging step is
 * what makes the package usable without a compiler, and doing it here keeps CI
 * and local builds identical.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const debug = args.includes('--debug')
const stage = !args.includes('--no-stage') && !debug
const configuration = debug ? 'Debug' : 'Release'

/** Runs a command, inheriting stdio, and returns its exit status. */
function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  return result.status ?? 1
}

/** Locates a usable node-gyp: local dev dependency first, then a pinned npx. */
function nodeGypCommand() {
  const local = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'node-gyp.cmd' : 'node-gyp')
  if (existsSync(local)) return { command: local, args: [] }
  // node-gyp ships with npm, but not on PATH; npx resolves it without a global install.
  return { command: process.platform === 'win32' ? 'npx.cmd' : 'npx', args: ['--yes', 'node-gyp@11'] }
}

/**
 * Parallelism. The team machines run under a 200% CPU / 4 GiB cgroup, and libuv
 * + cmark compile fine at two jobs, so default to 2 and let CI raise it.
 */
function jobsFlag() {
  const jobs = process.env.DSH_QT_NAPI_JOBS || '2'
  return [`--jobs=${jobs}`]
}

function main() {
  const gyp = nodeGypCommand()
  const gypArgs = [...gyp.args, 'rebuild', `--${configuration.toLowerCase()}`, ...jobsFlag()]
  console.log(`[dsh-qt-napi] ${gyp.command} ${gypArgs.join(' ')}`)
  const status = run(gyp.command, gypArgs)
  if (status !== 0) {
    console.error(`[dsh-qt-napi] node-gyp failed with exit code ${status}`)
    process.exit(status)
  }

  const built = join(root, 'build', configuration, 'qt-bridge.node')
  if (!existsSync(built)) {
    console.error(`[dsh-qt-napi] expected ${built} to exist after the build`)
    process.exit(1)
  }

  if (!stage) {
    console.log(`[dsh-qt-napi] built ${built} (not staged)`)
    return
  }

  const triple = `${process.platform}-${process.arch}`
  const target = join(root, 'prebuild', triple, 'qt-bridge.node')
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(built, target)
  const size = statSync(target).size
  console.log(`[dsh-qt-napi] staged prebuild/${triple}/qt-bridge.node (${size} bytes)`)
}

main()
