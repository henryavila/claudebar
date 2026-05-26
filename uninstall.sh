#!/usr/bin/env bash
# uninstall.sh — disable statusline by restoring a prior settings.json backup.
# Cross-platform: macOS, Linux (Ubuntu/Debian/Arch/Fedora), WSL.
# Files in ~/.claude/statusline/ are left in place; remove manually if desired.
set -uo pipefail

# ─── Colored output helpers ──────────────────────────────────────────
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
BLUE=$'\033[36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

error() { printf '%s[ERROR]%s %s\n' "$RED"    "$RESET" "$1" >&2; exit 1; }
warn()  { printf '%s[WARN]%s %s\n'  "$YELLOW" "$RESET" "$1" >&2; }
ok()    { printf '%s[OK]%s %s\n'    "$GREEN"  "$RESET" "$1"; }
info()  { printf '%s[INFO]%s %s\n'  "$BLUE"   "$RESET" "$1"; }
section() { printf '\n%s━━━ %s ━━━%s\n' "$BOLD" "$1" "$RESET"; }

SETTINGS="$HOME/.claude/settings.json"

# Portable file mtime: GNU stat -c %Y, BSD/macOS stat -f %m
file_mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

main() {
    section "Claude Code statusline uninstaller"

    [[ -f "$SETTINGS" ]] || error "Settings file not found at $SETTINGS"

    # Find install-time backups only (exclude .before-uninstall-* safety snapshots
    # created by prior runs of this script).
    shopt -s nullglob
    local all_backups=("$SETTINGS".bak-*)
    shopt -u nullglob

    (( ${#all_backups[@]} > 0 )) || \
        error "No backups found matching $SETTINGS.bak-*. Cannot rollback automatically. Edit $SETTINGS by hand to remove the statusLine block."

    # Pick most-recent by mtime (works regardless of filename format).
    local newest="" newest_mtime=0 b mt
    for b in "${all_backups[@]}"; do
        mt=$(file_mtime "$b")
        if (( mt > newest_mtime )); then
            newest_mtime=$mt
            newest=$b
        fi
    done

    info "Found ${#all_backups[@]} backup(s)"

    # If multiple, let user pick; otherwise use the only/newest one.
    if (( ${#all_backups[@]} > 1 )); then
        printf '\nAvailable backups (newest first):\n'
        # Sort: print newest first, then the rest
        local sorted=("$newest")
        for b in "${all_backups[@]}"; do
            [[ "$b" == "$newest" ]] || sorted+=("$b")
        done
        local i=1 label
        for b in "${sorted[@]}"; do
            label=""
            [[ "$b" == "$newest" ]] && label=" ${GREEN}(most recent)${RESET}"
            printf '  [%d] %s%s\n' "$i" "$b" "$label"
            i=$((i+1))
        done
        printf '\nWhich backup to restore? [Enter for most recent, or 1-%d]: ' "${#sorted[@]}"
        local choice=""
        read -r choice
        if [[ -n "$choice" ]]; then
            if [[ "$choice" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= ${#sorted[@]} )); then
                newest="${sorted[$((choice-1))]}"
            else
                error "Invalid choice: $choice"
            fi
        fi
    fi

    section "Restore plan"
    printf '  Restore: %s\n  Target:  %s\n\n' "$newest" "$SETTINGS"

    printf 'Continue? [y/N] '
    local reply=""
    read -r reply
    case "$reply" in
        [yY]|[yY][eE][sS]) ;;
        *) info "Aborted. No changes made."; exit 0 ;;
    esac

    # Snapshot current state in case user picked the wrong backup and wants to redo.
    local ts safety
    ts=$(date +%Y%m%d-%H%M%S)
    safety="${SETTINGS}.before-uninstall-${ts}"
    cp "$SETTINGS" "$safety"
    info "Snapshot of current state: $safety"

    cp "$newest" "$SETTINGS"

    if command -v jq >/dev/null 2>&1; then
        if jq empty "$SETTINGS" 2>/dev/null; then
            ok "Restored $newest → $SETTINGS"
            printf '\nstatusLine now points to: '
            jq -r '.statusLine.command // "(unset)"' "$SETTINGS"
        else
            warn "Restored file does not parse as JSON. Verify $SETTINGS manually."
        fi
    else
        ok "Restored $newest → $SETTINGS (jq not available — JSON not validated)"
    fi

    section "Uninstall complete"
    printf 'Restart Claude Code OR send any message — prior statusline takes effect.\n\n'
    printf 'Files at %s/.claude/statusline/ left in place.\n' "$HOME"
    printf '  Delete everything: rm -rf %s/.claude/statusline\n' "$HOME"
    printf '  Re-enable later:   %s/.claude/statusline/install.sh\n\n' "$HOME"
}

main "$@"
