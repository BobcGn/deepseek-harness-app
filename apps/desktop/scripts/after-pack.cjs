const { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  const source = join(context.packager.projectDir, 'runtime')
  if (!existsSync(source)) throw new Error(`desktop runtime is missing: ${source}`)

  const appRoot = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
    : context.appOutDir
  const resources = context.electronPlatformName === 'darwin'
    ? join(appRoot, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  const target = join(resources, 'runtime')

  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true })

  const repositoryRoot = join(context.packager.projectDir, '../..')
  for (const name of ['cosmokit', 'schemastery']) {
    const vendorSource = join(repositoryRoot, 'vendor', name)
    const vendorTarget = join(appRoot, 'vendor', name)
    rmSync(vendorTarget, { recursive: true, force: true })
    cpSync(vendorSource, vendorTarget, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: (source) => source === vendorSource || !source.split(/[\\/]/u).includes('node_modules'),
    })
  }

  // pnpm's legacy store symlinks resolve the vendored @deepseek-ai/schemastery
  // and @deepseek-ai/cosmokit copies outside the runtime, at <appRoot>/vendor.
  // Schemastery's own entry imports @deepseek-ai/cosmokit by bare specifier, so
  // give the app root the node_modules bridge the workspace root provides in
  // development; without it that import throws ERR_MODULE_NOT_FOUND and every
  // schemastery-importing plugin fails to load at boot.
  const vendorBridge = join(appRoot, 'node_modules', '@deepseek-ai')
  mkdirSync(vendorBridge, { recursive: true })
  for (const name of ['cosmokit', 'schemastery']) {
    const link = join(vendorBridge, name)
    rmSync(link, { recursive: true, force: true })
    symlinkSync(join('..', '..', 'vendor', name), link, 'junction')
  }

  const prunedSymlinks = pruneBrokenSymlinks(appRoot)
  if (prunedSymlinks > 0) {
    console.log(`Pruned ${prunedSymlinks} broken symlinks from packaged desktop app`)
  }
}

function pruneBrokenSymlinks(root) {
  let removed = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      if (pointsToExistingTarget(path)) continue
      unlinkSync(path)
      removed += 1
      continue
    }
    if (stat.isDirectory()) removed += pruneBrokenSymlinks(path)
  }
  return removed
}

function pointsToExistingTarget(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}
