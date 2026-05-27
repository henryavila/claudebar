#!/usr/bin/env bash
set -uo pipefail

fail=0
check() {
    local desc=$1 want=$2 got=$3
    if [[ "$got" == "$want" ]]; then echo "  ok: $desc"
    else echo "  FAIL: $desc — expected='$want' got='$got'"; fail=1; fi
}

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cp "$repo_root/assets/statusline.sh" "$tmpdir/statusline.sh"
cp "$repo_root/assets/toml-parser.sh" "$tmpdir/toml-parser.sh"
chmod +x "$tmpdir/statusline.sh"

# 1. No config.toml → defaults
got=$(bash -c 'source "'"$tmpdir"'/statusline.sh"; echo "$C_MODEL"')
check "no config.toml → C_MODEL=213" "213" "$got"

# 2. Config.toml present → override
cat > "$tmpdir/config.toml" <<'TOML'
[colors]
model = 99
branch = 40
[thresholds]
warning = 50
TOML
rm -f "$tmpdir/config.sh"

got=$(bash -c 'source "'"$tmpdir"'/statusline.sh"; echo "$C_MODEL $C_BRANCH $THRESHOLD_WARNING"')
check "config.toml overrides applied" "99 40 50" "$got"

# 3. config.sh cache created
if [[ -f "$tmpdir/config.sh" ]]; then echo "  ok: config.sh cache created"
else echo "  FAIL: config.sh should exist"; fail=1; fi

# 4. config.sh NOT recompiled when fresh
sleep 1; touch "$tmpdir/config.sh"
mtime_before=$(stat -c %Y "$tmpdir/config.sh" 2>/dev/null || stat -f %m "$tmpdir/config.sh")
bash -c 'source "'"$tmpdir"'/statusline.sh"' >/dev/null
mtime_after=$(stat -c %Y "$tmpdir/config.sh" 2>/dev/null || stat -f %m "$tmpdir/config.sh")
check "fresh config.sh not recompiled" "$mtime_before" "$mtime_after"

# 5. config.sh recompiled when TOML is newer
sleep 1
cat > "$tmpdir/config.toml" <<'TOML'
[colors]
model = 77
TOML
got=$(bash -c 'source "'"$tmpdir"'/statusline.sh"; echo "$C_MODEL"')
check "stale config.sh recompiled → C_MODEL=77" "77" "$got"

if (( fail == 0 )); then echo "PASS: config loading"; exit 0
else echo "FAIL: config loading"; exit 1; fi
