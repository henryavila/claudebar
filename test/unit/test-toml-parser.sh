#!/usr/bin/env bash
set -uo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

fail=0
check() {
    local desc=$1 want=$2 got=$3
    if [[ "$got" == "$want" ]]; then echo "  ok: $desc"
    else echo "  FAIL: $desc — expected='$want' got='$got'"; fail=1; fi
}

source "$repo_root/assets/toml-parser.sh"

compile_str() {
    local tmpfile; tmpfile=$(mktemp)
    printf '%s\n' "$1" > "$tmpfile"
    compile_config "$tmpfile"
    rm -f "$tmpfile"
}

# 1. Colors → C_UPPER_KEY=value
got=$(compile_str '[colors]
model = 99
branch = 40')
check "colors: model" "C_MODEL=99" "$(echo "$got" | grep 'C_MODEL=')"
check "colors: branch" "C_BRANCH=40" "$(echo "$got" | grep 'C_BRANCH=')"

# 2. Naming mismatches
got=$(compile_str '[colors]
effort_high = 111
effort_xhigh = 222
separator = 123')
check "mismatch: effort_high → C_EFFORT_HI" "C_EFFORT_HI=111" "$(echo "$got" | grep 'C_EFFORT_HI=')"
check "mismatch: effort_xhigh → C_EFFORT_XHI" "C_EFFORT_XHI=222" "$(echo "$got" | grep 'C_EFFORT_XHI=')"
check "mismatch: separator → C_SEP" "C_SEP=123" "$(echo "$got" | grep 'C_SEP=')"

# 3. Thresholds → THRESHOLD_*
got=$(compile_str '[thresholds]
warning = 50
critical = 85')
check "thresholds: warning" "THRESHOLD_WARNING=50" "$(echo "$got" | grep 'THRESHOLD_WARNING=')"
check "thresholds: critical" "THRESHOLD_CRITICAL=85" "$(echo "$got" | grep 'THRESHOLD_CRITICAL=')"

# 4. Chips → CHIP_*=1|0
got=$(compile_str '[chips]
tmux = false
pr = true
dirty = false')
check "chips: tmux=false" "CHIP_TMUX=0" "$(echo "$got" | grep 'CHIP_TMUX=')"
check "chips: pr=true" "CHIP_PR=1" "$(echo "$got" | grep 'CHIP_PR=')"
check "chips: dirty=false" "CHIP_DIRTY=0" "$(echo "$got" | grep 'CHIP_DIRTY=')"

# 5. Layout → LAYOUT_*
got=$(compile_str '[layout]
force = compact
refresh_interval = 15')
check "layout: force" "LAYOUT_FORCE=compact" "$(echo "$got" | grep 'LAYOUT_FORCE=')"
check "layout: refresh_interval" "LAYOUT_REFRESH_INTERVAL=15" "$(echo "$got" | grep 'LAYOUT_REFRESH_INTERVAL=')"

# 6. Glyphs → GLYPH_*
got=$(compile_str '[glyphs]
sparkle = *
pencil = P')
check "glyphs: sparkle" "GLYPH_SPARKLE=*" "$(echo "$got" | grep 'GLYPH_SPARKLE=')"
check "glyphs: pencil" "GLYPH_PENCIL=P" "$(echo "$got" | grep 'GLYPH_PENCIL=')"

# 7. Comments and blank lines ignored
got=$(compile_str '# Full-line comment
[colors]
# model = 50
model = 99

')
lines=$(echo "$got" | grep -c '=' || true)
check "comments/blanks: 1 assignment only" "1" "$lines"

# 8. Inline comments stripped
got=$(compile_str '[colors]
model = 99  # hot pink')
check "inline comment stripped" "C_MODEL=99" "$(echo "$got" | grep 'C_MODEL=')"

# 9. Whitespace around =
got=$(compile_str '[colors]
model=99
branch =  40')
check "no-space: model=99" "C_MODEL=99" "$(echo "$got" | grep 'C_MODEL=')"
check "extra-space: branch=40" "C_BRANCH=40" "$(echo "$got" | grep 'C_BRANCH=')"

# 10. Quoted string values
got=$(compile_str '[layout]
force = "compact"')
check "quoted string stripped" "LAYOUT_FORCE=compact" "$(echo "$got" | grep 'LAYOUT_FORCE=')"

# 11. Multiple sections
got=$(compile_str '[colors]
model = 99
[thresholds]
warning = 50
[chips]
tmux = false')
for line in "C_MODEL=99" "THRESHOLD_WARNING=50" "CHIP_TMUX=0"; do
    check "multi-section: $line" "$line" "$(echo "$got" | grep "${line%%=*}=")"
done

if (( fail == 0 )); then echo "PASS: toml-parser"; exit 0
else echo "FAIL: toml-parser"; exit 1; fi
