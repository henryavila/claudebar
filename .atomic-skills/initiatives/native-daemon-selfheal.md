---
initiative_id: native-daemon-selfheal
status: active
started: 2026-06-02
last_updated: 2026-06-02T11:40:00Z
branch:
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

next_action: "DONE (code + live launchd verify): src/daemon.js + lifecycle/doctor/CLI integration; [daemon] config flag; full parity heal; CLAUDEBAR_SETTINGS pinned. Suite 185 CLI + 40 bash green. Uncommitted — decide commit + release (v1.3.0) + live deploy (claudebar update)"
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

## Links

- Plan: /Users/henry/.claude/plans/optimized-bubbling-crayon.md
- Sibling/predecessor: midsession-selfheal (hook-based heal; this is the OS backstop)
- Cross-touch: `assets/ensure-statusline.mjs` (midsession-selfheal scope) gains
  full-parity via `healAll` — recorded as `emerged` on that initiative.
