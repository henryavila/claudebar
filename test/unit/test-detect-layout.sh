#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local desc=$1 want=$2
    local got
    got=$(detect_layout)
    if [[ "$got" == "$want" ]]; then
        echo "  ok: $desc → $got"
    else
        echo "  FAIL: $desc expected=$want got=$got"
        fail=1
    fi
}

# 1. CLAUDEBAR_LAYOUT override (highest priority)
CLAUDEBAR_LAYOUT=compact MOSHI_CLIENT='' COLUMNS=200 check "CLAUDEBAR_LAYOUT=compact overrides wide terminal" compact
CLAUDEBAR_LAYOUT=full MOSHI_CLIENT=1 COLUMNS=30 check "CLAUDEBAR_LAYOUT=full overrides MOSHI+narrow" full

# 2. MOSHI_CLIENT detection
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT=1 COLUMNS=200 check "MOSHI_CLIENT=1 on wide terminal" compact
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT=0 COLUMNS=200 check "MOSHI_CLIENT=0 is not a trigger" full

# 3. COLUMNS detection
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=45 check "COLUMNS=45 → compact" compact
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=59 check "COLUMNS=59 → compact" compact
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=60 check "COLUMNS=60 → full" full
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=100 check "COLUMNS=100 → full" full

# 4. Default (wide terminal)
CLAUDEBAR_LAYOUT='' MOSHI_CLIENT='' COLUMNS=80 check "default wide → full" full

if (( fail == 0 )); then echo "PASS: detect_layout"; exit 0
else echo "FAIL: detect_layout"; exit 1; fi
