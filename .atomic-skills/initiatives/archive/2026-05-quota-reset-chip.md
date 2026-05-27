---
initiative_id: quota-reset-chip
status: archived
started: 2026-05-26
last_updated: 2026-05-26T21:10:50Z
branch: feat/quota-reset-chip
plan_link:
wip_limit: 2
scope_paths:
  - .

stack:
  - {id: 1, title: "Quota reset countdown + time-elapsed marker", type: initiative, opened_at: 2026-05-26T21:10:50Z}

tasks: {}

parked: []

emerged: []
---

# Quota reset countdown + time-elapsed marker

## Context

Added countdown text and time-elapsed marker to the 5h and 7d fuel gauge chips. When `rate_limits.*.resets_at` is present in stdin JSON, the chip shows a magnitude-aware countdown (`now`, `4h12m`, `3d04h`, `30d+`) between the label and the bar. A vertical marker (`│`) in the bar shows time elapsed vs usage.

Surgical change — zero new dependencies, pure function of stdin data that Claude Code already emitted but `statusline.sh` was discarding.

## Completion summary

Merged via PR #3. Added magnitude-aware countdown and time-elapsed marker to 5h/7d chips. 3 new fixtures, deterministic test clock via CLAUDEBAR_NOW_FOR_TESTING.

## Links

- Spec: `docs/superpowers/specs/2026-05-26-quota-reset-chip-design.md`
- PR: #3
