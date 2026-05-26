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
if [[ -z "$out" ]]; then
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
