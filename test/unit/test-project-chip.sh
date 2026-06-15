#!/usr/bin/env bash
# Unit: the project focus chip reads <git-root>/.atomic-skills/focus.json (the
# atomic-skills producer's flat projection) and renders "◇ <plan> · <F i/n> ·
# <done/total>", with a dim "~" when a source file drifted (lastUpdated mismatch
# or missing). Desktop-only — only ever called from identity_row(). Fail-open on
# absent file / plan:null / unknown schemaVersion / CHIP_PROJECT=0.
#
# Self-contained: every case builds its own focus.json (+ source files for the
# staleness cases) in a tmpdir and calls project_chip "$tmp". We do NOT drop
# focus fixtures under test/fixtures/ — that dir is the statusline-input fixture
# runner and would try to execute them as snapshot tests.
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

fail=0
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/.atomic-skills"
f="$tmp/.atomic-skills/focus.json"

# Strip ANSI SGR so assertions test text, not color codes.
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

# run "<extra env>" → captures project_chip "$tmp", ANSI-stripped.
run() {
    local env_str=$1
    env $env_str bash -c "source '$script'; project_chip '$tmp'" 2>/dev/null | strip
}

assert_has() { # <desc> <needle> <haystack>
    if [[ "$3" == *"$2"* ]]; then echo "  ok: $1"
    else echo "  FAIL: $1 — expected to contain [$2], got: [$3]"; fail=1; fi
}
assert_empty() { # <desc> <haystack>
    if [[ -z "$2" ]]; then echo "  ok: $1"
    else echo "  FAIL: $1 — expected empty, got: [$2]"; fail=1; fi
}
assert_no() { # <desc> <needle> <haystack>
    if [[ "$3" != *"$2"* ]]; then echo "  ok: $1"
    else echo "  FAIL: $1 — expected NOT to contain [$2], got: [$3]"; fail=1; fi
}

write_focus() { printf '%s\n' "$1" > "$f"; }

# ── fresh: plan active, source present + matching last_updated → no "~" ──
printf 'last_updated: 2026-06-15T18:35:00Z\n' > "$tmp/.atomic-skills/src.md"
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":2,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[{"path":".atomic-skills/src.md","lastUpdated":"2026-06-15T18:35:00Z"}]}'
out=$(run "")
assert_has  "fresh renders slug + phase + tasks" "my-plan · F0 1/6 · 2/7" "$out"
assert_no   "fresh has no stale marker" "~" "$out"

# ── blocked: tasks.blocked>0 → "⚠N" ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":2,"total":7,"blocked":3},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
out=$(run "")
assert_has "blocked shows warning count" "⚠3" "$out"

# ── multipleActivePlans true → multiplan marker present ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":2,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":true},"sources":[]}'
out=$(run "GLYPH_MULTIPLAN=@M@")
assert_has "multipleActivePlans → marker rendered" "@M@" "$out"
# and absent when false
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":2,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
out=$(run "GLYPH_MULTIPLAN=@M@")
assert_no "single active plan → no marker" "@M@" "$out"

# ── drift: flags.drift true → drift glyph ⌁ ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":3,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":true,"multipleActivePlans":false},"sources":[]}'
out=$(run "")
assert_has "drift shows drift glyph" "⌁" "$out"

# ── stale (missing source): recorded source file does not exist → "~" ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":0,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[{"path":".atomic-skills/gone.md","lastUpdated":"2026-06-15T18:35:00Z"}]}'
out=$(run "")
assert_has "missing source → stale marker" "~" "$out"

# ── stale (mismatch): source exists but last_updated differs ──
printf 'last_updated: 2026-06-15T20:00:00Z\n' > "$tmp/.atomic-skills/src.md"
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":0,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[{"path":".atomic-skills/src.md","lastUpdated":"2026-06-15T18:35:00Z"}]}'
out=$(run "")
assert_has "drifted source → stale marker" "~" "$out"

# ── fresh via camelCase lastUpdated (contract field, nested layout) ──
printf 'lastUpdated: 2026-06-15T18:35:00Z\n' > "$tmp/.atomic-skills/src.md"
out=$(run "")
assert_no "camelCase lastUpdated matches → not stale" "~" "$out"

# ── full id by default (no truncation): long slug shown whole, no ellipsis ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"a-really-long-plan-slug-name","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":0,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
out=$(run "")
assert_has "long slug shown in full" "a-really-long-plan-slug-name" "$out"
assert_no  "no ellipsis by default" "…" "$out"

# ── PROJECT_SLUG_MAX opt-in cap → ellipsis ──
out=$(run "PROJECT_SLUG_MAX=10")
assert_has "PROJECT_SLUG_MAX truncates with ellipsis" "…" "$out"

# ── REGRESSION: plan active but phase:null (schema-valid) → renders, no crash ──
# Empty phase.id must NOT collapse the field split (US separator, not TAB).
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":null,"tasks":{"done":2,"total":7,"blocked":0},"gates":null,"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
out=$(run "")
assert_has "phase:null still renders slug + tasks" "my-plan" "$out"
assert_has "phase:null shows task counts" "2/7" "$out"
assert_no  "phase:null does not leak an error" "unbound" "$out"

# ── REGRESSION: empty plan.slug → renders nothing (guard not defeated by shift) ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":3},"tasks":{"done":1,"total":4,"blocked":0},"gates":null,"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
assert_empty "empty plan.slug → empty" "$(run "")"

# ── source with empty recorded lastUpdated → indeterminate, NOT stale ──
printf 'last_updated: 2026-06-15T18:35:00Z\n' > "$tmp/.atomic-skills/src.md"
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":0,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[{"path":".atomic-skills/src.md","lastUpdated":""}]}'
out=$(run "")
assert_no "empty recorded lastUpdated → not stale" "~" "$out"

# ── null plan → renders nothing ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":null,"phase":null,"tasks":null,"gates":null,"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
assert_empty "plan:null → empty" "$(run "")"

# ── unknown schemaVersion → renders nothing ──
write_focus '{"schemaVersion":"9.9","generatedAt":"x","plan":{"slug":"x","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":1},"tasks":{"done":0,"total":1,"blocked":0},"gates":{"met":0,"total":0},"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
assert_empty "unknown schemaVersion → empty" "$(run "")"

# ── CHIP_PROJECT=0 → renders nothing ──
write_focus '{"schemaVersion":"0.1","generatedAt":"x","plan":{"slug":"my-plan","title":"t","status":"active"},"phase":{"id":"F0","index":1,"total":6},"tasks":{"done":0,"total":7,"blocked":0},"gates":{"met":0,"total":1},"flags":{"drift":false,"multipleActivePlans":false},"sources":[]}'
assert_empty "CHIP_PROJECT=0 → empty" "$(run "CHIP_PROJECT=0")"

# ── absent focus.json → renders nothing ──
rm -f "$f"
assert_empty "absent focus.json → empty" "$(run "")"

# ── empty git-root arg → renders nothing (no crash) ──
out=$(env bash -c "source '$script'; project_chip ''" 2>/dev/null | strip)
assert_empty "empty root arg → empty" "$out"

if (( fail )); then echo "FAILED: test-project-chip"; exit 1; fi
echo "PASS: test-project-chip"
