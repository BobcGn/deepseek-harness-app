const { cpSync, existsSync, rmSync } = require('node:fs')
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
    cpSync(vendorSource, vendorTarget, { recursive: true, dereference: false, verbatimSymlinks: true })
  }
}
