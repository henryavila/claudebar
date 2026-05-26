#!/usr/bin/env bash
# Usage: run-fixture.sh <fixture-name-without-extension>
# Diffs script output against expected/<name>.txt
#
# Hermetic git state: each fixture's session_id determines the cache file
# at /tmp/statusline-git-<session_id>. To make tests deterministic across
# environments, optionally provide a sidecar file fixtures/<name>.dirty
# containing a single integer (the dirty count to inject). If absent,
# defaults to 0 (clean tree).
set -uo pipefail

name="$1"
dir="$(cd "$(dirname "$0")" && pwd)"
fixture="$dir/fixtures/${name}.json"
expected="$dir/expected/${name}.txt"
dirty_sidecar="$dir/fixtures/${name}.dirty"
script="$dir/../statusline.sh"

# Allow standalone invocation (not via run-all.sh) to still be deterministic.
: "${CLAUDEBAR_NOW_FOR_TESTING:=1830000000}"
: "${CLAUDEBAR_BRANCH_FOR_TESTING:=main}"
export CLAUDEBAR_NOW_FOR_TESTING CLAUDEBAR_BRANCH_FOR_TESTING

# Compact fixtures: names containing "-compact-" force compact layout
# regardless of terminal width.
if [[ "$name" == *-compact-* ]]; then
    export CLAUDEBAR_LAYOUT=compact
else
    export CLAUDEBAR_LAYOUT=full
fi

if [[ ! -f "$fixture" ]]; then echo "Missing fixture: $fixture" >&2; exit 2; fi
if [[ ! -f "$expected" ]]; then echo "Missing expected: $expected" >&2; exit 2; fi

# Extract session_id from JSON, pre-populate cache for hermetic dirty count
session_id=$(grep -o '"session_id" *: *"[^"]*"' "$fixture" | head -1 | grep -o '"[^"]*"$' | tr -d '"')
session_id=${session_id:-default}
cache_file="/tmp/statusline-git-${session_id}"
if [[ -f "$dirty_sidecar" ]]; then
    cp "$dirty_sidecar" "$cache_file"
else
    echo "0" > "$cache_file"
fi
touch "$cache_file"  # ensure mtime is fresh so dirty_count() uses cache (< 5s window)

# Per-fixture branch override (e.g. to test long branch names)
branch_sidecar="$dir/fixtures/${name}.branch"
if [[ -f "$branch_sidecar" ]]; then
    CLAUDEBAR_BRANCH_FOR_TESTING=$(cat "$branch_sidecar")
    export CLAUDEBAR_BRANCH_FOR_TESTING
fi

# Unset TMUX so tmux_chip stays empty in integration fixtures — fixture
# output should be deterministic regardless of whether tests run inside tmux.
# (test/unit/test-tmux.sh covers the tmux feature explicitly with mocked env.)
actual=$(unset TMUX; "$script" < "$fixture")
expected_content=$(cat "$expected")

if [[ "$actual" == "$expected_content" ]]; then
    echo "PASS: $name"
    exit 0
else
    echo "FAIL: $name"
    diff <(printf '%s\n' "$actual") <(printf '%s\n' "$expected_content") | head -50
    exit 1
fi
