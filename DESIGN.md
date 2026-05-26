# Claude Code Statusline Redesign — Design Spec

**Date:** 2026-05-26
**Author:** Henry Avila (via brainstorming with Claude)
**Replaces:** `~/.claude/ccline/ccline` binary
**Implementation target:** `~/.claude/statusline/statusline.sh`

---

## Goal

Replace the current `ccline` statusline with a custom, modern, **zone-driven** status bar that uses pip-style fuel gauges and threshold-shifted colors to communicate session state at a glance. Optimized for a Claude.ai subscriber (rate limits matter, dollar cost doesn't).

---

## Constraints & Assumptions

| Dimension | Value |
|---|---|
| Runtime | Any Linux (WSL2 Ubuntu, native Ubuntu/Debian/Arch, macOS); bash 4+, jq, git |
| Shell | Any POSIX shell can invoke the script (zsh, bash, fish) — script itself uses `#!/usr/bin/env bash` |
| Terminal | Any ANSI 256-color terminal with Nerd Font installed (tmux optional, not required) |
| Color support | ANSI 256-color is the floor; truecolor used if available, but no required for any segment |
| User tier | Claude.ai subscriber → `cost.total_cost_usd` ignored, `rate_limits.*` central |
| Trigger model | Event-driven (post-message, post-/compact, vim/perm toggle), 300ms debounce + `refreshInterval: 30` for time-sensitive segments |
| Output channel | Stdout, captured by Claude Code, rendered in user's terminal |
| Layout budget | Single row of vertical space × 2 logical rows of content; right ~25% of physical row may be overlaid by Claude Code notifications |

### Cross-platform compatibility (required)

The script MUST run identically on:

- WSL2 (Ubuntu/Debian/etc.)
- Native Ubuntu / Debian / Arch / Fedora
- macOS (Intel and Apple Silicon)

**Implementation rules to keep portability:**

1. **No GNU-only flags.** `stat -c %Y` (Linux) vs `stat -f %m` (macOS) — must use a probe like `stat -c %Y "$f" 2>/dev/null || stat -f %m "$f"` (the docs' own caching example does this).
2. **No `realpath`/`readlink -f` GNU-isms** unless wrapped in a fallback.
3. **No bashisms beyond bash 4.0.** No bash 5-only features (associative array shorthand, etc.).
4. **POSIX-friendly `printf`** for ANSI escapes (`printf '%b'` for unambiguous interpretation across shells, as docs recommend over `echo -e`).
5. **Dependency probe at top of script:** if `jq` or `git` is missing, fall back to printing a minimal `[Opus] {dir}` line so the bar doesn't disappear entirely.
6. **Locale:** assume UTF-8. If `LANG`/`LC_ALL` is C/POSIX, glyphs may render as `?` — script still works, just with degraded glyphs.

A small `test/portability.sh` will run the script with synthetic JSON inputs on each target platform pre-release.

---

## Final Design

### Row 1 — Identity

```
✦ {model_short} · {EFFORT}   {owner}/{repo} › [⎇ ]{branch}  {dirty_or_clean}   {pr_chip}
```

Segments left → right:

| Segment | Source | Glyph | Color |
|---|---|---|---|
| Model | `model.display_name` | `✦` prefix | pink/magenta (256: 213) |
| Effort chip | `effort.level` | `LOW` / `MED` / `HIGH` / `XHIGH` / `MAX` text | per-level (see palette) |
| Repo | `workspace.repo.owner/name` | none | dim grey (245) |
| Worktree marker | `workspace.git_worktree` present | `⎇ ` (only when in a worktree) | soft violet (147) |
| Branch | git current branch | nf-fa git icon ` ` | leaf green (76) |
| Dirty/clean | `git status --porcelain \| wc -l` | `✎N` if N>0, else `✓` | amber (178) / green (82) |
| PR chip | `pr.number` + `pr.review_state` | nf git pull icon ` ` + state glyph | per-state (see palette) |

**Separators:** `·` between model/effort, `›` between repo/branch, double-space `  ` between segment groups. All separators in dim grey (238).

**Effort chip:** hidden entirely when `effort.level` field absent (some models don't support it).

**PR chip:** hidden entirely when `pr` field absent.

### Row 2 — Fuel Gauges

```
ctx ▰▰▱▱▱▱▱▱▱▱ 23%   5h  ▰▰▰▱▱▱▱▱▱▱ 34%   7d  ▰▰▰▰▰▰▱▱▱▱ 62%
```

Three fixed bars, identical structure:

| Position | Element | Detail |
|---|---|---|
| Prefix | Label | `ctx` / `5h` / `7d`, dim grey (245) |
| Bar | 10 pips | `▰` filled, `▱` empty. Fill count = `floor(pct * 10 / 100)` |
| Suffix | Percentage | `NN%`, right-aligned to 2 digits |

Both filled pips AND the percentage number take the **same zone color**. Empty pips always dim grey (238).

**Bar absence:**
- `ctx` bar always shown (fall back to `0%` / empty if `used_percentage` is null)
- `5h` bar hidden entirely if `rate_limits.five_hour` absent
- `7d` bar hidden entirely if `rate_limits.seven_day` absent

#### Countdown semantics (`5h` and `7d` chips)

When the stdin JSON includes `rate_limits.{five_hour,seven_day}.resets_at` (Unix
timestamp, emitted by Claude Code), the chip renders a magnitude-aware countdown
between the label and the bar:

```
5h · 2h18m  ▰▰▱▱▱▱▱▱▱▱ 18%
7d · 5d09h  ▰▰▱▱▱▱▱▱▱▱ 21%
```

| Range | Format | Example |
|---|---|---|
| `seconds < 60` (or negative — already reset) | `now` | `5h · now  ▰...` |
| `60 ≤ s < 86400` | `XhYYm` (zero-padded minutes; X may be 0) | `0h32m`, `2h18m`, `23h59m` |
| `86400 ≤ s ≤ 2592000` | `XdYYh` (zero-padded hours) | `1d04h`, `5d09h`, `7d00h` |
| `s > 2592000` (>30 days) | `30d+` (defensive cap) | `30d+` |

Colors: `·` separator and countdown text share the dim grey (245) of the label.
Bar zone color and percentage stay zone-driven — the countdown is metadata, not
a third alarm. Layout: `label SPACE · SPACE countdown TWO_SPACES bar SPACE pct%`.
The extra space between countdown and bar visually clusters `[label · countdown]`
as metadata vs `[bar pct%]` as the metric.

**Absence:** when `resets_at` is missing, null, zero, or non-numeric, the chip
falls back to `label SPACE bar SPACE pct%` (no countdown, no extra spacing).
Backward-compatible with stdin that predates the field.

**Determinism for tests:** `now_epoch()` returns `$CLAUDEBAR_NOW_FOR_TESTING`
when set to a positive integer, otherwise `date +%s`. Empty/non-numeric values
fall back defensively. Used by `test/run-all.sh` (`FROZEN_NOW = 1830000000`).

#### Time-elapsed marker (`│`)

When `resets_at` is present, the bar additionally gains a thin `│` marker
showing **how far into the window we are**, in the same 10-pip resolution as
the fill. The bar grows from 10 to 11 chars; the marker can land at any of
11 slots (`0` = before pip 0, `N` = between pip N-1 and pip N, `10` = after
pip 9). The juxtaposition is the whole point of the chip:

| Marker vs fill edge | Reading | Example |
|---|---|---|
| Marker **at** fill edge | Burn rate matches time — on pace | `▰▰▰▰▰▰▰▰│▱▱` (89% usage, 89% elapsed) |
| Marker **inside** fill | You're consuming faster than time — caution | `▰▰▰▰▰▰│▰▱▱▱` (72% usage, 40% elapsed) |
| Marker **past** fill | Time is ahead of usage — you have margin | `▰▰▰▰▰▰▰▱│▱▱` (75% usage, 83% elapsed) |

Position formula: `marker_pos = elapsed * 10 / WINDOW`, where
`elapsed = WINDOW - (resets_at - now)` clamped to `[0, WINDOW]`. Window
durations are pinned (`WINDOW_5H_SECONDS = 18000`, `WINDOW_7D_SECONDS = 604800`)
because Anthropic's rolling-window semantics aren't public — a fixed
denominator is a good enough approximation for glanceable "burning fast?"
reading.

Marker color: dim grey (245), same as the label and the countdown text —
preserves the bar+% as the saturation signal and the marker as metadata.

### Special State — Agent Active

When `agent.name` is present (subagent dispatched, user's turn paused):

**Row 1 morphs:**
- Model name **dims** to grey (240) — no sparkle color
- Effort chip is **replaced** by agent chip: ` agent:{name}` with a **pulsing** `●` (ANSI blink: `\033[5m●\033[25m`)
- Agent chip color: soft violet (141)
- Repo / branch / dirty / PR unchanged

**Row 2:** unchanged (bars are environmental, not turn-driven).

**Blink fallback:** if the user's terminal silently drops blink (some Windows Terminal versions, certain tmux configs), the `●` is still rendered in soft violet — the chip still reads "agent active", just without the pulse animation. No graceful degradation needed beyond that.

```
✦ Opus ·  agent:Explore ●   {owner}/{repo} › ⎇  {branch}  ✎3   #1234 ⏳
ctx ▰▰▱▱▱▱▱▱▱▱ 23%   5h  ▰▰▰▱▱▱▱▱▱▱ 34%   7d  ▰▰▰▰▰▰▱▱▱▱ 62%
```

---

## Color Logic

### Zone Thresholds (the core "experience" feature)

Applied independently to `ctx`, `5h`, `7d`:

| Pct range | Color | 256-color code | Semantic |
|---|---|---|---|
| `pct < 60` | green | 76 | Calm — plenty of runway |
| `60 ≤ pct < 90` | yellow | 220 | Caution — half-life crossed, ease off |
| `pct ≥ 90` | red | 196 | Danger — finish what you're doing |

Filled pips AND percentage text take the zone color. Empty pips stay dim grey (238) regardless.

### Static palette (does not vary by state)

| Segment | 256-color | Notes |
|---|---|---|
| Model bright | 213 | pink/magenta — Claude vibe |
| Model dimmed (agent active) | 240 | grey |
| Effort LOW | 76 | green |
| Effort MED | 39 | cyan |
| Effort HIGH | 220 | amber |
| Effort XHIGH | 208 | orange |
| Effort MAX | 197 | hot pink (alert) |
| Repo | 245 | dim grey |
| Worktree marker `⎇` | 147 | soft violet |
| Branch | 76 | leaf green |
| Dirty `✎N` | 178 | amber |
| Clean `✓` | 82 | bright green |
| PR pending `⏳` | 220 | amber |
| PR approved `✓` | 82 | bright green |
| PR changes `✗` | 196 | red |
| PR draft `◯` | 240 | grey |
| Agent | 141 | soft violet |
| Separators (`·` `›`) | 238 | very dim |
| Empty pips | 238 | very dim |

---

## Field Absence Handling

Layout shifts left and gaps collapse when a field is absent. **No placeholder text.**

**Separator ownership rule:** each segment owns its *preceding* separator (the `·` or `›` to its left, or the inter-group double-space). When a segment is hidden, its leading separator is hidden too. This prevents orphan `·` or `›` glyphs from appearing.

| JSON path | If absent / null |
|---|---|
| `model.display_name` | Fall back to `model.id`; if both null, show `?` |
| `effort.level` | Hide effort chip entirely |
| `workspace.repo.owner` or `.name` | Hide owner/repo segment + `›` separator |
| `workspace.git_worktree` | Hide `⎇ ` marker (regular branch only) |
| `pr.number` | Hide entire PR chip |
| `pr.review_state` (PR present) | Show PR number with no state glyph: ` #1234` |
| `agent.name` | Normal identity row (model + effort restored to bright/colored) |
| `context_window.used_percentage` | Show `ctx 0% ▱▱▱▱▱▱▱▱▱▱` |
| `rate_limits.five_hour.used_percentage` | Hide `5h` bar entirely |
| `rate_limits.five_hour.resets_at` | Hide `· countdown` segment of `5h` chip; bar+pct still render |
| `rate_limits.seven_day.used_percentage` | Hide `7d` bar entirely |
| `rate_limits.seven_day.resets_at` | Hide `· countdown` segment of `7d` chip; bar+pct still render |
| Git status command fails / not a repo | Hide owner/repo, branch, dirty, PR all together (whole git block gone) |

---

## Git Dirty Implementation

`git status --porcelain | wc -l` is the source.

**Caching (per official docs guidance):**
- Cache file: `/tmp/statusline-git-{session_id}` (session_id from JSON stdin — stable per session, unique across)
- Cache TTL: 5 seconds
- Cache format: pipe-separated `dirty_count|branch|in_worktree_flag`
- Cache regeneration: any time mtime is older than 5s OR file absent

This keeps the bar from running `git status` on every keystroke / message in large repos.

---

## Refresh Strategy

`settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline/statusline.sh",
    "padding": 0,
    "refreshInterval": 30
  }
}
```

**Why `refreshInterval: 30`:**
- Rate limit windows move noticeably across 30s during heavy use
- Git status changes if user edits files in another pane between assistant messages
- 30s is responsive without burning cycles when idle
- Cache layer (5s for git) prevents 30s ticks from causing 6× more git calls

---

## Implementation Choices

### Language: Bash

| Criterion | Bash | Python | Node | Go |
|---|---|---|---|---|
| Cold-start | ~5ms | ~50ms | ~100ms | ~5ms (single binary) |
| Deps required | `jq` only (already present) | python3 | node | none |
| Complexity ceiling | Moderate | High | High | High |
| Distribution friction | Zero | Zero | Zero | One-time build |

**Choice: Bash.** The 5-50ms cold-start matters because the script runs after every assistant message. If logic grows beyond bash readability later, migrate to Go (single binary, same cold-start, much higher complexity ceiling).

### File location

| File | Purpose |
|---|---|
| `~/.claude/statusline/statusline.sh` | The script Claude Code invokes |
| `~/.claude/statusline/DESIGN.md` | This document |
| `~/.claude/statusline/CHANGELOG.md` | Track future tweaks |

NOT inside the Arch repo — this is personal Claude tooling, not project code. Lives in `~/.claude/` next to other user-level config.

### Script structure (pseudocode)

```
1. Read JSON from stdin into $input
2. Single jq invocation extracting all needed fields into bash vars
3. Compute derived values (zone color per pct, dirty_count via cached git)
4. If agent.name present:
     build_identity_row_agent_mode
   else:
     build_identity_row_normal_mode
5. build_fuel_gauges_row
6. echo identity_row
7. echo fuel_gauges_row
```

### Performance budget

| Metric | Target |
|---|---|
| Total exec time | < 50ms |
| jq invocations | 1 (single call extracting all fields) |
| Subprocess spawns | ≤ 2 (jq + occasional `git status` when cache stale) |
| External API calls | 0 |

### Known risk: multi-line + ANSI rendering

Official docs warn that "Multi-line status lines with escape codes are more prone to rendering issues than single-line plain text." This design uses 2 rows + heavy ANSI. Mitigations:

1. Keep each row under the typical terminal width (~100 cols) so wrapping never occurs
2. Always reset ANSI state (`\033[0m`) at end of each `printf`
3. Avoid OSC sequences (no clickable links in v1) — they're the most fragile
4. If glitches appear in practice, the contingency is to collapse to a single-row variant (variant `3c-G` from brainstorming) — keep that variant's code path in a comment for fast pivot

---

## Acceptance Criteria

The implementation is done when:

1. ✅ All 7 demo states from `/tmp/statusline-demo-final.sh` render correctly in user's live Claude Code session
2. ✅ Color thresholds fire at exactly 60% (green→yellow) and 90% (yellow→red)
3. ✅ Bar fills are accurate: each pip = 10% of capacity, count = `floor(pct × 10 / 100)`
4. ✅ Worktree `⎇` marker appears IFF `workspace.git_worktree` is present in JSON
5. ✅ Git dirty indicator updates within 5s of an actual file change
6. ✅ Agent dispatch dims model name, hides effort chip, shows pulsing agent chip
7. ✅ PR chip glyph/color flips correctly across all 4 `pr.review_state` values
8. ✅ Effort chip hidden when `effort.level` JSON field absent
9. ✅ `5h` and `7d` bars hidden when `rate_limits.*` absent (e.g., non-subscriber)
10. ✅ Total exec time < 50ms per invocation (measured via `time` over 10 runs)
11. ✅ No tofu / boxes in user's Nerd Font setup
12. ✅ `settings.json` updated to point at new script; old `ccline` reference removed
13. ✅ Script runs identically on WSL2 Ubuntu **and** native Ubuntu (and macOS as a stretch goal) — verified via `test/portability.sh`
14. ✅ Script degrades gracefully (still prints something usable) when `jq` or `git` is missing, instead of producing an empty status line

---

## Out of Scope (explicitly excluded)

These were considered and **rejected** during brainstorming:

| Excluded | Why |
|---|---|
| `output_style` chip | User declined — already aware of which mode is active |
| `cost.total_cost_usd` | User is subscribed; dollars don't drive decisions |
| `thinking.enabled` chip | Marginal value; thinking state changes infrequently |
| `cost.total_lines_added/removed` | Noisy in short sessions, not worth the width |
| Session duration `⏱ 47m` | Rate-limit bars implicitly communicate session progression |
| API vs wall time split | Diagnostic, not glanceable |
| Time of day `🕐 15:42` | User has terminal/tmux clock if needed |
| `vim.mode` | User doesn't use vim editing mode |
| `exceeds_200k_tokens` | Redundant with ctx% bar |
| Pre-existing `ccline` binary | Replaced wholesale; not extending |

---

## Layout Detection

`detect_layout()` returns `"compact"` or `"full"` using a 4-layer priority cascade:

| Priority | Signal | Type | Trigger |
|----------|--------|------|---------|
| 1 | `CLAUDEBAR_LAYOUT=compact\|full` | Explicit override | User sets in shell profile |
| 2 | `MOSHI_CLIENT=1` | App signal | Moshi iOS: Settings > Integrations > Export ENV |
| 3 | `mosh-server` in process tree | Auto-detection | Walks `/proc` ancestry (Linux) with `ps` fallback (macOS) |
| 4 | `$COLUMNS < 60` | Terminal width | Fallback; unreliable when stdin is a pipe (falls back to terminfo default 80) |

### Limitations

- **SSH-only connections are not auto-detected.** When mosh is unavailable and the connection is pure SSH, layers 2–4 cannot reliably distinguish a mobile client from a desktop client. Use `CLAUDEBAR_LAYOUT=compact` explicitly in these cases.
- **Layer 4 is best-effort.** The statusline runs as a subprocess with stdin/stdout piped, so `tput cols` returns the terminfo default (80), not the actual terminal width. `$COLUMNS` is only set in interactive shells.

---

## Future Expansion (post-v1)

Not in this scope, but candidates for v2 if appetite emerges:

- Sparkline of context-window growth over time (needs history file)
- Tmux pane/window name integration via `$TMUX_PANE`
- Per-project color theme overrides (`.claude/statusline.json` in project root)
- OSC 8 clickable hyperlink on PR chip → open in browser
- Time of day chip (gated behind a `show_clock` env var or flag)
- Subagent panel customization via `subagentStatusLine`
