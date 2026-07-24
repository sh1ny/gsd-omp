---
type: Removed
pr: 8
---
**This GSD fork is now OMP-only.** Support for 19 harness runtimes (claude, codex, opencode, pi, cursor, windsurf, kilo, kimi, kimi-code, antigravity, augment, cline, codebuddy, copilot, hermes, qwen, trae, vscode, zcode) plus the claude-orchestration feature capability has been removed. The `gsd-mcp-server` companion, the `hooks/` tree, generated `skills/` artifact, and per-harness packaging directories (`.claude-plugin/`, `.opencode/`, `.kilo/`, `pi/`, `vscode/`) have been deleted. Any explicit non-omp runtime value (`GSD_RUNTIME` env, `.planning/config.json` `runtime` field, or a removed `--<runtime>` CLI flag) now produces a hard error: `this GSD fork supports OMP only`. Absent runtime values default to `omp`. Migration: reinstall with `gsd-core --omp`.
