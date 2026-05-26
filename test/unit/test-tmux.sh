#!/usr/bin/env bash
# Unit tests for tmux_chip — verifies env-based detection and fail-safe behavior.
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# Case 1: TMUX unset → empty output
out=$(unset TMUX; tmux_chip)
if [[ -z "$out" ]]; then
    echo "  ok: tmux_chip empty when TMUX unset"
else
    echo "  FAIL: tmux_chip should be empty when TMUX unset, got: $out"
    fail=1
fi

# Case 2: TMUX set but tmux binary fails → empty output (defensive)
# Simulate by setting TMUX and replacing tmux binary with one that always errors.
fake_path=$(mktemp -d)
cat > "$fake_path/tmux" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$fake_path/tmux"

out=$(TMUX="/fake/sock,123,0" PATH="$fake_path:$PATH" tmux_chip)
if [[ -z "$out" ]]; then
    echo "  ok: tmux_chip empty when tmux command fails"
else
    echo "  FAIL: tmux_chip should be empty on tmux command failure, got: $out"
    fail=1
fi

# Case 3: TMUX set + fake tmux returns expected format → chip rendered
cat > "$fake_path/tmux" <<'EOF'
#!/bin/sh
# Mock: display-message -p '#S:#I.#P' returns "test-sess:2.1"
case "$*" in
    *display-message*) echo "test-sess:2.1" ;;
    *) exit 1 ;;
esac
EOF

out=$(TMUX="/fake/sock,123,0" PATH="$fake_path:$PATH" tmux_chip)
if [[ "$out" == *"test-sess:2.1"* ]]; then
    echo "  ok: tmux_chip renders 'test-sess:2.1' when tmux available"
else
    echo "  FAIL: tmux_chip expected to contain 'test-sess:2.1', got: $out"
    fail=1
fi

# Cleanup
rm -rf "$fake_path"

if (( fail == 0 )); then
    echo "PASS: tmux_chip"
    exit 0
else
    echo "FAIL: tmux_chip"
    exit 1
fi
