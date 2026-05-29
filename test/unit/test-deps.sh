#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

# Simulate missing jq by creating a temporary directory tree without jq
fake_path=$(mktemp -d)
fake_bin="$fake_path/bin"
mkdir -p "$fake_bin"

# Symlink (do NOT copy) essential commands BUT NOT jq.
# Symlinks resolve each tool at its real location, so the original signed
# binary executes in place. Copying system binaries to a temp dir is killed
# by macOS library validation (SIGKILL/137), so cp is not portable here.
# Resolve via command -v so /bin/bash (macOS) and /usr/bin/bash (Linux) both work.
for _tool in bash cat grep head cut; do
    _src=$(command -v "$_tool" 2>/dev/null) || continue
    [[ -n "$_src" ]] && ln -s "$_src" "$fake_bin/$_tool" 2>/dev/null || true
done

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
