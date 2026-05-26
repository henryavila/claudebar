#!/usr/bin/env bash
# Generate SVG screenshots of the statusline across realistic states.
# Output: docs/screenshots/<state>.svg
set -uo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)"
script="$dir/statusline.sh"
py="$dir/tools/ansi-to-svg.py"
out="$dir/docs/screenshots"

mkdir -p "$out"

render() {
    local name=$1 title=$2 fixture=$3
    local session_id cache_file
    session_id=$(grep -o '"session_id" *: *"[^"]*"' "$fixture" | head -1 \
        | grep -o '"[^"]*"$' | tr -d '"')
    cache_file="/tmp/statusline-git-${session_id:-default}"

    if [[ -f "${fixture%.json}.dirty" ]]; then
        cp "${fixture%.json}.dirty" "$cache_file"
    else
        echo "0" > "$cache_file"
    fi
    touch "$cache_file"

    # Force consistent env for reproducibility:
    # - unset TMUX so tmux chip stays absent (cleaner screenshot without env noise)
    unset TMUX
    "$script" < "$fixture" | python3 "$py" "$title" > "$out/${name}.svg"
    echo "  → $out/${name}.svg"
}

echo "Rendering screenshots…"
render "01-calm"         "Calm — start of session"                 "$dir/test/fixtures/01-calm.json"
render "02-mid-session"  "Mid-session — worktree work in progress" "$dir/test/fixtures/02-mid-session.json"
render "03-caution"      "Caution — yellow zone (60-89%)"          "$dir/test/fixtures/03-caution.json"
render "04-danger"       "Danger — red zone (≥90%) + PR rejected"  "$dir/test/fixtures/04-danger.json"
render "05-agent"        "Subagent dispatched — model dims"        "$dir/test/fixtures/05-agent.json"
render "06-pr-approved"  "PR approved — clean tree"                "$dir/test/fixtures/06-pr-approved.json"

# Compose a single "all states" SVG with stacked panels
echo "Composing all-states.svg…"
python3 - "$out" <<'PY'
import os, sys, re

states = [
    ("01-calm",        "Calm — start of session"),
    ("02-mid-session", "Mid-session — worktree work in progress"),
    ("03-caution",     "Caution — yellow zone (60-89%)"),
    ("04-danger",      "Danger — red zone (≥90%) + PR rejected"),
    ("05-agent",       "Subagent dispatched — model dims"),
    ("06-pr-approved", "PR approved — clean tree"),
]
out_dir = sys.argv[1]

# Read each svg, extract inner content + dims
panels = []
max_w = 0
total_h = 0
for name, _title in states:
    with open(os.path.join(out_dir, f"{name}.svg")) as fh:
        svg = fh.read()
    w = int(re.search(r'width="(\d+)"', svg).group(1))
    h = int(re.search(r'height="(\d+)"', svg).group(1))
    inner = re.search(r'<svg[^>]*>(.*)</svg>', svg, re.DOTALL).group(1)
    panels.append((w, h, inner))
    max_w = max(max_w, w)
    total_h += h + 8

total_h += 16  # outer padding

out_parts = [
    f'<svg xmlns="http://www.w3.org/2000/svg" width="{max_w}" height="{total_h}" '
    f'font-family="JetBrains Mono, Fira Code, Menlo, Consolas, monospace" font-size="14">',
    f'<rect width="{max_w}" height="{total_h}" fill="#11111b"/>',
]
y = 8
for (w, h, inner) in panels:
    out_parts.append(f'<g transform="translate(0,{y})">{inner}</g>')
    y += h + 8

out_parts.append('</svg>')
all_path = os.path.join(out_dir, "all-states.svg")
with open(all_path, "w") as fh:
    fh.write("\n".join(out_parts))
print(f"  → {all_path}")
PY

echo "Done."
