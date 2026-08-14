#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronPackage = require.resolve('electron/package.json')
const electronDist = resolve(dirname(electronPackage), 'dist')
const builderCli = require.resolve('electron-builder/cli.js')
const electronDistConfig = existsSync(electronDist) ? [`-c.electronDist=${electronDist}`] : []

const result = spawnSync(process.execPath, [
  builderCli,
  ...process.argv.slice(2),
  ...electronDistConfig,
  '--publish=never',
], {
  cwd: packageRoot,
  env: { ...process.env, CI: 'true' },
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
process.exit(result.status ?? 1)
