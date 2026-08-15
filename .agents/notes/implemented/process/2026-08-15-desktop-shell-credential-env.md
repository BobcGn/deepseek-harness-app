# Agent Note: Desktop shell credential environment

Status: implemented

English | [中文](2026-08-15-desktop-shell-credential-env.zh.md)

## Problem

The Web client reads `DEEPSEEK_API_KEY` from the inherited process environment, and a user exports it in a shell startup file (`~/.zprofile` or `~/.bash_profile`) for `dsh web`. The packaged desktop app launched from Finder cannot see that key: macOS GUI launches do not read shell startup files, so the Electron main process never has the variable, and the runtime child it spawns inherits nothing. The env pass-through from `main.ts` to the runtime was intact; the source was missing.

## Decision

The Electron main process parses `export NAME=value` lines from the usual shell configs (`.zshenv`, `.zprofile`, `.zshrc`, `.bash_profile`, `.bashrc`, `.profile`) and merges the missing `DEEPSEEK_*` and `DSH_*` variables into the runtime environment it passes to the spawned Harness runtime. Values already present in `process.env` (terminal launches, `launchctl setenv`) keep precedence. The parser reads only `export` lines with a quoted or bare value; it never executes shell code, so user shell startup side effects cannot run and shell syntax errors cannot break the launch.

Windows is unaffected: GUI apps there inherit the system/user environment, and the parser finds no shell configs, so the merge is a no-op.

## Alternatives considered

**Require `launchctl setenv`.** This gives GUI apps the variable, but it is a manual, per-session setup step that the Web path does not need, so it would widen the desktop/Web gap this note closes.

**Execute the user shell to snapshot its environment.** A login shell would load the full profile, but running user shell startup code from the app is slow, can have side effects, and makes launch failures depend on shell state.

**Rely on `~/.dsh/.env`.** The credentials provider already reads that file as a fallback layer, but it ranks below the managed store and requires the user to know an extra configuration path that the Web launch does not.

## Consequences

- A Finder-launched desktop app picks up the same credentials a terminal `dsh web` sees, closing the shell-env gap.
- The lifted variables are read-only to the credentials provider (`source: env`), matching the inherited-environment semantics.
- Only `DEEPSEEK_*` and `DSH_*` names are lifted; unrelated shell exports stay out of the runtime.
- README pair documents the behavior and the precedence rule.
