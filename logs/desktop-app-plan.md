# Desktop App Plan

Date: 2026-08-14

## Goal

Package the current DeepSeek Harness client as installable desktop applications for macOS and Windows while preserving the existing Web UI, profiles, sessions, settings, credentials, plugin composition, and local tool behavior.

The desktop app should remove the developer-preview startup burden from ordinary users: no manual terminal process, no user-facing localhost URL, and no separate browser launch.

## Current Project Facts

- The repository is a developer-preview monorepo at `0.1.0-rc.5`.
- The current checkout is clean and aligned with official upstream `HEAD` at `47f943859b`.
- The primary product launcher is `@deepseek-ai/dsh` in `apps/cli`.
- `dsh web` boots the `web` profile and serves the Web UI at `http://127.0.0.1:3080` by default.
- The Web surface is assembled by `@deepseek-ai/dsh-web-app` over `@deepseek-ai/dsh-base`.
- The HTTP server is a replaceable host carrier, not the product core.
- `@deepseek-ai/dsh-host-webserver` already documents a desktop direction: browsers use HTTP, while Electron should load the built dist over `file://` and carry API requests over an IPC bridge.

## Recommended Architecture

Use Electron for the desktop implementation.

Rationale:

- The harness is already a Node-based product with many local runtime capabilities: filesystem, shell, subprocess, PTY, SQLite, package loading, settings, credentials, and plugin composition.
- Electron main process can host the existing Node runtime with fewer translation layers than a Rust-first shell.
- Tauri remains attractive later for footprint, but it would force early sidecar and IPC decisions before the current preview architecture settles.

## Target Desktop Runtime

The intended final desktop runtime is:

1. Electron main process boots the Harness host runtime.
2. Electron renderer loads the existing built Web frontend from `file://`.
3. A preload script exposes a minimal IPC bridge.
4. A desktop API client uses IPC to reach the existing host-side `ApiProxy`.
5. No HTTP port is required for the desktop app.

An acceptable short-lived MVP is:

1. Electron main process launches the existing Web profile on an OS-assigned loopback port.
2. The window loads that private URL.
3. The user never sees a terminal or localhost URL.

This is only a bootstrap tactic. The production desktop surface should move to `file://` plus IPC because the existing host webserver documentation already names that direction.

## Work Phases

### Phase 1: Runtime Mapping

Map how the current Web product boots and where a desktop surface can attach.

Deliverables:

- Identify the CLI profile boot path.
- Identify the Web bundle rows and runtime glue.
- Identify the frontend boot manifest injection path.
- Identify the API transport abstractions available for a non-HTTP carrier.
- Identify process lifecycle and dispose behavior that desktop must preserve.

#### Findings

- `apps/cli/src/profile-boot.ts` owns the reusable profile boot pipeline: it prepares the profile, composes bundle/user/overlay patches, provides launch environment and command-line facts, boots the Cordis tree, watches user patches, and wires bounded shutdown.
- `packages/bundle/web-app/cordis.patch.yml` is the Web surface composition. It inserts the Host services, `api-gateway`, `webserver`, `web-runtime`, `client-connection`, `client-modules`, and the browser UI plugin roster.
- `packages/bundle/web-app/src/index.ts` resolves the built Web frontend, mounts static serving, injects the Web surface prompt, exposes `DSH_WEB_URL`, and prints the local URL. A desktop surface should not reuse the URL prompt unchanged once it stops serving HTTP.
- `packages/client/modules/src/index.ts` is the Host half of dynamic UI plugin boot. It scans Loader entries with `dsh.client.platform === 'web'`, builds the `window.__DSH_BOOT__` graph, serves `/plugins/<id>/client.js`, and injects the graph into `index.html`.
- `packages/client/modules/src/client/manifest.ts` is browser-safe and defines the boot manifest wire format. Desktop should reuse this format rather than inventing a parallel plugin graph.
- `packages/client/web/src/boot.tsx` consumes `window.__DSH_BOOT__`, creates the browser module system, prefetches immediate bundles, mounts the Cordis Loader in the renderer, then creates one client plugin entry per manifest row.
- `packages/client/connection/src/client/index.ts` currently selects either `FixtureApiClient` or `WebApiClient` from page URL state. Desktop needs a third platform client selected from a preload-exposed capability rather than from localhost state.
- `packages/host/apiproxy/src/fetch/client.ts` already isolates transport behind `AbstractApiClient.doFetch()`. Its comment explicitly lists "IPC bridge" as a possible transport, so Electron IPC can reuse the existing protocol parser, rpcId handling, response validation, and domain methods.
- `packages/host/apiproxy/src/fetch/handler.ts` maps `ApiProxy` to a pure fetch-shaped handler. This can be reused in Electron main process as an in-process bridge target or as the implementation behind an IPC request handler.
- `packages/client/connection/src/client/web-api-client.ts` uses WebSocket downlinks for event streams. Desktop IPC must provide equivalent stream behavior for `events.mux` and `events.host`, not only unary calls.

#### Phase 1 Decision

The production desktop design should add a desktop transport beside the existing Web transport:

- Keep `ApiProxy` as the Host business API.
- Reuse `AbstractApiClient` for the client-side protocol contract.
- Add an Electron-specific client transport for unary calls and event streams.
- Reuse the existing Web frontend boot manifest format.
- Avoid changing `core/agent-loop`.

The fastest visible MVP may temporarily hide a loopback Web server inside Electron, but the implementation plan should target the documented `file://` plus IPC model.

### Phase 2: Desktop Package Skeleton

Add a new workspace package for the desktop application.

Likely location:

- `apps/desktop`

Expected contents:

- Electron main process entry.
- Electron preload entry.
- Renderer bootstrap integration with the existing frontend dist.
- Development launcher script.
- Package-local README explaining developer usage and limitations.

Immediate implementation tasks:

- Add `apps/desktop/package.json`.
- Add `apps/desktop/tsconfig.json`.
- Add `apps/desktop/src/main.ts` for Electron main process startup.
- Add `apps/desktop/src/preload.ts` for the renderer bridge.
- Add `apps/desktop/README.md`.
- Register the app in the Host aggregate only if its main/preload TypeScript participates in repository typecheck. Renderer UI stays in existing client packages.
- Add root scripts only after the package can build locally.

### Phase 3: Desktop Transport

Implement the Electron IPC carrier.

Expected work:

- Add or extend a client-side API implementation for Electron IPC.
- Add a host-side IPC adapter around the existing `ApiProxy`.
- Preserve the typed remote/client expectations already used by the Web UI.
- Keep renderer privileges narrow: no Node integration in renderer, context isolation enabled.

Likely package split:

- Host/runtime code can live in `apps/desktop` while it is an app-local carrier.
- If another non-Web surface needs it, extract a reusable package under `packages/client` or `packages/host` after the second consumer exists.

Open design questions:

- Whether the renderer should load plugin bundles through custom `dsh-plugin://` URLs, preload IPC returning script text, or a generated desktop boot HTML file.
- Whether `client-modules` should grow a filesystem/plugin-bundle resolver for desktop, or whether `apps/desktop` should adapt its existing `graph()` and `clientPath()` APIs.
- Whether to keep the `dsh.client.platform` value as `web` for shared browser/Electron renderer bundles, or introduce `browser`/`desktop` platform distinctions later.

### Phase 4: Packaging

Create installable artifacts.

Expected work:

- Add Electron packaging toolchain.
- Configure macOS and Windows targets.
- Include built frontend, host packages, and native/runtime dependencies.
- Verify app startup from packaged artifacts, not only dev mode.

Target artifacts:

- macOS DMG installer.
- macOS compressed archive containing `DeepSeek Harness.app`.
- Windows installer, preferably NSIS `.exe` first unless MSI requirements become explicit.
- Windows compressed archive containing the unpacked desktop app.

The macOS artifacts are unsigned until an Apple Developer Program certificate is available. Users who download the unsigned macOS archive or install from the unsigned DMG may need to remove Gatekeeper quarantine manually, for example:

```sh
xattr -r -d com.apple.quarantine /Applications/"DeepSeek Harness".app
```

This is a distribution limitation, not the long-term release path. Signed and notarized macOS artifacts remain a release hardening task.

Packaging should run locally first, then in GitHub Actions with an OS matrix:

- macOS packaging on a macOS runner.
- Windows packaging on a Windows runner.
- Artifact upload for installers and compressed archives.
- No release claim until each uploaded artifact opens and reaches the Harness UI.

Open packaging prerequisites:

- Replace the dev-only source launcher with a packaged-runtime launcher that does not depend on `apps/cli/src/bin.ts` being present in a checkout.
- Decide whether the packaged app starts built CLI JavaScript, embeds a runtime package, or boots the profile in-process.
- Include the built Web frontend and all runtime files needed by the Web profile.
- Define Electron Builder or equivalent config for app id, product name, artifact names, macOS DMG/ZIP, and Windows installer/archive targets.
- Make native addons, generated Typert artifacts, package exports, and dynamic plugin loading resolve from the packaged app layout.
- Decide which user data, profile, settings, credentials, and log paths live under Electron's app data directories.
- Add a desktop smoke check for packaged artifacts, not only `electron .`.
- Document unsigned macOS installation steps in the desktop README once packaging exists.
- Keep the GitHub Actions workflow disabled or manual-only until local packaged artifacts can start reliably.

### Phase 5: Product Polish

Add desktop-native affordances.

Possible work:

- Application menu.
- Quit and dispose behavior.
- Logs and diagnostics.
- First-run credential guidance.
- Optional tray behavior.
- Code signing and notarization preparation.
- Optional auto-update channel.

## Validation Strategy

Use focused checks that match each phase.

- Runtime-only refactors: package unit tests and typecheck.
- Web-visible behavior: Web snapshot tests.
- Desktop entry path: packaged-app smoke tests.
- IPC transport: host/client integration tests.
- Release packaging: macOS and Windows artifact boot checks.

Do not claim desktop support until packaged artifacts have been opened and the application can create or load a session.

## Risks

- Electron IPC may expose mismatches hidden by the current HTTP/fetch carrier.
- Packaged runtime may fail to resolve workspace packages, native addons, or built Typert artifacts.
- Shell, filesystem, PTY, and subprocess behavior must keep the current permission model.
- macOS signing/notarization and Windows signing are release work, not ordinary development checks.
- Unsigned macOS artifacts require manual Gatekeeper quarantine removal, which is acceptable for internal preview builds but not for a polished public release.
- Preview upstream may change boot composition quickly, so changes should attach through documented extension points.

## Execution Log

### 2026-08-14

- Created this plan.
- Completed the first runtime mapping pass across CLI boot, Web bundle composition, Web runtime glue, client module manifest generation, frontend boot, and API transport.
- Confirmed the main desktop attachment points: `runProfile`-style profile boot, `ApiProxy`, `AbstractApiClient`, `client-modules` boot graph, and the existing Web frontend shell.
- User decision: implement the desktop application with Electron.
- Next step: create the `apps/desktop` skeleton and keep the first implementation app-local until a second surface justifies extracting reusable desktop transport packages.
- Added the first `apps/desktop` skeleton: package manifest, TypeScript project, tsdown entries, Electron main process, preload bridge, and package README.
- Updated `pnpm-lock.yaml` with Electron dependency resolution using `pnpm install --lockfile-only`; no `node_modules` install was performed.
- The current Electron shell is a secure placeholder window: context isolation enabled, renderer Node integration disabled, renderer sandbox enabled, and a minimal `dshDesktop` preload bridge.
- Added the paired Chinese README and `README.i18n.yaml` record for `apps/desktop` so the new package follows the repository's bilingual README rule.
- After dependencies were installed, replaced the placeholder window with the first runnable Electron MVP: the main process launches `dsh web --port 0`, captures the private loopback URL from stdout, loads it in the Electron window, and disposes the child process on quit.
- Added `electron` to the workspace `onlyBuiltDependencies` allow-list because Electron's install script must fetch the platform runtime binary.
- Built the desktop package with `pnpm --filter @deepseek-ai/dsh-desktop run build`; it passed.
- Built the full repository with `pnpm run build`; it passed.
- Verified the CLI Web profile with `node --import tsx/esm apps/cli/src/bin.ts web --port 0`; it reported a loopback URL and was stopped cleanly.
- Installed the Electron runtime binary using the npm mirror because the default Electron binary download did not complete in this environment.
- Verified the Electron MVP with `pnpm --filter @deepseek-ai/dsh-desktop run dev`; the main process loaded, Electron became ready, the Harness Web profile reported `http://127.0.0.1:50250`, and the window loaded that URL. The process was then interrupted after the smoke check, so pnpm reported the expected SIGINT exit.
- Confirmed no Electron or `dsh web` validation process remained after stopping the smoke check.
- Recorded the packaging targets: unsigned macOS DMG plus compressed app archive, Windows installer plus compressed app archive, and a manual macOS quarantine-removal path for preview builds without Apple Developer Program signing.
- Added the desktop preview packaging baseline: `electron-builder`, package scripts for `pack` and `dist`, Electron Builder targets for macOS `dmg`/`zip` and Windows NSIS `exe`/`zip`, and a manual-only `.github/workflows/desktop-preview.yml` workflow that uploads Actions artifacts.
- Kept the workflow on `workflow_dispatch` only because the fork distributes preview builds manually.
- Updated the desktop README pair with preview packaging commands, artifact targets, and the unsigned macOS quarantine-removal command.
- Verified `pnpm install` after adding Electron Builder and explicitly denied `electron-winstaller` lifecycle scripts because the preview targets NSIS, not Squirrel.Windows.
- Verified `pnpm --filter @deepseek-ai/dsh-desktop run build`; it passed.
- Ran `pnpm --filter @deepseek-ai/dsh-desktop run pack`; Electron Builder loaded the new config and reached macOS packaging, but local packaging stalled after downloading Electron and was interrupted. The next packaging task is to diagnose that local pack hang, then replace the dev-only source runtime launcher with a packaged runtime closure before claiming installable artifacts are usable.
- Added a packaged-runtime launcher path: development still uses the source CLI through `tsx`, while packaged builds use `resources/runtime/lib/bin.js` with Electron's Node runtime and `--expose-internals`.
- Added `apps/desktop/scripts/prepare-runtime.mjs`, which runs `pnpm deploy --legacy --prod` for `@deepseek-ai/dsh` and materializes workspace `@deepseek-ai/*` packages into the runtime hoist directory so nested runtime imports do not depend on the source checkout.
- Added an Electron Builder `afterPack` hook that copies the prepared runtime into app resources and copies vendored override packages to the relative paths expected by pnpm's legacy symlinks.
- Verified the prepared runtime with `node apps/desktop/runtime/lib/bin.js --version`; it reported `0.1.0-rc.5`.
- Verified an Electron dev smoke using `DSH_DESKTOP_RUNTIME_ROOT`; it started the deployed runtime, reported a loopback Web URL, and loaded the window.
- Verified an unpacked macOS arm64 packaged app from `apps/desktop/dist/mac-arm64`; it started the runtime from `.app/Contents/Resources/runtime`, reported a loopback Web URL, and loaded the window.
- Generated local unsigned macOS arm64 preview artifacts: `DeepSeek-Harness-0.1.0-rc.5-macOS-arm64.dmg` and `DeepSeek-Harness-0.1.0-rc.5-mac-arm64.zip`.
- Verified the generated DMG with `hdiutil imageinfo`.
- Added a tag-triggered desktop release workflow. Pushing `v*` packages macOS and Windows on native GitHub runners, then creates or updates the matching GitHub Release with the generated installers and archives.
- Set the desktop wrapper version to `0.1.0` for the first small-scale release artifacts; the bundled Harness runtime remains on the upstream preview version.

### 2026-08-15

- Diagnosed why the desktop app could not read an API key the user exports for `dsh web`: macOS GUI launches (Finder / LaunchServices) do not load shell startup files, so `~/.zprofile`'s `export DEEPSEEK_API_KEY=…` never reaches the Electron main process, and the runtime child inherits nothing. The env pass-through itself (`main.ts` → spawn) was intact; the source was missing.
- Fixed it in the desktop shell: `main.ts` parses `export NAME=value` lines from the usual shell configs (`.zshenv`, `.zprofile`, `.zshrc`, `.bash_profile`, `.bashrc`, `.profile`) and injects the missing `DEEPSEEK_*` / `DSH_*` variables into the runtime environment. Values already present in `process.env` (terminal launches, `launchctl setenv`) keep precedence; nothing is executed, only parsed.
- Verified end to end from a Finder-style launch of the packaged app: `credentials.describe` reports `DEEPSEEK_API_KEY configured: true, source: env`, and `llm.models` lists the DeepSeek catalog with no failures.
