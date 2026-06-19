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

# ── staleness guard: chip must compare .update-available against installed .version ──
# (overridable via CLAUDEBAR_VERSION_FILE) and only surface when available > installed.
vf="$tmp/.version"

# regression: available == installed → stale notification, hide it (the v1.5.0 bug)
printf '1.5.0\n' > "$upd"; printf '1.5.0\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ -z "$out" ]]; then echo "  ok: available==installed hides chip"
else echo "  FAIL: equal versions should hide, got: $out"; fail=1; fi

# available older than installed → stale, hide
printf '1.4.0\n' > "$upd"; printf '1.5.0\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ -z "$out" ]]; then echo "  ok: available<installed hides chip"
else echo "  FAIL: older available should hide, got: $out"; fail=1; fi

# available newer (patch) → show
printf '1.5.1\n' > "$upd"; printf '1.5.0\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ "$out" == *"v1.5.1"* ]]; then echo "  ok: newer patch shows chip"
else echo "  FAIL: newer patch should show, got: $out"; fail=1; fi

# available newer (minor) → show
printf '1.6.0\n' > "$upd"; printf '1.5.0\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ "$out" == *"v1.6.0"* ]]; then echo "  ok: newer minor shows chip"
else echo "  FAIL: newer minor should show, got: $out"; fail=1; fi

# numeric (not lexical) compare: 1.10.0 > 1.9.0 → show
printf '1.10.0\n' > "$upd"; printf '1.9.0\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ "$out" == *"v1.10.0"* ]]; then echo "  ok: 1.10.0 > 1.9.0 (numeric) shows chip"
else echo "  FAIL: numeric compare 1.10.0>1.9.0 should show, got: $out"; fail=1; fi

# numeric compare other direction: installed 1.10.0, available 1.9.0 → hide
printf '1.9.0\n' > "$upd"; printf '1.10.0\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ -z "$out" ]]; then echo "  ok: 1.9.0 < 1.10.0 (numeric) hides chip"
else echo "  FAIL: numeric compare 1.9.0<1.10.0 should hide, got: $out"; fail=1; fi

# patch boundary: installed 1.5.1, available 1.5.0 → hide
printf '1.5.0\n' > "$upd"; printf '1.5.1\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ -z "$out" ]]; then echo "  ok: 1.5.0 < 1.5.1 (patch) hides chip"
else echo "  FAIL: 1.5.0<1.5.1 should hide, got: $out"; fail=1; fi

# installed .version missing → can't prove stale → show (no false hide)
printf '1.5.0\n' > "$upd"; rm -f "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ "$out" == *"v1.5.0"* ]]; then echo "  ok: missing .version → show"
else echo "  FAIL: missing .version should show, got: $out"; fail=1; fi

# installed .version unparseable → show (don't hide a real update)
printf '1.6.0\n' > "$upd"; printf 'dev\n' > "$vf"
out=$(run "CLAUDEBAR_VERSION_FILE=$vf" update_chip)
if [[ "$out" == *"v1.6.0"* ]]; then echo "  ok: unparseable .version → show"
else echo "  FAIL: unparseable .version should show, got: $out"; fail=1; fi

if (( fail == 0 )); then echo "PASS: update chip"; exit 0
else echo "FAIL: update chip"; exit 1; fi
