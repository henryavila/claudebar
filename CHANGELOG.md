# Changelog

## v1.6.0 — 2026-06-25

### New: GLM Coding Plan 5-hour quota monitoring

claudebar now supports Claude Code sessions routed through GLM endpoints (`api.z.ai`, `open.bigmodel.cn`, or `dev.bigmodel.cn`). Those sessions do not expose Anthropic-style `.rate_limits.five_hour` data, so the `5h` chip previously stayed empty even when GLM quota information was available elsewhere.

The statusline now detects GLM from `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, reads a local `quota-cache.json`, and refreshes it in a detached background process via the Z.ai monitor API (`/api/monitor/usage/quota/limit`). The render path never waits on the network, non-GLM sessions never poll, and concurrent renders are de-bounced with a lockfile. Configure it with `[quota] enabled` and `[quota] refresh_interval_minutes` (default 5, minimum 1).

Reinstalling over an older config now back-fills newly shipped config sections and keys from `default-config.toml` without overwriting user settings or explicit opt-outs, so `[quota]` and future defaults show up in existing installs. The TOML parser also ignores comment-only future sections, while still rejecting unknown sections that contain active settings.

## v1.5.1 — 2026-06-19

### Fix: the "update available" chip no longer lingers after you're up to date

The auto-updater drops the latest published version into `.update-available`, and the statusline's update chip rendered that file **verbatim** — it never checked the version against the one actually installed (`.version`). The file is only ever cleared on `runAutoUpdate`'s throttled "up to date" pass (≤24h apart) and **never** right after an update is applied, so once you caught up to the advertised version the chip kept showing a phantom `⬆ v<current>` alert (everyone saw `⬆ v1.5.0` while already on 1.5.0).

`update_chip` now re-derives the truth at render time: it surfaces the chip **only when the advertised version is strictly newer than the installed one**, comparing `x.y.z` field-by-field as integers (so `1.10.0 > 1.9.0`, not a lexical compare). A missing or unparseable version on either side falls through and shows the chip — a real update is never hidden on a parse failure. This self-heals any stale `.update-available` on the next render, regardless of how it went stale. Locked by 9 new cases in `test/unit/test-update-chip.sh` (regression + boundary + edge; 14 total).

## v1.5.0 — 2026-06-17

### Time-elapsed marker is now an overlay cell with a state-colored pipe

The rate-limit time-elapsed marker (the `│` showing where you *should* be in a window) became an **overlay** cell: the pipe occupies a cell in the gauge and renders gray until consumed, then takes the zone color as the window burns down. Shipped via PR #21.

## v1.4.0 — 2026-06-15

### New: atomic-skills project focus chip (desktop-only)

The `atomic-skills:project` skill publishes a flat `.atomic-skills/focus.json` projection of "where am I" (plan → phase → task). claudebar now reads that **one** file and renders a glanceable focus chip on the **second row** (after the ctx/5h/7d gauges, where there's horizontal room): `◉ <plan-id> · <F i/n> · <done/total>`. It is **desktop-only** (full layout) — never rendered in the compact/mobile layout.

- **No-op by default for everyone else.** When `.atomic-skills/focus.json` is absent (the common case for users without atomic-skills), `plan` is null, or the `schemaVersion` is unknown, the chip renders nothing — so it's safe on by default (`[chips] project`).
- **Freshness oracle (never shows stale data as fresh).** `focus.json` is derived data; a mid-session `git checkout` or external edit can outdate it with no producer hook firing. The chip re-reads each `sources[]` file's `lastUpdated`/`last_updated` frontmatter and compares it to the recorded value — on mismatch or a missing source it shows a dim `~` instead of pretending the numbers are current. Uses `lastUpdated` content (not mtime, which `git checkout` resets → false-stale).
- **Markers.** `⚠N` when tasks are blocked (chip recolors), `⌁` on completion drift, and `` (nf-fa-clone) when more than one plan is active (the chip shows one of several).
- **Full plan id** by default (`PROJECT_SLUG_MAX` opt-in cap). Git-root is resolved by a pure-bash walk from the CWD (no `git` subprocess), so the no-atomic-skills path costs only a couple of stat calls and the render stays inside the <50ms budget.
- **Config.** `[chips] project`, `[colors] project / project_stale / project_blocked`, `[glyphs] project / drift / multiplan`.

Covered by `test/unit/test-project-chip.sh` (fresh / blocked / drift / multipleActivePlans / stale / legacy `last_updated` / `phase:null` regression / empty slug / full-id / `PROJECT_SLUG_MAX` / null-plan / unknown-version / chip-off / absent). `test/run-fixture.sh` disables the chip so repo state never leaks into snapshots.

## v1.3.5 — 2026-06-10

### Fix: the self-heal hook no longer fights Claude Code's fullscreen TUI

v1.3.2 (PR #16) stopped the **OS daemon** from restoring `statusLine` while Claude Code is in its fullscreen TUI — but it deliberately left the **hook path** (the `UserPromptSubmit` / `SessionStart` heal) unconditional, on the stale assumption that fullscreen was a transient overlay. In current Claude Code (2.1.89+) fullscreen is a **persistent, user-chosen rendering mode** with no inline statusLine: while it is active CC re-persists `settings.json` *without* the `statusLine` block. The per-turn hook restored it every prompt, CC hot-reloaded the block, and the TUI dropped out of fullscreen — once per submitted prompt.

`healAll` now applies the fullscreen gate to **both** paths: while `tui:"fullscreen"`, the heal stands down entirely (there is no statusline to heal). On leaving fullscreen, the next `SessionStart` / `UserPromptSubmit` — or the daemon timer — restores `statusLine` within one turn, so no mid-session recovery is lost. The `healHookPresent` defer remains daemon-only (the hook path does the restoring and does not defer to itself). Locked by 5 new tests (regression + boundary + edge, hook and unit level).

## v1.3.4 — 2026-06-07

### Fix: the 7d percentage no longer gets truncated on narrow mobile widths

v1.3.3 added the time-elapsed marker (the `│`) to the compact `5h` and `7d` chips, but the inserted marker widens each rate chip by one cell. On a narrow mobile terminal that pushed the trailing `7d` percentage past the edge, so it rendered cut off (e.g. `37%` → `3…`).

`compact_row3` now uses a **single-space** inter-chip gap (the full/desktop layout keeps its 2-space gap), reclaiming exactly the two cells the `5h` + `7d` markers add. The compact fuel row is back to the same width it was before v1.3.3, so the percentage fits — while keeping the inserted-pipe marker (true parity with desktop) and the accurate 5-pip gauge. Locked by a new `26-compact-markers` fixture (markers active, two-digit `7d %`) that asserts the full row renders.

## v1.3.3 — 2026-06-07

### Mobile/compact 5h & 7d chips now show the time-elapsed marker (the │)

The time-elapsed marker — the dim `│` that shows where you *should* be in a rate-limit window, so you can see at a glance whether you're burning faster than the window allows (pipe inside the fill) or have margin (pipe past the fill edge) — only rendered on the **desktop** layout. The **mobile/compact** `5h` and `7d` chips drew a bare 5-pip bar with no marker.

The compact bars now render the same cue: `pip_bar_compact` takes an optional marker argument (scaled to its 5-pip width), and `compact_row3` accepts `five_hour_resets_at` / `seven_day_resets_at`, computes the elapsed-window slot exactly like the full `fuel_row`, and passes it through. The compact layout shows the **marker only** (no countdown text — there's no room), keeping mobile in parity with the desktop signal. Covered by new marker assertions in `test/unit/test-pip-bar-compact.sh` and `test/unit/test-compact-rows.sh`.

## v1.3.2 — 2026-06-02

### Fix: the self-heal daemon stops fighting Claude Code's fullscreen TUI

The native self-heal daemon (v1.3.0) could write `settings.json` while Claude Code held its fullscreen TUI open, racing the editor's own re-persist and causing flicker / lost edits. The daemon's `healAll` now gates on a daemon-mode flag (`CLAUDEBAR_DAEMON=1`) so the watch-triggered heal no longer fights the live TUI, and the systemd `.path` unit's start-limit fragility is fixed with `StartLimitIntervalSec=0`. PR #16; CI green on macOS + Ubuntu.

## v1.3.1 — 2026-06-02

### Fix: 5h/7d chips render 0% under a comma-decimal locale

Under a comma-decimal locale (`pt_BR`, `de_DE`, …) the `5h` and `7d` fuel gauges showed **0%** even when real usage was non-zero. Root cause: `statusline.sh` runs under macOS's bash 3.2, whose `printf '%.0f'` parses floats through `LC_NUMERIC`. With a comma as the decimal separator it rejects every period-decimal percentage `jq` emits (`23.5`, `4.7`, …) as an "invalid number" and falls back to 0. The fix sets `export LC_NUMERIC=C` near the top of the script — only `LC_NUMERIC`, so `LC_CTYPE` stays intact and UTF-8 powerline glyphs keep rendering. Covered by a new `test/unit/test-locale-float.sh` that probes for an installed comma-decimal locale, feeds fractional payloads, and asserts the rounded percent (skips cleanly when no such locale is available).

## v1.3.0 — 2026-06-02

### Native OS self-heal daemon — the bar survives even when the hooks are stripped

The statusline kept vanishing for good. Root cause: Claude Code re-persists `~/.claude/settings.json` from its in-memory snapshot on a TUI toggle, and that rewrite can drop **both** the `statusLine` block **and the heal hook entry itself**. The previous heal was 100% hook-driven, so once its own hook was gone, nothing ever ran it again — the bar stayed dead until a manual `update`.

claudebar now registers a **native OS daemon** that runs the heal from *outside* Claude Code's control, so recovery no longer depends on any hook surviving:

- **macOS** — a `launchd` LaunchAgent with `WatchPaths` on `settings.json` (re-heals within ~10s of any change; launchd enforces a ~10s minimum between job starts) plus a 5-minute `StartInterval` safety net.
- **Linux / WSL with systemd** — `systemd --user` `.path` unit watching `settings.json` (+ a `.timer` safety net), running a one-shot `.service`.
- **Older WSL / no systemd** — falls back to a `cron` entry, or a managed block in `~/.profile` that launches a poll loop.

When it fires it restores **full parity** — `statusLine` + the heal hooks (SessionStart + UserPromptSubmit) + the auto-update hook — so even a total settings wipe comes back whole, and the zero-cost hook fast-path is re-seeded. The daemon pins the exact target file via `CLAUDEBAR_SETTINGS`, so it heals the right `settings.json` regardless of the supervisor's minimal environment.

It's **on by default**. Opt out with `claudebar install --no-daemon` or `[daemon] enabled = false` in `config.toml`. `uninstall` deregisters it (every mechanism), `update` back-fills it onto existing installs, `doctor` reports its status, and you can manage it directly with **`claudebar daemon [install|uninstall|status|restart]`**. Registration is best-effort — a `launchctl`/`systemctl` hiccup is logged and never aborts an install.

## v1.2.1 — 2026-06-01

### Fix: installer offers the auto-update choice on reinstall

The interactive auto-update prompt only appeared on a clean install. Reinstalling over an existing `config.toml` logged `config.toml already exists — preserved` and skipped the prompt entirely, so anyone who first installed before the prompt existed (or in a non-TTY context) could never pick a mode through the installer. The installer now also offers the choice on reinstall **when no explicit `auto_update` mode has been set yet** (the shipped line is commented). An already-chosen mode is preserved and never re-prompted, and only the `auto_update` line is touched — every other setting in your config is left exactly as-is.

## v1.2.0 — 2026-06-01

### Auto-update — fixes reach you on their own

claudebar now keeps itself up to date in the background, so a published fix arrives without you running `update` by hand. A SessionStart hook spawns a detached, throttled check (once per day by default) that reads the latest published version and decides what to do based on the configured mode:

- **`patch`** (default) — auto-applies hotfixes (`1.1.x`) only; a minor/major release just *notifies* (it never installs a feature or breaking change on its own).
- **`all`** — auto-applies every newer release.
- **`off`** — never checks or updates.

The decision runs entirely in the already-installed local code and only reads a version string from the network; the apply step is exactly the same `npx @henryavila/claudebar@latest update` you'd run manually. The check never blocks a session start: it's detached, fails silently when offline, and is gated by a timestamp so it costs a single `stat` on most launches. On install, an interactive prompt offers the mode (TTY only; CI falls back to the default).

When a minor/major update is available, the statusline shows an **`⬆ vX.Y.Z`** chip. Change the mode any time with **`claudebar config auto-update [patch|all|off]`** (no argument prints the current mode), and **`claudebar doctor`** now reports the auto-update status and mode. Everything is configurable via the new `[update]` section in `config.toml` and the `update` chip/color/glyph keys.

## v1.1.1 — 2026-05-29

### Fix: location always visible outside git repos

The identity row showed nothing in the location slot when the current directory was not a git repository. It now falls back to the directory basename with a folder glyph (` name`), in both the full and compact layouts, so the working location is never blank.

### Fix: worktree indicator is unmistakable and no longer overlaps

The git worktree marker (`⎇`, U+2387) was rendered as a separate glyph immediately before the branch icon. Its ambiguous character width caused it to visually overlap the following Private-Use git glyph, and the small unlabeled symbol was easy to miss. Now, when inside a worktree, the `⎇` marker **replaces** the git branch glyph and the whole branch chip renders in worktree violet — removing the glyph adjacency that caused the overlap and making a worktree obvious at a glance. The marker is now also shown in the compact layout (previously full-layout only), via a shared `branch_chip` renderer.

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
