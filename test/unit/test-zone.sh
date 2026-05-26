#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local pct=$1 expected=$2
    local actual=$(zone_color "$pct")
    if [[ "$actual" == "$expected" ]]; then
        echo "  ok: zone_color($pct) = $expected"
    else
        echo "  FAIL: zone_color($pct) expected=$expected actual=$actual"
        fail=1
    fi
}

# Green zone: < 60
check 0  76
check 23 76
check 59 76

# Yellow zone: 60 <= x < 90
check 60 220
check 78 220
check 89 220

# Red zone: >= 90
check 90 196
check 94 196
check 100 196

if (( fail == 0 )); then
    echo "PASS: zone_color thresholds"; exit 0
else
    echo "FAIL: zone_color thresholds"; exit 1
fi
