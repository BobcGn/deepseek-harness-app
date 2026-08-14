# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron desktop application shell for DeepSeek Harness.

This app is the desktop surface under development. It will preserve the existing Web client while replacing the developer-preview launch flow with an installable macOS and Windows application.

## Development

Install workspace dependencies first:

```sh
pnpm install
```

Build the desktop main and preload entries:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
```

Run the current Electron shell:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

Build local preview artifacts for the current platform:

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dist
```

## Current Scope

The current shell opens an Electron window with context isolation enabled, renderer Node integration disabled, and a minimal preload bridge. Development mode launches the existing Web profile from the source checkout on an OS-assigned loopback port. Packaged preview builds launch a deployed Harness runtime from Electron resources, then load the hidden loopback Web UI. The next transport milestone is to load the existing Web frontend over `file://` with an IPC-backed API client.

## Preview Packaging

The desktop preview workflow is manual-only and uploads GitHub Actions artifacts instead of publishing a release. macOS artifacts target unsigned `dmg` and `zip` outputs. Windows artifacts target NSIS `exe` and `zip` outputs.

Packaging runs the repository build, prepares an app-local runtime with `pnpm deploy --legacy --prod`, and copies that runtime into Electron resources. The preview runtime also materializes workspace packages in its pnpm hoist directory so packaged builds do not depend on a source checkout.

Unsigned macOS preview builds may need Gatekeeper quarantine removal after installation:

```sh
xattr -r -d com.apple.quarantine /Applications/"DeepSeek Harness".app
```

## Release Packaging

Pushing a `v*` tag runs the desktop release workflow. The workflow packages macOS and Windows on their native GitHub runners, then creates or updates the matching GitHub Release with the generated installers and archives. The desktop wrapper version controls artifact names; the bundled Harness runtime keeps its upstream preview version until the runtime itself is released.

## Implementation Notes

- Keep desktop-specific transport code app-local until another surface needs it.
- Reuse the existing Web boot manifest format from `@deepseek-ai/dsh-client-modules`.
- Reuse `ApiProxy` and `AbstractApiClient`; do not fork the business API.
- Do not change `core/agent-loop` for desktop startup.
