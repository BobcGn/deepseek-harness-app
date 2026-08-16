/**
 * Verify the dsh app's dependencies cover every shipped bundle entry.
 *
 * A deployed runtime's top-level node_modules holds only the app's direct
 * dependencies (pnpm deploy keeps workspace links unresolved), and the profile
 * module-fallback heal links packages from that closure. A bundle entry the
 * app never declares would resolve only through the hoist-root wholesale link,
 * a silent second-class path; this gate pins the primary contract: every
 * plugin entry the shipped bundles (base/web-app/headless) mount must be a
 * direct dependency of the app.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'

const root = resolve(import.meta.dirname, '..')
const SHIPPED_BUNDLES = [
  'packages/bundle/base/cordis.patch.yml',
  'packages/bundle/web-app/cordis.patch.yml',
  'packages/bundle/headless/cordis.patch.yml',
]
const APP_MANIFEST = 'apps/cli/package.json'

interface PackageManifest {
  name?: string
  dependencies?: Record<string, string>
}

interface JsExpr {
  __jsExpr: string
}

const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: data => typeof data === 'string',
  construct: (data: unknown): JsExpr => {
    if (typeof data !== 'string') throw new TypeError('!!js requires a scalar string')
    return { __jsExpr: data }
  },
})
const schema = yaml.JSON_SCHEMA.extend(jsExprType)

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/** The entry names declared anywhere in one patch file, including inside group config lists. */
function entryNames(file: string): Set<string> {
  const document: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'), { schema })
  const names = new Set<string>()
  const walk = (value: unknown): void => {
    if (isUnknownArray(value)) {
      for (const item of value) walk(item)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.name === 'string') names.add(value.name)
    for (const child of Object.values(value)) walk(child)
  }
  walk(document)
  return names
}

/** Normalize an entry name to its package name: `@deepseek-ai/x/sub` -> `@deepseek-ai/x`. */
function packageName(name: string): string | undefined {
  if (!name.startsWith('@deepseek-ai/')) return undefined
  const segments = name.split('/')
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined
}

const manifest = JSON.parse(readFileSync(resolve(root, APP_MANIFEST), 'utf8')) as PackageManifest
const dependencies = manifest.dependencies ?? {}
const errors: string[] = []
for (const file of SHIPPED_BUNDLES) {
  for (const entryName of entryNames(file)) {
    if (entryName.startsWith('cordis:')) continue
    const pkg = packageName(entryName)
    if (pkg === undefined) continue
    if (dependencies[pkg] === undefined) {
      errors.push(`${file}: entry "${entryName}" resolves to ${pkg}, which ${APP_MANIFEST} does not declare as a dependency`)
    }
  }
}

if (errors.length > 0) {
  console.error('verify-app-dependency-coverage: shipped bundle entries must be direct dependencies of the dsh app:')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('verify-app-dependency-coverage: all shipped bundle entries are declared app dependencies.')
}
