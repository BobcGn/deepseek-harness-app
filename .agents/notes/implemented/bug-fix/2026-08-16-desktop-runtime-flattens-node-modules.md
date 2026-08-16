# Agent Note: Desktop runtime flattens node_modules for installers that drop symlinks

Status: implemented

English | [中文](2026-08-16-desktop-runtime-flattens-node-modules.zh.md)

## Problem

A fresh Windows install of the packaged desktop app failed to boot with `Cannot find package '@deepseek-ai/dsh-shell' imported from D:\新建文件夹\DeepSeek Harness\resources\runtime\node_modules\@deepseek-ai\dsh-shell-env\lib\index.js`, and the same `ERR_MODULE_NOT_FOUND` for transitive dependencies across the tree (`zod`, `@deepseek-ai/dsh-fs`, `@deepseek-ai/dsh-typert-protocol`, `@earendil-works/pi-ai`, `@img/colour`, ...).

The declared-entry fixes made every plugin a top-level package, but the deployed runtime is a pnpm **isolated store**: top-level entries are symlinks into `node_modules/.pnpm`, and packages resolve their transitive dependencies through store links inside their own `node_modules`. macOS installers (dmg/zip) preserve symlinks, so the store graph survives. Windows installers (NSIS/zip extraction) do not preserve symlinks/junctions, so an installed copy loses the whole store graph: top-level packages become plain directories with no way to reach their dependencies, and the loader fails on the first plugin that imports one.

## Decision

`prepare-runtime` flattens the deployed `node_modules` into a self-contained tree with no symlinks:

- Every hoist-root entry (`node_modules/.pnpm/node_modules/*`, which pnpm fills with every dependency) is real-copied to the top level, scoped packages included.
- Remaining nested links are materialized iteratively (an explicit stack, not recursion): each link is replaced by a real copy of its target. A package's own `node_modules` is kept, because it pins the exact store version a package needs when the graph holds multiple versions of one name.
- A materialized copy excludes its own `node_modules` subdirectory, which both cuts the peer cycle (`@deepseek-ai/cordis` <-> `cordis-plugin-loader`) that would otherwise nest copies until the path exceeds the filesystem limit, and lets the flat top level resolve the dependency.
- The store (`node_modules/.pnpm`) and its metadata are deleted; an absolute self-link the deploy leaves for the app (`node_modules/@deepseek-ai/dsh`) is removed.

The store path itself contains `node_modules` segments, so the copy filter judges by the path relative to the copied root. The resulting runtime has zero symlinks and zero broken links; the Windows-installed layout is byte-identical in structure to what the smoke job boots.

## Alternatives considered

**Inject workspace packages (`inject-workspace-packages=true`).** Rejected: pnpm v10+ deploy still emits symlink top-level entries into the store; injection does not make the installed tree symlink-free.

**Flatten only for Windows packaging.** Rejected: keeping two layouts would let macOS and Windows products diverge and the CI smoke would not cover the shipped structure. One flat layout is verified on both platforms.

**Materialize with recursion.** Rejected: the deep dependency chains and the peer cycle overflowed the stack and produced path-too-long aborts; the iterative walk plus the node_modules exclusion is bounded.

## Consequences

An installed copy is self-contained on every platform: no symlink or junction is required, so NSIS and zip extraction produce a working runtime. The runtime grows from ~129 MiB to ~186 MiB (real copies of nested store packages) and loses the `.pnpm` store. The CI boot smoke (macOS and Windows, fresh `$DSH_HOME`) is the gate that would have caught the Windows failure on the previous release.

Verification: clean-machine boots of the flattened runtime report the web URL and serve HTTP 200; the tree has zero symlinks and the prune reports zero broken links; app-boot tests stay green.
