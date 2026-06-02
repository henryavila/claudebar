#!/usr/bin/env bash
# Regression: 5h/7d chips must render the real rounded percentage even when the
# ambient LC_NUMERIC uses a comma decimal separator.
#
# Bug: statusline.sh runs under macOS bash 3.2, whose builtin `printf '%.0f'`
# parses floats through LC_NUMERIC. jq emits used_percentage as a period-decimal
# float (e.g. 23.5); under a comma locale (pt_BR, de_DE, ...) bash rejects it
# ("invalid number") and emits 0 — so a real 23% usage rendered as 0%.
# Fix: statusline.sh forces LC_NUMERIC=C internally.
set -uo pipefail

dir="$(cd "$(dirname "$0")/../.." && pwd)"
script="$dir/statusline.sh"

# Find an installed locale whose decimal separator is a comma. Probe with an
# INTEGER (parses in any locale) and read the radix char back: "1,0" → comma.
comma_locale=""
while IFS= read -r loc; do
    [[ -z "$loc" ]] && continue
    if [[ "$(LC_NUMERIC="$loc" printf '%.1f' 1 2>/dev/null)" == "1,0" ]]; then
        comma_locale="$loc"
        break
    fi
done < <(locale -a 2>/dev/null)

if [[ -z "$comma_locale" ]]; then
    echo "SKIP: test-locale-float (no comma-decimal locale installed)"
    exit 0
fi

# jq-style period-decimal floats, as Claude Code feeds them: 4.7 → 5, 23.5 → 24.
payload='{"model":{"display_name":"Opus 4.8"},"session_id":"locale-test","workspace":{"current_dir":"/tmp"},"context_window":{"used_percentage":33},"rate_limits":{"five_hour":{"used_percentage":4.7,"resets_at":1830018000},"seven_day":{"used_percentage":23.5,"resets_at":1830600000}}}'

out=$(printf '%s' "$payload" | \
    LC_NUMERIC="$comma_locale" \
    CLAUDEBAR_LAYOUT=full \
    CLAUDEBAR_NOW_FOR_TESTING=1830000000 \
    CLAUDEBAR_BRANCH_FOR_TESTING=main \
    bash "$script" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g')

fail=0
# seven_day 23.5 must round to 24%, NOT collapse to 0%.
if [[ "$out" == *"24%"* ]]; then
    echo "  ok: 7d 23.5 → 24% under $comma_locale"
else
    echo "  FAIL: 7d should show 24% under $comma_locale, got: $out"; fail=1
fi
# five_hour 4.7 must round to 5%.
if [[ "$out" == *"5%"* ]]; then
    echo "  ok: 5h 4.7 → 5% under $comma_locale"
else
    echo "  FAIL: 5h should show 5% under $comma_locale, got: $out"; fail=1
fi

(( fail == 0 )) && { echo "PASS: locale-float"; exit 0; } || { echo "FAIL: locale-float"; exit 1; }
