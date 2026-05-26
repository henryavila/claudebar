#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

# Simulate missing jq by creating a temporary directory tree without jq
fake_path=$(mktemp -d)
fake_bin="$fake_path/bin"
mkdir -p "$fake_bin"

# Copy essential commands BUT NOT jq
# Use explicit paths to avoid aliases and builtins
cp /usr/bin/bash "$fake_bin/" 2>/dev/null || true
cp /bin/cat "$fake_bin/" 2>/dev/null || cp /usr/bin/cat "$fake_bin/" 2>/dev/null || true
cp /bin/grep "$fake_bin/" 2>/dev/null || cp /usr/bin/grep "$fake_bin/" 2>/dev/null || true
cp /usr/bin/head "$fake_bin/" 2>/dev/null || true
cp /usr/bin/cut "$fake_bin/" 2>/dev/null || true

# Run the script with a PATH that has our fake bin but NOT the system jq
result=$(PATH="$fake_bin" bash -c "cat <<'EOF' | $script
{\"model\":{\"display_name\":\"Opus 4.7\"},\"workspace\":{\"current_dir\":\"/tmp\"}}
EOF" 2>&1)

# Cleanup
rm -rf "$fake_path"

# Expect fallback output (NOT empty, NOT the full pip bar)
if [[ "$result" == *"Opus"* && "$result" != *"▰"* ]]; then
    echo "PASS: missing-jq fallback prints minimal status"
    exit 0
else
    echo "FAIL: missing-jq fallback. Got: $result"
    exit 1
fi
