#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# All three present
out=$(fuel_row ctx=23 five_hour=34 seven_day=62)
for label in "ctx" "5h" "7d"; do
    [[ "$out" == *"$label"* ]] || { echo "  FAIL: fuel_row missing label '$label'"; fail=1; }
done
[[ "$out" == *"23%"* && "$out" == *"34%"* && "$out" == *"62%"* ]] \
    || { echo "  FAIL: fuel_row missing percentage"; fail=1; }

# 5h absent → no 5h bar
out=$(fuel_row ctx=23 five_hour= seven_day=62)
if [[ "$out" == *"5h"* ]]; then
    echo "  FAIL: 5h should be hidden when five_hour empty"; fail=1
else
    echo "  ok: 5h hidden when absent"
fi

# Both rate limits absent → only ctx bar
out=$(fuel_row ctx=23 five_hour= seven_day=)
if [[ "$out" == *"5h"* || "$out" == *"7d"* ]]; then
    echo "  FAIL: both rate bars should be hidden"; fail=1
else
    echo "  ok: only ctx bar when rate limits absent"
fi

(( fail == 0 )) && { echo "PASS: fuel_row"; exit 0; } || { echo "FAIL: fuel_row"; exit 1; }
