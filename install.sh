#!/usr/bin/env bash
# install.sh — set up Claude Code statusline on this machine.
# Validates prerequisites (does NOT install them) and patches Claude Code's settings.json.
set -uo pipefail

# ─── Flags ───────────────────────────────────────────────────────────
NON_INTERACTIVE=0
for arg in "$@"; do
    case "$arg" in
        --non-interactive) NON_INTERACTIVE=1 ;;
    esac
done

# ─── Colored output helpers ──────────────────────────────────────────
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
BLUE=$'\033[36m'; BOLD=$'\033[1m'; RESET=$'\033[0m'

error() { printf '%s[ERROR]%s %s\n' "$RED"    "$RESET" "$1" >&2; exit 1; }
warn()  { printf '%s[WARN]%s %s\n'  "$YELLOW" "$RESET" "$1" >&2; }
ok()    { printf '%s[OK]%s %s\n'    "$GREEN"  "$RESET" "$1"; }
info()  { printf '%s[INFO]%s %s\n'  "$BLUE"   "$RESET" "$1"; }
section() { printf '\n%s━━━ %s ━━━%s\n' "$BOLD" "$1" "$RESET"; }

# ─── OS detection ────────────────────────────────────────────────────
detect_os() {
    case "$(uname -s)" in
        Darwin) echo macos ;;
        Linux)
            if [[ -f /etc/os-release ]]; then
                # shellcheck disable=SC1091
                . /etc/os-release
                case "${ID:-}" in
                    ubuntu|debian|pop|linuxmint|raspbian) echo debian ;;
                    arch|manjaro|endeavouros)             echo arch ;;
                    fedora|rhel|centos|almalinux|rocky)   echo fedora ;;
                    *) echo linux-other ;;
                esac
            else
                echo linux-other
            fi
            ;;
        *) echo unknown ;;
    esac
}

install_hint() {
    local pkg=$1
    case "$OS" in
        macos)       echo "brew install $pkg" ;;
        debian)      echo "sudo apt install $pkg" ;;
        arch)        echo "sudo pacman -S $pkg" ;;
        fedora)      echo "sudo dnf install $pkg" ;;
        *)           echo "install $pkg via your package manager" ;;
    esac
}

# ─── Check 1: bash version ───────────────────────────────────────────
check_bash() {
    if (( BASH_VERSINFO[0] < 4 )); then
        error "Need bash 4+, found ${BASH_VERSION}. On macOS the default bash is 3.2.57 (frozen at GPLv2). Install a newer bash: $(install_hint bash) — then ensure it's first on PATH."
    fi
    ok "bash ${BASH_VERSION}"
}

# ─── Check 2: required CLI tools ─────────────────────────────────────
check_cmd() {
    local cmd=$1
    if ! command -v "$cmd" >/dev/null 2>&1; then
        error "Required command '$cmd' not found. Install: $(install_hint "$cmd")"
    fi
    ok "$cmd: $(command -v "$cmd")"
}

# ─── Check 3: terminal color support ─────────────────────────────────
check_colors() {
    local colors
    colors=$(tput colors 2>/dev/null || echo 0)
    if (( colors < 256 )); then
        error "Terminal supports only ${colors} colors. Statusline needs 256-color support. Set TERM=xterm-256color (or tmux-256color in tmux) before running Claude Code."
    fi
    ok "Terminal supports $colors colors (TERM=$TERM)"
}

# ─── Check 4: Nerd Font (interactive) ────────────────────────────────
check_nerdfont() {
    section "Nerd Font check"
    printf 'The statusline uses Nerd Font glyphs for icons.\n'
    printf 'Below is a sample of glyphs the statusline will render:\n\n'
    printf '   \xef\x9f\xa8                 \xe2\x8e\x87\n'
    printf '   sparkle  folder    git    pr   chevron  worktree\n\n'
    printf 'Do you see real icons (not empty squares/tofu)? [y/N] '
    local reply=""
    read -r reply
    case "$reply" in
        [yY]|[yY][eE][sS]) ok "Nerd Font confirmed" ;;
        *) error "Nerd Font is required. Install one from https://www.nerdfonts.com/ and configure your terminal to use it. Then re-run this installer." ;;
    esac
}

# ─── Check 5: Claude Code settings.json exists + is valid JSON ───────
check_settings() {
    SETTINGS="$HOME/.claude/settings.json"
    if [[ ! -f "$SETTINGS" ]]; then
        error "Claude Code settings not found at $SETTINGS. Is Claude Code installed?"
    fi
    if ! jq empty "$SETTINGS" 2>/dev/null; then
        error "$SETTINGS exists but is not valid JSON. Fix or reset it before running this installer."
    fi
    ok "settings.json: valid JSON at $SETTINGS"
}

# ─── Check 6: statusline script present and executable ───────────────
check_script() {
    SCRIPT="$HOME/.claude/statusline/statusline.sh"
    if [[ ! -f "$SCRIPT" ]]; then
        error "Statusline script not found at $SCRIPT. Copy the statusline/ directory to ~/.claude/statusline/ before running this installer."
    fi
    if [[ ! -x "$SCRIPT" ]]; then
        chmod +x "$SCRIPT"
        info "Made $SCRIPT executable"
    fi
    ok "Statusline script: $SCRIPT"
}

# ─── Backup + patch settings.json ────────────────────────────────────
patch_settings() {
    local ts backup tmp
    ts=$(date +%Y%m%d-%H%M%S)
    backup="${SETTINGS}.bak-${ts}"
    cp "$SETTINGS" "$backup"
    ok "Backed up settings to $backup"

    tmp=$(mktemp)
    if ! jq --arg cmd "~/.claude/statusline/statusline.sh" '.statusLine = {
        type: "command",
        command: $cmd,
        padding: 0,
        refreshInterval: 30
    }' "$SETTINGS" > "$tmp"; then
        rm -f "$tmp"
        error "jq patch failed. Restore from $backup if needed."
    fi

    if ! jq empty "$tmp" 2>/dev/null; then
        rm -f "$tmp"
        error "Patched JSON is invalid. Aborted — no changes made. Backup at $backup."
    fi

    mv "$tmp" "$SETTINGS"
    ok "Patched $SETTINGS"
    BACKUP_PATH=$backup
}

main() {
    section "Claude Code statusline installer"

    OS=$(detect_os)
    info "Detected OS: $OS"

    section "Prerequisite checks"
    check_bash
    check_cmd jq
    check_cmd git
    check_colors
    if (( NON_INTERACTIVE )); then
        info "Nerd Font check: skipped (--non-interactive)"
    else
        check_nerdfont
    fi

    section "Claude Code integration"
    check_settings
    check_script
    patch_settings

    section "Install complete"
    if (( NON_INTERACTIVE )); then
        ok "statusline configured (backup: $BACKUP_PATH)"
    else
        printf 'Next steps:\n'
        printf '  1. Restart Claude Code OR send any message in your current session\n'
        printf '  2. New statusline appears at the bottom of your terminal\n\n'
        printf 'Rollback if needed:\n'
        printf '  cp %s %s\n\n' "$BACKUP_PATH" "$SETTINGS"
        printf 'Test: ./test/run-all.sh\n\n'
    fi
}

main "$@"
