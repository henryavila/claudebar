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
