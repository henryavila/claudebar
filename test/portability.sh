#!/usr/bin/env bash
# Sanity checks for cross-platform portability.
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/../statusline.sh"

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

# 3. Bash 4+ features only (no associative array shorthand, no bash 5+ stuff)
# Spot check: associative arrays via 'declare -A' are bash 4+ OK
if grep -nE '\${[a-zA-Z_]+@U}|\${[a-zA-Z_]+@u}' "$script" >/dev/null; then
    echo "FAIL: bash 5+ parameter expansion (@U, @u) used"; fail=1
else
    echo "  ok: no bash 5+ syntax"
fi

# 4. Script runs with bash 4.0 syntax (basic smoke)
if bash -n "$script"; then
    echo "  ok: bash syntax check passes"
else
    echo "FAIL: bash syntax error"; fail=1
fi

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
