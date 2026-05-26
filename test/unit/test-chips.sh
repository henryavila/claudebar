#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# effort_chip
for pair in "low:LOW:$C_EFFORT_LOW" \
            "medium:MED:$C_EFFORT_MED" \
            "high:HIGH:$C_EFFORT_HI" \
            "xhigh:XHIGH:$C_EFFORT_XHI" \
            "max:MAX:$C_EFFORT_MAX"; do
    IFS=: read -r level label color <<< "$pair"
    out=$(effort_chip "$level")
    if [[ "$out" == *"$label"* && "$out" == *"38;5;${color}m"* ]]; then
        echo "  ok: effort_chip($level) contains $label and color $color"
    else
        echo "  FAIL: effort_chip($level) got: $out"; fail=1
    fi
done

# Absent level returns empty
out=$(effort_chip "")
[[ -z "$out" ]] && echo "  ok: effort_chip('') = empty" || { echo "  FAIL: effort_chip empty"; fail=1; }

# pr_chip
for pair in "pending:⏳:$C_PR_PENDING" \
            "approved:✓:$C_PR_APPROVED" \
            "changes_requested:✗:$C_PR_CHANGES" \
            "draft:◯:$C_PR_DRAFT"; do
    IFS=: read -r state glyph color <<< "$pair"
    out=$(pr_chip 1234 "$state")
    if [[ "$out" == *"#1234"* && "$out" == *"$glyph"* && "$out" == *"38;5;${color}m"* ]]; then
        echo "  ok: pr_chip(1234, $state)"
    else
        echo "  FAIL: pr_chip($state) got: $out"; fail=1
    fi
done

if (( fail == 0 )); then echo "PASS: chips"; exit 0
else echo "FAIL: chips"; exit 1; fi
