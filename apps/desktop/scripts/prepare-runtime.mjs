#!/usr/bin/env node

import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const runtimeRoot = resolve(packageRoot, 'runtime')

rmSync(runtimeRoot, { recursive: true, force: true })

const pnpmExecPath = process.env.npm_execpath
const pnpmCommand = pnpmExecPath === undefined || pnpmExecPath === ''
  ? { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args: [] }
  : { command: process.execPath, args: [pnpmExecPath] }

const result = spawnSync(pnpmCommand.command, [
  ...pnpmCommand.args,
  '--filter',
  '@deepseek-ai/dsh',
  'deploy',
  '--legacy',
  '--prod',
  runtimeRoot,
], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const hoistRoot = join(runtimeRoot, 'node_modules/.pnpm/node_modules/@deepseek-ai')
for (const packageRoot of workspacePackageRoots()) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith('@deepseek-ai/')) continue
  const target = join(hoistRoot, manifest.name.slice('@deepseek-ai/'.length))
  rmSync(target, { recursive: true, force: true })
  cpSync(packageRoot, target, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (source) => source === packageRoot || !source.split(/[\\/]/u).includes('node_modules'),
  })
}

pruneRuntime(runtimeRoot)

function workspacePackageRoots() {
  return [
    ...twoLevelPackageRoots(join(repositoryRoot, 'packages')),
    ...oneLevelPackageRoots(join(repositoryRoot, 'vendor')),
    join(repositoryRoot, 'apps/web'),
  ].filter((candidate) => existsSync(join(candidate, 'package.json')))
}

function twoLevelPackageRoots(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((group) => {
    if (!group.isDirectory()) return []
    const groupRoot = join(root, group.name)
    return readdirSync(groupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(groupRoot, entry.name))
  })
}

function oneLevelPackageRoots(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
}

function pruneRuntime(root) {
  const before = measureTree(root)
  const removed = {
    directories: 0,
    files: 0,
    symlinks: 0,
  }

  pruneUnsupportedPlatformPackages(join(root, 'node_modules/.pnpm'), removed)
  pruneTree(root, removed)
  pruneBrokenSymlinks(root, removed)

  const after = measureTree(root)
  process.stdout.write(
    `Pruned desktop runtime: ${formatBytes(before.bytes)} -> ${formatBytes(after.bytes)}, ` +
    `${before.files} -> ${after.files} files, removed ${removed.directories} directories, ` +
    `${removed.files} files, ${removed.symlinks} broken symlinks\n`,
  )
}

function pruneUnsupportedPlatformPackages(pnpmStoreRoot, removed) {
  if (!existsSync(pnpmStoreRoot)) return
  for (const entry of readdirSync(pnpmStoreRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    if (!isUnsupportedPlatformPackage(entry.name)) continue
    removeDirectory(join(pnpmStoreRoot, entry.name), removed)
  }
}

function isUnsupportedPlatformPackage(name) {
  const unsupportedOsTokens = {
    win32: ['darwin', 'linux'],
    darwin: ['win32', 'windows', 'linux'],
    linux: ['darwin', 'win32', 'windows'],
  }[process.platform] ?? []
  if (unsupportedOsTokens.some((token) => name.includes(token))) return true

  const unsupportedArchTokens = process.arch === 'arm64'
    ? ['x64', 'ia32']
    : process.arch === 'x64'
      ? ['arm64', 'ia32']
      : []
  return unsupportedArchTokens.some((token) => name.includes(token))
}

function pruneTree(root, removed) {
  const entries = readdirSync(root, { withFileTypes: true })
  // The parent holding package.json is a package root: only there do the
  // repo's own docs/tests/examples/benchmark dirs live. Published packages
  // ship the same names inside their runtime payload (yaml ships dist/doc
  // with modules its dist requires), so those must survive.
  const atPackageRoot = existsSync(join(root, 'package.json'))
  for (const entry of entries) {
    const path = join(root, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      if (shouldPruneDirectory(entry.name, atPackageRoot)) {
        removeDirectory(path, removed)
        continue
      }
      pruneTree(path, removed)
      continue
    }
    if (stat.isFile() && shouldPruneFile(entry.name)) removeFile(path, removed)
  }
}

function pruneBrokenSymlinks(root, removed) {
  const entries = readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(root, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      if (!pointsToExistingTarget(path)) removeSymlink(path, removed)
      continue
    }
    if (stat.isDirectory()) pruneBrokenSymlinks(path, removed)
  }
}

function pointsToExistingTarget(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

function shouldPruneDirectory(name, atPackageRoot) {
  const devMeta = ['.cache', '.changeset', '.github', '.turbo', '.vite', '.vitest', 'coverage']
  if (devMeta.includes(name)) return true
  // These names also appear inside published package payloads (yaml/dist/doc,
  // mermaid/dist/tests), so prune them only at a package root — the repo's own
  // docs/tests/examples/benchmark dirs — never inside a package's dist/lib.
  return atPackageRoot && [
    '__tests__', 'benchmark', 'benchmarks', 'doc', 'docs', 'example', 'examples', 'test', 'tests',
  ].includes(name)
}

function shouldPruneFile(name) {
  return name.endsWith('.d.ts') ||
    name.endsWith('.d.ts.map') ||
    name.endsWith('.map') ||
    name.endsWith('.md') ||
    name.endsWith('.tsbuildinfo')
}

function removeDirectory(path, removed) {
  rmSync(path, { recursive: true, force: true })
  removed.directories += 1
}

function removeFile(path, removed) {
  rmSync(path, { force: true })
  removed.files += 1
}

function removeSymlink(path, removed) {
  unlinkSync(path)
  removed.symlinks += 1
}

function measureTree(root) {
  const result = { bytes: 0, files: 0 }
  if (!existsSync(root)) return result
  measureTreeInto(root, result)
  return result
}

function measureTreeInto(root, result) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const stat = lstatSync(path)
    if (entry.isDirectory()) {
      measureTreeInto(path, result)
      continue
    }
    if (entry.isFile()) result.files += 1
    result.bytes += stat.size
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(1)} KiB`
  const mib = kib / 1024
  if (mib < 1024) return `${mib.toFixed(1)} MiB`
  return `${(mib / 1024).toFixed(1)} GiB`
}
