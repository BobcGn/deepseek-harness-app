# Agent Note: 打包应用声明全部 shipped bundle entry

Status: implemented

[English](2026-08-16-packaged-app-declares-shipped-bundle-entries.md) | 中文

## Problem

Windows 全新安装的桌面打包应用启动失败，报 `Cannot find package '@deepseek-ai/dsh-llm' imported from C:\Users\Admin\.dsh\profiles\web\` —— 与 store 下探 heal 本想覆盖的全新机器失败模式相同，但发生在 pnpm store 布局从未被验证过的平台上。底层原因是**声明缺口**而非解析问题：

- `pnpm deploy --filter @deepseek-ai/dsh --prod` 只把 app 的**直接**依赖放进部署后的顶层 `node_modules`；workspace 包以 link 形式存在，不展开。
- shipped bundles（base/web-app/headless）挂载了 127 个插件 entry 包，但 `apps/cli/package.json` 只声明了其中 64 个：6 个在 `devDependencies`，41 个完全未声明（只能通过 `dsh-base` 的 peer 声明间接可达）。
- macOS 上基于 realpath 的 heal BFS 恰好借 pnpm hoist root 补上了缺口；Windows 全新机器上这条链（manifest 闭包 + peer 传播 + store 软链 realpath）失败，且没有任何 CI 步骤曾启动过打包后的 Windows runtime 来发现它。

## Decision

四层修复让打包应用在所有平台的全新机器上都能启动：

1. **声明运行时面。** `apps/cli/package.json` 把 10 个运行时需要的包从 `devDependencies` 移入，并补上缺失的 83 个 bundle-entry 包，使部署后的顶层 `node_modules` 覆盖每个 shipped entry（shipped runtime 为 154 个包）。
2. **heal 全量兜底。** `healProfilesModuleFallback` 在 manifest 闭包 BFS 之外，把整个 pnpm hoist root（`node_modules/.pnpm/node_modules/@deepseek-ai/*`，打包步骤从每个 workspace 包物化而来）全部建链接。将来即使有 bundle entry 漏声明，全新机器上仍能解析；扁平 npm 安装没有 hoist root，自然跳过此步。
3. **CI 启动冒烟。** `desktop-release.yml` 新增 `smoke` job，在 macOS 与 Windows runner 上准备 runtime 并以全新 `$DSH_HOME` 启动 `lib/bin.js web --port 0`，断言回环 URL；release job 现在依赖它。
4. **声明门禁。** `scripts/verify-app-dependency-coverage.ts` 在任一 shipped bundle entry 的包不是 app 直接依赖时报错；它运行于共享静态门禁与 `check-all`。

## Alternatives considered

**只依赖 manifest 闭包 + realpath heal。** 拒绝：已被证明在 Windows 上脆弱，且依赖 peer 声明传播；声明缺口本身就是缺陷，不是解析链。

**在 `prepare-runtime` 里展开 workspace 依赖而非声明它们。** 拒绝：这绕过了 pnpm 的 deploy 语义，把依赖关系从 manifest 中隐藏，且对未来 entry 仍无兜底保证。

**认为打包成功即可省略 CI 冒烟。** 拒绝：打包成功从未验证过启动；冒烟是首个在某平台验证打包 runtime 能上报 URL 的检查。

## Consequences

部署后的 runtime 顶层 `node_modules` 覆盖全部 shipped bundle entry（当前 bundles 为 154 个包、0 缺失），heal 额外链接整个 hoist root，因此全新安装无需任何既有 `~/.dsh` 状态即可在 macOS 与 Windows 启动。fallback 链接数增至 hoist root 规模（约 230），首次启动 heal 仍很快。声明门禁钉死该契约，未来 bundle entry 无法再以第二类解析路径静默发布。

验证：app-boot 单元测试（107 个，含 hoist-root 全量回归）、prepared runtime 的全新机器启动上报 web URL 并服务 HTTP 200、门禁正反例、以及两个平台的 CI 冒烟 job。
