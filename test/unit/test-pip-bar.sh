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

# ── Time-elapsed marker (the │) — OVERLAY semantics ────────────────────
# The marker is one of the 10 CELLS (not an inserted 11th char): the │
# REPLACES the pip at cell index `marker` (clamped to [0,9]). Filling the
# cells BEFORE the marker does NOT count as reaching it — the marker cell
# is "reached" only when the fill consumes it (filled > marker). Total
# width stays 10. check_marker strips ANSI and compares the glyph sequence.
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

# Back-compat: empty marker == no marker (legacy 10-char render, no pipe)
check_marker 40 ""  "▰▰▰▰▱▱▱▱▱▱"

# Marker occupies a cell; width is always 10 (│ replaces a pip)
check_marker 40 0   "│▰▰▰▱▱▱▱▱▱"
check_marker 40 9   "▰▰▰▰▱▱▱▱▱│"

# "encostou" — fill reaches the cells before the marker but NOT the marker
# cell itself (filled == marker): pipe shows, glyph sequence unchanged
check_marker 40 4   "▰▰▰▰│▱▱▱▱▱"

# "passou" — fill consumes the marker cell and beyond (filled > marker)
check_marker 72 4   "▰▰▰▰│▰▰▱▱▱"

# "atrás" — marker sits in the empty region (filled < marker)
check_marker 40 7   "▰▰▰▰▱▱▱│▱▱"

# Synchronized: usage 89% (8 filled), time cell 8 → encostou
check_marker 89 8   "▰▰▰▰▰▰▰▰│▱"

# Time slightly ahead: usage 75% (7 filled), time cell 8 → atrás
check_marker 75 8   "▰▰▰▰▰▰▰▱│▱"

# Defensive clamp to [0,9]
check_marker 50 -3  "│▰▰▰▰▱▱▱▱▱"
check_marker 50 99  "▰▰▰▰▰▱▱▱▱│"

# Width invariance: marker active → still exactly 10 glyphs (▰+▱+│)
out=$(pip_bar 60 4)
w=$(( $(printf '%s' "$out"|grep -o '▰'|wc -l) + $(printf '%s' "$out"|grep -o '▱'|wc -l) + $(printf '%s' "$out"|grep -o '│'|wc -l) ))
if (( w == 10 )); then
    echo "  ok: overlay marker preserves 10-cell width"
else
    echo "  FAIL: overlay marker width = $w (expected 10)"; fail=1
fi

# ── Pipe COLOR by state (overlay) ──────────────────────────────────────
# Not reached (filled <= marker) → C_REPO (245, gray).
# Reached/passou (filled > marker) → zone_color (green 76 / yellow 220 / red 196).
# The pipe's color = the LAST 38;5;Nm escape before the │ glyph.
check_pipe_color() {
    local pct=$1 marker=$2 want=$3 desc=$4
    local out before code
    out=$(pip_bar "$pct" "$marker")
    before=${out%%│*}
    code=$(printf '%s' "$before" | grep -oE '38;5;[0-9]+m' | tail -1 | sed -E 's/38;5;([0-9]+)m/\1/')
    if [[ "$code" == "$want" ]]; then
        echo "  ok: pipe color pip_bar($pct,$marker) = $code ($desc)"
    else
        echo "  FAIL: pipe color pip_bar($pct,$marker) expected $want got '$code' ($desc)"
        fail=1
    fi
}

check_pipe_color 40 7  245 "atrás → gray"
check_pipe_color 40 4  245 "encostou (filled==marker) → gray"
check_pipe_color 89 8  245 "encostou high → gray"
check_pipe_color 50 3  76  "passou green zone → green"
check_pipe_color 72 4  220 "passou yellow zone → yellow"
check_pipe_color 95 8  196 "passou red zone → red"

if (( fail == 0 )); then echo "PASS: pip_bar fill counts + overlay marker + pipe color"; exit 0
else echo "FAIL: pip_bar"; exit 1; fi
