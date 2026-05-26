#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# Normal mode
out=$(identity_row \
    model="Opus 4.7" \
    effort=high \
    owner=henryavila repo=arch \
    worktree=filament-v4-migration \
    branch=feature/filament-v4-migration \
    dirty_count=3 \
    pr_number=1234 pr_state=pending \
    agent="")

want_substrings=("Opus 4.7" "HIGH" "henryavila/arch" "⎇" "feature/filament-v4-migration" " 3" "#1234")
for s in "${want_substrings[@]}"; do
    if [[ "$out" != *"$s"* ]]; then
        echo "  FAIL: normal identity_row missing '$s'"; fail=1
    fi
done
(( fail == 0 )) && echo "  ok: normal identity row contains all expected segments"

# Agent active mode
out=$(identity_row \
    model="Opus 4.7" \
    effort=high \
    owner=henryavila repo=arch \
    worktree=filament-v4-migration \
    branch=feature/filament-v4-migration \
    dirty_count=3 \
    pr_number=1234 pr_state=pending \
    agent="Explore")

if [[ "$out" == *"agent:Explore"* && "$out" != *"HIGH"* ]]; then
    echo "  ok: agent mode replaces effort with agent name"
else
    echo "  FAIL: agent mode should hide HIGH chip"; fail=1
fi

# Missing PR
out=$(identity_row model="Opus" effort=high owner=h repo=r \
    worktree= branch=main dirty_count=0 pr_number= pr_state= agent="")
if [[ "$out" != *"#"* ]]; then
    echo "  ok: missing PR hides chip"
else
    echo "  FAIL: missing PR should not render '#'"; fail=1
fi

# Missing effort
out=$(identity_row model="Opus" effort="" owner=h repo=r \
    worktree= branch=main dirty_count=0 pr_number= pr_state= agent="")
if [[ "$out" != *"HIGH"* && "$out" != *"MED"* && "$out" != *"MAX"* ]]; then
    echo "  ok: missing effort hides chip"
else
    echo "  FAIL: missing effort should not render any effort label"; fail=1
fi

(( fail == 0 )) && { echo "PASS: identity_row"; exit 0; } || { echo "FAIL: identity_row"; exit 1; }
