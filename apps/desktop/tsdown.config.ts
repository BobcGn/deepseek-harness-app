import { defineConfig } from 'tsdown'

/** Build the Electron main and preload entries as independent Node artifacts. */
export default defineConfig([
  {
    entry: ['lib/types/main.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    external: ['electron'],
  },
  {
    entry: ['lib/types/preload.js'],
    outDir: 'lib',
    format: ['cjs'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: true,
    dts: false,
    clean: false,
    external: ['electron'],
  },
])
