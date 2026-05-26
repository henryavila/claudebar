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

# ── Marker position (time-elapsed indicator) ───────────────────────────
# check_marker PCT MARKER_POS EXPECTED_PLAIN
# strips ANSI escapes before comparing the glyph sequence.
check_marker() {
    local pct=$1 marker=$2 want=$3
    local out plain
    out=$(pip_bar "$pct" "$marker")
    plain=$(printf '%s' "$out" | sed -E 's/\x1b\[[0-9;]*m//g')
    if [[ "$plain" == "$want" ]]; then
        echo "  ok: pip_bar($pct, $marker) = $plain"
    else
        echo "  FAIL: pip_bar($pct, $marker) expected '$want' got '$plain'"
        fail=1
    fi
}

# Back-compat: passing empty marker == no marker (existing 10-char render)
check_marker 40 ""  "▰▰▰▰▱▱▱▱▱▱"

# Marker at slot boundaries (0 = before all pips, 10 = after all)
check_marker 40 0   "│▰▰▰▰▱▱▱▱▱▱"
check_marker 40 10  "▰▰▰▰▱▱▱▱▱▱│"

# Marker AT the fill edge: pipe lands between last filled and first empty
check_marker 40 4   "▰▰▰▰│▱▱▱▱▱▱"

# Marker INSIDE the fill (usage > elapsed → "burning faster than time")
check_marker 72 4   "▰▰▰▰│▰▰▰▱▱▱"

# Marker BEYOND the fill (elapsed > usage → "you have margin")
check_marker 40 7   "▰▰▰▰▱▱▱│▱▱▱"

# Danger 5h: usage 89% (8 pips), elapsed 89% (slot 8) → synchronized
check_marker 89 8   "▰▰▰▰▰▰▰▰│▱▱"

# Danger 7d: usage 75% (7 pips), elapsed 83% (slot 8) → time slightly ahead
check_marker 75 8   "▰▰▰▰▰▰▰▱│▱▱"

# Defensive clamp
check_marker 50 -3  "│▰▰▰▰▰▱▱▱▱▱"
check_marker 50 99  "▰▰▰▰▰▱▱▱▱▱│"

if (( fail == 0 )); then echo "PASS: pip_bar fill counts + marker"; exit 0
else echo "FAIL: pip_bar"; exit 1; fi
