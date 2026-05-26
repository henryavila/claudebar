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

if [[ ! -f "$fixture" ]]; then echo "Missing fixture: $fixture" >&2; exit 2; fi
if [[ ! -f "$expected" ]]; then echo "Missing expected: $expected" >&2; exit 2; fi

# Extract session_id from JSON, pre-populate cache for hermetic dirty count
session_id=$(grep -o '"session_id":"[^"]*"' "$fixture" | head -1 | cut -d'"' -f4)
session_id=${session_id:-default}
cache_file="/tmp/statusline-git-${session_id}"
if [[ -f "$dirty_sidecar" ]]; then
    cp "$dirty_sidecar" "$cache_file"
else
    echo "0" > "$cache_file"
fi

actual=$("$script" < "$fixture")
expected_content=$(cat "$expected")

if [[ "$actual" == "$expected_content" ]]; then
    echo "PASS: $name"
    exit 0
else
    echo "FAIL: $name"
    diff <(printf '%s\n' "$actual") <(printf '%s\n' "$expected_content") | head -50
    exit 1
fi
