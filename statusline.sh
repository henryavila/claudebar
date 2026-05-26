#!/usr/bin/env bash
# Claude Code statusline — see DESIGN.md
set -uo pipefail

# ─── Dependency probe ─────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

# ─── Palette (256-color codes from DESIGN.md) ─────────────────────────
readonly C_MODEL=213
readonly C_MODEL_DIM=240
readonly C_EFFORT_LOW=76
readonly C_EFFORT_MED=39
readonly C_EFFORT_HI=220
readonly C_EFFORT_XHI=208
readonly C_EFFORT_MAX=197
readonly C_REPO=245
readonly C_WORKTREE=147
readonly C_BRANCH=76
readonly C_DIRTY=178
readonly C_CLEAN=82
readonly C_PR_PENDING=220
readonly C_PR_APPROVED=82
readonly C_PR_CHANGES=196
readonly C_PR_DRAFT=240
readonly C_BAR_GREEN=76
readonly C_BAR_YELLOW=220
readonly C_BAR_RED=196
readonly C_BAR_DIM=238
readonly C_AGENT=141
readonly C_SEP=238

# ─── ANSI helpers ──────────────────────────────────────────────────────
esc=$'\033'
fg() { printf '%s[38;5;%dm%s%s[0m' "$esc" "$1" "$2" "$esc"; }
sep() { printf '%s[38;5;%dm%s%s[0m' "$esc" "$C_SEP" "$1" "$esc"; }

# ─── Zone color: <60 green, 60-89 yellow, >=90 red ────────────────────
zone_color() {
    local pct=$1
    if   (( pct >= 90 )); then echo "$C_BAR_RED"
    elif (( pct >= 60 )); then echo "$C_BAR_YELLOW"
    else                       echo "$C_BAR_GREEN"
    fi
}

minimal_fallback() {
    # Read stdin with grep (no jq) to extract just the model name
    local input model dir
    input=$(cat)
    model=$(printf '%s' "$input" | grep -o '"display_name":"[^"]*"' | head -1 | cut -d'"' -f4)
    dir=$(printf '%s' "$input" | grep -o '"current_dir":"[^"]*"' | head -1 | cut -d'"' -f4)
    : "${model:=?}"
    : "${dir:=?}"
    echo "[$model] ${dir##*/}"
}

main() {
    if ! have jq; then
        minimal_fallback
        return 0
    fi
    # Full implementation comes in later tasks
    cat > /dev/null
    echo "TODO: implement statusline (jq present)"
}

# Sourcing guard: only run main when invoked directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
