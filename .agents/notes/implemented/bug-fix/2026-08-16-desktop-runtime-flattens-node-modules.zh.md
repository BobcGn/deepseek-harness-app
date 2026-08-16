# Agent Note: 桌面运行时扁平化 node_modules，适配丢弃符号链接的安装器

Status: implemented

[English](2026-08-16-desktop-runtime-flattens-node-modules.md) | 中文

## Problem

Windows 全新安装的桌面打包应用启动失败，报 `Cannot find package '@deepseek-ai/dsh-shell' imported from D:\新建文件夹\DeepSeek Harness\resources\runtime\node_modules\@deepseek-ai\dsh-shell-env\lib\index.js`，且整棵依赖树里传递依赖（`zod`、`@deepseek-ai/dsh-fs`、`@deepseek-ai/dsh-typert-protocol`、`@earendil-works/pi-ai`、`@img/colour` 等）同样 `ERR_MODULE_NOT_FOUND`。

已声明的 entry 修复让每个插件都成为顶层包，但部署后的 runtime 是 pnpm **isolated store**：顶层条目是指向 `node_modules/.pnpm` 的符号链接，包通过各自 `node_modules` 里的 store 链接解析传递依赖。macOS 安装器（dmg/zip）保留符号链接，store 图得以存活；Windows 安装器（NSIS/zip 解压）不保留符号链接/junction，安装副本失去整个 store 图：顶层包变成普通目录，无法触达依赖，loader 在第一个导入依赖的插件处失败。

## Decision

`prepare-runtime` 把部署后的 `node_modules` 扁平化为无符号链接的自包含树：

- 每个 hoist-root 条目（`node_modules/.pnpm/node_modules/*`，pnpm 在其中放置全部依赖）实化为顶层真实目录，含 scoped 包。
- 剩余嵌套链接以迭代方式（显式栈，非递归）实化：每个链接替换为目标的真实副本。保留包自身的 `node_modules`，因为当依赖图里同一名字有多个版本时，它钉住包所需的确切 store 版本。
- 实化副本排除自身的 `node_modules` 子目录：既切断 peer 循环（`@deepseek-ai/cordis` ↔ `cordis-plugin-loader`，否则嵌套复制直到路径超过文件系统限制），也让扁平顶层解析依赖。
- 删除 store（`node_modules/.pnpm`）及其元数据；移除 deploy 为 app 自身留下的绝对自链接（`node_modules/@deepseek-ai/dsh`）。

store 路径本身包含 `node_modules` 段，因此复制过滤器按相对被复制根的路径判断。最终 runtime 零符号链接、零 broken 链接；Windows 安装后的布局结构与 smoke job 启动的结构逐字节一致。

## Alternatives considered

**注入 workspace 包（`inject-workspace-packages=true`）。** 拒绝：pnpm v10+ 的 deploy 仍生成指向 store 的符号链接顶层条目；注入不会让安装树无符号链接。

**仅为 Windows 打包扁平化。** 拒绝：两种布局会让 macOS 与 Windows 产物分叉，CI smoke 也无法覆盖发布的实际结构。统一扁平布局在两个平台验证。

**递归实化。** 拒绝：深层依赖链与 peer 循环导致栈溢出和路径超长 abort；迭代遍历加 node_modules 排除是有界的。

## Consequences

安装副本在所有平台自包含：不依赖任何符号链接/junction，NSIS 与 zip 解压即得可用 runtime。runtime 从约 129 MiB 增至约 186 MiB（嵌套 store 包的真实副本），并失去 `.pnpm` store。CI boot smoke（macOS 与 Windows、全新 `$DSH_HOME`）正是会在上一版发布时拦住 Windows 失败的门禁。

验证：扁平 runtime 的全新机器启动上报 web URL 并服务 HTTP 200；树中零符号链接、prune 报告零 broken 链接；app-boot 测试保持全绿。
