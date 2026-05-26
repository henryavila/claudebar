#!/usr/bin/env bash
# Claude Code statusline — see DESIGN.md
set -uo pipefail

main() {
    cat > /dev/null  # consume stdin so Claude Code doesn't block
    echo "TODO: implement statusline"
}

# Sourcing guard: only run main when invoked directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
