---
last_updated: 2026-06-17T13:40:00Z
active_count: 0
archived_count: 3
---

# Project Status Index

Canonical entry point. Auto-updated by `atomic-skills:project-status`. Read first every session.

## Active Initiatives

| Slug | Status | Started | Branch | Next Action |
|---|---|---|---|---|
| overlay-time-marker | shipped | 2026-06-17 | feat/overlay-time-marker | SHIPPED v1.5.0 (npm latest via OIDC): marcador do tempo virou OVERLAY (│ ocupa célula, cinza→cor-da-zona ao ser consumido). PR #21 merged (56ea85c), CI verde ubuntu+macos. DESIGN.md atualizado. Trade-off pipe-esconde-fill mantido (validado) |
| atomic-skills-focus-chip | shipped | 2026-06-15 | feat/atomic-skills-focus-chip | SHIPPED v1.4.0 (npm latest): chip desktop-only do focus.json na linha 2 (◉ plano · F i/n · done/total), staleness por lastUpdated, marcador multiplan. PR #20 merged; CI verde macOS+Ubuntu; review 2 camadas (1 CRITICAL phase:null corrigido) |
| npm-distribution | shipped | 2026-05-26 | — | SHIPPED: package.json + bin/cli.js + src/ CLI publicados no npm (v1.4.0). Validado 2026-06-17 |
| midsession-selfheal | shipped | 2026-06-01 | — | SHIPPED: heal em SessionStart+UserPromptSubmit (settings.js:30, install/update). Validado 2026-06-17 |
| auto-update | shipped | 2026-06-01 | — | DONE: PR #13 merged (43ce411), release v1.2.1 publicado no npm via OIDC (latest=1.2.1). Reinstall agora oferece escolha de auto-update |
| locale-float-bug | shipped | 2026-06-02 | — | SHIPPED in v1.3.1: `export LC_NUMERIC=C` fixes 7d/5h=0% under comma locale; +test/unit/test-locale-float.sh; released to npm via OIDC |
| native-daemon-selfheal | shipped | 2026-06-02 | — | SHIPPED v1.3.2 (npm latest): fixed daemon vs fullscreen-TUI write-fight (healAll daemon-mode gate + CLAUDEBAR_DAEMON=1) + .path start-limit fragility (StartLimitIntervalSec=0). PR #16 merged; CI green on macOS + Ubuntu. |

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
| 2026-06-07T12:24:46Z | Feat: port the time-elapsed marker (│) from desktop `fuel_row` to the mobile/compact 5h & 7d chips. `pip_bar_compact` now takes an optional marker arg (scaled 0–5); `compact_row3` accepts `five_hour_resets_at`/`seven_day_resets_at`, computes elapsed-window slot, and passes it through; call site wired up. Compact shows the pipe only (no countdown text — no room). +marker tests in `test-pip-bar-compact.sh` & `test-compact-rows.sh`; 198 CLI + 40 fixtures + all unit green. SHIPPED v1.3.3 (PR #17, npm latest=1.3.3); auto-update verified live (1.3.2→1.3.3) |
| 2026-06-07T12:45:00Z | Fix (regression from v1.3.3): the compact marker (│) widened each rate chip by 1 cell, pushing the trailing 7d % off-screen on narrow mobile widths (`37%`→`3…`). Fix: `compact_row3` inter-chip gap 2→1 space (full layout keeps 2), reclaiming exactly the 2 marker cells → back to pre-v1.3.3 width. Kept inserted-pipe marker (desktop parity) over overlay (which would hide a pip's fill). Regenerated compact fixtures 20–24; +new `26-compact-markers` fixture (markers active, two-digit 7d %). SHIPPED v1.3.4 (PR #18, npm latest=1.3.4); validated on live install before publish |
| 2026-06-10T00:00:00Z | Fix(TDD): Claude Code fullscreen TUI dropped to inline once per submitted prompt (follow-up to `native-daemon-selfheal`, the hook half of PR #16's daemon fix). Root cause — `healAll` (`src/settings.js:183`) gated `isFullscreenTui` behind `daemon &&`, so the `UserPromptSubmit` hook path (daemon:false) restored `statusLine` while `tui:"fullscreen"`; CC hot-reloaded it and exited fullscreen every turn. Fix: fullscreen now gates BOTH paths; `healHookPresent` defer stays daemon-only. +5 tests (4 in `heal.test.js`, 1 in `settings.test.js`); rewrote 1 stale-contract test that asserted the buggy behavior. Suite 203 CLI + 41 bash green. Diagnosis: `docs/2026-06-09-hook-fullscreen-conflict-diagnosis.md`. SHIPPED v1.3.5 (PR #19) |
