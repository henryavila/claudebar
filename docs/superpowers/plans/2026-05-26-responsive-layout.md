# Responsive Mobile Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact 3-row layout to claudebar that auto-detects mobile terminals and renders correctly at ~45-50 columns, while keeping the existing 2-row desktop layout unchanged.

**Architecture:** New `detect_layout()` function checks env vars (`CLAUDEBAR_LAYOUT`, `MOSHI_CLIENT`) and terminal width (`$COLUMNS` / `tput cols`) to return `compact` or `full`. Compact mode uses its own 3-row renderers (`compact_row1/2/3`) and a 5-pip bar variant (`pip_bar_compact`), sharing existing helpers (`fg`, `sep`, `zone_color`, `pr_chip`, `effort_chip`, `dirty_indicator`). The `main()` function branches on the layout result. No existing functions are modified.

**Tech Stack:** Bash 4+, jq, ANSI 256-color

**Spec:** `docs/superpowers/specs/2026-05-26-responsive-layout-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `statusline.sh` | Modify | Add `detect_layout`, `pip_bar_compact`, `compact_row1`, `compact_row2`, `compact_row3`; update `main()` to branch on layout |
| `test/unit/test-detect-layout.sh` | Create | Unit tests for `detect_layout()` cascade |
| `test/unit/test-pip-bar-compact.sh` | Create | Unit tests for 5-pip bar fill accuracy |
| `test/unit/test-compact-rows.sh` | Create | Unit tests for compact row renderers |
| `test/fixtures/20-compact-calm.json` | Create | Compact fixture: low usage, clean tree |
| `test/fixtures/21-compact-long-branch.json` | Create | Compact fixture: long branch, dirty, PR |
| `test/fixtures/22-compact-danger.json` | Create | Compact fixture: red zone |
| `test/fixtures/23-compact-agent.json` | Create | Compact fixture: agent active |
| `test/fixtures/24-compact-no-repo.json` | Create | Compact fixture: no git repo (2 rows) |
| `test/fixtures/25-compact-no-rate-limits.json` | Create | Compact fixture: no rate limits |
| `test/fixtures/21-compact-long-branch.dirty` | Create | Dirty sidecar: 7 dirty files |
| `test/expected/20-compact-calm.txt` | Create | Expected output (blessed) |
| `test/expected/21-compact-long-branch.txt` | Create | Expected output (blessed) |
| `test/expected/22-compact-danger.txt` | Create | Expected output (blessed) |
| `test/expected/23-compact-agent.txt` | Create | Expected output (blessed) |
| `test/expected/24-compact-no-repo.txt` | Create | Expected output (blessed) |
| `test/expected/25-compact-no-rate-limits.txt` | Create | Expected output (blessed) |
| `test/run-fixture.sh` | Modify | Detect `compact-` prefix in fixture name → export `CLAUDEBAR_LAYOUT=compact` |

---

## Task 1: `detect_layout()` with TDD

**Files:**
- Create: `test/unit/test-detect-layout.sh`
- Modify: `statusline.sh` (add function after `now_epoch`, around line 85)

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-detect-layout.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local desc=$1 want=$2
    local got
    got=$(detect_layout)
    if [[ "$got" == "$want" ]]; then
        echo "  ok: $desc → $got"
    else
        echo "  FAIL: $desc expected=$want got=$got"
        fail=1
    fi
}

# 1. CLAUDEBAR_LAYOUT override (highest priority)
CLAUDEBAR_LAYOUT=compact MOSHI_CLIENT='' COLUMNS=200 check "CLAUDEBAR_LAYOUT=compact overrides wide terminal" compact
CLAUDEBAR_LAYOUT=full MOSHI_CLIENT=1 COLUMNS=30 check "CLAUDEBAR_LAYOUT=full overrides MOSHI+narrow" full

# 2. MOSHI_CLIENT detection
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT=1 COLUMNS=200 check "MOSHI_CLIENT=1 on wide terminal" compact
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT=0 COLUMNS=200 check "MOSHI_CLIENT=0 is not a trigger" full

# 3. COLUMNS detection
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=45 check "COLUMNS=45 → compact" compact
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=59 check "COLUMNS=59 → compact" compact
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=60 check "COLUMNS=60 → full" full
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=100 check "COLUMNS=100 → full" full

# 4. Default (wide terminal)
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=80 check "default wide → full" full

if (( fail == 0 )); then echo "PASS: detect_layout"; exit 0
else echo "FAIL: detect_layout"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-detect-layout.sh`
Expected: FAIL with "detect_layout: command not found" or similar

- [ ] **Step 3: Implement `detect_layout` in `statusline.sh`**

Add after the `now_epoch()` function (after line 84), before `format_countdown`:

```bash
# ─── detect_layout — return "compact" or "full" based on environment ──
detect_layout() {
    case "${CLAUDEBAR_LAYOUT:-}" in
        compact) echo compact; return ;;
        full)    echo full;    return ;;
    esac
    [[ "${MOSHI_CLIENT:-}" == "1" ]] && { echo compact; return; }
    local cols=${COLUMNS:-0}
    (( cols == 0 )) && cols=$(tput cols 2>/dev/null || echo 80)
    (( cols < 60 )) && { echo compact; return; }
    echo full
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-detect-layout.sh`
Expected: PASS: detect_layout

- [ ] **Step 5: Verify no regressions**

Run: `bash test/run-all.sh`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add statusline.sh test/unit/test-detect-layout.sh
git commit -m "feat: add detect_layout() with TDD coverage"
```

---

## Task 2: `pip_bar_compact()` with TDD

**Files:**
- Create: `test/unit/test-pip-bar-compact.sh`
- Modify: `statusline.sh` (add function after `pip_bar`, around line 149)

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-pip-bar-compact.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local pct=$1 want_filled=$2 want_empty=$3
    local out
    out=$(pip_bar_compact "$pct")
    local f e
    f=$(printf '%s' "$out" | grep -o '▰' | wc -l)
    e=$(printf '%s' "$out" | grep -o '▱' | wc -l)
    if (( f == want_filled && e == want_empty )); then
        echo "  ok: pip_bar_compact($pct) = ${f}▰ + ${e}▱"
    else
        echo "  FAIL: pip_bar_compact($pct) expected ${want_filled}▰+${want_empty}▱ got ${f}▰+${e}▱"
        fail=1
    fi
}

check 0   0 5
check 19  0 5     # 19*5/100 = 0 (integer floor)
check 20  1 4     # 20*5/100 = 1
check 39  1 4
check 40  2 3
check 50  2 3     # 50*5/100 = 2 (integer floor)
check 60  3 2
check 80  4 1
check 99  4 1     # 99*5/100 = 4
check 100 5 0

# Zone colors: same thresholds as 10-pip bar
check_color() {
    local pct=$1 want_color=$2
    local out
    out=$(pip_bar_compact "$pct")
    if [[ "$out" == *"38;5;${want_color}m"* ]]; then
        echo "  ok: pip_bar_compact($pct) uses color $want_color"
    else
        echo "  FAIL: pip_bar_compact($pct) expected color $want_color"
        fail=1
    fi
}

check_color 23  76    # green
check_color 65  220   # yellow
check_color 92  196   # red

if (( fail == 0 )); then echo "PASS: pip_bar_compact"; exit 0
else echo "FAIL: pip_bar_compact"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-pip-bar-compact.sh`
Expected: FAIL

- [ ] **Step 3: Implement `pip_bar_compact` in `statusline.sh`**

Add after the `pip_bar()` function (after line 148):

```bash
# ─── pip_bar_compact PCT — 5-pip zone-colored bar (compact layout) ────
pip_bar_compact() {
    local pct=$1
    local color filled i
    color=$(zone_color "$pct")
    filled=$(( pct * 5 / 100 ))
    (( filled > 5 )) && filled=5
    (( filled < 0 )) && filled=0
    for ((i=0; i<5; i++)); do
        if (( i < filled )); then
            fg "$color" "▰"
        else
            fg "$C_BAR_DIM" "▱"
        fi
    done
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-pip-bar-compact.sh`
Expected: PASS: pip_bar_compact

- [ ] **Step 5: Commit**

```bash
git add statusline.sh test/unit/test-pip-bar-compact.sh
git commit -m "feat: add pip_bar_compact() 5-pip variant with TDD"
```

---

## Task 3: Compact row renderers with TDD

**Files:**
- Create: `test/unit/test-compact-rows.sh`
- Modify: `statusline.sh` (add 3 functions after `pip_bar_compact`)

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-compact-rows.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# ── compact_row1 ──────────────────────────────────────────────────────
# Normal mode: model + effort + PR
out=$(compact_row1 model="Opus 4.7" effort=max pr_number=1234 pr_state=pending agent="")
for s in "Opus 4.7" "MAX" "#1234" "⏳"; do
    if [[ "$out" != *"$s"* ]]; then
        echo "  FAIL: compact_row1 normal missing '$s'"; fail=1
    fi
done
# Must NOT contain owner/repo, tmux, or worktree
for s in "henryavila" "tmux:" "⎇"; do
    if [[ "$out" == *"$s"* ]]; then
        echo "  FAIL: compact_row1 should not contain '$s'"; fail=1
    fi
done
(( fail == 0 )) && echo "  ok: compact_row1 normal"

# Agent mode: model dims, agent chip replaces effort, PR stays
out=$(compact_row1 model="Opus 4.7" effort=max pr_number=42 pr_state=approved agent="Explore")
if [[ "$out" == *"agent:Explore"* && "$out" != *"MAX"* && "$out" == *"#42"* ]]; then
    echo "  ok: compact_row1 agent mode"
else
    echo "  FAIL: compact_row1 agent mode"; fail=1
fi

# Missing PR
out=$(compact_row1 model="Opus 4.7" effort=high pr_number="" pr_state="" agent="")
if [[ "$out" != *"#"* ]]; then
    echo "  ok: compact_row1 missing PR hides chip"
else
    echo "  FAIL: compact_row1 missing PR"; fail=1
fi

# Missing effort
out=$(compact_row1 model="Opus 4.7" effort="" pr_number="" pr_state="" agent="")
if [[ "$out" != *"MAX"* && "$out" != *"MED"* && "$out" != *"HIGH"* && "$out" != *"LOW"* ]]; then
    echo "  ok: compact_row1 missing effort hides chip"
else
    echo "  FAIL: compact_row1 missing effort"; fail=1
fi

# ── compact_row2 ──────────────────────────────────────────────────────
# Normal: repo name (no owner) + branch + dirty
out=$(compact_row2 repo="arch" branch=main dirty_count=3)
if [[ "$out" == *"arch"* && "$out" == *"main"* && "$out" == *"3"* ]]; then
    echo "  ok: compact_row2 normal"
else
    echo "  FAIL: compact_row2 normal"; fail=1
fi
# Must NOT contain owner
if [[ "$out" != *"henryavila"* ]]; then
    echo "  ok: compact_row2 no owner"
else
    echo "  FAIL: compact_row2 should not contain owner"; fail=1
fi

# No repo → empty output
out=$(compact_row2 repo="" branch="" dirty_count="")
if [[ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]]; then
    echo "  ok: compact_row2 no repo = empty"
else
    echo "  FAIL: compact_row2 no repo should be empty"; fail=1
fi

# ── compact_row3 ──────────────────────────────────────────────────────
# All bars present
out=$(compact_row3 ctx=23 five_hour=34 seven_day=62)
f5=$(printf '%s' "$out" | grep -o '▰' | wc -l)
e5=$(printf '%s' "$out" | grep -o '▱' | wc -l)
if [[ "$out" == *"ctx"* && "$out" == *"5h"* && "$out" == *"7d"* && "$out" == *"23%"* ]]; then
    echo "  ok: compact_row3 all bars"
else
    echo "  FAIL: compact_row3 all bars"; fail=1
fi
# Should use 5-pip bars (total pips = 15: 5 per bar × 3 bars)
total_pips=$(( f5 + e5 ))
if (( total_pips == 15 )); then
    echo "  ok: compact_row3 uses 5-pip bars (15 total pips)"
else
    echo "  FAIL: compact_row3 expected 15 pips got $total_pips"; fail=1
fi

# No countdown or marker
if [[ "$out" != *"│"* && "$out" != *"·"* ]]; then
    echo "  ok: compact_row3 no countdown/marker"
else
    echo "  FAIL: compact_row3 should not have countdown or marker"; fail=1
fi

# Only ctx (no rate limits)
out=$(compact_row3 ctx=50 five_hour="" seven_day="")
if [[ "$out" == *"ctx"* && "$out" != *"5h"* && "$out" != *"7d"* ]]; then
    echo "  ok: compact_row3 ctx-only"
else
    echo "  FAIL: compact_row3 ctx-only"; fail=1
fi

if (( fail == 0 )); then echo "PASS: compact rows"; exit 0
else echo "FAIL: compact rows"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-compact-rows.sh`
Expected: FAIL

- [ ] **Step 3: Implement compact row renderers in `statusline.sh`**

Add after `pip_bar_compact()`:

```bash
# ─── compact_row1 — session row (model + effort/agent + PR) ──────────
# Usage: compact_row1 model=X effort=X pr_number=X pr_state=X agent=X
compact_row1() {
    local model="" effort="" pr_number="" pr_state="" agent=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            model=*)      model=${arg#model=} ;;
            effort=*)     effort=${arg#effort=} ;;
            pr_number=*)  pr_number=${arg#pr_number=} ;;
            pr_state=*)   pr_state=${arg#pr_state=} ;;
            agent=*)      agent=${arg#agent=} ;;
        esac
    done

    local sparkle="✦"

    if [[ -n "$agent" ]]; then
        fg "$C_MODEL_DIM" "${sparkle} ${model}"
        printf ' '
        sep "·"
        printf ' '
        fg "$C_AGENT" "${GLYPH_GEAR} agent:${agent}"
        printf '%s[5m' "$esc"
        fg "$C_AGENT" " ●"
        printf '%s[25m' "$esc"
    else
        fg "$C_MODEL" "${sparkle} ${model}"
        if [[ -n "$effort" ]]; then
            printf ' '
            sep "·"
            printf ' '
            effort_chip "$effort"
        fi
    fi

    if [[ -n "$pr_number" ]]; then
        printf '  '
        pr_chip "$pr_number" "$pr_state"
    fi

    printf '\n'
}

# ─── compact_row2 — git context (repo name + branch + dirty) ─────────
# Usage: compact_row2 repo=X branch=X dirty_count=X
compact_row2() {
    local repo="" branch="" dirty_count=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            repo=*)         repo=${arg#repo=} ;;
            branch=*)       branch=${arg#branch=} ;;
            dirty_count=*)  dirty_count=${arg#dirty_count=} ;;
        esac
    done

    [[ -z "$repo" ]] && { printf '\n'; return; }

    fg "$C_REPO" "$repo"
    printf ' '
    sep "›"
    printf ' '
    if [[ -n "$branch" ]]; then
        fg "$C_BRANCH" "${GLYPH_GIT} ${branch}"
    fi
    if [[ -n "$dirty_count" ]]; then
        printf ' '
        dirty_indicator "$dirty_count"
    fi

    printf '\n'
}

# ─── compact_row3 — fuel gauges with 5-pip bars ──────────────────────
# Usage: compact_row3 ctx=X five_hour=X seven_day=X
compact_row3() {
    local ctx="" five_hour="" seven_day=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            ctx=*)        ctx=${arg#ctx=} ;;
            five_hour=*)  five_hour=${arg#five_hour=} ;;
            seven_day=*)  seven_day=${arg#seven_day=} ;;
        esac
    done

    : "${ctx:=0}"
    fg "$C_REPO" "ctx"; printf ' '
    pip_bar_compact "$ctx"
    printf ' '
    fg "$(zone_color "$ctx")" "$(printf '%2d%%' "$ctx")"

    if [[ -n "$five_hour" ]]; then
        printf '  '
        fg "$C_REPO" "5h"; printf ' '
        pip_bar_compact "$five_hour"
        printf ' '
        fg "$(zone_color "$five_hour")" "$(printf '%2d%%' "$five_hour")"
    fi

    if [[ -n "$seven_day" ]]; then
        printf '  '
        fg "$C_REPO" "7d"; printf ' '
        pip_bar_compact "$seven_day"
        printf ' '
        fg "$(zone_color "$seven_day")" "$(printf '%2d%%' "$seven_day")"
    fi

    printf '\n'
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-compact-rows.sh`
Expected: PASS: compact rows

- [ ] **Step 5: Commit**

```bash
git add statusline.sh test/unit/test-compact-rows.sh
git commit -m "feat: add compact row renderers (row1/row2/row3) with TDD"
```

---

## Task 4: Wire compact layout into `main()`

**Files:**
- Modify: `statusline.sh` (update `main()` function, around line 466-483)

- [ ] **Step 1: Update `main()` to branch on layout**

In `statusline.sh`, replace the Render section of `main()` (the last ~17 lines, starting at the `# Render` comment):

Current code (lines ~466-483):
```bash
    # Render
    identity_row \
        model="$MODEL" \
        effort="$EFFORT" \
        owner="$OWNER" repo="$REPO" \
        worktree="$WORKTREE" \
        branch="$BRANCH" \
        dirty_count="$DIRTY" \
        pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
        agent="$AGENT"

    fuel_row \
        ctx="$CTX" \
        five_hour="$FIVE_HOUR" \
        seven_day="$SEVEN_DAY" \
        five_hour_resets_at="$FIVE_HOUR_RESETS_AT" \
        seven_day_resets_at="$SEVEN_DAY_RESETS_AT"
```

Replace with:

```bash
    # Render
    local layout
    layout=$(detect_layout)

    if [[ "$layout" == "compact" ]]; then
        compact_row1 \
            model="$MODEL" \
            effort="$EFFORT" \
            pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
            agent="$AGENT"

        compact_row2 \
            repo="$REPO" \
            branch="$BRANCH" \
            dirty_count="$DIRTY"

        compact_row3 \
            ctx="$CTX" \
            five_hour="$FIVE_HOUR" \
            seven_day="$SEVEN_DAY"
    else
        identity_row \
            model="$MODEL" \
            effort="$EFFORT" \
            owner="$OWNER" repo="$REPO" \
            worktree="$WORKTREE" \
            branch="$BRANCH" \
            dirty_count="$DIRTY" \
            pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
            agent="$AGENT"

        fuel_row \
            ctx="$CTX" \
            five_hour="$FIVE_HOUR" \
            seven_day="$SEVEN_DAY" \
            five_hour_resets_at="$FIVE_HOUR_RESETS_AT" \
            seven_day_resets_at="$SEVEN_DAY_RESETS_AT"
    fi
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bash test/run-all.sh`
Expected: All existing tests pass (existing fixtures don't set CLAUDEBAR_LAYOUT, and COLUMNS is wide enough to default to full)

- [ ] **Step 3: Commit**

```bash
git add statusline.sh
git commit -m "feat: wire detect_layout into main() for compact/full branching"
```

---

## Task 5: Update `run-fixture.sh` for compact fixtures

**Files:**
- Modify: `test/run-fixture.sh` (add CLAUDEBAR_LAYOUT export for compact fixtures)

- [ ] **Step 1: Update `run-fixture.sh`**

In `test/run-fixture.sh`, add after the `export CLAUDEBAR_NOW_FOR_TESTING CLAUDEBAR_BRANCH_FOR_TESTING` line (line 22), before the fixture existence check:

```bash
# Compact fixtures: names starting with a number followed by "-compact-"
# force compact layout regardless of terminal width.
if [[ "$name" == *-compact-* ]]; then
    export CLAUDEBAR_LAYOUT=compact
else
    export CLAUDEBAR_LAYOUT=full
fi
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `bash test/run-all.sh`
Expected: All existing tests still pass (they get `CLAUDEBAR_LAYOUT=full` now, same as their implicit default)

- [ ] **Step 3: Commit**

```bash
git add test/run-fixture.sh
git commit -m "feat: run-fixture.sh auto-sets CLAUDEBAR_LAYOUT for compact fixtures"
```

---

## Task 6: Create compact integration fixtures + expected outputs

**Files:**
- Create: `test/fixtures/20-compact-calm.json`
- Create: `test/fixtures/21-compact-long-branch.json`
- Create: `test/fixtures/21-compact-long-branch.dirty`
- Create: `test/fixtures/22-compact-danger.json`
- Create: `test/fixtures/23-compact-agent.json`
- Create: `test/fixtures/24-compact-no-repo.json`
- Create: `test/fixtures/25-compact-no-rate-limits.json`
- Create: all corresponding `test/expected/` files

- [ ] **Step 1: Create fixture JSON files**

`test/fixtures/20-compact-calm.json`:
```json
{
  "session_id": "test-20-compact",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"}
  },
  "effort": {"level": "medium"},
  "context_window": {"used_percentage": 12},
  "rate_limits": {
    "five_hour": {"used_percentage": 18},
    "seven_day": {"used_percentage": 45}
  }
}
```

`test/fixtures/21-compact-long-branch.json`:
```json
{
  "session_id": "test-21-compact",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"},
    "git_worktree": "filament-v4-migration"
  },
  "effort": {"level": "high"},
  "context_window": {"used_percentage": 55},
  "rate_limits": {
    "five_hour": {"used_percentage": 72},
    "seven_day": {"used_percentage": 38}
  },
  "pr": {"number": 1234, "review_state": "pending"}
}
```

`test/fixtures/21-compact-long-branch.dirty` (sidecar):
```
7
```

`test/fixtures/22-compact-danger.json`:
```json
{
  "session_id": "test-22-compact",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"}
  },
  "effort": {"level": "max"},
  "context_window": {"used_percentage": 92},
  "rate_limits": {
    "five_hour": {"used_percentage": 95},
    "seven_day": {"used_percentage": 88}
  },
  "pr": {"number": 42, "review_state": "changes_requested"}
}
```

`test/fixtures/23-compact-agent.json`:
```json
{
  "session_id": "test-23-compact",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"}
  },
  "effort": {"level": "high"},
  "context_window": {"used_percentage": 23},
  "rate_limits": {
    "five_hour": {"used_percentage": 34},
    "seven_day": {"used_percentage": 62}
  },
  "pr": {"number": 99, "review_state": "pending"},
  "agent": {"name": "Explore"}
}
```

`test/fixtures/24-compact-no-repo.json`:
```json
{
  "session_id": "test-24-compact",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/notes"
  },
  "effort": {"level": "medium"},
  "context_window": {"used_percentage": 8},
  "rate_limits": {
    "five_hour": {"used_percentage": 12},
    "seven_day": {"used_percentage": 30}
  }
}
```

`test/fixtures/25-compact-no-rate-limits.json`:
```json
{
  "session_id": "test-25-compact",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"}
  },
  "effort": {"level": "low"},
  "context_window": {"used_percentage": 5}
}
```

- [ ] **Step 2: Bless expected outputs**

Generate each expected output by running the script with `CLAUDEBAR_LAYOUT=compact`:

```bash
for name in 20-compact-calm 21-compact-long-branch 22-compact-danger \
            23-compact-agent 24-compact-no-repo 25-compact-no-rate-limits; do
    CLAUDEBAR_LAYOUT=compact CLAUDEBAR_NOW_FOR_TESTING=1830000000 \
    CLAUDEBAR_BRANCH_FOR_TESTING=main \
    bash statusline.sh < "test/fixtures/${name}.json" > "test/expected/${name}.txt"
done
```

Note: fixture 21 uses `CLAUDEBAR_BRANCH_FOR_TESTING=feat/quota-reset-chip` to test long branch names:

```bash
CLAUDEBAR_LAYOUT=compact CLAUDEBAR_NOW_FOR_TESTING=1830000000 \
CLAUDEBAR_BRANCH_FOR_TESTING=feat/quota-reset-chip \
bash statusline.sh < test/fixtures/21-compact-long-branch.json > test/expected/21-compact-long-branch.txt
```

- [ ] **Step 3: Manually inspect each blessed output**

For each expected file, run:
```bash
cat -v test/expected/<name>.txt
```

Verify:
- Fixture 20: 3 rows — model+MED, arch+main+✓, ctx+5h+7d with 5 pips
- Fixture 21: 3 rows — model+HIGH+PR, arch+feat/quota-reset-chip+✎7, ctx+5h+7d
- Fixture 22: 3 rows — model+MAX+PR(✗), arch+main+✓, ctx+5h+7d in red zone
- Fixture 23: 3 rows — model(dim)+agent:Explore+PR, arch+main, ctx+5h+7d
- Fixture 24: 2 rows only — model+MED, ctx+5h+7d (no git row)
- Fixture 25: 2 rows — model+LOW, arch+main+✓, ctx only (no 5h/7d)

Wait — fixture 25 has a repo but no rate limits, so it's 3 rows with just `ctx` on row 3. Fixture 24 has no repo, so row 2 is empty/hidden → effectively 2 visible rows + 1 blank line.

- [ ] **Step 4: Run the full test suite**

Run: `bash test/run-all.sh`
Expected: All tests pass including 6 new compact fixtures

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/2[0-5]* test/expected/2[0-5]* test/fixtures/21-compact-long-branch.dirty
git commit -m "test: add 6 compact layout integration fixtures"
```

---

## Task 7: Handle fixture 21 long branch + final verification

**Files:**
- Modify: `test/run-fixture.sh` (handle per-fixture branch overrides)

- [ ] **Step 1: Add branch override support for fixture 21**

The long-branch fixture needs `CLAUDEBAR_BRANCH_FOR_TESTING=feat/quota-reset-chip` instead of the default `main`. Create a sidecar file `test/fixtures/21-compact-long-branch.branch` containing:

```
feat/quota-reset-chip
```

Then update `test/run-fixture.sh` — after the dirty sidecar handling (around line 36), add:

```bash
# Per-fixture branch override (e.g. to test long branch names)
branch_sidecar="$dir/fixtures/${name}.branch"
if [[ -f "$branch_sidecar" ]]; then
    CLAUDEBAR_BRANCH_FOR_TESTING=$(cat "$branch_sidecar")
    export CLAUDEBAR_BRANCH_FOR_TESTING
fi
```

- [ ] **Step 2: Re-bless fixture 21 with the branch sidecar**

```bash
CLAUDEBAR_LAYOUT=compact CLAUDEBAR_NOW_FOR_TESTING=1830000000 \
CLAUDEBAR_BRANCH_FOR_TESTING=feat/quota-reset-chip \
bash statusline.sh < test/fixtures/21-compact-long-branch.json > test/expected/21-compact-long-branch.txt
```

- [ ] **Step 3: Run the full test suite**

Run: `bash test/run-all.sh`
Expected: All tests pass — unit tests + all fixtures (existing + new compact)

- [ ] **Step 4: Run the performance test**

Run: `bash test/perf.sh`
Expected: < 50ms per invocation for both layouts

- [ ] **Step 5: Commit**

```bash
git add test/run-fixture.sh test/fixtures/21-compact-long-branch.branch test/expected/21-compact-long-branch.txt
git commit -m "feat: branch sidecar support in run-fixture.sh for long branch testing"
```

---

## Task 8: Final regression check + compact_row2 empty-line fix

**Files:**
- Possibly modify: `statusline.sh` (`compact_row2` if empty line is unwanted)

- [ ] **Step 1: Review compact_row2 behavior when no repo**

When there's no repo, `compact_row2` prints `\n` (an empty line). Check whether fixture 24 (no-repo) has an unwanted blank line between row 1 and row 3. If so, skip the newline:

In `compact_row2`, change:
```bash
[[ -z "$repo" ]] && { printf '\n'; return; }
```
to:
```bash
[[ -z "$repo" ]] && return
```

This way row 2 is truly hidden (no empty line) when there's no git repo, and the output is just 2 lines.

- [ ] **Step 2: Re-bless fixture 24 if changed**

```bash
CLAUDEBAR_LAYOUT=compact CLAUDEBAR_NOW_FOR_TESTING=1830000000 \
CLAUDEBAR_BRANCH_FOR_TESTING=main \
bash statusline.sh < test/fixtures/24-compact-no-repo.json > test/expected/24-compact-no-repo.txt
```

- [ ] **Step 3: Update test-compact-rows.sh no-repo assertion**

If you changed compact_row2 to not emit a newline, update the test assertion:

Change:
```bash
if [[ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ]]; then
```
to:
```bash
if [[ -z "$out" ]]; then
```

- [ ] **Step 4: Run all tests one final time**

Run: `bash test/run-all.sh`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add statusline.sh test/unit/test-compact-rows.sh test/expected/24-compact-no-repo.txt
git commit -m "fix: compact_row2 emits no output when not in git repo"
```

---

## Summary of commits

| # | Message | What |
|---|---|---|
| 1 | `feat: add detect_layout() with TDD coverage` | Detection cascade function + unit tests |
| 2 | `feat: add pip_bar_compact() 5-pip variant with TDD` | 5-pip bar renderer + unit tests |
| 3 | `feat: add compact row renderers (row1/row2/row3) with TDD` | 3 compact renderers + unit tests |
| 4 | `feat: wire detect_layout into main() for compact/full branching` | Main integration |
| 5 | `feat: run-fixture.sh auto-sets CLAUDEBAR_LAYOUT for compact fixtures` | Test harness update |
| 6 | `test: add 6 compact layout integration fixtures` | Fixtures + expected outputs |
| 7 | `feat: branch sidecar support in run-fixture.sh for long branch testing` | Long branch fixture support |
| 8 | `fix: compact_row2 emits no output when not in git repo` | Edge case polish |
