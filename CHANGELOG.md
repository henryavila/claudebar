# Changelog

## Unreleased

(nothing yet)

## v1.0.0 — 2026-05-26

Initial release.

### Features

- 2-row pip-style statusline for Claude Code (replaces ccline)
- Zone-driven colors: green `<60%`, yellow `60-89%`, red `≥90%` on all 3 bars
- Identity row: model + effort chip + tmux context + owner/repo + worktree marker + branch + dirty/clean indicator + PR chip with review state
- Fuel-gauge row: ctx + 5h rate limit + 7d rate limit (each bar hidden when the corresponding JSON field is absent)
- Agent-active mode: model dims to grey, effort chip replaced by pulsing agent name chip (blink ANSI)
- Tmux integration: `· session:window.pane` chip auto-appears when running inside tmux
- Cross-platform: macOS, Ubuntu, Debian, Arch, Fedora, WSL2 — same script, no edits required

### Tooling

- `install.sh` — validates prerequisites (bash 4+, jq, git, 256-color terminal, Nerd Font) with per-platform install hints. Backs up `~/.claude/settings.json` with timestamp and patches the `statusLine` block via jq.
- `uninstall.sh` — lists install-time backups, restores chosen one (or auto-picks the most recent), snapshots current state first in case you change your mind.
- 20 automated tests: 8 unit tests (palette, zone color, pip bar, chips, identity row, fuel row, git cache, tmux, dependency fallback) + 12 integration fixtures covering the 7 demo states + 5 absence patterns.
- Performance: <50ms warm-cache execution. Single `jq` invocation, 5-second session-scoped cache for `git status`.
- Portability test: enforces no GNU-only flags, no realpath/readlink -f, no bash 5+ syntax.
