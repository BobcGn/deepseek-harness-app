#!/usr/bin/env node

import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
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

// The deployed runtime is a pnpm isolated store: every top-level entry is a
// symlink into node_modules/.pnpm and packages resolve their transitive
// dependencies through store links. Windows installers do not preserve
// symlinks/junctions, so an installed copy loses the whole store graph.
// Flatten the hoist root (which pnpm fills with every dependency) into real
// top-level directories and drop the store, so the installed node_modules is
// self-contained with no symlink to break.
flattenModules(runtimeRoot)

pruneRuntime(runtimeRoot)

function flattenModules(runtimeRoot) {
  const modules = join(runtimeRoot, 'node_modules')
  const hoist = join(modules, '.pnpm', 'node_modules')
  if (!existsSync(hoist)) return
  // Remove the deployed top-level entries; every dependency comes from the
  // hoist root below. .bin holds plain launcher scripts and stays.
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (entry.name === '.bin' || entry.name === '.pnpm' || entry.name === '.modules.yaml') continue
    rmSync(join(modules, entry.name), { recursive: true, force: true })
  }
  // Real-copy every hoist-root entry (scoped packages included), following
  // the store links so the copies are self-contained. cpSync's dereference
  // does not expand nested links, so materialize them afterwards: a package's
  // own node_modules pins the exact store version it needs, which the single
  // top-level copy cannot replace when the graph holds multiple versions.
  for (const entry of readdirSync(hoist, { withFileTypes: true })) {
    const source = join(hoist, entry.name)
    const target = join(modules, entry.name)
    rmSync(target, { recursive: true, force: true })
    cpSync(source, target, { recursive: true, dereference: true })
  }
  materializeLinks(modules)
  // The store duplicates the flattened tree; drop it and its metadata.
  rmSync(join(modules, '.pnpm'), { recursive: true, force: true })
  rmSync(join(modules, '.modules.yaml'), { force: true })
  // A deploy may leave an absolute link for the app itself pointing back at
  // the build checkout; the runtime never resolves itself from node_modules.
  rmSync(join(modules, '@deepseek-ai', 'dsh'), { recursive: true, force: true })
}

/** Replace every remaining symlink with a real copy of its target, iteratively. */
function materializeLinks(root) {
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.pnpm') continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        let target
        try {
          target = realpathSync(path)
        } catch {
          // Dangling link (e.g. an optional peer no version satisfies): leave
          // it for the broken-symlink prune instead of failing the build.
          continue
        }
        rmSync(path, { recursive: true, force: true })
        // Copy the package payload only: a peer cycle (cordis <-> loader)
        // would otherwise nest copies forever, and the flat top level already
        // resolves every dependency after the store is dropped. The store
        // path itself contains node_modules segments, so judge by the
        // relative path under the copied root, not the absolute one.
        cpSync(target, path, {
          recursive: true,
          dereference: true,
          filter: (source) => source === target
            || !relative(target, source).split(/[\\/]/u).includes('node_modules'),
        })
        if (existsSync(path) && lstatSync(path).isDirectory()) stack.push(path)
      } else if (entry.isDirectory()) {
        stack.push(path)
      }
    }
  }
}

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
