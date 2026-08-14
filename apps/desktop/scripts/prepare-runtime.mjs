#!/usr/bin/env node

import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const runtimeRoot = resolve(packageRoot, 'runtime')

rmSync(runtimeRoot, { recursive: true, force: true })

const result = spawnSync('pnpm', [
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
