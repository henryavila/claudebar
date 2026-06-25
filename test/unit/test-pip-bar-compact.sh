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

# ── Time-elapsed marker (│) — OVERLAY, scaled to the 5-pip width ──
# The │ occupies one of the 5 CELLS (replaces the pip at cell `marker`,
# clamped [0,4]); total width stays 5. "Reached" only when filled > marker.
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
errfile=$(mktemp)
pip_bar_compact 50 abc >/dev/null 2>"$errfile"
err=$(cat "$errfile")
rm -f "$errfile"
if [[ -z "$err" ]]; then
    echo "  ok: pip_bar_compact non-numeric marker writes no stderr"
else
    echo "  FAIL: pip_bar_compact non-numeric marker wrote stderr: $err"
    fail=1
fi
# Numeric marker in range → exactly one pipe
check_marker 50 0    1 "marker at cell 0"
check_marker 50 3    1 "marker mid-bar"
check_marker 50 4    1 "marker at last cell"
# Out-of-range numeric clamps into [0,4] but still renders one pipe
check_marker 50 -2   1 "negative clamps to 0"
check_marker 50 99   1 "overflow clamps to 4"

# Exact overlay glyph sequence (ANSI-stripped). filled = pct*5/100.
check_seq() {
    local pct=$1 marker=$2 want=$3
    local out plain
    out=$(pip_bar_compact "$pct" "$marker")
    plain=$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;]*m//g')
    if [[ "$plain" == "$want" ]]; then
        echo "  ok: pip_bar_compact($pct,$marker) = $plain"
    else
        echo "  FAIL: pip_bar_compact($pct,$marker) expected '$want' got '$plain'"
        fail=1
    fi
}
check_seq 40 2  "▰▰│▱▱"   # filled 2, marker 2 → encostou
check_seq 80 2  "▰▰│▰▱"   # filled 4, marker 2 → passou
check_seq 20 3  "▰▱▱│▱"   # filled 1, marker 3 → atrás

# Marker never changes the total width (5 cells: ▰+▱+│ == 5)
out=$(pip_bar_compact 60 2)
w=$(( $(printf '%s' "$out"|grep -o '▰'|wc -l) + $(printf '%s' "$out"|grep -o '▱'|wc -l) + $(printf '%s' "$out"|grep -o '│'|wc -l) ))
if (( w == 5 )); then
    echo "  ok: overlay marker preserves 5-cell width"
else
    echo "  FAIL: overlay marker changed width to $w"; fail=1
fi

# Pipe color by state: not reached → 245 gray; passou → zone color
check_pipe_color() {
    local pct=$1 marker=$2 want=$3 desc=$4
    local out before code
    out=$(pip_bar_compact "$pct" "$marker")
    before=${out%%│*}
    code=$(printf '%s' "$before" | grep -oE '38;5;[0-9]+m' | tail -1 | sed -E 's/38;5;([0-9]+)m/\1/')
    if [[ "$code" == "$want" ]]; then
        echo "  ok: pipe color pip_bar_compact($pct,$marker) = $code ($desc)"
    else
        echo "  FAIL: pipe color pip_bar_compact($pct,$marker) expected $want got '$code' ($desc)"
        fail=1
    fi
}
check_pipe_color 20 3  245 "atrás → gray"
check_pipe_color 40 2  245 "encostou → gray"
check_pipe_color 80 2  220 "passou yellow → yellow"
check_pipe_color 100 2 196 "passou red → red"

if (( fail == 0 )); then echo "PASS: pip_bar_compact"; exit 0
else echo "FAIL: pip_bar_compact"; exit 1; fi
