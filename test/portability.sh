#!/usr/bin/env bash
# Sanity checks for cross-platform portability.
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/../statusline.sh"
parser="$dir/../assets/toml-parser.sh"

fail=0

# 1. Script has no GNU-only stat usage without fallback
if grep -nE 'stat -c [^|]*$' "$script" | grep -v 'file_mtime\|2>/dev/null' >/dev/null; then
    echo "FAIL: ungated 'stat -c' usage (GNU-only) found"; fail=1
else
    echo "  ok: stat usage has fallback"
fi

# 2. No realpath / readlink -f without fallback
if grep -nE 'realpath |readlink -f' "$script" >/dev/null; then
    echo "FAIL: realpath / readlink -f used (not portable to BSD)"; fail=1
else
    echo "  ok: no realpath / readlink -f"
fi

# 3. No bash 4+ features (project targets bash 3.2 — macOS default)
for src in "$script" "$parser"; do
    label=$(basename "$src")
    if grep -nE 'declare -A|declare -n|local -n|mapfile|readarray|\$\{[a-zA-Z_]+@[Uu]\}|\$\{[a-zA-Z_]+,,\}|\$\{[a-zA-Z_]+\^\^\}' "$src" >/dev/null; then
        echo "FAIL: bash 4+ or 5+ syntax found in $label"; fail=1
    else
        echo "  ok: no bash 4+/5+ syntax in $label"
    fi
done

# 4. Scripts pass bash syntax check
for src in "$script" "$parser"; do
    label=$(basename "$src")
    if bash -n "$src"; then
        echo "  ok: bash syntax check passes for $label"
    else
        echo "FAIL: bash syntax error in $label"; fail=1
    fi
done

# 5. jq missing → graceful fallback (already tested in test-deps.sh, recheck)
fake=$(mktemp -d)
out=$(PATH="$fake:/usr/bin:/bin" \
    echo '{"model":{"display_name":"Opus"},"workspace":{"current_dir":"/tmp"}}' \
    | "$script")
rm -rf "$fake"
if [[ "$out" == *"Opus"* ]]; then
    echo "  ok: jq-missing fallback produces output"
else
    echo "FAIL: jq-missing fallback empty"; fail=1
fi

if (( fail == 0 )); then echo; echo "PASS: portability"; exit 0
else echo; echo "FAIL: portability"; exit 1; fi
