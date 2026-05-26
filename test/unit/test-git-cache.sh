#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

# Set up throwaway repo
tmprepo=$(mktemp -d)
trap 'rm -rf "$tmprepo"' EXIT
cd "$tmprepo"
git init -q
git config user.email "t@t"
git config user.name  "t"
echo "x" > file
git add file
git commit -q -m "init"

# Clean tree
result=$(dirty_count "test-session-A")
if [[ "$result" == "0" ]]; then
    echo "  ok: clean tree → 0"
else
    echo "  FAIL: clean tree expected 0 got $result"
    exit 1
fi

# Modify a file
echo "y" >> file
result=$(dirty_count "test-session-B")
if [[ "$result" == "1" ]]; then
    echo "  ok: 1 modified file → 1"
else
    echo "  FAIL: 1 modified expected 1 got $result"
    exit 1
fi

# Cache hit: same session_id within 5s should not re-run git
cache_file="/tmp/statusline-git-test-session-B"
mtime_before=$(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file")
sleep 1
result=$(dirty_count "test-session-B")
mtime_after=$(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file")
if [[ "$mtime_before" == "$mtime_after" && "$result" == "1" ]]; then
    echo "  ok: cache hit within 5s"
else
    echo "  FAIL: cache should not regenerate within 5s (before=$mtime_before after=$mtime_after)"
    exit 1
fi

# Cleanup cache files for this test
rm -f /tmp/statusline-git-test-session-A /tmp/statusline-git-test-session-B

echo "PASS: dirty_count + cache"
