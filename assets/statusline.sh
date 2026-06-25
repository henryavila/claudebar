#!/usr/bin/env bash
# Claude Code statusline — see DESIGN.md
set -uo pipefail

# Force a C decimal separator (period). macOS bash 3.2's `printf '%.0f'` parses
# floats through LC_NUMERIC; under a comma-decimal locale (pt_BR, de_DE, …) it
# rejects the period-decimal percentages jq emits ("invalid number") and falls
# back to 0 — so a real 23% five_hour/seven_day rendered as 0%. Set only
# LC_NUMERIC (not LC_ALL) so LC_CTYPE stays intact and UTF-8 glyphs keep working.
export LC_NUMERIC=C

# ─── Dependency probe ─────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

# ─── Config loading ──────────────────────────────────────────────────
# Use dirname directly (avoids subshell cd+pwd overhead). Works correctly
# for both symlink-resolved and direct paths since the installed copy
# and config.toml always live in the same directory.
_CB_SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[[ "$_CB_SCRIPT_DIR" == "${BASH_SOURCE[0]}" ]] && _CB_SCRIPT_DIR="."
_CB_CONFIG_TOML="$_CB_SCRIPT_DIR/config.toml"
# The auto-updater drops the latest available version here for the update chip.
# Overridable for tests; defaults to the install dir alongside this script.
_CB_UPDATE_FILE="${CLAUDEBAR_UPDATE_FILE:-$_CB_SCRIPT_DIR/.update-available}"
# The installed version (written by install/update). update_chip compares it
# against .update-available so a notification that's already been satisfied does
# not linger as a phantom alert. Overridable for tests.
_CB_VERSION_FILE="${CLAUDEBAR_VERSION_FILE:-$_CB_SCRIPT_DIR/.version}"
# GLM quota cache (Option C). Overridable for tests; defaults to a sibling of
# this script (the install dir, ~/.config/claudebar/).
_CB_QUOTA_CACHE="${CLAUDEBAR_QUOTA_CACHE:-$_CB_SCRIPT_DIR/quota-cache.json}"

if [[ -f "$_CB_CONFIG_TOML" ]]; then
    _CB_CONFIG_SH="$_CB_SCRIPT_DIR/config.sh"
    if [[ ! -f "$_CB_CONFIG_SH" ]] || [[ "$_CB_CONFIG_TOML" -nt "$_CB_CONFIG_SH" ]]; then
        source "$_CB_SCRIPT_DIR/toml-parser.sh"
        compile_config "$_CB_CONFIG_TOML" > "$_CB_CONFIG_SH"
    fi
    source "$_CB_CONFIG_SH"
fi

# ─── Palette (256-color codes from DESIGN.md) ─────────────────────────
readonly C_MODEL=${C_MODEL:-213}
readonly C_MODEL_DIM=${C_MODEL_DIM:-240}
readonly C_EFFORT_LOW=${C_EFFORT_LOW:-76}
readonly C_EFFORT_MED=${C_EFFORT_MED:-39}
readonly C_EFFORT_HI=${C_EFFORT_HI:-220}
readonly C_EFFORT_XHI=${C_EFFORT_XHI:-208}
readonly C_EFFORT_MAX=${C_EFFORT_MAX:-197}
readonly C_REPO=${C_REPO:-245}
readonly C_WORKTREE=${C_WORKTREE:-147}
readonly C_BRANCH=${C_BRANCH:-76}
readonly C_DIRTY=${C_DIRTY:-178}
readonly C_CLEAN=${C_CLEAN:-82}
readonly C_PR_PENDING=${C_PR_PENDING:-220}
readonly C_PR_APPROVED=${C_PR_APPROVED:-82}
readonly C_PR_CHANGES=${C_PR_CHANGES:-196}
readonly C_PR_DRAFT=${C_PR_DRAFT:-240}
readonly C_BAR_GREEN=${C_BAR_GREEN:-76}
readonly C_BAR_YELLOW=${C_BAR_YELLOW:-220}
readonly C_BAR_RED=${C_BAR_RED:-196}
readonly C_BAR_DIM=${C_BAR_DIM:-238}
readonly C_AGENT=${C_AGENT:-141}
readonly C_TMUX=${C_TMUX:-105}
readonly C_SEP=${C_SEP:-238}
readonly C_UPDATE=${C_UPDATE:-220}
readonly C_PROJECT=${C_PROJECT:-39}
readonly C_PROJECT_STALE=${C_PROJECT_STALE:-244}
readonly C_PROJECT_BLOCKED=${C_PROJECT_BLOCKED:-220}

# ─── Quota window durations (seconds) — used by the time-elapsed marker ─
# Anthropic's rate-limit windows are nominally 5 hours and 7 days. We pin
# the durations here so the marker position is deterministic; the exact
# rolling-window semantics aren't public but a fixed denominator is a good
# enough approximation for "am I burning faster than time?" reading.
readonly WINDOW_5H_SECONDS=${WINDOW_5H_SECONDS:-18000}
readonly WINDOW_7D_SECONDS=${WINDOW_7D_SECONDS:-604800}

# ─── Zone thresholds (percentage) — configurable via config.toml ──────
readonly THRESHOLD_WARNING=${THRESHOLD_WARNING:-60}
readonly THRESHOLD_CRITICAL=${THRESHOLD_CRITICAL:-90}

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
#   GLYPH_FOLDER  U+F07B  nf-fa-folder           — non-git path fallback
readonly GLYPH_PENCIL=${GLYPH_PENCIL:-$'\xef\x81\x80'}
readonly GLYPH_GIT=${GLYPH_GIT:-$'\xee\x9c\xa5'}
readonly GLYPH_PR=${GLYPH_PR:-$'\xef\x90\x87'}
readonly GLYPH_TMUX=${GLYPH_TMUX:-$'\xef\x86\xb2'}
readonly GLYPH_GEAR=${GLYPH_GEAR:-$'\xef\x82\x85'}
readonly GLYPH_FOLDER=${GLYPH_FOLDER:-$'\xef\x81\xbb'}
# GLYPH_UPDATE U+2B06 (upwards arrow) — "update available" chip. Not a Private
# Use Area glyph, so a literal byte sequence is safe here.
readonly GLYPH_UPDATE=${GLYPH_UPDATE:-$'\xe2\xac\x86'}
# GLYPH_PROJECT U+F192 nf-fa-dot-circle-o — atomic-skills focus chip leader (a
# filled target = "focus", in the same Font Awesome family as the other chips).
# GLYPH_DRIFT U+2301 ⌁ — completion-drift marker on the same chip.
# GLYPH_MULTIPLAN U+F0C5 nf-fa-clone — "more than one active plan" marker (the
# chip shows one of several). Kept as UTF-8 byte sequences for transport safety,
# same rationale as the other glyphs.
readonly GLYPH_PROJECT=${GLYPH_PROJECT:-$'\xef\x86\x92'}
readonly GLYPH_DRIFT=${GLYPH_DRIFT:-$'\xe2\x8c\x81'}
readonly GLYPH_MULTIPLAN=${GLYPH_MULTIPLAN:-$'\xef\x83\x85'}

# ─── Chip toggle defaults ────────────────────────────────────────────
readonly CHIP_MODEL=${CHIP_MODEL:-1}
readonly CHIP_EFFORT=${CHIP_EFFORT:-1}
readonly CHIP_TMUX=${CHIP_TMUX:-1}
readonly CHIP_REPO=${CHIP_REPO:-1}
readonly CHIP_BRANCH=${CHIP_BRANCH:-1}
readonly CHIP_WORKTREE=${CHIP_WORKTREE:-1}
readonly CHIP_DIRTY=${CHIP_DIRTY:-1}
readonly CHIP_PR=${CHIP_PR:-1}
readonly CHIP_AGENT=${CHIP_AGENT:-1}
readonly CHIP_CTX_BAR=${CHIP_CTX_BAR:-1}
readonly CHIP_FIVE_HOUR_BAR=${CHIP_FIVE_HOUR_BAR:-1}
readonly CHIP_SEVEN_DAY_BAR=${CHIP_SEVEN_DAY_BAR:-1}
readonly CHIP_COUNTDOWN=${CHIP_COUNTDOWN:-1}
readonly CHIP_TIME_MARKER=${CHIP_TIME_MARKER:-1}
readonly CHIP_UPDATE=${CHIP_UPDATE:-1}
readonly CHIP_PROJECT=${CHIP_PROJECT:-1}

# ─── GLM quota polling (Option C) — only active on a GLM endpoint ─────
# When Claude Code is pointed at api.z.ai / open.bigmodel.cn, the 5-hour token
# quota is polled from the Z.ai monitor API and cached (quota-cache.json, a
# sibling of this script). QUOTA_ENABLED is the master switch; the interval is
# the cache TTL in minutes (clamped to a 1-min floor by the fetcher). Ignored
# entirely on non-GLM setups — the env gate in _glm_active short-circuits first.
readonly QUOTA_ENABLED=${QUOTA_ENABLED:-1}
readonly QUOTA_REFRESH_INTERVAL_MINUTES=${QUOTA_REFRESH_INTERVAL_MINUTES:-5}

# ─── ANSI helpers ──────────────────────────────────────────────────────
esc=$'\033'
fg() { printf '%s[38;5;%dm%s%s[0m' "$esc" "$1" "$2" "$esc"; }
sep() { printf '%s[38;5;%dm%s%s[0m' "$esc" "$C_SEP" "$1" "$esc"; }

# ─── Zone color: <60 green, 60-89 yellow, >=90 red ────────────────────
zone_color() {
    local pct=$1
    if   (( pct >= THRESHOLD_CRITICAL )); then echo "$C_BAR_RED"
    elif (( pct >= THRESHOLD_WARNING ));  then echo "$C_BAR_YELLOW"
    else                                       echo "$C_BAR_GREEN"
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

# ─── GLM quota cache (Option C) ───────────────────────────────────────
# Claude Code injects ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN into the
# statusline subprocess. _glm_active is the cheap gate — everything past it
# (cache read, detached network refresh) only runs on a GLM Coding Plan setup,
# so Anthropic users pay one string test and zero network. QUOTA_ENABLED is the
# master switch from config.toml [quota].
_glm_active() {
    (( ${QUOTA_ENABLED:-0} )) || return 1
    [[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]] || return 1
    local base=${ANTHROPIC_BASE_URL:-}
    [[ "$base" == *z.ai* || "$base" == *bigmodel.cn* ]] || return 1
    return 0
}

# Read the cached 5h % from $1 (quota-cache.json); spawn a DETACHED refresh
# ($2 = quota-fetch.mjs) when the cache is older than $3 minutes and no fetch is
# already in flight. Prints the % (0-100) or nothing. Never blocks the render:
# the refresh runs backgrounded and writes the NEXT render's cache. The lock file
# ($1.lock) carries the spawn epoch (ms) so a burst of renders de-bounces, and a
# crashed fetcher self-heals once the lock ages past the TTL. Cache-miss → the
# whole block (read + spawn) is skipped, so there's never a spawn without a cache.
glm_quota() {
    local cache=$1 fetcher=$2 ttl=${3:-5}
    local pct="" fetched=0 now_ms lock lock_ts
    now_ms=$(( $(now_epoch) * 1000 ))
    if [[ -f "$cache" ]]; then
        pct=$(jq -r '.fiveHourPct // empty' "$cache" 2>/dev/null)
        fetched=$(jq -r '.fetchedAt // 0' "$cache" 2>/dev/null)
        fetched=${fetched//[^0-9]/}; fetched=${fetched:-0}
    fi
    # Spawn a detached refresh when there's no usable cache yet OR it's stale.
    # The cache-miss arm is what BOOTSTRAPS a fresh install: first render has no
    # cache → spawn → the next render reads it. (main() already guaranteed jq.)
    if (( fetched <= 0 || now_ms - fetched >= ttl * 60000 )); then
        lock="${cache}.lock"
        lock_ts=0
        [[ -f "$lock" ]] && { lock_ts=$(cat "$lock" 2>/dev/null); lock_ts=${lock_ts//[^0-9]/}; lock_ts=${lock_ts:-0}; }
        # De-bounce: spawn only if no recent in-flight fetch (lock empty or aged
        # past TTL). The subshell is backgrounded; statusline has no tty, so the
        # child survives parent exit and removes the lock on completion.
        if (( lock_ts <= 0 || now_ms - lock_ts >= ttl * 60000 )) && have node && [[ -f "$fetcher" ]]; then
            printf '%s' "$now_ms" > "$lock" 2>/dev/null || true
            ( node "$fetcher" >/dev/null 2>&1; rm -f "$lock" 2>/dev/null ) &
        fi
    fi
    printf '%s' "$pct"
}

# ─── _is_mosh_session — walk process tree for mosh-server ancestor ────
# Returns 0 (true) when any ancestor process is mosh-server.
# Uses /proc on Linux with ps fallback for portability.
_is_mosh_session() {
    local pid=$$
    while (( pid > 1 )); do
        local name
        if [[ -r "/proc/$pid/comm" ]]; then
            name=$(< /proc/$pid/comm)
        else
            name=$(ps -o comm= -p "$pid" 2>/dev/null) || break
        fi
        [[ "$name" == "mosh-server" ]] && return 0
        local next_pid
        if [[ -r "/proc/$pid/status" ]]; then
            next_pid=$(awk '/^PPid:/ {print $2}' /proc/$pid/status)
        else
            next_pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ') || break
        fi
        pid=${next_pid:-0}
    done
    return 1
}

# ─── detect_layout — return "compact" or "full" based on environment ──
detect_layout() {
    case "${CLAUDEBAR_LAYOUT:-}" in
        compact) echo compact; return ;;
        full)    echo full;    return ;;
    esac
    [[ "${MOSHI_CLIENT:-}" == "1" ]] && { echo compact; return; }
    _is_mosh_session && { echo compact; return; }
    local cols=${COLUMNS:-0}
    (( cols == 0 )) && cols=$(tput cols 2>/dev/null || echo 80)
    (( cols < 60 )) && { echo compact; return; }
    echo full
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
# Time-elapsed marker (the │) is an OVERLAY: it OCCUPIES one of the 10
# cells (cell index in [0..9]), replacing that pip — NOT an inserted 11th
# char, so the bar width is always 10. Reading the 5h/7d cue:
#   filled <  marker → "atrás": time cell still empty, you have margin.
#   filled == marker → "encostou": cells before the pipe are full, but the
#                      pipe cell itself is NOT yet consumed → not reached.
#   filled >  marker → "passou": fill consumed the pipe cell → you reached
#                      the time mark / are burning faster than the window.
# The pipe's COLOR carries this: gray (C_REPO) until reached, then the zone
# color once passed ("to reach the pipe it has to change"). The cell the
# pipe sits on hides its own ▰/▱, so the color is what disambiguates the
# ~10% band where the fill edge and the pipe coincide. Empty/unset marker
# preserves the 10-char legacy render (no pipe).
pip_bar() {
    local pct=$1
    local marker=${2:-}
    local color filled i
    color=$(zone_color "$pct")
    filled=$(( pct * 10 / 100 ))
    (( filled > 10 )) && filled=10
    (( filled < 0 ))  && filled=0

    # Marker is a CELL index in [0,9] (overlay). Clamp when numeric; treat
    # anything else (empty, non-digit) as "no marker".
    local marker_active=0
    if [[ "$marker" =~ ^-?[0-9]+$ ]]; then
        marker_active=1
        (( marker < 0 )) && marker=0
        (( marker > 9 )) && marker=9
    fi

    for ((i=0; i<10; i++)); do
        if (( marker_active )) && (( marker == i )); then
            # Pipe occupies this cell: gray until the fill reaches it,
            # zone color once consumed (filled > i).
            if (( filled > i )); then
                fg "$color" "│"
            else
                fg "$C_REPO" "│"
            fi
        elif (( i < filled )); then
            fg "$color" "▰"
        else
            fg "$C_BAR_DIM" "▱"
        fi
    done
}

# ─── pip_bar_compact PCT [MARKER_POS] — 5-pip zone-colored bar (compact) ─
# Mirrors pip_bar's OVERLAY marker, scaled to the 5-pip width: the │
# OCCUPIES one of the 5 cells (cell index in [0..4]), replacing that pip —
# width stays 5. Same color rule as pip_bar: gray (C_REPO) while not yet
# reached (filled <= marker), zone color once the fill consumes the pipe
# cell (filled > marker). Empty/unset marker preserves the legacy 5-char
# render (no pipe).
pip_bar_compact() {
    local pct=$1
    local marker=${2:-}
    local color filled i
    color=$(zone_color "$pct")
    filled=$(( pct * 5 / 100 ))
    (( filled > 5 )) && filled=5
    (( filled < 0 )) && filled=0

    # Marker is a CELL index in [0,4] (overlay). Clamp when numeric; treat
    # anything else (empty, non-digit) as "no marker".
    local marker_active=0
    if [[ "$marker" =~ ^-?[0-9]+$ ]]; then
        marker_active=1
        (( marker < 0 )) && marker=0
        (( marker > 4 )) && marker=4
    fi

    for ((i=0; i<5; i++)); do
        if (( marker_active )) && (( marker == i )); then
            if (( filled > i )); then
                fg "$color" "│"
            else
                fg "$C_REPO" "│"
            fi
        elif (( i < filled )); then
            fg "$color" "▰"
        else
            fg "$C_BAR_DIM" "▱"
        fi
    done
}

# ─── compact_row1 — session row (model + effort/agent + PR) ──────────
# Usage: compact_row1 model=X effort=X pr_number=X pr_state=X agent=X
compact_row1() {
    local model="" effort="" pr_number="" pr_state="" agent=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            model=*)      model=${arg#model=} ;;
            effort=*)     effort=${arg#effort=} ;;
            pr_number=*)  pr_number=${arg#pr_number=} ;;
            pr_state=*)   pr_state=${arg#pr_state=} ;;
            agent=*)      agent=${arg#agent=} ;;
        esac
    done

    local sparkle="✦"

    if [[ -n "$agent" ]] && (( CHIP_AGENT )); then
        if (( CHIP_MODEL )); then
            fg "$C_MODEL_DIM" "${sparkle} ${model}"
            printf ' '
            sep "·"
            printf ' '
        fi
        fg "$C_AGENT" "${GLYPH_GEAR} agent:${agent}"
        printf '%s[5m' "$esc"
        fg "$C_AGENT" " ●"
        printf '%s[25m' "$esc"
    else
        if (( CHIP_MODEL )); then
            fg "$C_MODEL" "${sparkle} ${model}"
        fi
        if [[ -n "$effort" ]] && (( CHIP_EFFORT )); then
            printf ' '
            sep "·"
            printf ' '
            effort_chip "$effort"
        fi
    fi

    if [[ -n "$pr_number" ]] && (( CHIP_PR )); then
        printf '  '
        pr_chip "$pr_number" "$pr_state"
    fi

    local upd
    upd=$(update_chip)
    if [[ -n "$upd" ]]; then
        printf '  '
        printf '%s' "$upd"
    fi

    printf '\n'
}

# ─── compact_row2 — git context (repo name + branch + dirty) ─────────
# Usage: compact_row2 repo=X branch=X dirty_count=X worktree=X cwd=X
# Outside a git repo (no repo) the directory basename is shown instead,
# so the location is never blank. The worktree marker (via branch_chip) is
# rendered here too, matching the full layout.
compact_row2() {
    local repo="" branch="" dirty_count="" worktree="" cwd=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            repo=*)         repo=${arg#repo=} ;;
            branch=*)       branch=${arg#branch=} ;;
            dirty_count=*)  dirty_count=${arg#dirty_count=} ;;
            worktree=*)     worktree=${arg#worktree=} ;;
            cwd=*)          cwd=${arg#cwd=} ;;
        esac
    done

    # No git repo → fall back to the current directory basename.
    if [[ -z "$repo" ]]; then
        if [[ -n "$cwd" ]] && (( CHIP_REPO )); then
            fg "$C_REPO" "${GLYPH_FOLDER} ${cwd##*/}"
            printf '\n'
        fi
        return
    fi

    if (( CHIP_REPO )); then
        fg "$C_REPO" "$repo"
        printf ' '
        sep "›"
        printf ' '
    fi
    branch_chip "$worktree" "$branch"
    if [[ -n "$dirty_count" ]] && (( CHIP_DIRTY )); then
        printf ' '
        dirty_indicator "$dirty_count"
    fi

    printf '\n'
}

# ─── compact_row3 — fuel gauges with 5-pip bars ──────────────────────
# Usage: compact_row3 ctx=X five_hour=X seven_day=X \
#                     five_hour_resets_at=X seven_day_resets_at=X
# Like fuel_row, a positive *_resets_at timestamp drives the time-elapsed
# marker (the │) on the 5h/7d chips. The compact layout has no room for the
# countdown text, so it renders the marker only — keeping mobile in parity
# with the desktop "are you burning faster than the window allows" cue.
compact_row3() {
    local ctx="" five_hour="" seven_day=""
    local five_hour_resets_at="" seven_day_resets_at=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            ctx=*)                  ctx=${arg#ctx=} ;;
            five_hour=*)            five_hour=${arg#five_hour=} ;;
            seven_day=*)            seven_day=${arg#seven_day=} ;;
            five_hour_resets_at=*)  five_hour_resets_at=${arg#five_hour_resets_at=} ;;
            seven_day_resets_at=*)  seven_day_resets_at=${arg#seven_day_resets_at=} ;;
        esac
    done

    : "${ctx:=0}"
    if (( CHIP_CTX_BAR )); then
        fg "$C_REPO" "ctx"; printf ' '
        pip_bar_compact "$ctx"
        printf ' '
        fg "$(zone_color "$ctx")" "$(printf '%2d%%' "$ctx")"
    fi

    if [[ -n "$five_hour" ]] && (( CHIP_FIVE_HOUR_BAR )); then
        # Single-space inter-chip gap (vs 2 in the full layout): the marker's
        # │ widens each rate chip by one cell, and at narrow mobile widths the
        # 2-space gap pushed the trailing 7d % off-screen (truncated to "3…").
        printf ' '
        fg "$C_REPO" "5h"; printf ' '
        local marker_5h=""
        if (( CHIP_TIME_MARKER )) && [[ "$five_hour_resets_at" =~ ^[0-9]+$ ]] && (( five_hour_resets_at > 0 )); then
            local now_5h remaining_5h elapsed_5h
            now_5h=$(now_epoch)
            remaining_5h=$(( five_hour_resets_at - now_5h ))
            elapsed_5h=$(( WINDOW_5H_SECONDS - remaining_5h ))
            (( elapsed_5h < 0 )) && elapsed_5h=0
            (( elapsed_5h > WINDOW_5H_SECONDS )) && elapsed_5h=WINDOW_5H_SECONDS
            marker_5h=$(( elapsed_5h * 5 / WINDOW_5H_SECONDS ))
        fi
        pip_bar_compact "$five_hour" "$marker_5h"
        printf ' '
        fg "$(zone_color "$five_hour")" "$(printf '%2d%%' "$five_hour")"
    fi

    if [[ -n "$seven_day" ]] && (( CHIP_SEVEN_DAY_BAR )); then
        printf ' '
        fg "$C_REPO" "7d"; printf ' '
        local marker_7d=""
        if (( CHIP_TIME_MARKER )) && [[ "$seven_day_resets_at" =~ ^[0-9]+$ ]] && (( seven_day_resets_at > 0 )); then
            local now_7d remaining_7d elapsed_7d
            now_7d=$(now_epoch)
            remaining_7d=$(( seven_day_resets_at - now_7d ))
            elapsed_7d=$(( WINDOW_7D_SECONDS - remaining_7d ))
            (( elapsed_7d < 0 )) && elapsed_7d=0
            (( elapsed_7d > WINDOW_7D_SECONDS )) && elapsed_7d=WINDOW_7D_SECONDS
            marker_7d=$(( elapsed_7d * 5 / WINDOW_7D_SECONDS ))
        fi
        pip_bar_compact "$seven_day" "$marker_7d"
        printf ' '
        fg "$(zone_color "$seven_day")" "$(printf '%2d%%' "$seven_day")"
    fi

    printf '\n'
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

# ─── branch_chip WORKTREE BRANCH — worktree-aware branch render ────────
# Shared by full + compact layouts. In a worktree, the ⎇ marker REPLACES
# the git branch glyph and the whole chip renders in worktree violet
# (C_WORKTREE) — so a worktree is unmistakable at a glance, and there is no
# longer a "⎇ <git-glyph>" adjacency for terminals to overlap (the old bug:
# U+2387 is ambiguous-width and bled into the following Private-Use glyph).
# Outside a worktree: git glyph + branch in green (C_BRANCH).
# Honors CHIP_WORKTREE (suppress worktree styling) and CHIP_BRANCH.
# wt_glyph is U+2387 ⎇ alternative-key — kept as UTF-8 bytes for transport
# safety, same rationale as the Private-Use glyphs declared at the top.
branch_chip() {
    local worktree=$1 branch=$2
    local wt_glyph=$'\xe2\x8e\x87'
    if [[ -n "$worktree" ]] && (( CHIP_WORKTREE )); then
        if [[ -n "$branch" ]]; then
            fg "$C_WORKTREE" "${wt_glyph} ${branch}"
        else
            fg "$C_WORKTREE" "${wt_glyph}"
        fi
    elif [[ -n "$branch" ]] && (( CHIP_BRANCH )); then
        fg "$C_BRANCH" "${GLYPH_GIT} ${branch}"
    fi
}

# ─── update_chip — "⬆ vX.Y.Z" when the auto-updater found a newer release ──
# Reads the version the background updater wrote to .update-available. Prints
# nothing when the file is absent/blank or CHIP_UPDATE is off. Accepts an
# explicit path as $1 (tests); otherwise uses the resolved _CB_UPDATE_FILE.
update_chip() {
    (( CHIP_UPDATE )) || return 0
    local f="${1:-$_CB_UPDATE_FILE}"
    [[ -f "$f" ]] || return 0
    local ver
    ver=$(<"$f")
    ver=${ver//[$'\n\r\t ']/}
    [[ -n "$ver" ]] || return 0

    # Suppress a satisfied notification: the auto-updater clears .update-available
    # only on its throttled "up to date" pass and never right after applying an
    # update, so once installed catches up the file lingers with the now-current
    # version. Re-derive the truth here — show only when the advertised version is
    # strictly newer than the installed one. Compare x.y.z field-by-field as
    # integers (1.10.0 > 1.9.0, not lexical). A missing/unparseable version on
    # either side falls through and shows the chip (never hide a real update).
    local vf="${2:-$_CB_VERSION_FILE}"
    if [[ -f "$vf" ]]; then
        local inst
        inst=$(<"$vf")
        inst=${inst//[$'\n\r\t ']/}
        if [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$inst" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            local a1 a2 a3 i1 i2 i3 newer=0
            IFS=. read -r a1 a2 a3 <<<"$ver"
            IFS=. read -r i1 i2 i3 <<<"$inst"
            if   (( a1 != i1 )); then (( a1 > i1 )) && newer=1
            elif (( a2 != i2 )); then (( a2 > i2 )) && newer=1
            elif (( a3 != i3 )); then (( a3 > i3 )) && newer=1
            fi
            (( newer )) || return 0
        fi
    fi

    fg "$C_UPDATE" "${GLYPH_UPDATE} v${ver}"
}

# ─── resolve_git_root DIR — walk up from DIR to the repo root, no subprocess ──
# Prints the first ancestor (inclusive) containing a .git entry (dir OR file —
# worktrees use a .git file). Empty + non-zero when none found. Pure bash stat
# calls, so it is far cheaper than spawning `git rev-parse --show-toplevel` —
# which matters because the project chip resolves the root on every render.
resolve_git_root() {
    local d=$1 prev
    while [[ -n "$d" && "$d" != "/" ]]; do
        [[ -e "$d/.git" ]] && { printf '%s' "$d"; return 0; }
        prev=$d; d=${d%/*}
        [[ "$d" == "$prev" ]] && break   # no slash to strip (relative path) → stop
    done
    [[ -e "/.git" ]] && { printf '/'; return 0; }
    return 1
}

# ─── project_chip — atomic-skills focus.json → "◉ plan · F i/n · done/total" ──
# Desktop-only: called ONLY from fuel_row() (row 2), never from compact_row*.
# Reads ONE flat file (the producer's denormalized projection) and renders a
# glanceable "where am I in the project" chip. Contract + rationale:
#   docs/specs/atomic-skills-focus-chip.md
#   ~/atomic-skills/meta/schemas/focus.schema.json
# Arg $1 = repo root (git-root; caller resolves it). focus.json lives at the
# repo root, NOT the CWD, so the path is anchored there. Fail-open everywhere:
# absent file / plan:null / unknown schemaVersion / bad JSON → render nothing.
#
# Freshness: focus.json is derived data the producer regenerates on mutations +
# session hooks. It can go stale on a mid-session git checkout / external edit
# no hook saw. The sources[] block records each source file's frontmatter
# `lastUpdated` at emit time; we re-read it and compare (NOT mtime — checkout
# resets mtime → false-stale). Mismatch / missing source → show a dim "~".
project_chip() {
    (( CHIP_PROJECT )) || return 0
    local root=$1
    [[ -n "$root" ]] || return 0
    local f="$root/.atomic-skills/focus.json"
    [[ -f "$f" ]] || return 0
    have jq || return 0

    # One jq pass. Line 1 = render fields; each following line = one source as
    # "path<US>lastUpdated". Fields are joined with U+001F (unit separator) — a
    # NON-whitespace char — NOT a tab: bash `read` with a whitespace IFS collapses
    # runs and drops empty fields, so a schema-valid empty field (e.g. phase.id
    # when phase is null) would shift every column left and corrupt the parse.
    local US=$'\037'
    local data
    data=$(jq -rj '
        def row: join("\u001f");
        if (.plan == null) or (.schemaVersion != "0.1") then "SKIP\n"
        else
          ([ .plan.slug, (.phase.id // ""), (.phase.index // 0 | tostring),
             (.phase.total // 0 | tostring), (.tasks.done // 0 | tostring),
             (.tasks.total // 0 | tostring), (.tasks.blocked // 0 | tostring),
             (.flags.drift // false | tostring),
             (.flags.multipleActivePlans // false | tostring) ] | row), "\n",
          ( [ .sources[]? | [ .path, (.lastUpdated // "") ] | row ] | join("\n") )
        end' "$f" 2>/dev/null) || return 0
    [[ -z "$data" || "$data" == "SKIP" ]] && return 0

    local slug="" pid="" pidx="" ptot="" tdone="" ttot="" tblk="" drift="" multi=""
    local stale=0 first=1 line path recorded current
    while IFS= read -r line; do
        if (( first )); then
            IFS=$US read -r slug pid pidx ptot tdone ttot tblk drift multi <<<"$line"
            first=0
            continue
        fi
        [[ -z "$line" ]] && continue
        (( stale )) && continue          # already stale → skip remaining greps
        IFS=$US read -r path recorded <<<"$line"
        [[ -z "$path" ]] && continue
        local sf="$root/$path"
        if [[ ! -f "$sf" ]]; then stale=1; continue; fi
        # Accept both the contract field (lastUpdated, nested layout) and the
        # legacy flat field (last_updated) — a strict superset of the contract.
        # Strip "key:" + surrounding whitespace/quotes only (keep interior).
        current=$(grep -m1 -E '^(lastUpdated|last_updated):' "$sf" \
                  | sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]+$//; s/^["'\'']//; s/["'\'']$//')
        # Compare only when BOTH sides have a value; an empty side is
        # indeterminate (field absent producer- or consumer-side) → assume fresh.
        [[ -n "$current" && -n "$recorded" && "$current" != "$recorded" ]] && stale=1
    done <<<"$data"

    [[ -z "$slug" ]] && return 0
    # Numeric/boolean fallbacks so a malformed digest degrades, never crashes.
    [[ "$tblk" =~ ^[0-9]+$ ]] || tblk=0
    [[ "$drift" == "true" ]] || drift=false

    # Show the full plan id by default (row 2 has room). PROJECT_SLUG_MAX caps it
    # only as a runaway guard; set to 0 to disable truncation entirely.
    local max=${PROJECT_SLUG_MAX:-0}
    local slug_disp=$slug
    if (( max > 0 )) && (( ${#slug} > max )); then slug_disp=${slug:0:max}"…"; fi
    # ">1 active plan" marker — the chip shows one of several (e.g. invariant
    # "≤1 active plan/branch" violated). Sits right after the slug.
    local marker=""; [[ "$multi" == "true" ]] && marker=" ${GLYPH_MULTIPLAN}"
    local body="${GLYPH_PROJECT} ${slug_disp}${marker} · ${pid} ${pidx}/${ptot} · ${tdone}/${ttot}"
    (( tblk > 0 )) && body+=" ⚠${tblk}"
    [[ "$drift" == "true" ]] && body+=" ${GLYPH_DRIFT}"

    local color=$C_PROJECT
    (( tblk > 0 )) && color=$C_PROJECT_BLOCKED
    if (( stale )); then color=$C_PROJECT_STALE; body+=" ~"; fi
    fg "$color" "$body"
}

# ─── identity_row — compose row 1 ─────────────────────────────────────
# Usage: identity_row key=value key=value ...
# Keys: model effort owner repo worktree branch dirty_count
#       pr_number pr_state agent
identity_row() {
    local model="" effort="" owner="" repo=""
    local worktree="" branch="" dirty_count=""
    local pr_number="" pr_state="" agent="" cwd=""

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
            cwd=*)          cwd=${arg#cwd=} ;;
        esac
    done

    local sparkle="✦"

    # ── Left group: model + (effort | agent) ─────────────
    if [[ -n "$agent" ]] && (( CHIP_AGENT )); then
        if (( CHIP_MODEL )); then
            fg "$C_MODEL_DIM" "${sparkle} ${model}"
            printf ' '
            sep "·"
            printf ' '
        fi
        fg "$C_AGENT" "${GLYPH_GEAR} agent:${agent}"
        printf '%s[5m' "$esc"  # blink on
        fg "$C_AGENT" " ●"
        printf '%s[25m' "$esc"  # blink off
    else
        if (( CHIP_MODEL )); then
            fg "$C_MODEL" "${sparkle} ${model}"
        fi
        if [[ -n "$effort" ]] && (( CHIP_EFFORT )); then
            printf ' '
            sep "·"
            printf ' '
            effort_chip "$effort"
        fi
    fi

    # ── Tmux chip (only when running inside tmux) ──────────
    if (( CHIP_TMUX )); then
        local tmux_out
        tmux_out=$(tmux_chip)
        if [[ -n "$tmux_out" ]]; then
            printf ' '
            sep "·"
            printf ' '
            printf '%s' "$tmux_out"
        fi
    fi

    # ── Middle group: repo › [⎇ ]branch dirty ────────────
    if [[ -n "$owner" && -n "$repo" ]] && (( CHIP_REPO )); then
        printf '  '
        fg "$C_REPO" "${owner}/${repo}"
        printf ' '
        sep "›"
        printf ' '
        branch_chip "$worktree" "$branch"
        if [[ -n "$dirty_count" ]] && (( CHIP_DIRTY )); then
            printf ' '
            dirty_indicator "$dirty_count"
        fi
    elif [[ -n "$cwd" ]] && (( CHIP_REPO )); then
        # No git repo → show the directory basename so location is never blank.
        printf '  '
        fg "$C_REPO" "${GLYPH_FOLDER} ${cwd##*/}"
    fi

    # ── Right group: PR chip ─────────────────────────────
    if [[ -n "$pr_number" ]] && (( CHIP_PR )); then
        printf '   '
        pr_chip "$pr_number" "$pr_state"
    fi

    # ── Update-available chip ────────────────────────────
    local upd
    upd=$(update_chip)
    if [[ -n "$upd" ]]; then
        printf '   '
        printf '%s' "$upd"
    fi

    printf '\n'
}

# ─── fuel_row — compose row 2 (the 3 bars) ────────────────────────────
# Usage: fuel_row key=value key=value ...
# Keys: ctx five_hour seven_day five_hour_resets_at seven_day_resets_at
#
# When a *_resets_at kwarg is a positive Unix timestamp, the chip renders
# "label · countdown  bar pct%" (dim countdown + 2-space gap visually
# clusters [label · countdown] as metadata vs [bar pct%] as the metric).
# When absent / zero / non-numeric, falls back to "label bar pct%".
fuel_row() {
    local ctx="" five_hour="" seven_day=""
    local five_hour_resets_at="" seven_day_resets_at="" git_root=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            ctx=*)                  ctx=${arg#ctx=} ;;
            five_hour=*)            five_hour=${arg#five_hour=} ;;
            seven_day=*)            seven_day=${arg#seven_day=} ;;
            five_hour_resets_at=*)  five_hour_resets_at=${arg#five_hour_resets_at=} ;;
            seven_day_resets_at=*)  seven_day_resets_at=${arg#seven_day_resets_at=} ;;
            git_root=*)             git_root=${arg#git_root=} ;;
        esac
    done

    # ctx — always render even if 0
    : "${ctx:=0}"
    if (( CHIP_CTX_BAR )); then
        fg "$C_REPO" "ctx"; printf ' '
        pip_bar "$ctx"
        printf ' '
        fg "$(zone_color "$ctx")" "$(printf '%2d%%' "$ctx")"
    fi

    # 5h
    if [[ -n "$five_hour" ]] && (( CHIP_FIVE_HOUR_BAR )); then
        printf '   '
        fg "$C_REPO" "5h"; printf ' '
        local marker_5h=""
        if [[ "$five_hour_resets_at" =~ ^[0-9]+$ ]] && (( five_hour_resets_at > 0 )); then
            local now_5h countdown_5h elapsed_5h remaining_5h
            now_5h=$(now_epoch)
            remaining_5h=$(( five_hour_resets_at - now_5h ))
            if (( CHIP_COUNTDOWN )); then
                countdown_5h=$(format_countdown "$remaining_5h")
                fg "$C_REPO" "·"; printf ' '
                fg "$C_REPO" "$countdown_5h"; printf '  '
            fi
            if (( CHIP_TIME_MARKER )); then
                elapsed_5h=$(( WINDOW_5H_SECONDS - remaining_5h ))
                (( elapsed_5h < 0 )) && elapsed_5h=0
                (( elapsed_5h > WINDOW_5H_SECONDS )) && elapsed_5h=WINDOW_5H_SECONDS
                marker_5h=$(( elapsed_5h * 10 / WINDOW_5H_SECONDS ))
            fi
        fi
        pip_bar "$five_hour" "$marker_5h"
        printf ' '
        fg "$(zone_color "$five_hour")" "$(printf '%2d%%' "$five_hour")"
    fi

    # 7d
    if [[ -n "$seven_day" ]] && (( CHIP_SEVEN_DAY_BAR )); then
        printf '   '
        fg "$C_REPO" "7d"; printf ' '
        local marker_7d=""
        if [[ "$seven_day_resets_at" =~ ^[0-9]+$ ]] && (( seven_day_resets_at > 0 )); then
            local now_7d countdown_7d elapsed_7d remaining_7d
            now_7d=$(now_epoch)
            remaining_7d=$(( seven_day_resets_at - now_7d ))
            if (( CHIP_COUNTDOWN )); then
                countdown_7d=$(format_countdown "$remaining_7d")
                fg "$C_REPO" "·"; printf ' '
                fg "$C_REPO" "$countdown_7d"; printf '  '
            fi
            if (( CHIP_TIME_MARKER )); then
                elapsed_7d=$(( WINDOW_7D_SECONDS - remaining_7d ))
                (( elapsed_7d < 0 )) && elapsed_7d=0
                (( elapsed_7d > WINDOW_7D_SECONDS )) && elapsed_7d=WINDOW_7D_SECONDS
                marker_7d=$(( elapsed_7d * 10 / WINDOW_7D_SECONDS ))
            fi
        fi
        pip_bar "$seven_day" "$marker_7d"
        printf ' '
        fg "$(zone_color "$seven_day")" "$(printf '%2d%%' "$seven_day")"
    fi

    # ── Project focus chip (atomic-skills focus.json; desktop-only) ──
    # Lives on row 2, after the fuel gauges (more horizontal room here than
    # row 1). Renders nothing when off / no git-root / no focus.json.
    if (( CHIP_PROJECT )) && [[ -n "$git_root" ]]; then
        local proj
        proj=$(project_chip "$git_root")
        if [[ -n "$proj" ]]; then
            printf '   '
            printf '%s' "$proj"
        fi
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
        "CWD="        + ((.workspace.current_dir // .cwd // "") | @sh) + "\n" +
        "WORKTREE="   + ((.workspace.git_worktree // "") | @sh) + "\n" +
        "CTX="        + ((.context_window.used_percentage // 0 | floor) | tostring | @sh) + "\n" +
        "FIVE_HOUR="            + ((.rate_limits.five_hour.used_percentage // "") | tostring | @sh) + "\n" +
        "FIVE_HOUR_RESETS_AT="  + ((.rate_limits.five_hour.resets_at // "") | tostring | @sh) + "\n" +
        "SEVEN_DAY="            + ((.rate_limits.seven_day.used_percentage // "") | tostring | @sh) + "\n" +
        "SEVEN_DAY_RESETS_AT="  + ((.rate_limits.seven_day.resets_at // "") | tostring | @sh) + "\n" +
        "PR_NUMBER="  + ((.pr.number // "") | tostring | @sh) + "\n" +
        "PR_STATE="   + ((.pr.review_state // "") | @sh) + "\n" +
        "AGENT="      + ((.agent.name // "") | @sh)
    ')
    eval "$jq_out"

    # Derive branch (not in JSON for normal sessions — git is source of truth)
    # CLAUDEBAR_BRANCH_FOR_TESTING overrides the git lookup so fixture snapshots
    # stay reproducible regardless of which branch the test runner is sitting on.
    local BRANCH=""
    if [[ -n "${CLAUDEBAR_BRANCH_FOR_TESTING:-}" ]]; then
        BRANCH=$CLAUDEBAR_BRANCH_FOR_TESTING
    elif have git && git rev-parse --git-dir >/dev/null 2>&1; then
        BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    fi

    # Derive dirty count
    local DIRTY=""
    if have git && git rev-parse --git-dir >/dev/null 2>&1; then
        DIRTY=$(dirty_count "$SESSION_ID")
    fi

    # Derive git-root for the project focus chip (anchors .atomic-skills/focus.json
    # at the repo root, not the CWD). Walked from CWD without spawning git, so the
    # common no-atomic-skills case costs only a few stat calls. Chip-gated.
    local GIT_ROOT=""
    if (( CHIP_PROJECT )) && [[ -n "$CWD" ]]; then
        GIT_ROOT=$(resolve_git_root "$CWD") || GIT_ROOT=""
    fi

    # GLM Coding Plan fallback: when Claude Code reports no Anthropic rate-limit
    # (it doesn't on a GLM endpoint — .rate_limits.five_hour is empty), source
    # the 5h % from the Z.ai monitor cache instead. The detached refresh keeps
    # the cache fresh for the next render; this render reads whatever's cached.
    # Pure no-op on Anthropic setups (_glm_active short-circuits). Falls back to
    # the cast below, so the chip renders through the exact same path either way.
    if [[ -z "$FIVE_HOUR" ]] && _glm_active; then
        FIVE_HOUR=$(glm_quota "$_CB_QUOTA_CACHE" "${_CB_SCRIPT_DIR}/quota-fetch.mjs" "$QUOTA_REFRESH_INTERVAL_MINUTES")
    fi

    # Cast FIVE_HOUR / SEVEN_DAY (jq emits floats like "23.5") to int
    [[ -n "$FIVE_HOUR" ]] && FIVE_HOUR=$(printf '%.0f' "$FIVE_HOUR")
    [[ -n "$SEVEN_DAY" ]] && SEVEN_DAY=$(printf '%.0f' "$SEVEN_DAY")

    # Render
    local layout
    layout=$(detect_layout)

    if [[ "$layout" == "compact" ]]; then
        compact_row1 \
            model="$MODEL" \
            effort="$EFFORT" \
            pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
            agent="$AGENT"

        compact_row2 \
            repo="$REPO" \
            branch="$BRANCH" \
            dirty_count="$DIRTY" \
            worktree="$WORKTREE" \
            cwd="$CWD"

        compact_row3 \
            ctx="$CTX" \
            five_hour="$FIVE_HOUR" \
            seven_day="$SEVEN_DAY" \
            five_hour_resets_at="$FIVE_HOUR_RESETS_AT" \
            seven_day_resets_at="$SEVEN_DAY_RESETS_AT"
    else
        identity_row \
            model="$MODEL" \
            effort="$EFFORT" \
            owner="$OWNER" repo="$REPO" \
            worktree="$WORKTREE" \
            branch="$BRANCH" \
            dirty_count="$DIRTY" \
            pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
            agent="$AGENT" \
            cwd="$CWD"

        fuel_row \
            ctx="$CTX" \
            five_hour="$FIVE_HOUR" \
            seven_day="$SEVEN_DAY" \
            five_hour_resets_at="$FIVE_HOUR_RESETS_AT" \
            seven_day_resets_at="$SEVEN_DAY_RESETS_AT" \
            git_root="$GIT_ROOT"
    fi
}

# Sourcing guard: only run main when invoked directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
