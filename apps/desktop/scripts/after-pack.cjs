const { cpSync, existsSync, lstatSync, readdirSync, rmSync, statSync, unlinkSync } = require('node:fs')
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
