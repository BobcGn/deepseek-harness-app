# Agent Note: Desktop Windows packaging budget

Status: implemented

[English](2026-08-15-desktop-windows-packaging-budget.md) | 中文

## Problem

桌面预览流水线可以很快生成 macOS 产物，但 Windows job 可能把完整超时时间都耗在 electron-builder 的 zip target 内。失败的 run 已经完成依赖安装、runtime 准备和 Electron 解包，并进入 `dist\DeepSeek-Harness-0.1.0-win-x64.zip`，之后直到 45 分钟超时都没有可见进展。桌面 runtime 是部署后的 Node 应用，包含大量小文件、workspace 包副本和平台可选包，因此 Windows 压缩成本可能主导整条 release lane。

## Decision

桌面 runtime 准备步骤在 `pnpm deploy` 和 workspace 包物化后裁剪发行版不需要的文件。裁剪会移除 pnpm virtual store 中不支持当前平台的包目录、文档和测试目录、source map、TypeScript declaration 文件、markdown 文件、tsbuildinfo 文件以及断开的符号链接。它会在 CI 日志中报告裁剪前后的字节数和文件数，让打包回归具备可见的体积证据。

Electron Builder 默认使用 normal compression。仅在 Windows 上，包装脚本传入 `-c.compression=store`，让必需的 zip 产物只打包而不执行高成本 archive compression。NSIS 安装程序和 zip 仍然都是 Windows 输出集合的一部分。预览产物上传路径只包含可分发文件，不包含 unpacked 中间应用目录。

## Alternatives considered

**提高 Windows job 超时时间。** 这可能让慢速 run 通过，但会让 release lane 继续不可预测，并掩盖打包体积问题。

**放弃 Windows zip 产物。** 这可以避开已观察到的慢 target，但桌面 release 策略要求在安装程序之外提供压缩便携产物。

**保留 maximum compression 以获得更小产物。** 更小下载体积有价值，但这个预览分发更重视 CI 稳定完成，而不是 archive 密度。

**手工挑选每一个 runtime dependency。** 最小依赖清单可能更小，但会重复 pnpm resolver 行为，并可能遗漏 harness 动态加载的插件。

## Consequences

- Windows 打包优先保证确定完成，而不是追求最小 archive。
- CI 日志会在 Electron Builder 运行前包含 runtime 体积证据。
- 桌面 runtime 仍以 pnpm deploy 为事实来源，并且只裁剪运行时不会执行的文件。
- 其他操作系统的平台可选包不会进入 packaged app，因此未来跨平台 native dependency 必须使用准确的平台 token 命名，或者更新 pruner。
