#!/usr/bin/env bash
# Prep your terminal for a clean screenshot of one statusline state.
#
# Usage:
#   tools/prep-screenshot.sh                 # interactive menu of all states
#   tools/prep-screenshot.sh <state>         # render just one state
#   tools/prep-screenshot.sh all             # all states with labels (for overview)
#
# State names: 01-calm  02-mid-session  03-caution  04-danger  05-agent
#              06-pr-approved  07-main-tree  08-with-tmux
#
# Workflow:
#   1. Run with a state name → screen clears, bar renders centered with padding
#   2. Take a screenshot of the terminal window (or just the bar lines)
#   3. Save the PNG to docs/screenshots/<state>.png
#   4. Repeat for each state

set -uo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)"
script="$dir/statusline.sh"

set_cache() {
    local fixture=$1 count=$2
    local sid
    sid=$(grep -o '"session_id" *: *"[^"]*"' "$fixture" | head -1 \
        | grep -o '"[^"]*"$' | tr -d '"')
    sid=${sid:-default}
    if [[ -n "$count" ]]; then
        echo "$count" > "/tmp/statusline-git-${sid}"
    else
        echo "0" > "/tmp/statusline-git-${sid}"
    fi
    touch "/tmp/statusline-git-${sid}"
}

declare -A LABELS=(
    [01-calm]="Calm start of session"
    [02-mid-session]="Mid-session - worktree work in progress"
    [03-caution]="Caution - yellow zone (60-89%)"
    [04-danger]="Danger - red zone (>=90%) + PR changes requested"
    [05-agent]="Subagent dispatched - model dims, agent chip pulses"
    [06-pr-approved]="PR approved - clean tree"
    [07-main-tree]="Main working tree (no worktree, no PR)"
    [08-with-tmux]="Mid-session WITH tmux chip visible"
)
declare -A DIRTY=(
    [01-calm]="2"
    [02-mid-session]="3"
    [03-caution]="5"
    [04-danger]="8"
    [05-agent]="5"
    [06-pr-approved]=""
    [07-main-tree]=""
    [08-with-tmux]="3"
)
declare -A FIXTURE_OF=(
    [01-calm]="01-calm"
    [02-mid-session]="02-mid-session"
    [03-caution]="03-caution"
    [04-danger]="04-danger"
    [05-agent]="05-agent"
    [06-pr-approved]="06-pr-approved"
    [07-main-tree]="07-main-tree"
    [08-with-tmux]="02-mid-session"
)

ORDER=(01-calm 02-mid-session 03-caution 04-danger 05-agent 06-pr-approved 07-main-tree 08-with-tmux)

render_one() {
    local state=$1
    local fixture_name=${FIXTURE_OF[$state]}
    local fixture="$dir/test/fixtures/${fixture_name}.json"
    set_cache "$fixture" "${DIRTY[$state]}"

    clear
    printf '\n\n'
    printf '   \e[38;5;245m%s\e[0m\n' "${LABELS[$state]}"
    printf '   \e[38;5;238m-----------------------------------------\e[0m\n\n'

    if [[ "$state" == "08-with-tmux" ]]; then
        # Render twice — without tmux vs with tmux — so the difference is
        # unmistakable. The added chip is "tmux:session:window.pane" between
        # the effort chip and the repo block.
        printf '   \e[38;5;238m# WITHOUT tmux (baseline) — no extra chip after HIGH:\e[0m\n   '
        (unset TMUX; "$script" < "$fixture") | sed 's/^/   /'
        printf '\n\n'
        printf '   \e[38;5;238m# WITH tmux active — notice the new \e[38;5;105mtmux:...\e[0m\e[38;5;238m chip:\e[0m\n   '
        "$script" < "$fixture" | sed 's/^/   /'
    else
        printf '   '
        (unset TMUX; "$script" < "$fixture") | sed 's/^/   /'
    fi

    printf '\n\n'
    printf '   \e[38;5;238m[snap] Take a screenshot now. Save as: docs/screenshots/%s.png\e[0m\n\n' "$state"
}

render_all() {
    clear
    printf '\n\e[1;38;5;245m  claudebar - all 8 states in sequence\e[0m\n'
    printf '  \e[38;5;238mScroll back to capture each section, or take a long screenshot.\e[0m\n'
    for state in "${ORDER[@]}"; do
        local fixture_name=${FIXTURE_OF[$state]}
        local fixture="$dir/test/fixtures/${fixture_name}.json"
        set_cache "$fixture" "${DIRTY[$state]}"
        printf '\n  \e[1;38;5;245m-- %s. %s --\e[0m\n\n  ' "${state%%-*}" "${LABELS[$state]}"
        if [[ "$state" == "08-with-tmux" ]]; then
            "$script" < "$fixture" | sed 's/^/  /'
        else
            (unset TMUX; "$script" < "$fixture") | sed 's/^/  /'
        fi
        printf '\n'
    done
    printf '\n'
}

show_menu() {
    printf '\n\e[1;38;5;245mPrep terminal for screenshot. Pick a state:\e[0m\n\n'
    local i=1
    for state in "${ORDER[@]}"; do
        printf '  [%d] %-20s %s\n' "$i" "$state" "${LABELS[$state]}"
        i=$((i+1))
    done
    printf '  [a] all                  (sequential overview)\n'
    printf '  [q] quit\n\n'
    printf 'Choice: '
    local choice
    read -r choice
    case "$choice" in
        [1-8])
            local idx=$((choice-1))
            render_one "${ORDER[$idx]}"
            ;;
        a|A) render_all ;;
        q|Q) exit 0 ;;
        *)   echo "Invalid choice"; exit 1 ;;
    esac
}

if [[ $# -eq 0 ]]; then
    show_menu
elif [[ "$1" == "all" ]]; then
    render_all
elif [[ -n "${LABELS[$1]:-}" ]]; then
    render_one "$1"
else
    echo "Unknown state: $1"
    echo "Available: ${ORDER[*]}  all"
    exit 1
fi
