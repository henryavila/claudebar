#!/usr/bin/env bash
# Measures avg latency over N runs. Fails if avg > BUDGET_MS.
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/../statusline.sh"
fixture="$dir/fixtures/02-mid-session.json"
budget_ms=50
runs=10

total_ns=0
for i in $(seq 1 $runs); do
    start=$(date +%s%N)
    "$script" < "$fixture" > /dev/null
    end=$(date +%s%N)
    total_ns=$(( total_ns + end - start ))
done
avg_ms=$(( total_ns / runs / 1000000 ))

echo "Average: ${avg_ms}ms over ${runs} runs (budget ${budget_ms}ms)"
if (( avg_ms <= budget_ms )); then
    echo "PASS: performance budget"
    exit 0
else
    echo "FAIL: exceeded budget"
    exit 1
fi
