#!/usr/bin/env bash
set -uo pipefail

fail=0
check() {
    local desc=$1 want=$2 got=$3
    if [[ "$got" == "$want" ]]; then
        echo "  ok: $desc"
    else
        echo "  FAIL: $desc — expected='$want' got='$got'"
        fail=1
    fi
}

script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

# 1. Color override
got=$(C_MODEL=99 bash -c 'source "'"$script"'"; echo "$C_MODEL"')
check "C_MODEL overridden to 99" "99" "$got"

# 2. Default preserved when unset
got=$(bash -c 'unset C_MODEL; source "'"$script"'"; echo "$C_MODEL"')
check "C_MODEL defaults to 213" "213" "$got"

# 3. Glyph override
got=$(GLYPH_PENCIL=X bash -c 'source "'"$script"'"; echo "$GLYPH_PENCIL"')
check "GLYPH_PENCIL overridden to X" "X" "$got"

# 4. Window duration override
got=$(WINDOW_5H_SECONDS=9999 bash -c 'source "'"$script"'"; echo "$WINDOW_5H_SECONDS"')
check "WINDOW_5H_SECONDS overridden to 9999" "9999" "$got"

# 5. Threshold override changes zone_color
got=$(THRESHOLD_WARNING=40 THRESHOLD_CRITICAL=70 bash -c '
    source "'"$script"'"
    echo "$(zone_color 30) $(zone_color 50) $(zone_color 80)"
')
check "custom thresholds: 30=green 50=yellow 80=red" "76 220 196" "$got"

# 6. Default thresholds unchanged
got=$(bash -c '
    unset THRESHOLD_WARNING THRESHOLD_CRITICAL
    source "'"$script"'"
    echo "$THRESHOLD_WARNING $THRESHOLD_CRITICAL"
')
check "default thresholds 60 90" "60 90" "$got"

# 7. C_SEP override
got=$(C_SEP=123 bash -c 'source "'"$script"'"; echo "$C_SEP"')
check "C_SEP overridden to 123" "123" "$got"

# 8. C_EFFORT_HI override
got=$(C_EFFORT_HI=111 bash -c 'source "'"$script"'"; echo "$C_EFFORT_HI"')
check "C_EFFORT_HI overridden to 111" "111" "$got"

if (( fail == 0 )); then echo "PASS: config override"; exit 0
else echo "FAIL: config override"; exit 1; fi
