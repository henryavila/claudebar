#!/usr/bin/env bash
# Usage: run-fixture.sh <fixture-name-without-extension>
# Diffs script output against expected/<name>.txt
set -uo pipefail

name="$1"
dir="$(cd "$(dirname "$0")" && pwd)"
fixture="$dir/fixtures/${name}.json"
expected="$dir/expected/${name}.txt"
script="$dir/../statusline.sh"

if [[ ! -f "$fixture" ]]; then echo "Missing fixture: $fixture" >&2; exit 2; fi
if [[ ! -f "$expected" ]]; then echo "Missing expected: $expected" >&2; exit 2; fi

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
