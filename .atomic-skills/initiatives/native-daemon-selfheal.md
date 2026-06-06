---
initiative_id: native-daemon-selfheal
status: active
started: 2026-06-02
last_updated: 2026-06-06T21:24:53Z
branch: feat/native-daemon-selfheal
worktree:
plan_link: /Users/henry/.claude/plans/optimized-bubbling-crayon.md
wip_limit: 2
scope_paths:
  - src/daemon.js
  - src/settings.js
  - src/install.js
  - src/uninstall.js
  - src/update.js
  - src/doctor.js
  - bin/cli.js
  - assets/ensure-statusline.mjs
  - assets/default-config.toml
  - test/cli/

stack:
  - {id: 1, title: "Native OS daemon (launchd/systemd/cron) as hook-independent self-heal backstop", type: initiative, opened_at: 2026-06-02T11:09:50Z}

tasks: {}

parked: []

emerged: []

next_action: "Frames 2+3 RESOLVED. (2) fullscreen write-fight gate; (3) StartLimitIntervalSec=0 so the .path watch survives write bursts. Validated live: daemon fired 8x during a real tui:fullscreen+statusLine state and left it untouched; .path survived an 8-write burst. Suite 198 CLI/40 bash green. UNCOMMITTED — next: commit + PR + v1.3.2 release to npm via OIDC."
---

# Native daemon self-heal — keep the bar alive when Claude Code strips the hooks

## Context

The statusline keeps vanishing. Root cause (diagnosed in `midsession-selfheal`):
Claude Code re-persists `~/.claude/settings.json` from its in-memory snapshot on a
TUI toggle (fingerprint: a `"tui":"fullscreen"` key appears exactly when
`statusLine` + externally-added hooks disappear), dropping **both** the `statusLine`
block **and the heal hook entries themselves**.

Today's heal is 100% hook-driven (`assets/ensure-statusline.mjs`). Chicken-and-egg:
the heal can only re-register itself if it runs, but it only runs if it's still
registered. Once the clobber removes the hook entry, **nothing ever runs the heal
again** → bar dead permanently.

Fix: a platform-native OS daemon that re-injects everything from *outside* Claude
Code's control. Hook heal stays as the zero-cost fast path; the daemon is the
OS-level backstop. `uninstall` deregisters the daemon.

## Decisions

- **New initiative** (distinct mechanism from hook heal). Confirmed with user.
- **Default on, opt-out** (`--no-daemon` flag / `[daemon] enabled = false`).
- **Full parity** restore: statusLine + heal hooks + auto-update hook.
- **OS-native one-shot triggers, no always-running Node process**:
  - macOS → `launchd` LaunchAgent, `WatchPaths` settings.json (+ `StartInterval` net)
  - Linux/WSL w/ systemd → `systemd --user` `.path` + `.service` (+ `.timer` net)
  - old WSL / no systemd → `cron` if available, else managed `~/.profile` block (poll)
- **Single payload**: add `healAll(settings)` to `src/settings.js`; rewire
  `ensure-statusline.mjs` to call it; daemon runs that same script. No 2nd payload.
- Pin `process.execPath` into the supervisor at install/update time.
- Daemon registration is best-effort — failure logs, never aborts install.

## Outcome (validated 2026-06-02)

End-to-end validated on both target platforms:
- **macOS** — `launchd` LaunchAgent (WatchPaths on settings.json + StartInterval).
  Isolated live test + real deploy (`update` → v1.3.0): RunAtLoad heals instantly,
  WatchPaths re-heals after a clobber (~10s; launchd's min relaunch interval),
  full parity restored, `doctor` ✓, clean `uninstall`.
- **WSL** — `systemd --user` `.path` + `.service` (oneshot) + `.timer`. First
  attempt hit `systemctl --user enable` ETIMEDOUT (5s too short for WSL's slow
  user manager) → fixed with a 12s timeout + a systemd→cron→profile fallback +
  artifact-based status. Re-test: units active/waiting, clobber re-healed so fast
  the bar never visibly blanked, full parity restored.

Key robustness decision (c7c449e): never trust a single systemd probe — if any
`systemctl --user` call fails/hangs, clean up the half-written units and fall back
to cron → ~/.profile poll, and report the mechanism actually installed (not the
guessed one).

## Regression fix (2026-06-06) — daemon vs fullscreen TUI write-fight

REOPENED. The instant watch (systemd `.path` / launchd `WatchPaths`) reacted to
Claude Code's TRANSIENT statusLine drop on a fullscreen-TUI toggle as if it were a
permanent clobber, restoring it immediately. CC re-persisted (still fullscreen) →
daemon restored again → tight ping-pong that (a) made the fullscreen TUI flicker /
vanish and (b) tripped systemd's start-limit (`unit-start-limit-hit` after ~7min),
killing the daemon outright.

Live evidence that revised the old diagnosis (line 41): the `"tui":"fullscreen"`
fingerprint key is present WITH statusLine + heal hooks intact — so on the current
CC version the fullscreen toggle drops ONLY statusLine, not the hooks. The hooks
being intact means the hook-driven heal (UserPromptSubmit) recovers statusLine at
the next turn anyway, after the overlay closes — the daemon never needed to act
there.

Fix (TDD): `healAll(settings, { daemon })`. Daemon path acts ONLY on a genuine
catastrophic clobber — it skips when `settings.tui === 'fullscreen'` OR when the
heal hook still lives (defers to the hook). The OS supervisors now invoke the heal
with `CLAUDEBAR_DAEMON=1` (added to launchd plist env, systemd service env, cron
entry, poll script); the hook path leaves it unset and keeps its unconditional
mid-session restore. Both signals combined = robust even if a future CC version
also drops hooks during fullscreen. +5 settings unit tests, +1 daemon-template
test, +3 deployed-script integration tests; suite 197 CLI / 40 bash green.
Redeployed live via `update` (systemd service carries CLAUDEBAR_DAEMON=1, `.path`
recovered from failed → active); end-to-end confirmed: fullscreen drop left
untouched (no fight), hook-less clobber still fully healed.

### Frame 3 — systemd .path start-limit fragility (2026-06-06)

Surfaced while verifying frame 2: the `.path` unit had re-latched
`failed (unit-start-limit-hit)`. Journal showed the gate WORKS (post-fix the
service runs single, clean, no ping-pong — only the periodic `.timer` fires every
~6.6min), but the `.path` had died earlier from a burst of 5 service starts in one
second (during the deploy/test window). systemd does NOT auto-recover a
start-limit-latched unit → the instant watch was dead until a manual
`reset-failed`. Any future ≥5-writes-in-10s burst from ANY source would re-kill it
— the same "watcher dies permanently" class of bug.

Fix: `StartLimitIntervalSec=0` in the service `[Unit]` section (disables the rate
limit). Safe now because the daemon-mode gate makes the oneshot loop-safe — it
can't self-fight, so unbounded triggering only ever produces cheap idempotent
no-op runs. Live proof: an 8-write burst on settings.json kept `.path` active with
0 start-limit-hits and 8 clean service runs; during that burst the real
settings.json was in `tui:fullscreen` WITH statusLine present and the daemon left
it completely untouched. +1 daemon-template test. (launchd needs no equivalent —
WatchPaths throttles to ~10s but never latches failed.)

## Links

- Plan: /Users/henry/.claude/plans/optimized-bubbling-crayon.md
- Sibling/predecessor: midsession-selfheal (hook-based heal; this is the OS backstop)
- Cross-touch: `assets/ensure-statusline.mjs` (midsession-selfheal scope) gains
  full-parity via `healAll` — recorded as `emerged` on that initiative.
