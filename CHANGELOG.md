# Changelog

## v1.1.0 — 2026-05-29

### Self-healing statusLine config

`install` and `update` now register a `SessionStart` hook (`ensure-statusline.mjs`) that restores the `statusLine` entry in `~/.claude/settings.json` if it ever goes missing — e.g. after a Claude Code update or a settings rewrite that drops it. The hook is silent, best-effort (never blocks a session, never writes to stdout), and only restores when `statusLine` is absent, so a user-customized statusLine is never clobbered. Existing `SessionStart` hooks (e.g. atomic-skills version-check) are preserved.

`update` runs this self-heal on every invocation — including when already on the latest version — because the common trigger (config dropped externally) is independent of the claudebar version. `uninstall` removes the hook; `doctor` reports whether it is registered.

## v1.0.0 — 2026-05-27

### npm distribution

claudebar is now distributed as `@henryavila/claudebar` on npm. Install, update, configure, and diagnose via `npx`:

```bash
npx @henryavila/claudebar install
npx @henryavila/claudebar config
npx @henryavila/claudebar doctor
npx @henryavila/claudebar update
npx @henryavila/claudebar uninstall
npx @henryavila/claudebar install-font
```

No git clone required. Zero npm dependencies — CLI uses Node.js 18+ stdlib only.

### TOML configuration system

Every color, threshold, glyph, and chip toggle is now configurable via `~/.config/claudebar/config.toml`. The config file is self-documenting (all options listed with defaults, commented out). Changes auto-recompile on the next statusline render (<1ms overhead).

### Chip toggles

Individual statusline segments can be toggled on/off via `[chips]` in config.toml: model, effort, tmux, repo, branch, worktree, dirty, PR, agent, ctx bar, 5h bar, 7d bar, countdown text, and time-elapsed marker.

### Configurable thresholds

Zone boundaries (green→yellow→red) are now configurable via `[thresholds]` in config.toml. Defaults remain 60/90.

### CI/CD

GitHub Actions workflows for testing (ubuntu + macOS matrix) and npm publishing via OIDC Trusted Publishing.

## Previous (unreleased)

### Features

- **Quota reset countdown** on the `5h` and `7d` chips. When stdin carries `rate_limits.*.resets_at` (Unix timestamp), the chip prepends a magnitude-aware countdown between label and bar — `5h · 2h18m  ▰...`, `7d · 5d09h  ▰...`. Format: `now` (<60s), `XhYYm` (<24h), `XdYYh` (<30d), `30d+` cap. Color is the dim grey of the label so the bar+% remain the saturation signal. When `resets_at` is absent, the chip renders exactly as before — backward-compatible.
- **Time-elapsed marker (`│`)** in the same 5h/7d bars. The bar grows from 10 to 11 chars; the marker shows how far into the window we are. When the marker is *inside* the fill, you're burning faster than time allows (`▰▰▰▰▰▰│▰▱▱▱`); *past* the fill, you have margin (`▰▰▰▰▰▰▰▱│▱▱`); *at* the fill edge, you're on pace. Marker color matches the label (dim 245) so it reads as metadata, not a third zone signal.

### Testing

- Two new helpers (`format_countdown`, `now_epoch`) with dedicated unit tests (`test/unit/test-format-countdown.sh`, `test/unit/test-now-epoch.sh`).
- `pip_bar` extended with optional `MARKER_POS` arg (0-10 slots, defensive clamp). Back-compat preserved: callers without a marker keep the legacy 10-char render. Unit tests in `test/unit/test-pip-bar.sh` cover 10 marker cases including edge slots and defensive bounds.
- Three new fixtures (`15-countdown-fresh`, `16-countdown-critical`, `17-resets-at-missing`) plus deterministic recalibration of fixtures 01-12 against `CLAUDEBAR_NOW_FOR_TESTING=1830000000`.
- `CLAUDEBAR_BRANCH_FOR_TESTING` env var added to make fixture expected outputs hermetic — they no longer leak the runner's git branch.
- Suite grew from 20 to 25 tests (10 unit + 15 fixtures). All under the 50ms warm budget.

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
