#!/usr/bin/env bash
# Claude Code statusline — see DESIGN.md
set -uo pipefail

# ─── Dependency probe ─────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

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
