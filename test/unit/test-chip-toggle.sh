#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

fail=0

run_fn() {
    local env_str=$1; shift
    local fn=$1; shift
    env $env_str bash -c "source '$script'; $fn $*" 2>/dev/null
}

# CHIP_PR=0 hides PR chip
out=$(run_fn "CHIP_PR=0" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number=42 pr_state=pending agent=""')
if [[ "$out" != *"#42"* ]]; then echo "  ok: CHIP_PR=0 hides PR"
else echo "  FAIL: CHIP_PR=0 should hide #42"; fail=1; fi

# CHIP_PR=1 (default) shows PR chip
out=$(run_fn "" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number=42 pr_state=pending agent=""')
if [[ "$out" == *"#42"* ]]; then echo "  ok: CHIP_PR=1 shows PR"
else echo "  FAIL: default CHIP_PR should show #42"; fail=1; fi

# CHIP_EFFORT=0 hides effort
out=$(run_fn "CHIP_EFFORT=0" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"HIGH"* ]]; then echo "  ok: CHIP_EFFORT=0 hides effort"
else echo "  FAIL: CHIP_EFFORT=0 should hide HIGH"; fail=1; fi

# CHIP_MODEL=0 hides model name
out=$(run_fn "CHIP_MODEL=0" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"Opus"* ]]; then echo "  ok: CHIP_MODEL=0 hides model"
else echo "  FAIL: CHIP_MODEL=0 should hide Opus"; fail=1; fi

# CHIP_REPO=0 hides repo
out=$(run_fn "CHIP_REPO=0" identity_row \
    'model="Opus 4.7" effort=high owner=henryavila repo=arch worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"henryavila/arch"* ]]; then echo "  ok: CHIP_REPO=0 hides repo"
else echo "  FAIL: CHIP_REPO=0 should hide repo"; fail=1; fi

# CHIP_BRANCH=0 hides branch
out=$(run_fn "CHIP_BRANCH=0" identity_row \
    'model="Opus 4.7" effort= owner=h repo=r worktree= branch=feat-x dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"feat-x"* ]]; then echo "  ok: CHIP_BRANCH=0 hides branch"
else echo "  FAIL: CHIP_BRANCH=0 should hide branch"; fail=1; fi

# CHIP_DIRTY=0 hides dirty count — check for pencil glyph (U+F040)
out=$(run_fn "CHIP_DIRTY=0" identity_row \
    'model="Opus 4.7" effort= owner=h repo=r worktree= branch=main dirty_count=5 pr_number= pr_state= agent=""')
pencil=$'\xef\x81\x80'
if [[ "$out" != *"$pencil"* ]]; then echo "  ok: CHIP_DIRTY=0 hides dirty"
else echo "  FAIL: CHIP_DIRTY=0 should hide pencil glyph"; fail=1; fi

# CHIP_CTX_BAR=0 hides context bar
out=$(run_fn "CHIP_CTX_BAR=0" fuel_row \
    'ctx=50 five_hour=30 seven_day=20 five_hour_resets_at= seven_day_resets_at=')
if [[ "$out" != *"ctx"* ]]; then echo "  ok: CHIP_CTX_BAR=0 hides ctx"
else echo "  FAIL: CHIP_CTX_BAR=0 should hide ctx label"; fail=1; fi

if (( fail == 0 )); then echo "PASS: chip toggle"; exit 0
else echo "FAIL: chip toggle"; exit 1; fi
