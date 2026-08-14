# Agent Note: Desktop Windows packaging budget

Status: implemented

English | [中文](2026-08-15-desktop-windows-packaging-budget.zh.md)

## Problem

The desktop preview workflow builds macOS artifacts quickly but the Windows job can spend its full timeout inside electron-builder's zip target. The failed run reached `dist\DeepSeek-Harness-0.1.0-win-x64.zip` after installing dependencies, preparing the runtime, and unpacking Electron, then made no visible progress until the job hit the 45 minute limit. The desktop runtime is a deployed Node application with many small files, workspace package copies, and platform optional packages, so Windows compression cost can dominate the whole release lane.

## Decision

The desktop runtime preparation step prunes release-irrelevant files after `pnpm deploy` and workspace package materialization. The pruning removes unsupported platform package directories from the pnpm virtual store, documentation and test directories, source maps, TypeScript declaration files, markdown files, tsbuildinfo files, and broken symlinks. It reports before and after byte and file counts in CI logs so packaging regressions have visible size evidence.

Electron Builder uses normal compression by default. On Windows only, the wrapper passes `-c.compression=store` so the required zip artifact is packaged without expensive archive compression. The NSIS installer and zip remain part of the Windows output set. Preview artifact upload paths include only distributable files, not unpacked intermediate application directories.

The Electron `afterPack` hook removes broken symlinks from the packaged application directory after copying the runtime. Vendor packages copied to support legacy pnpm links exclude their own `node_modules`, because those development-time links can point outside the packaged application and make 7zip fail while enumerating the archive input.

## Alternatives considered

**Raise the Windows job timeout.** This could make a slow run pass, but it leaves the release lane unpredictable and hides the packaging size problem.

**Drop the Windows zip artifact.** This would avoid the observed slow target, but the desktop release policy requires a compressed portable artifact alongside an installer.

**Keep maximum compression for smaller artifacts.** Smaller downloads are useful, but this preview distribution values reliable CI completion more than archive density.

**Hand-pick every runtime dependency.** A minimal dependency manifest could be smaller, but it would duplicate pnpm's resolver behavior and risk omitting plugins that the harness loads dynamically.

## Consequences

- Windows packaging favors deterministic completion over smallest possible archives.
- CI logs include runtime size evidence before Electron Builder runs.
- The desktop runtime keeps pnpm deploy as the source of truth and prunes only files that are not executed at runtime.
- Platform optional packages for other operating systems are absent from packaged apps, so future cross-platform native dependencies must use package names with accurate platform tokens or update the pruner.
- Broken symlink cleanup is a packaging step, not a runtime resolver; required dependencies still need to exist through the deployed runtime or the explicitly copied vendor packages.
