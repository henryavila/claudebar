---
initiative_id: midsession-selfheal
status: active
started: 2026-06-01
last_updated: 2026-06-02T11:09:50Z
branch:
worktree:
plan_link:
wip_limit: 2
scope_paths:
  - src/settings.js
  - assets/ensure-statusline.mjs
  - src/install.js
  - src/update.js
  - test/cli/

stack:
  - {id: 1, title: "Register self-heal on UserPromptSubmit so a mid-session statusLine clobber recovers without restart", type: initiative, opened_at: 2026-06-01T09:24:05Z}

tasks: {}

parked: []

emerged:
  - {title: "ensure-statusline.mjs upgraded to full parity (now also restores auto-update hook) via shared healAll(); driven by native-daemon-selfheal", surfaced_at: 2026-06-02T11:09:50Z, promoted: false}

next_action: "Implemented + live-validated. Commit; consider release (version bump) so npm users get mid-session recovery."
---

# Mid-session self-heal — recover statusLine without a restart

## Context

claudebar's SessionStart heal hook (`assets/ensure-statusline.mjs`, registered by
`src/settings.js:ensureHealHook`) restores a dropped `statusLine` entry — but only
at session start. The disappearance, however, happens **mid-session**: Claude Code
re-persists `settings.json` from its in-memory copy when a TUI setting is toggled
(fingerprint: a `"tui":"fullscreen"` key appearing exactly when `statusLine` and a
set of externally-added hooks vanished, confirmed across the user's settings.json
backups), clobbering on-disk edits made after the session loaded. A SessionStart
heal cannot fire again until the next restart, so the bar stays gone for the rest
of the session.

## Empirical validation (done before implementation — "validate, don't deduce")

Confirmed live, with the user observing their own statusbar (the docs do NOT
specify whether the `statusLine` block is hot-reloaded — so it had to be tested):

1. Removing `statusLine` from settings.json mid-session **blanked the bar** →
   Claude Code re-reads the `statusLine` config from disk live (hot-reload).
2. Re-writing `statusLine` to the file **redrew the bar without a restart**.

→ A `UserPromptSubmit` heal is viable: that event fires once per turn (confirmed
via Claude Code hooks docs), so rewriting the dropped `statusLine` on each user
turn brings the bar back within one prompt of any mid-session clobber.

## Decisions

- Register the heal hook on BOTH `SessionStart` (fast recovery at start) and
  `UserPromptSubmit` (mid-session recovery). The hook script is idempotent and
  silent, and already writes only when something is missing (no churn).
- Keep the existing self-registration fix (heal re-asserts its own hook), so a
  clobber that drops the hook entry is re-seeded the next time it runs.

## Open question / risk

- Per-turn UserPromptSubmit cost: the heal script is a short node process that
  no-ops (no write) when nothing is missing. Acceptable, but verify it stays
  silent on stdout (UserPromptSubmit stdout is injected into the prompt context).

## Outcome (live-validated 2026-06-01)

Implemented: `ensureHealHook`/`removeHealHook` now iterate `HEAL_HOOK_EVENTS =
['SessionStart','UserPromptSubmit']` (per-event idempotent, back-fills older
SessionStart-only installs). `ensure-statusline.mjs` (which already calls
`ensureHealHook`) self-extends to both events. install/update log text updated.
Tests: +5 in `test/cli/settings.test.js` + 1 in `test/cli/heal.test.js`; full
suite 78 CLI + 38 bash green.

End-to-end live proof on the user's machine: removed `statusLine` mid-session
(simulated TUI clobber) → bar blanked → user submitted a prompt → the
UserPromptSubmit hook rewrote `statusLine` (settings.json mtime stamped at submit
time) → bar reappeared the same turn, no restart, no manual intervention.

## Links

- Sibling fix (self-registration): ad-hoc session 2026-06-01 in PROJECT-STATUS.md
- Claude Code hooks docs: UserPromptSubmit fires once per turn
