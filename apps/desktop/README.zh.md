# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 的 Electron 桌面应用外壳。

此应用是正在开发中的桌面端 surface。它会保留现有 Web 客户端，同时用可安装的 macOS 和 Windows 应用替代开发者预览版的启动流程。

## 开发

请先安装 workspace 依赖：

```sh
pnpm install
```

构建桌面端 main 和 preload 入口：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
```

运行当前 Electron 外壳：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dev
```

为当前平台构建本地预览产物：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run dist
```

## 当前范围

当前外壳会打开一个 Electron 窗口，启用 context isolation，禁用 renderer Node integration，并提供一个最小 preload bridge。开发模式会从源码 checkout 在操作系统分配的 loopback 端口上启动现有 Web profile。打包预览构建会从 Electron resources 中部署好的 Harness runtime 启动，然后加载隐藏 loopback Web UI。下一项 transport 里程碑是通过带 IPC API 客户端的 `file://` 加载现有 Web 前端。

## 预览打包

桌面预览 workflow 只支持手动触发，并上传 GitHub Actions artifacts，不发布 release。macOS 产物目标是未签名的 `dmg` 和 `zip`。Windows 产物目标是 NSIS `exe` 和 `zip`。

打包会先运行仓库构建，再用 `pnpm deploy --legacy --prod` 准备应用本地 runtime，并将该 runtime 复制进 Electron resources。预览 runtime 还会将 workspace 包物化到 pnpm hoist 目录，使打包产物不依赖源码 checkout。

未签名 macOS 预览构建在安装后可能需要手动移除 Gatekeeper quarantine：

```sh
xattr -r -d com.apple.quarantine /Applications/"DeepSeek Harness".app
```

## Release 打包

推送 `v*` 标签会运行桌面 release workflow。该 workflow 会在 GitHub 的 macOS 和 Windows 原生 runner 上分别打包，然后用生成的安装器和压缩包创建或更新对应的 GitHub Release。桌面封装版本会控制产物文件名；内置 Harness runtime 会在 runtime 自身发布前继续保持上游预览版本。

## 实现说明

- 在第二个 surface 需要之前，将桌面端专属 transport 代码保留在应用本地。
- 复用 `@deepseek-ai/dsh-client-modules` 中现有的 Web boot manifest 格式。
- 复用 `ApiProxy` 和 `AbstractApiClient`；不要 fork 业务 API。
- 不要为了桌面端启动修改 `core/agent-loop`。
