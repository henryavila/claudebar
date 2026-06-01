#!/usr/bin/env bash
# Unit: the update-available chip reads ~/.config/claudebar/.update-available
# (overridable via CLAUDEBAR_UPDATE_FILE) and renders "⬆ v<version>" when an
# update was found by the background auto-updater. Honors CHIP_UPDATE.
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

fail=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
upd="$tmp/.update-available"

run() {
    # $1 = extra env (e.g. CHIP_UPDATE=0), rest = function + args
    local env_str=$1; shift
    env CLAUDEBAR_UPDATE_FILE="$upd" $env_str bash -c "source '$script'; $*" 2>/dev/null
}

# present file → chip shows the version
printf '1.2.0\n' > "$upd"
out=$(run "" update_chip)
if [[ "$out" == *"v1.2.0"* ]]; then echo "  ok: chip renders v1.2.0"
else echo "  FAIL: expected v1.2.0, got: $out"; fail=1; fi

# CHIP_UPDATE=0 suppresses it
out=$(run "CHIP_UPDATE=0" update_chip)
if [[ -z "$out" ]]; then echo "  ok: CHIP_UPDATE=0 hides chip"
else echo "  FAIL: CHIP_UPDATE=0 should hide chip, got: $out"; fail=1; fi

# absent file → nothing
rm -f "$upd"
out=$(run "" update_chip)
if [[ -z "$out" ]]; then echo "  ok: no file → empty"
else echo "  FAIL: missing file should render nothing, got: $out"; fail=1; fi

# empty/whitespace-only file → nothing (defensive)
printf '   \n' > "$upd"
out=$(run "" update_chip)
if [[ -z "$out" ]]; then echo "  ok: blank file → empty"
else echo "  FAIL: blank file should render nothing, got: $out"; fail=1; fi

# integration: identity_row surfaces the chip when an update is available
printf '1.3.1\n' > "$upd"
out=$(run "" identity_row \
    'model="Opus" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" == *"v1.3.1"* ]]; then echo "  ok: identity_row shows update chip"
else echo "  FAIL: identity_row should show v1.3.1, got: $out"; fail=1; fi

if (( fail == 0 )); then echo "PASS: update chip"; exit 0
else echo "FAIL: update chip"; exit 1; fi
