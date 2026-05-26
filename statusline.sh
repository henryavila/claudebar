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
readonly C_TMUX=105
readonly C_SEP=238

# ─── Nerd Font glyphs (Private Use Area, U+E000-F8FF) ─────────────────
# Constructed from UTF-8 byte escapes (NOT literal chars) — Private Use
# Area chars get silently stripped by some editors/transports that normalize
# Unicode. Keeping the source ASCII-only insulates against that whole class
# of bug. Bash reconstructs the multibyte sequence at runtime.
#
# Glyph names and codepoints:
#   GLYPH_PENCIL  U+F040  nf-fa-pencil           — dirty file indicator
#   GLYPH_GIT     U+E725  devicons-git-branch    — branch label
#   GLYPH_PR      U+F407  nf-fa-code-pull-req    — PR chip
#   GLYPH_TMUX    U+F1B2  nf-fa-cube             — tmux session chip
#   GLYPH_GEAR    U+F085  nf-fa-cogs             — agent-active chip
readonly GLYPH_PENCIL=$'\xef\x81\x80'
readonly GLYPH_GIT=$'\xee\x9c\xa5'
readonly GLYPH_PR=$'\xef\x90\x87'
readonly GLYPH_TMUX=$'\xef\x86\xb2'
readonly GLYPH_GEAR=$'\xef\x82\x85'

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

# ─── now_epoch — current Unix timestamp, overridable for deterministic tests
# Returns $CLAUDEBAR_NOW_FOR_TESTING if it's a positive integer; otherwise
# defaults to `date +%s`. Empty / non-numeric override falls back defensively
# so a typo in test setup never poisons real renders.
now_epoch() {
    local v=${CLAUDEBAR_NOW_FOR_TESTING:-}
    if [[ "$v" =~ ^[0-9]+$ ]]; then
        printf '%s' "$v"
        return
    fi
    date +%s
}

# ─── format_countdown SECONDS — magnitude-aware time-until string ──────
# Returns a 3-6 char ASCII string:
#   s < 60                 → "now"
#   60 ≤ s < 86400         → "XhYYm"   (X may be 0; minutes zero-padded)
#   86400 ≤ s ≤ 2592000    → "XdYYh"   (hours zero-padded)
#   s > 2592000            → "30d+"    (defensive cap)
format_countdown() {
    local s=$1
    if (( s < 60 )); then
        printf 'now'
        return
    fi
    if (( s > 2592000 )); then
        printf '30d+'
        return
    fi
    if (( s >= 86400 )); then
        printf '%dd%02dh' "$(( s / 86400 ))" "$(( (s % 86400) / 3600 ))"
        return
    fi
    printf '%dh%02dm' "$(( s / 3600 ))" "$(( (s % 3600) / 60 ))"
}

# ─── pip_bar PCT [MARKER_POS] — render 10-pip zone-colored bar ────────
# When MARKER_POS is a number in [0..10], a dim │ is inserted at that slot
# (0 = before pip 0, N = between pip N-1 and pip N, 10 = after pip 9).
# Used by the time-elapsed marker on the 5h/7d chips: when the fill edge
# and the marker disagree, the chip visually communicates "you're burning
# faster than the window allows" (pipe inside fill) or "you have margin"
# (pipe past the fill edge). Empty/unset marker preserves the 10-char
# legacy render.
pip_bar() {
    local pct=$1
    local marker=${2:-}
    local color filled i
    color=$(zone_color "$pct")
    filled=$(( pct * 10 / 100 ))
    (( filled > 10 )) && filled=10
    (( filled < 0 ))  && filled=0

    # Normalize / clamp marker to [0, 10] when numeric; treat anything else
    # (empty, negative-string, non-digit) as "no marker".
    local marker_active=0
    if [[ "$marker" =~ ^-?[0-9]+$ ]]; then
        marker_active=1
        (( marker < 0 ))  && marker=0
        (( marker > 10 )) && marker=10
    fi

    for ((i=0; i<10; i++)); do
        if (( marker_active && marker == i )); then
            fg "$C_REPO" "│"
        fi
        if (( i < filled )); then
            fg "$color" "▰"
        else
            fg "$C_BAR_DIM" "▱"
        fi
    done
    if (( marker_active && marker == 10 )); then
        fg "$C_REPO" "│"
    fi
}

# ─── tmux_chip — show tmux session:window.pane when inside tmux ────────
# Reads $TMUX (set by tmux server) + queries tmux for display info.
# Returns empty when not in tmux or tmux command fails.
# Uses GLYPH_TMUX (declared at top).
# Format: " tmux:session:window.pane" — explicit "tmux:" prefix prevents
# visual confusion when the tmux session name coincides with the repo
# name (e.g. session "arch" + repo "henryavila/arch" → without prefix
# the chip just reads "arch:1.1" which can be mistaken for another chip).
tmux_chip() {
    [[ -z "${TMUX:-}" ]] && return 0
    have tmux || return 0
    local context
    context=$(tmux display-message -p '#S:#I.#P' 2>/dev/null) || return 0
    [[ -z "$context" ]] && return 0
    fg "$C_TMUX" "${GLYPH_TMUX} tmux:${context}"
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
# Uses GLYPH_PR (declared at top).
pr_chip() {
    local number=$1 state=$2
    case "$state" in
        pending)           fg "$C_PR_PENDING"  "${GLYPH_PR} #${number} ⏳" ;;
        approved)          fg "$C_PR_APPROVED" "${GLYPH_PR} #${number} ✓" ;;
        changes_requested) fg "$C_PR_CHANGES"  "${GLYPH_PR} #${number} ✗" ;;
        draft)             fg "$C_PR_DRAFT"    "${GLYPH_PR} #${number} ◯" ;;
        "")                fg "$C_PR_PENDING"  "${GLYPH_PR} #${number}" ;;
        *)                 fg "$C_PR_PENDING"  "${GLYPH_PR} #${number}" ;;
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

# ─── dirty_indicator N — pencil + count when dirty, ✓ when clean ─────
# Uses GLYPH_PENCIL (declared at top). Space between glyph and count is
# intentional — defensive separation in case some terminal renders the
# glyph at >1 cell width.
dirty_indicator() {
    local count=$1
    if [[ -z "$count" ]]; then
        return 0  # not a git repo → nothing
    fi
    if (( count > 0 )); then
        fg "$C_DIRTY" "${GLYPH_PENCIL} ${count}"
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
    local wt_glyph=$'\xe2\x8e\x87'   # U+2387 ⎇ alternative-key — NOT private use, but kept as bytes for consistency

    # ── Left group: model + (effort | agent) ─────────────
    if [[ -n "$agent" ]]; then
        fg "$C_MODEL_DIM" "${sparkle} ${model}"
        printf ' '
        sep "·"
        printf ' '
        # Agent chip uses GEAR (cogs), distinct from git branch glyph
        fg "$C_AGENT" "${GLYPH_GEAR} agent:${agent}"
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

    # ── Tmux chip (only when running inside tmux) ──────────
    local tmux_out
    tmux_out=$(tmux_chip)
    if [[ -n "$tmux_out" ]]; then
        printf ' '
        sep "·"
        printf ' '
        printf '%s' "$tmux_out"
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
            fg "$C_BRANCH" "${GLYPH_GIT} ${branch}"
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

# ─── fuel_row — compose row 2 (the 3 bars) ────────────────────────────
# Usage: fuel_row key=value key=value ...
# Keys: ctx five_hour seven_day
fuel_row() {
    local ctx="" five_hour="" seven_day=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            ctx=*)        ctx=${arg#ctx=} ;;
            five_hour=*)  five_hour=${arg#five_hour=} ;;
            seven_day=*)  seven_day=${arg#seven_day=} ;;
        esac
    done

    # ctx — always render even if 0
    : "${ctx:=0}"
    fg "$C_REPO" "ctx"; printf ' '
    pip_bar "$ctx"
    printf ' '
    fg "$(zone_color "$ctx")" "$(printf '%2d%%' "$ctx")"

    # 5h
    if [[ -n "$five_hour" ]]; then
        printf '   '
        fg "$C_REPO" "5h"; printf '  '
        pip_bar "$five_hour"
        printf ' '
        fg "$(zone_color "$five_hour")" "$(printf '%2d%%' "$five_hour")"
    fi

    # 7d
    if [[ -n "$seven_day" ]]; then
        printf '   '
        fg "$C_REPO" "7d"; printf '  '
        pip_bar "$seven_day"
        printf ' '
        fg "$(zone_color "$seven_day")" "$(printf '%2d%%' "$seven_day")"
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
    # Dependency probe
    if ! have jq; then
        minimal_fallback
        return 0
    fi

    local input jq_out
    input=$(cat)

    # Parse once with jq — emit shell-safe assignments via @sh, then eval them.
    # Each field uses // "" fallback so absent fields → empty bash vars.
    jq_out=$(printf '%s' "$input" | jq -r '
        "MODEL="      + ((.model.display_name // .model.id // "?") | @sh) + "\n" +
        "SESSION_ID=" + ((.session_id // "default") | @sh) + "\n" +
        "EFFORT="     + ((.effort.level // "") | @sh) + "\n" +
        "OWNER="      + ((.workspace.repo.owner // "") | @sh) + "\n" +
        "REPO="       + ((.workspace.repo.name // "") | @sh) + "\n" +
        "WORKTREE="   + ((.workspace.git_worktree // "") | @sh) + "\n" +
        "CTX="        + ((.context_window.used_percentage // 0 | floor) | tostring | @sh) + "\n" +
        "FIVE_HOUR="  + ((.rate_limits.five_hour.used_percentage // "") | tostring | @sh) + "\n" +
        "SEVEN_DAY="  + ((.rate_limits.seven_day.used_percentage // "") | tostring | @sh) + "\n" +
        "PR_NUMBER="  + ((.pr.number // "") | tostring | @sh) + "\n" +
        "PR_STATE="   + ((.pr.review_state // "") | @sh) + "\n" +
        "AGENT="      + ((.agent.name // "") | @sh)
    ')
    eval "$jq_out"

    # Derive branch (not in JSON for normal sessions — git is source of truth)
    local BRANCH=""
    if have git && git rev-parse --git-dir >/dev/null 2>&1; then
        BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    fi

    # Derive dirty count
    local DIRTY=""
    if have git && git rev-parse --git-dir >/dev/null 2>&1; then
        DIRTY=$(dirty_count "$SESSION_ID")
    fi

    # Cast FIVE_HOUR / SEVEN_DAY (jq emits floats like "23.5") to int
    [[ -n "$FIVE_HOUR" ]] && FIVE_HOUR=$(printf '%.0f' "$FIVE_HOUR")
    [[ -n "$SEVEN_DAY" ]] && SEVEN_DAY=$(printf '%.0f' "$SEVEN_DAY")

    # Render
    identity_row \
        model="$MODEL" \
        effort="$EFFORT" \
        owner="$OWNER" repo="$REPO" \
        worktree="$WORKTREE" \
        branch="$BRANCH" \
        dirty_count="$DIRTY" \
        pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
        agent="$AGENT"

    fuel_row \
        ctx="$CTX" \
        five_hour="$FIVE_HOUR" \
        seven_day="$SEVEN_DAY"
}

# Sourcing guard: only run main when invoked directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
