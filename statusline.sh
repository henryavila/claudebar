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

# ─── pip_bar PCT — render 10-pip zone-colored bar ─────────────────────
pip_bar() {
    local pct=$1
    local color filled empty i
    color=$(zone_color "$pct")
    filled=$(( pct * 10 / 100 ))
    (( filled > 10 )) && filled=10
    (( filled < 0 ))  && filled=0
    empty=$(( 10 - filled ))
    for ((i=0; i<filled; i++)); do fg "$color" "▰"; done
    for ((i=0; i<empty;  i++)); do fg "$C_BAR_DIM" "▱"; done
}

# ─── effort_chip LEVEL — colored text chip per effort level ────────────
effort_chip() {
    local level=$1
    case "$level" in
        low)    fg "$C_EFFORT_LOW" "LOW" ;;
        medium) fg "$C_EFFORT_MED" "MED" ;;
        high)   fg "$C_EFFORT_HI"  "HIGH" ;;
        xhigh)  fg "$C_EFFORT_XHI" "XHIGH" ;;
        max)    fg "$C_EFFORT_MAX" "MAX" ;;
        *)      : ;;  # absent or unknown → empty
    esac
}

# ─── pr_chip NUMBER STATE — colored PR chip with state glyph ───────────
# Glyph: nf-fa-code-pull-request (U+F407) ""
pr_chip() {
    local number=$1 state=$2
    local pr_glyph=$''
    case "$state" in
        pending)           fg "$C_PR_PENDING"  "${pr_glyph} #${number} ⏳" ;;
        approved)          fg "$C_PR_APPROVED" "${pr_glyph} #${number} ✓" ;;
        changes_requested) fg "$C_PR_CHANGES"  "${pr_glyph} #${number} ✗" ;;
        draft)             fg "$C_PR_DRAFT"    "${pr_glyph} #${number} ◯" ;;
        "")                fg "$C_PR_PENDING"  "${pr_glyph} #${number}" ;;
        *)                 fg "$C_PR_PENDING"  "${pr_glyph} #${number}" ;;
    esac
}

# ─── Portable stat-mtime ──────────────────────────────────────────────
file_mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

# ─── dirty_count SESSION_ID — git porcelain count, cached 5s ──────────
# Returns: integer count of dirty files, or empty string if not in a git repo.
dirty_count() {
    local session_id=${1:-default}
    local cache="/tmp/statusline-git-${session_id}"
    local now mtime age
    now=$(date +%s)

    if [[ -f "$cache" ]]; then
        mtime=$(file_mtime "$cache")
        age=$(( now - mtime ))
        if (( age < 5 )); then
            cat "$cache"
            return 0
        fi
    fi

    # Cache stale or missing → regenerate
    if ! have git || ! git rev-parse --git-dir >/dev/null 2>&1; then
        echo "" > "$cache"
        cat "$cache"
        return 0
    fi
    git status --porcelain 2>/dev/null | wc -l | tr -d ' ' > "$cache"
    cat "$cache"
}

# ─── dirty_indicator N — render "✎N" or "✓" ───────────────────────────
dirty_indicator() {
    local count=$1
    if [[ -z "$count" ]]; then
        return 0  # not a git repo → nothing
    fi
    if (( count > 0 )); then
        fg "$C_DIRTY" "✎${count}"
    else
        fg "$C_CLEAN" "✓"
    fi
}

# ─── identity_row — compose row 1 ─────────────────────────────────────
# Usage: identity_row key=value key=value ...
# Keys: model effort owner repo worktree branch dirty_count
#       pr_number pr_state agent
identity_row() {
    local model="" effort="" owner="" repo=""
    local worktree="" branch="" dirty_count=""
    local pr_number="" pr_state="" agent=""

    local arg
    for arg in "$@"; do
        case "$arg" in
            model=*)        model=${arg#model=} ;;
            effort=*)       effort=${arg#effort=} ;;
            owner=*)        owner=${arg#owner=} ;;
            repo=*)         repo=${arg#repo=} ;;
            worktree=*)     worktree=${arg#worktree=} ;;
            branch=*)       branch=${arg#branch=} ;;
            dirty_count=*)  dirty_count=${arg#dirty_count=} ;;
            pr_number=*)    pr_number=${arg#pr_number=} ;;
            pr_state=*)     pr_state=${arg#pr_state=} ;;
            agent=*)        agent=${arg#agent=} ;;
        esac
    done

    local sparkle="✦"
    local git_glyph=$''   # nf-fa-code-fork
    local wt_glyph=$'⎇'

    # ── Left group: model + (effort | agent) ─────────────
    if [[ -n "$agent" ]]; then
        fg "$C_MODEL_DIM" "${sparkle} ${model}"
        printf ' '
        sep "·"
        printf ' '
        fg "$C_AGENT" "${git_glyph} agent:${agent}"
        printf '%s[5m' "$esc"  # blink on
        fg "$C_AGENT" " ●"
        printf '%s[25m' "$esc"  # blink off
    else
        fg "$C_MODEL" "${sparkle} ${model}"
        if [[ -n "$effort" ]]; then
            printf ' '
            sep "·"
            printf ' '
            effort_chip "$effort"
        fi
    fi

    # ── Middle group: repo › [⎇ ]branch dirty ────────────
    if [[ -n "$owner" && -n "$repo" ]]; then
        printf '  '
        fg "$C_REPO" "${owner}/${repo}"
        printf ' '
        sep "›"
        printf ' '
        if [[ -n "$worktree" ]]; then
            fg "$C_WORKTREE" "${wt_glyph} "
        fi
        if [[ -n "$branch" ]]; then
            fg "$C_BRANCH" "${git_glyph} ${branch}"
        fi
        if [[ -n "$dirty_count" ]]; then
            printf ' '
            dirty_indicator "$dirty_count"
        fi
    fi

    # ── Right group: PR chip ─────────────────────────────
    if [[ -n "$pr_number" ]]; then
        printf '   '
        pr_chip "$pr_number" "$pr_state"
    fi

    printf '\n'
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
