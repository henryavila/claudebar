#!/usr/bin/env bash
# Unit test for format_countdown helper.
# Validates the 4 magnitude regimes: "now" (< 60s), "XhYYm", "XdYYh", "30d+" cap.
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local seconds=$1 want=$2
    local got
    got=$(format_countdown "$seconds")
    if [[ "$got" == "$want" ]]; then
        echo "  ok: format_countdown($seconds) = $got"
    else
        echo "  FAIL: format_countdown($seconds) expected '$want' got '$got'"
        fail=1
    fi
}

# ── Edge "now" (s < 60) ────────────────────────────────────────────────
check -9999 now
check -1    now
check 0     now
check 30    now
check 59    now

# ── Transição now → XhYYm ──────────────────────────────────────────────
check 60    0h01m
check 61    0h01m

# ── Faixa XhYYm com X=0 (sub-hora) ─────────────────────────────────────
check 720   0h12m
check 1920  0h32m
check 3540  0h59m

# ── Faixa XhYYm com X>0 ────────────────────────────────────────────────
check 3600  1h00m
check 8280  2h18m
check 14880 4h08m
check 86399 23h59m

# ── Transição XhYYm → XdYYh ────────────────────────────────────────────
check 86400 1d00h

# ── Faixa XdYYh ────────────────────────────────────────────────────────
check 100800 1d04h
check 324000 3d18h
check 464400 5d09h
check 604800 7d00h

# ── Zero-pad em XhYYm ──────────────────────────────────────────────────
check 3601 1h00m
check 3661 1h01m

# ── Zero-pad em XdYYh ──────────────────────────────────────────────────
check 86460 1d00h
check 90000 1d01h

# ── Cap superior ───────────────────────────────────────────────────────
check 2592000  30d00h
check 2592001  30d+
check 99999999 30d+

if (( fail == 0 )); then
    echo "PASS: format_countdown"
    exit 0
else
    echo "FAIL: format_countdown"
    exit 1
fi
