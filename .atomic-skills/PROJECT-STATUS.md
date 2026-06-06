---
last_updated: 2026-06-02T11:09:50Z
active_count: 5
archived_count: 3
---

# Project Status Index

Canonical entry point. Auto-updated by `atomic-skills:project-status`. Read first every session.

## Active Initiatives

| Slug | Status | Started | Branch | Next Action |
|---|---|---|---|---|
| npm-distribution | active | 2026-05-26 | — | Create package.json and bin/cli.js scaffold per spec architecture |
| midsession-selfheal | active | 2026-06-01 | — | TDD: register heal on UserPromptSubmit for mid-session statusLine recovery |
| auto-update | shipped | 2026-06-01 | — | DONE: PR #13 merged (43ce411), release v1.2.1 publicado no npm via OIDC (latest=1.2.1). Reinstall agora oferece escolha de auto-update |
| locale-float-bug | shipped | 2026-06-02 | — | SHIPPED in v1.3.1: `export LC_NUMERIC=C` fixes 7d/5h=0% under comma locale; +test/unit/test-locale-float.sh; released to npm via OIDC |
| native-daemon-selfheal | active | 2026-06-02 | — | 2 regressions FIXED: (a) daemon vs fullscreen-TUI write-fight → healAll daemon-mode gate (skip while tui===fullscreen / hook alive) + CLAUDEBAR_DAEMON=1; (b) .path latched 'failed' on write bursts → StartLimitIntervalSec=0. Validated live + 198/40 tests green. UNCOMMITTED. Next: commit + PR + v1.3.2. |

## Recently Archived (last 10)

| Slug | Archived | Branch | Summary |
|---|---|---|---|
| responsive-mobile-layout | 2026-05-26 | feat/responsive-mobile-layout | Compact 3-row mode for mobile (PR #4) |
| quota-reset-chip | 2026-05-26 | feat/quota-reset-chip | Countdown + time-elapsed marker (PR #3) |
| v1-core | 2026-05-26 | main | v1.0.0 statusline from scratch |

## Ad-Hoc Sessions Log (last 5)

| When | Description |
|---|---|
| 2026-05-29T13:12:14Z | Fix: statusline shows directory basename (folder glyph) when not in a git repo — added CWD extraction + path fallback in `identity_row`/`compact_row2`, updated no-repo fixtures (11, 24) |
| 2026-05-29T13:23:38Z | Improve worktree indicator: ⎇ marker now replaces the git glyph and recolors the whole branch violet (kills U+2387 overlap), added to compact layout too via shared `branch_chip` helper; regenerated worktree fixtures (02-06, 21) + DESIGN.md |
| 2026-06-01T09:24:05Z | Fix(TDD): statusbar disappears after a while. Root cause — `assets/ensure-statusline.mjs` restored `statusLine` but never re-registered its own SessionStart hook (called `ensureStatusLine`, not `ensureHealHook`), so once an external settings rewrite dropped the heal hook entry auto-healing died permanently. Fix: heal now also calls `ensureHealHook` and writes when either changed. +5 tests in `test/cli/heal.test.js`; full suite 73 CLI + 38 bash green; ran `update` on live machine (restored statusLine + hook, bar renders) |
