---
last_updated: 2026-05-29T13:23:38Z
active_count: 1
archived_count: 3
---

# Project Status Index

Canonical entry point. Auto-updated by `atomic-skills:project-status`. Read first every session.

## Active Initiatives

| Slug | Status | Started | Branch | Next Action |
|---|---|---|---|---|
| npm-distribution | active | 2026-05-26 | — | Create package.json and bin/cli.js scaffold per spec architecture |

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
