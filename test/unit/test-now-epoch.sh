#!/usr/bin/env bash
# Unit test for now_epoch helper.
# Validates CLAUDEBAR_NOW_FOR_TESTING override + defensive fallbacks.
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# ── 1. No override → returns within 2s of date +%s ─────────────────────
unset CLAUDEBAR_NOW_FOR_TESTING
real=$(date +%s)
got=$(now_epoch)
diff=$(( got - real ))
(( diff < 0 )) && diff=$(( -diff ))
if (( diff <= 2 )); then
    echo "  ok: no override → now_epoch=$got within 2s of date +%s=$real"
else
    echo "  FAIL: no override → diff $diff > 2s (got $got, real $real)"
    fail=1
fi

# ── 2. Numeric override → returns the override ─────────────────────────
export CLAUDEBAR_NOW_FOR_TESTING=12345
got=$(now_epoch)
if [[ "$got" == "12345" ]]; then
    echo "  ok: numeric override → $got"
else
    echo "  FAIL: numeric override expected '12345' got '$got'"
    fail=1
fi

# ── 3. Empty override → fallback to date +%s ───────────────────────────
export CLAUDEBAR_NOW_FOR_TESTING=
real=$(date +%s)
got=$(now_epoch)
diff=$(( got - real ))
(( diff < 0 )) && diff=$(( -diff ))
if (( diff <= 2 )); then
    echo "  ok: empty override → fell back to date +%s=$got"
else
    echo "  FAIL: empty override expected ~$real got '$got'"
    fail=1
fi

# ── 4. Non-numeric override → fallback to date +%s ─────────────────────
export CLAUDEBAR_NOW_FOR_TESTING=abc
real=$(date +%s)
got=$(now_epoch)
diff=$(( got - real ))
(( diff < 0 )) && diff=$(( -diff ))
if (( diff <= 2 )); then
    echo "  ok: non-numeric override → fell back to date +%s=$got"
else
    echo "  FAIL: non-numeric override expected ~$real got '$got'"
    fail=1
fi

unset CLAUDEBAR_NOW_FOR_TESTING

if (( fail == 0 )); then
    echo "PASS: now_epoch"
    exit 0
else
    echo "FAIL: now_epoch"
    exit 1
fi
