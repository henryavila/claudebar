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

# ── Time-elapsed marker (the │), scaled to the 5-pip width ──
check_marker() {
    local pct=$1 marker=$2 want_pipes=$3 desc=$4
    local out p
    out=$(pip_bar_compact "$pct" "$marker")
    p=$(printf '%s' "$out" | grep -o '│' | wc -l)
    if (( p == want_pipes )); then
        echo "  ok: pip_bar_compact($pct,$marker) → ${p} │  ($desc)"
    else
        echo "  FAIL: pip_bar_compact($pct,$marker) expected ${want_pipes} │ got ${p}"
        fail=1
    fi
}

# Empty / non-numeric marker → legacy render, no pipe
check_marker 50 ""   0 "empty marker = no pipe"
check_marker 50 abc  0 "non-numeric = no pipe"
# Numeric marker in range → exactly one pipe
check_marker 50 0    1 "marker before first pip"
check_marker 50 3    1 "marker mid-bar"
check_marker 50 5    1 "marker after last pip"
# Out-of-range numeric clamps into [0,5] but still renders one pipe
check_marker 50 -2   1 "negative clamps to 0"
check_marker 50 99   1 "overflow clamps to 5"

# Marker never changes the pip count (5 cells regardless)
marker_pips=$(pip_bar_compact 60 2 | grep -o '▰\|▱' | wc -l)
if (( marker_pips == 5 )); then
    echo "  ok: marker preserves 5-pip width"
else
    echo "  FAIL: marker changed pip count to $marker_pips"; fail=1
fi

if (( fail == 0 )); then echo "PASS: pip_bar_compact"; exit 0
else echo "FAIL: pip_bar_compact"; exit 1; fi
