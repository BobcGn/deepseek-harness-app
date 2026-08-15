# Agent Note: Packaged desktop runtime resolves every plugin through the store

Status: implemented

English | [中文](2026-08-15-packaged-runtime-plugin-resolution.zh.md)

## Problem

The packaged macOS app boots the `dsh` runtime from `Contents/Resources/runtime` and failed with `dsh web exited before reporting a URL`; every failing loader entry bottomed out at `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cosmokit' imported from <AppRoot>/vendor/schemastery/lib/index.mjs`. Three independent gaps in the desktop packaging pipeline produced it. Each surfaces only in the packaged layout, never in the source flow, because the workspace root `node_modules` and `vendor/schemastery/node_modules` mask them in development.

1. **Escaping store symlinks.** pnpm's `deploy --legacy` emits store-entry symlinks `@deepseek-ai/schemastery -> ../../../../../../../../vendor/schemastery` (and `@deepseek-ai/cosmokit` for the cordis family). Copied verbatim into `Contents/Resources/runtime`, eight levels of `..` land at `<AppRoot>/vendor/<name>`, where the `afterPack` hook copies the vendored packages with `node_modules` excluded. Schemastery's entry imports `@deepseek-ai/cosmokit` by bare specifier, and the app root has no `node_modules` ancestor chain, so that import throws.
2. **The heal cannot descend into the store.** `healProfilesModuleFallback` builds the flat `$DSH_HOME/profiles/node_modules` fallback by BFS over the app manifest's dependency closure, resolving each name with `createRequire(anchor).resolve.paths`. In a deployed runtime the top-level `node_modules/@deepseek-ai/<pkg>` entries are symlinks into the store, and `resolve.paths` walks the anchor's lexical parent chain, which never enters `node_modules/.pnpm` (the hoist root). The BFS therefore linked only the 64 direct dependencies and never reached store-resident transitive packages (`dsh-llm`, `dsh-session`, `dsh-typert-*`, `dsh-api-*`, ...), leaving roughly 30 web-profile entries unresolvable on a machine with no pre-existing fallback links. The fallback's link maintenance itself is covered by the [stale-fallback-link fix](2026-08-12-unlink-stale-profile-fallback-links.md).
3. **The pruner deleted runtime payload.** `prepare-runtime`'s tree pruner (whose size role is recorded in the [desktop packaging budget](../process/2026-08-15-desktop-windows-packaging-budget.md)) removed every directory named `doc`/`docs`/`test`/`tests`/`example`/`examples`/`benchmark`/`__tests__` anywhere in the runtime, including inside third-party package payloads: `yaml/dist/doc` (whose `composer.js` requires `../doc/directives.js`) was deleted, so the first plugin importing `yaml` crashed at module load.

## Decision

- `afterPack` creates the node_modules bridge the workspace root provides in development: `node_modules/@deepseek-ai/{cosmokit,schemastery}` symlinks at the app root pointing at `../../vendor/<name>`. The escaping symlinks reference only those two names, so two links close the gap.
- `packageDirFromAnchor` realpaths the anchor before probing, matching Node's own symlink-following load resolution. The heal BFS then descends into the store and links transitive in-box packages (195 links on the shipped runtime instead of 64).
- The pruner's directory-name list splits: `.cache`, `.changeset`, `.github`, `.turbo`, `.vite`, `.vitest`, `coverage` prune anywhere; `__tests__`, `benchmark`, `benchmarks`, `doc`, `docs`, `example`, `examples`, `test`, `tests` prune only at a package root (the parent holds `package.json`), where the repo's own dev dirs live. Published payload dirs like `yaml/dist/doc` survive.

## Alternatives considered

**Re-point the escaping symlinks at the hoist-root copies in `prepare-runtime` and drop the app-root vendor copies.** Rejected as a larger change to the documented pnpm-legacy-symlink layout; the bridge preserves that layout while adding two links.

**Mirror the entire hoist root at the app root in `afterPack`.** Rejected: roughly 230 extra links to fix one bare import; the escaping symlinks reference only `cosmokit` and `schemastery`, and the heal fix makes the hoist root reachable through the store walk instead.

**Prune by inspecting directory contents for loadable modules.** Rejected: walking candidate directories costs more and still guesses; "at a package root" is the exact discriminator between the repo's dev directories and a package's runtime payload.

## Consequences

A packaged app boots on a clean machine: the web profile reports its loopback URL and serves the GUI. `resolveBundleDir` results and fallback link targets now carry the realpath spelling when the install root is itself a symlink (macOS temp directories); the location is identical. The heal fix is product code in `dsh-app-boot`; the other two fixes are packaging scripts.

Verification: a unit regression covers the store-descent heal; end-to-end boots exercised the packaged runtime against the installed app layout with a pre-existing fallback, and a regenerated runtime against a fresh `$DSH_HOME`.
