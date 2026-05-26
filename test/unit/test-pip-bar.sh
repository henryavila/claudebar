#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local pct=$1 want_filled=$2 want_empty=$3
    local out=$(pip_bar "$pct")
    # Count filled (▰) and empty (▱) glyphs
    local f=$(printf '%s' "$out" | grep -o '▰' | wc -l)
    local e=$(printf '%s' "$out" | grep -o '▱' | wc -l)
    if (( f == want_filled && e == want_empty )); then
        echo "  ok: pip_bar($pct) = ${f}▰ + ${e}▱"
    else
        echo "  FAIL: pip_bar($pct) expected ${want_filled}▰+${want_empty}▱ got ${f}▰+${e}▱"
        fail=1
    fi
}

check 0   0 10
check 9   0 10    # 9*10/100 = 0 (integer floor)
check 10  1 9
check 23  2 8
check 50  5 5
check 99  9 1
check 100 10 0

if (( fail == 0 )); then echo "PASS: pip_bar fill counts"; exit 0
else echo "FAIL: pip_bar"; exit 1; fi
