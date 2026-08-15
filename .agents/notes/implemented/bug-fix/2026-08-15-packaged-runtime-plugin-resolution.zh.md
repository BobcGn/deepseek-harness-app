# Agent Note: 打包后的桌面运行时通过 store 解析全部插件

Status: implemented

[English](2026-08-15-packaged-runtime-plugin-resolution.md) | 中文

## Problem

打包后的 macOS App 从 `Contents/Resources/runtime` 启动 `dsh` 运行时失败，报 `dsh web exited before reporting a URL`；每个失败的 loader entry 最终都归结为 `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/cosmokit' imported from <AppRoot>/vendor/schemastery/lib/index.mjs`。这是桌面打包流水线里三个相互独立的问题叠加的结果。每个问题只在打包布局中出现、在源码流程中不出现，因为工作区根 `node_modules` 和 `vendor/schemastery/node_modules` 在开发时掩盖了它们。

1. **逃逸的 store 软链。** pnpm 的 `deploy --legacy` 生成 store-entry 软链 `@deepseek-ai/schemastery -> ../../../../../../../../vendor/schemastery`（cordis 家族还有 `@deepseek-ai/cosmokit`）。原样拷入 `Contents/Resources/runtime` 后，八级 `..` 落在 `<AppRoot>/vendor/<name>`，`afterPack` 钩子把 vendored 包拷到那里且排除了 `node_modules`。schemastery 的入口以裸说明符导入 `@deepseek-ai/cosmokit`，而 App 根没有 `node_modules` 祖先链，该导入直接抛错。
2. **heal 无法下探到 store。** `healProfilesModuleFallback` 通过 BFS 遍历 app 清单的依赖闭包构建扁平的 `$DSH_HOME/profiles/node_modules` 回退目录，每个名字用 `createRequire(anchor).resolve.paths` 解析。部署后的运行时里，顶层 `node_modules/@deepseek-ai/<pkg>` 是指向 store 的软链，而 `resolve.paths` 按锚点的词法父链行走，永远进不了 `node_modules/.pnpm`（hoist root）。于是 BFS 只链接了 64 个直接依赖，够不到 store 里的传递依赖（`dsh-llm`、`dsh-session`、`dsh-typert-*`、`dsh-api-*` 等），在没有历史回退链接的机器上约 30 个 web-profile 条目无法解析。回退链接本身的维护见[过期回退链接修复](2026-08-12-unlink-stale-profile-fallback-links.md)。
3. **剪枝器删掉了运行时载荷。** `prepare-runtime` 的树剪枝器（其体积作用记录在[桌面打包体积预算](../process/2026-08-15-desktop-windows-packaging-budget.md)中）把 runtime 里所有名为 `doc`/`docs`/`test`/`tests`/`example`/`examples`/`benchmark`/`__tests__` 的目录一律删除，包括第三方包的运行时载荷：`yaml/dist/doc`（其 `composer.js` 需要 `../doc/directives.js`）被删掉，第一个导入 `yaml` 的插件在模块加载时崩溃。

## Decision

- `afterPack` 创建开发时由工作区根提供的 node_modules 桥：App 根下 `node_modules/@deepseek-ai/{cosmokit,schemastery}` 软链指向 `../../vendor/<name>`。逃逸软链只引用这两个名字，所以两条软链即可闭合缺口。
- `packageDirFromAnchor` 在探测前先对锚点做 realpath，与 Node 自身跟随软链的加载解析一致。heal 的 BFS 因此能下探进 store，链接传递的盒内包（发布运行时为 195 条链接，此前为 64 条）。
- 剪枝器的目录名清单拆成两档：`.cache`、`.changeset`、`.github`、`.turbo`、`.vite`、`.vitest`、`coverage` 随处可剪；`__tests__`、`benchmark`、`benchmarks`、`doc`、`docs`、`example`、`examples`、`test`、`tests` 只在包根（父目录持有 `package.json`）剪——仓库自己的开发目录都在包根。`yaml/dist/doc` 这类发布载荷目录得以保留。

## Alternatives considered

**在 `prepare-runtime` 里把逃逸软链改指 hoist-root 副本并去掉 App 根 vendor 拷贝。** 拒绝：这是对既有 pnpm-legacy-软链布局的更大改动；桥接保留该布局，只增加两条软链。

**在 `afterPack` 里把整个 hoist root 镜像到 App 根。** 拒绝：为修一个裸导入增加约 230 条软链；逃逸软链只引用 `cosmokit` 和 `schemastery`，且 heal 修复已让 hoist root 通过 store 行走可达。

**按目录内容是否含可加载模块来决定是否剪枝。** 拒绝：遍历候选目录成本更高且仍是猜测；"在包根"是仓库开发目录与包运行时载荷之间的精确判别。

## Consequences

打包后的 App 能在干净机器上启动：web profile 上报回环 URL 并服务 GUI。当安装根自身是软链（macOS 临时目录）时，`resolveBundleDir` 的返回值和回退链接目标现在带 realpath 拼写；位置相同。heal 修复是 `dsh-app-boot` 的产品代码，另外两个修复是打包脚本。

验证：store 下探 heal 有单元回归；端到端启动分别覆盖了带既有回退的已安装 App 布局，以及全新 `$DSH_HOME` 下的重新生成运行时。
