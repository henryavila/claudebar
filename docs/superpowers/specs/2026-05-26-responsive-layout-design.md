# Responsive Layout for Mobile — Design Spec

**Date:** 2026-05-26
**Author:** Henry Avila (via brainstorming with Claude)
**Extends:** `DESIGN.md` (v1.1.0)
**Target:** `statusline.sh` — add adaptive layout detection + compact 3-row renderer

---

## Goal

Add a compact, 3-row layout to claudebar that renders correctly on mobile terminals (~45-50 columns). The existing 2-row desktop layout is unchanged. Layout selection is automatic (terminal width + `MOSHI_CLIENT`) with an explicit env-var override.

---

## Tier System

Two tiers. No intermediate layer — the visual difference wasn't large enough to justify a third mode.

| Tier | Name | Columns | Rows | Pips | Trigger |
|---|---|---|---|---|---|
| 1 | compact | < 60 | 3 | 5 | `MOSHI_CLIENT=1`, `COLUMNS < 60`, or `CLAUDEBAR_LAYOUT=compact` |
| 2 | full | ≥ 60 | 2 | 10 | Default (current behavior) |

---

## Detection Cascade

Evaluated top-to-bottom; first match wins:

```
1. CLAUDEBAR_LAYOUT=compact  → compact     (explicit override, highest priority)
2. CLAUDEBAR_LAYOUT=full     → full        (explicit override)
3. MOSHI_CLIENT=1            → compact     (Moshi iOS terminal app sets this)
4. COLUMNS < 60              → compact     (auto-detect via terminal width)
5. tput cols < 60            → compact     (fallback when COLUMNS unset/0)
6. default                   → full
```

### Notes on detection

- `MOSHI_CLIENT` is opt-in in the Moshi app (Settings > Integrations > Export ENV). It's injected into the remote shell via `mosh-server -l` or `export` at session start — it does NOT rely on SSH `SendEnv`/`AcceptEnv`.
- `$COLUMNS` may be `0` or unset inside non-interactive subshells (observed in tmux + Claude Code). When `$COLUMNS` is absent or `0`, fall back to `tput cols`.
- `tput cols` spawns a subprocess (~2ms); acceptable since it runs once per invocation.

---

## Compact Layout (3 rows)

### Row 1 — Session

```
✦ {model_short} · {EFFORT}  {pr_chip}
```

| Segment | Source | Behavior |
|---|---|---|
| Model | `model.display_name` | Full name (NOT abbreviated) — fits comfortably at ~10 chars |
| Effort | `effort.level` | Same chips as desktop: `LOW`/`MED`/`HIGH`/`XHIGH`/`MAX` |
| PR chip | `pr.number` + `pr.review_state` | Right-aligned on row. Hidden when absent |

Width budget: `✦ Opus 4.7 · MAX  #1234 ⏳` = **28 chars** worst case.

**Agent-active mode:** same behavior as desktop — model dims, effort replaced by agent chip. PR chip stays.

```
✦ Opus 4.7 · ⚙ agent:Explore ●  #1234 ⏳
```

Width: ~42 chars worst case — fits.

### Row 2 — Git Context

```
{repo} › {branch} {dirty_or_clean}
```

| Segment | Source | Behavior |
|---|---|---|
| Repo | `workspace.repo.name` | Repo name only — **owner dropped** to save width |
| Branch | git current branch | Same glyph + color as desktop |
| Dirty/clean | `git status --porcelain \| wc -l` | Same as desktop |

Width budget: `arch › feat/quota-reset-chip ✎3` = **34 chars** worst case for a typical long branch.

**Dropped from compact:** repo owner (`henryavila/`), worktree marker (`⎇`), tmux chip.

**Hidden entirely** when not in a git repo (same rule as desktop).

### Row 3 — Fuel Gauges (5 pips)

```
ctx {5pip} {pct}%  5h {5pip} {pct}%  7d {5pip} {pct}%
```

| Difference from desktop | Detail |
|---|---|
| Pip count | 5 instead of 10. Fill = `floor(pct * 5 / 100)` |
| Countdown text | **Hidden** — not enough width, and 5-pip resolution makes the time-elapsed marker meaningless |
| Time-elapsed marker (`│`) | **Hidden** — same reason |
| Zone colors | **Same** thresholds: green <60%, yellow 60-89%, red ≥90% |

Width budget: `ctx ▰▱▱▱▱ 23%  5h ▰▰▱▱▱ 34%  7d ▰▰▰▱▱ 62%` = **48 chars** worst case.

**Bar absence rules:** same as desktop (`5h`/`7d` hidden when `rate_limits.*` absent).

---

## Full Layout (2 rows) — Unchanged

Existing `identity_row` + `fuel_row` behavior. No modifications. See `DESIGN.md` for the full spec.

---

## Implementation Changes

### New function: `detect_layout()`

Returns `compact` or `full`. Pure function, no side effects. Testable via env vars.

```bash
detect_layout() {
    # 1. Explicit override
    case "${CLAUDEBAR_LAYOUT:-}" in
        compact) echo compact; return ;;
        full)    echo full;    return ;;
    esac
    # 2. Moshi detection
    [[ "${MOSHI_CLIENT:-}" == "1" ]] && { echo compact; return; }
    # 3. Column width detection
    local cols=${COLUMNS:-0}
    (( cols == 0 )) && cols=$(tput cols 2>/dev/null || echo 80)
    (( cols < 60 )) && { echo compact; return; }
    # 4. Default
    echo full
}
```

### New function: `pip_bar_compact()`

5-pip variant. Same zone colors, no marker support.

```bash
pip_bar_compact() {
    local pct=$1
    local color filled i
    color=$(zone_color "$pct")
    filled=$(( pct * 5 / 100 ))
    (( filled > 5 )) && filled=5
    (( filled < 0 )) && filled=0
    for ((i=0; i<5; i++)); do
        if (( i < filled )); then fg "$color" "▰"; else fg "$C_BAR_DIM" "▱"; fi
    done
}
```

### New function: `compact_row1()`

Session row: model + effort/agent + PR.

### New function: `compact_row2()`

Git context row: repo (name only) + branch + dirty.

### New function: `compact_row3()`

Fuel row: ctx + 5h + 7d with 5-pip bars, no countdown, no marker.

### Modified: `main()`

After parsing JSON and deriving values, call `detect_layout` and branch:

```bash
local layout
layout=$(detect_layout)

if [[ "$layout" == "compact" ]]; then
    compact_row1 ...
    compact_row2 ...
    compact_row3 ...
else
    identity_row ...
    fuel_row ...
fi
```

### No changes to existing functions

`identity_row`, `fuel_row`, `pip_bar`, `pr_chip`, `effort_chip`, `dirty_indicator`, `tmux_chip` — all unchanged. Compact mode uses its own renderers that call shared helpers (`fg`, `sep`, `zone_color`, `pr_chip`, `effort_chip`, `dirty_indicator`).

---

## Field Absence in Compact Mode

Same collapse rules as desktop. No placeholder text.

| Absent field | Compact behavior |
|---|---|
| `effort.level` | Row 1: just `✦ Model  #PR` |
| `pr.number` | Row 1: just `✦ Model · EFFORT` |
| Not in a git repo | Row 2: hidden entirely (only 2 rows rendered) |
| `rate_limits.five_hour` | Row 3: `ctx` + `7d` only |
| `rate_limits.seven_day` | Row 3: `ctx` + `5h` only |
| Both rate limits absent | Row 3: `ctx` only |
| `agent.name` | Normal row 1 (model bright + effort) |

---

## Testing

### New unit tests

| Test file | What it covers |
|---|---|
| `test/unit/test-detect-layout.sh` | Detection cascade: CLAUDEBAR_LAYOUT override, MOSHI_CLIENT, COLUMNS, tput fallback, defaults |
| `test/unit/test-pip-bar-compact.sh` | 5-pip fill at 0%, 19%, 20%, 50%, 99%, 100% |
| `test/unit/test-compact-rows.sh` | Row 1/2/3 rendering with various field absence patterns |

### New integration fixtures

Add compact-mode fixtures alongside existing ones. Use `CLAUDEBAR_LAYOUT=compact` in the test harness to force compact rendering regardless of the test runner's terminal width.

| Fixture | Scenario |
|---|---|
| `test/fixtures/20-compact-calm.json` | Compact: low usage, clean tree, short branch |
| `test/fixtures/21-compact-long-branch.json` | Compact: long branch name, dirty tree, PR pending |
| `test/fixtures/22-compact-danger.json` | Compact: red zone, PR changes requested |
| `test/fixtures/23-compact-agent.json` | Compact: agent active |
| `test/fixtures/24-compact-no-repo.json` | Compact: no git repo (2 rows only) |
| `test/fixtures/25-compact-no-rate-limits.json` | Compact: no rate limits (ctx only on row 3) |

### Determinism

- `CLAUDEBAR_LAYOUT=compact` forces compact mode in tests, bypassing `COLUMNS`/`tput` detection.
- Existing `CLAUDEBAR_NOW_FOR_TESTING` and `CLAUDEBAR_BRANCH_FOR_TESTING` env vars continue to work as before.

---

## Performance

| Metric | Target |
|---|---|
| Total exec time (compact) | < 50ms (same as desktop) |
| Additional subprocesses | +1 `tput cols` when `COLUMNS` is unset (only in auto-detect path) |

`detect_layout()` is called once per invocation — no caching needed.

---

## Out of Scope

| Excluded | Why |
|---|---|
| Intermediate tier (tablet) | Analysis showed it was too similar to desktop — not enough visual differentiation to justify the complexity |
| Model name abbreviation (`O4.7`) | Not needed — full name fits in 3-row layout |
| Countdown in compact | 5-pip resolution makes time-elapsed marker meaningless; width budget too tight |
| Vertical stacked bars (1 per line, 4+ rows) | Too much vertical real estate on mobile |
| `MOSHI_CLIENT` auto-configuration | User must enable it in Moshi app settings — out of claudebar's control |

---

## Acceptance Criteria

1. `detect_layout` returns `compact` when `MOSHI_CLIENT=1`
2. `detect_layout` returns `compact` when `CLAUDEBAR_LAYOUT=compact`
3. `detect_layout` returns `compact` when `COLUMNS=45`
4. `detect_layout` returns `full` when `COLUMNS=100`
5. `detect_layout` returns `full` by default (no env vars set, wide terminal)
6. Compact mode renders 3 rows (session, git, fuel)
7. Compact mode uses 5-pip bars with correct fill: `floor(pct * 5 / 100)`
8. Compact mode hides: tmux chip, repo owner, worktree marker, countdown, time-elapsed marker
9. Compact mode preserves: full model name, effort chip, branch, dirty indicator, PR chip, zone colors
10. Row 2 hidden entirely when not in a git repo
11. Agent-active mode works correctly in compact (dim model, agent chip, no effort)
12. All existing desktop tests still pass (no regressions)
13. New compact fixtures produce expected output
14. Total exec time < 50ms for both layouts
