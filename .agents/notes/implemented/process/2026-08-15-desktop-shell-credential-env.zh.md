# Agent Note: 桌面端 Shell 凭证环境

Status: implemented

[English](2026-08-15-desktop-shell-credential-env.md) | 中文

## 问题

Web 客户端从继承的进程环境读取 `DEEPSEEK_API_KEY`，用户会在 shell 启动文件（`~/.zprofile` 或 `~/.bash_profile`）中为 `dsh web` 导出它。从 Finder 启动的打包桌面应用看不到这个 key：macOS 的 GUI 启动不会读取 shell 启动文件，因此 Electron 主进程从未拥有该变量，它派生的 runtime 子进程也就继承不到任何值。`main.ts` 到 runtime 的环境传递本身是完整的；缺失的是来源。

## 决策

Electron 主进程解析常用 shell 配置（`.zshenv`、`.zprofile`、`.zshrc`、`.bash_profile`、`.bashrc`、`.profile`）中的 `export NAME=value` 行，并将缺失的 `DEEPSEEK_*` 与 `DSH_*` 变量合并进传递给 Harness runtime 的环境。`process.env` 中已有的值（终端启动、`launchctl setenv`）保持优先。解析器只读取带引号或无引号值的 `export` 行；它从不执行 shell 代码，因此用户 shell 启动副作用不会运行，shell 语法错误也不会破坏启动。

Windows 不受影响：那里的 GUI 应用会继承系统/用户环境，解析器也找不到 shell 配置文件，因此合并为空操作。

## 备选方案

**要求 `launchctl setenv`。** 这能让 GUI 应用获得变量，但这是一个需要用户手动操作的、按会话设置的步骤，而 Web 路径不需要它，因此会扩大本 note 要弥合的桌面/Web 差距。

**执行用户 shell 生成环境快照。** 登录 shell 会加载完整 profile，但从应用运行用户 shell 启动代码很慢、可能有副作用，还会让启动失败取决于 shell 状态。

**依赖 `~/.dsh/.env`。** 凭证 provider 已经将该文件作为回退层读取，但它排在 managed store 之下，并且要求用户知道 Web 启动不需要的额外配置路径。

## 后果

- 从 Finder 启动的桌面应用能获得与终端 `dsh web` 相同的凭证，弥合了 shell 环境差距。
- 被提升的变量对凭证 provider 是只读的（`source: env`），与继承环境的语义一致。
- 只提升 `DEEPSEEK_*` 与 `DSH_*` 名称；无关的 shell export 不会进入 runtime。
- README 双语对记录了该行为与优先级规则。
