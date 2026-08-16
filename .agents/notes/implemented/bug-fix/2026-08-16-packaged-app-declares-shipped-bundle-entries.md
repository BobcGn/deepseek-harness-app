# Agent Note: Packaged app declares every shipped bundle entry

Status: implemented

English | [中文](2026-08-16-packaged-app-declares-shipped-bundle-entries.zh.md)

## Problem

A fresh Windows install of the packaged desktop app failed to boot with `Cannot find package '@deepseek-ai/dsh-llm' imported from C:\Users\Admin\.dsh\profiles\web\` — the same fresh-machine failure mode the store-descent heal was meant to cover, but on a platform whose pnpm store layout was never exercised. The underlying cause is a declaration gap, not resolution:

- `pnpm deploy --filter @deepseek-ai/dsh --prod` puts only the app's **direct** dependencies in the deployed top-level `node_modules`; workspace packages are linked, not expanded.
- The shipped bundles (base/web-app/headless) mount 127 plugin entry packages, but `apps/cli/package.json` declared only 64 of them: 6 sat in `devDependencies` and 41 were never declared at all (they were reachable only through `dsh-base`'s peer declarations).
- On macOS the realpath-based heal BFS happened to bridge the gap through the pnpm hoist root; on a fresh Windows machine that chain (manifest closure + peer propagation + store-symlink realpath) failed, and no CI step ever booted a packaged Windows runtime to catch it.

## Decision

Four layers make the packaged app start on a fresh machine on every platform:

1. **Declare the runtime surface.** `apps/cli/package.json` moves the 10 runtime-needed packages out of `devDependencies` and adds the 83 bundle-entry packages that were missing, so the deployed top-level `node_modules` covers every shipped entry (154 packages on the shipped runtime).
2. **Wholesale heal fallback.** `healProfilesModuleFallback` links the whole pnpm hoist root (`node_modules/.pnpm/node_modules/@deepseek-ai/*`), which the packaging step materializes from every workspace package, in addition to the manifest-closure BFS. A bundle entry that is ever left undeclared still resolves on a fresh machine; a flat npm install simply has no hoist root and skips this.
3. **CI boot smoke.** `desktop-release.yml` gains a `smoke` job on macOS and Windows runners that prepares the runtime and boots `lib/bin.js web --port 0` against a fresh `$DSH_HOME`, asserting the loopback URL; the release job now depends on it.
4. **Declaration gate.** `scripts/verify-app-dependency-coverage.ts` fails when any shipped bundle entry's package is not a direct dependency of the app; it runs in the shared static gates and `check-all`.

## Alternatives considered

**Depend on the manifest closure + realpath heal alone.** Rejected: it proved platform-fragile (Windows) and depends on peer-declaration propagation; the declaration gap is the defect, not the resolution chain.

**Expand workspace dependencies inside `prepare-runtime` instead of declaring them.** Rejected: that bypasses pnpm's deploy semantics, hides the dependency relationship from the manifest, and would still leave the fallback without a guarantee for future entries.

**Skip the CI smoke as redundant with packaging.** Rejected: packaging success never exercised boot; the smoke is the first check that a packaged runtime reports a URL on a given platform.

## Consequences

The deployed runtime top-level `node_modules` covers all shipped bundle entries (154 packages, 0 missing on the current bundles), and the heal additionally links the entire hoist root, so a fresh install boots on macOS and Windows without any pre-existing `~/.dsh` state. The fallback link count grows to the hoist-root population (~230); first-launch healing stays fast. The declaration gate pins the contract so a future bundle entry cannot silently ship as a second-class resolution path.

Verification: app-boot unit tests (107, including the hoist-root wholesale regression), clean-machine boots of the prepared runtime reporting the web URL and serving HTTP 200, gate positive and negative cases, and the CI smoke job on both platforms.
