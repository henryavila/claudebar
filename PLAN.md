# Claude Code Statusline Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `ccline` statusline with a custom bash script that renders a 2-row pip-style status bar with zone-driven colors (green/yellow/red at 60%/90%), supporting all states defined in the spec.

**Architecture:** Single bash script (`statusline.sh`) reads JSON from stdin, parses with a single `jq` invocation, and emits 2 rows of ANSI-colored text. Helper functions (one per visual primitive) are composed by row builders. Git status is cached per-session to keep p99 latency under 50ms. Cross-platform: portable bash 4+, GNU/BSD `stat` fallback, dependency probe with graceful degradation.

**Tech Stack:** bash 4+, jq, git, ANSI 256-color escape codes, Nerd Font glyphs, simple file-based test harness (golden-output diff + function-level unit tests via sourcing).

**Spec reference:** `~/.claude/statusline/DESIGN.md`

## Testing Conventions

Integration tests (`run-fixture.sh`) run the script with the test harness's **current working directory** = `~/.claude/statusline/`. Git-derived fields (current branch, dirty count) therefore reflect that repo's state. The expected output files were "blessed" with the repo on its default branch (`main`, from `git init`) and clean tree.

If you run tests from a different cwd or different git state, expected outputs will differ in the branch/dirty segments — re-bless them per Task 10 Step 3.

Dirty counts can be controlled per-test by pre-writing the cache file before running:

```bash
echo "3" > /tmp/statusline-git-<session_id>   # 3 dirty files
```

The script reads the cache if it's <5s old, skipping the actual `git status` call.

---

## File Structure

```
~/.claude/statusline/
├── DESIGN.md                   # Spec (already written)
├── PLAN.md                     # This file
├── README.md                   # Install + quick reference
├── CHANGELOG.md                # Version history
├── statusline.sh               # The script Claude Code invokes
├── test/
│   ├── run-all.sh              # Run all tests (unit + integration)
│   ├── run-fixture.sh          # Diff one fixture against expected output
│   ├── unit/
│   │   └── test-helpers.sh     # Function-level tests (sources statusline.sh)
│   ├── fixtures/
│   │   ├── 01-calm.json
│   │   ├── 02-mid-session.json
│   │   ├── 03-caution.json
│   │   ├── 04-danger.json
│   │   ├── 05-agent.json
│   │   ├── 06-pr-approved.json
│   │   ├── 07-main-tree.json
│   │   ├── 10-no-effort.json
│   │   ├── 11-no-repo.json
│   │   ├── 12-no-pr.json
│   │   ├── 13-no-rate-limits.json
│   │   └── 14-no-rate-limits-no-pr.json
│   ├── expected/
│   │   └── <one file per fixture>.txt
│   ├── perf.sh                 # Measure 10-run avg latency
│   └── portability.sh          # Stat fallback + dep-missing checks
└── .git/                       # Personal version control for this tool
```

**File responsibilities:**

- `statusline.sh` — ALL runtime logic. Single file, ~300-400 lines. Sourcing guard so tests can call functions directly.
- `test/run-all.sh` — top-level test runner. Runs unit tests first, then walks every fixture in `test/fixtures/` and diffs against `test/expected/`.
- `test/fixtures/*.json` — synthetic JSON payloads representing each scenario from spec.
- `test/expected/*.txt` — byte-exact expected output INCLUDING ANSI escape sequences. Tests use plain `diff`.

---

## Task 1: Bootstrap project structure

**Files:**
- Create: `~/.claude/statusline/README.md`
- Create: `~/.claude/statusline/CHANGELOG.md`
- Create: `~/.claude/statusline/.gitignore`
- Init: `~/.claude/statusline/.git/`

- [ ] **Step 1: Initialize git repo**

```bash
cd ~/.claude/statusline
git init
```

Expected: "Initialized empty Git repository in /home/henry/.claude/statusline/.git/"

- [ ] **Step 2: Create test directory tree**

```bash
mkdir -p ~/.claude/statusline/test/{unit,fixtures,expected}
```

- [ ] **Step 3: Write `.gitignore`**

Create `~/.claude/statusline/.gitignore`:

```
# Test artifacts
test/tmp/
*.log
```

- [ ] **Step 4: Write `README.md`**

Create `~/.claude/statusline/README.md`:

```markdown
# Claude Code Statusline

Custom statusline for Claude Code. Replaces ccline.

See `DESIGN.md` for the design spec, `PLAN.md` for implementation, `CHANGELOG.md` for version history.

## Install

1. Ensure `jq` and `git` are installed: `which jq git`
2. Point Claude Code at this script in `~/.claude/settings.json`:

   ```json
   "statusLine": {
     "type": "command",
     "command": "~/.claude/statusline/statusline.sh",
     "padding": 0,
     "refreshInterval": 30
   }
   ```

3. Restart Claude Code or send any message to trigger a render.

## Test

```bash
./test/run-all.sh
```
```

- [ ] **Step 5: Write initial `CHANGELOG.md`**

Create `~/.claude/statusline/CHANGELOG.md`:

```markdown
# Changelog

## Unreleased

- Initial implementation per `DESIGN.md` 2026-05-26
```

- [ ] **Step 6: Initial commit**

```bash
cd ~/.claude/statusline
git add DESIGN.md PLAN.md README.md CHANGELOG.md .gitignore
git commit -m "chore: bootstrap statusline project"
```

---

## Task 2: TDD harness and first fixture

**Files:**
- Create: `~/.claude/statusline/statusline.sh` (stub)
- Create: `~/.claude/statusline/test/fixtures/01-calm.json`
- Create: `~/.claude/statusline/test/expected/01-calm.txt`
- Create: `~/.claude/statusline/test/run-fixture.sh`
- Create: `~/.claude/statusline/test/run-all.sh`

- [ ] **Step 1: Write stub `statusline.sh` that just echoes a placeholder**

Create `~/.claude/statusline/statusline.sh`:

```bash
#!/usr/bin/env bash
# Claude Code statusline — see DESIGN.md
set -uo pipefail

main() {
    cat > /dev/null  # consume stdin so Claude Code doesn't block
    echo "TODO: implement statusline"
}

# Sourcing guard: only run main when invoked directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
```

```bash
chmod +x ~/.claude/statusline/statusline.sh
```

- [ ] **Step 2: Write `test/fixtures/01-calm.json`**

```bash
cat > ~/.claude/statusline/test/fixtures/01-calm.json <<'EOF'
{
  "session_id": "test-01-calm",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "project_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"}
  },
  "effort": {"level": "medium"},
  "context_window": {"used_percentage": 12, "context_window_size": 200000},
  "rate_limits": {
    "five_hour":  {"used_percentage": 18, "resets_at": 1830000000},
    "seven_day":  {"used_percentage": 45, "resets_at": 1830500000}
  }
}
EOF
```

- [ ] **Step 3: Write `test/expected/01-calm.txt` (hand-written from spec)**

Use the spec's "STATE 1 · Calm start of session" rendering. Each ANSI sequence written byte-for-byte. The script will be considered correct when it produces this exact output.

```bash
# Use printf to write the file with actual escape codes
printf '\e[38;5;213m✦ Opus 4.7\e[0m \e[38;5;238m·\e[0m \e[38;5;39mMED\e[0m  \e[38;5;245mhenryavila/arch\e[0m \e[38;5;238m›\e[0m \e[38;5;76m main\e[0m \e[38;5;82m✓\e[0m\n\e[38;5;245mctx\e[0m \e[38;5;76m▰\e[0m\e[38;5;238m▱▱▱▱▱▱▱▱▱\e[0m \e[38;5;76m12%\e[0m   \e[38;5;245m5h\e[0m  \e[38;5;76m▰\e[0m\e[38;5;238m▱▱▱▱▱▱▱▱▱\e[0m \e[38;5;76m18%\e[0m   \e[38;5;245m7d\e[0m  \e[38;5;76m▰▰▰▰\e[0m\e[38;5;238m▱▱▱▱▱▱\e[0m \e[38;5;76m45%\e[0m\n' > ~/.claude/statusline/test/expected/01-calm.txt
```

(Note: branch will be `main` here because fixture's JSON doesn't set the branch — it gets resolved via `git branch --show-current` in the actual repo. For tests, the fixture provides the branch via a synthetic mechanism — see Task 7 for git mocking strategy.)

- [ ] **Step 4: Write `test/run-fixture.sh`**

```bash
cat > ~/.claude/statusline/test/run-fixture.sh <<'EOF'
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
EOF
chmod +x ~/.claude/statusline/test/run-fixture.sh
```

- [ ] **Step 5: Write `test/run-all.sh`**

```bash
cat > ~/.claude/statusline/test/run-all.sh <<'EOF'
#!/usr/bin/env bash
# Run all tests: unit tests first, then every fixture in test/fixtures/.
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
pass=0
fail=0
failed_names=()

# Unit tests
for t in "$dir"/unit/test-*.sh; do
    [[ -f "$t" ]] || continue
    if bash "$t"; then
        pass=$((pass+1))
    else
        fail=$((fail+1))
        failed_names+=("unit:$(basename "$t")")
    fi
done

# Fixture/integration tests
for fixture in "$dir"/fixtures/*.json; do
    name=$(basename "$fixture" .json)
    if "$dir/run-fixture.sh" "$name" > /dev/null 2>&1; then
        echo "PASS: $name"
        pass=$((pass+1))
    else
        echo "FAIL: $name"
        "$dir/run-fixture.sh" "$name" || true
        fail=$((fail+1))
        failed_names+=("fixture:$name")
    fi
done

echo
echo "─── Summary ───"
echo "Passed: $pass"
echo "Failed: $fail"
if (( fail > 0 )); then
    printf '  - %s\n' "${failed_names[@]}"
    exit 1
fi
EOF
chmod +x ~/.claude/statusline/test/run-all.sh
```

- [ ] **Step 6: Run the test — verify it FAILS**

```bash
~/.claude/statusline/test/run-all.sh
```

Expected: `FAIL: 01-calm` followed by a diff showing the stub output ("TODO: implement statusline") vs the hand-written expected output. This is the red phase of TDD — proving the test would actually catch a missing implementation.

- [ ] **Step 7: Commit (red phase)**

```bash
cd ~/.claude/statusline
git add statusline.sh test/
git commit -m "test: add TDD harness and first calm-state fixture (red)"
```

---

## Task 3: Dependency probe with graceful degradation

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-deps.sh`

- [ ] **Step 1: Write failing unit test for missing-deps fallback**

Create `~/.claude/statusline/test/unit/test-deps.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

# Simulate missing jq by mangling PATH
fake_path=$(mktemp -d)
# fake_path has no jq

result=$(PATH="$fake_path:/usr/bin:/bin" \
    echo '{"model":{"display_name":"Opus 4.7"},"workspace":{"current_dir":"/tmp"}}' \
    | "$script")

# Expect fallback output (NOT empty, NOT the full pip bar)
if [[ "$result" == *"Opus"* && "$result" != *"▰"* ]]; then
    echo "PASS: missing-jq fallback prints minimal status"
    rm -rf "$fake_path"
    exit 0
else
    echo "FAIL: missing-jq fallback. Got: $result"
    rm -rf "$fake_path"
    exit 1
fi
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-deps.sh
```

Expected: FAIL (the stub doesn't even try to handle this).

- [ ] **Step 3: Implement dependency probe in `statusline.sh`**

Replace the entire `statusline.sh` content with:

```bash
#!/usr/bin/env bash
# Claude Code statusline — see DESIGN.md
set -uo pipefail

# ─── Dependency probe ─────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

minimal_fallback() {
    # Read stdin with grep (no jq) to extract just the model name
    local input model dir
    input=$(cat)
    model=$(printf '%s' "$input" | grep -o '"display_name":"[^"]*"' | head -1 | cut -d'"' -f4)
    dir=$(printf '%s' "$input" | grep -o '"current_dir":"[^"]*"' | head -1 | cut -d'"' -f4)
    : "${model:=?}"
    : "${dir:=?}"
    echo "[$model] ${dir##*/}"
}

main() {
    if ! have jq; then
        minimal_fallback
        return 0
    fi
    # Full implementation comes in later tasks
    cat > /dev/null
    echo "TODO: implement statusline (jq present)"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
```

- [ ] **Step 4: Run unit test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-deps.sh
```

Expected: `PASS: missing-jq fallback prints minimal status`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-deps.sh
git commit -m "feat: dependency probe with graceful fallback when jq missing"
```

---

## Task 4: ANSI palette + zone_color function

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-zone.sh`

- [ ] **Step 1: Write failing unit test for `zone_color`**

Create `~/.claude/statusline/test/unit/test-zone.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local pct=$1 expected=$2
    local actual=$(zone_color "$pct")
    if [[ "$actual" == "$expected" ]]; then
        echo "  ok: zone_color($pct) = $expected"
    else
        echo "  FAIL: zone_color($pct) expected=$expected actual=$actual"
        fail=1
    fi
}

# Green zone: < 60
check 0  76
check 23 76
check 59 76

# Yellow zone: 60 <= x < 90
check 60 220
check 78 220
check 89 220

# Red zone: >= 90
check 90 196
check 94 196
check 100 196

if (( fail == 0 )); then
    echo "PASS: zone_color thresholds"; exit 0
else
    echo "FAIL: zone_color thresholds"; exit 1
fi
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-zone.sh
```

Expected: FAIL ("zone_color: command not found" or similar).

- [ ] **Step 3: Add palette + `zone_color` to `statusline.sh`**

Insert after the `have()` function in `statusline.sh`:

```bash
# ─── Palette (256-color codes from DESIGN.md) ─────────────────────────
readonly C_MODEL=213
readonly C_MODEL_DIM=240
readonly C_EFFORT_LOW=76
readonly C_EFFORT_MED=39
readonly C_EFFORT_HI=220
readonly C_EFFORT_XHI=208
readonly C_EFFORT_MAX=197
readonly C_REPO=245
readonly C_WORKTREE=147
readonly C_BRANCH=76
readonly C_DIRTY=178
readonly C_CLEAN=82
readonly C_PR_PENDING=220
readonly C_PR_APPROVED=82
readonly C_PR_CHANGES=196
readonly C_PR_DRAFT=240
readonly C_BAR_GREEN=76
readonly C_BAR_YELLOW=220
readonly C_BAR_RED=196
readonly C_BAR_DIM=238
readonly C_AGENT=141
readonly C_SEP=238

# ─── ANSI helpers ──────────────────────────────────────────────────────
esc=$'\033'
fg() { printf '%s[38;5;%dm%s%s[0m' "$esc" "$1" "$2" "$esc"; }
sep() { printf '%s[38;5;%dm%s%s[0m' "$esc" "$C_SEP" "$1" "$esc"; }

# ─── Zone color: <60 green, 60-89 yellow, >=90 red ────────────────────
zone_color() {
    local pct=$1
    if   (( pct >= 90 )); then echo "$C_BAR_RED"
    elif (( pct >= 60 )); then echo "$C_BAR_YELLOW"
    else                       echo "$C_BAR_GREEN"
    fi
}
```

- [ ] **Step 4: Run unit test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-zone.sh
```

Expected: `PASS: zone_color thresholds`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-zone.sh
git commit -m "feat: ANSI palette + zone_color thresholds (60/90)"
```

---

## Task 5: pip_bar function

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-pip-bar.sh`

- [ ] **Step 1: Write failing unit test**

Create `~/.claude/statusline/test/unit/test-pip-bar.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
check() {
    local pct=$1 want_filled=$2 want_empty=$3
    local out=$(pip_bar "$pct")
    # Count filled (▰) and empty (▱) glyphs
    local f=$(printf '%s' "$out" | grep -o '▰' | wc -l)
    local e=$(printf '%s' "$out" | grep -o '▱' | wc -l)
    if (( f == want_filled && e == want_empty )); then
        echo "  ok: pip_bar($pct) = ${f}▰ + ${e}▱"
    else
        echo "  FAIL: pip_bar($pct) expected ${want_filled}▰+${want_empty}▱ got ${f}▰+${e}▱"
        fail=1
    fi
}

check 0   0 10
check 9   0 10    # 9*10/100 = 0 (integer floor)
check 10  1 9
check 23  2 8
check 50  5 5
check 99  9 1
check 100 10 0

if (( fail == 0 )); then echo "PASS: pip_bar fill counts"; exit 0
else echo "FAIL: pip_bar"; exit 1; fi
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-pip-bar.sh
```

Expected: FAIL.

- [ ] **Step 3: Implement `pip_bar` in `statusline.sh`**

Add after `zone_color`:

```bash
# ─── pip_bar PCT — render 10-pip zone-colored bar ─────────────────────
pip_bar() {
    local pct=$1
    local color filled empty i
    color=$(zone_color "$pct")
    filled=$(( pct * 10 / 100 ))
    (( filled > 10 )) && filled=10
    (( filled < 0 ))  && filled=0
    empty=$(( 10 - filled ))
    for ((i=0; i<filled; i++)); do fg "$color" "▰"; done
    for ((i=0; i<empty;  i++)); do fg "$C_BAR_DIM" "▱"; done
}
```

- [ ] **Step 4: Run test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-pip-bar.sh
```

Expected: `PASS: pip_bar fill counts`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-pip-bar.sh
git commit -m "feat: pip_bar renderer with zone-driven fill color"
```

---

## Task 6: effort_chip + pr_chip functions

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-chips.sh`

- [ ] **Step 1: Write failing unit test**

Create `~/.claude/statusline/test/unit/test-chips.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# effort_chip
for pair in "low:LOW:$C_EFFORT_LOW" \
            "medium:MED:$C_EFFORT_MED" \
            "high:HIGH:$C_EFFORT_HI" \
            "xhigh:XHIGH:$C_EFFORT_XHI" \
            "max:MAX:$C_EFFORT_MAX"; do
    IFS=: read -r level label color <<< "$pair"
    out=$(effort_chip "$level")
    if [[ "$out" == *"$label"* && "$out" == *"38;5;${color}m"* ]]; then
        echo "  ok: effort_chip($level) contains $label and color $color"
    else
        echo "  FAIL: effort_chip($level) got: $out"; fail=1
    fi
done

# Absent level returns empty
out=$(effort_chip "")
[[ -z "$out" ]] && echo "  ok: effort_chip('') = empty" || { echo "  FAIL: effort_chip empty"; fail=1; }

# pr_chip
for pair in "pending:⏳:$C_PR_PENDING" \
            "approved:✓:$C_PR_APPROVED" \
            "changes_requested:✗:$C_PR_CHANGES" \
            "draft:◯:$C_PR_DRAFT"; do
    IFS=: read -r state glyph color <<< "$pair"
    out=$(pr_chip 1234 "$state")
    if [[ "$out" == *"#1234"* && "$out" == *"$glyph"* && "$out" == *"38;5;${color}m"* ]]; then
        echo "  ok: pr_chip(1234, $state)"
    else
        echo "  FAIL: pr_chip($state) got: $out"; fail=1
    fi
done

if (( fail == 0 )); then echo "PASS: chips"; exit 0
else echo "FAIL: chips"; exit 1; fi
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-chips.sh
```

Expected: FAIL.

- [ ] **Step 3: Implement chip functions**

Add to `statusline.sh` after `pip_bar`:

```bash
# ─── effort_chip LEVEL — colored text chip per effort level ───────────
effort_chip() {
    local level=$1
    case "$level" in
        low)    fg "$C_EFFORT_LOW" "LOW" ;;
        medium) fg "$C_EFFORT_MED" "MED" ;;
        high)   fg "$C_EFFORT_HI"  "HIGH" ;;
        xhigh)  fg "$C_EFFORT_XHI" "XHIGH" ;;
        max)    fg "$C_EFFORT_MAX" "MAX" ;;
        *)      : ;;  # absent or unknown → empty
    esac
}

# ─── pr_chip NUMBER STATE — colored PR chip with state glyph ──────────
# Glyph: nf-fa-code-pull-request (U+F407) ""
pr_chip() {
    local number=$1 state=$2
    local pr_glyph=$''
    case "$state" in
        pending)           fg "$C_PR_PENDING"  "${pr_glyph} #${number} ⏳" ;;
        approved)          fg "$C_PR_APPROVED" "${pr_glyph} #${number} ✓" ;;
        changes_requested) fg "$C_PR_CHANGES"  "${pr_glyph} #${number} ✗" ;;
        draft)             fg "$C_PR_DRAFT"    "${pr_glyph} #${number} ◯" ;;
        "")                fg "$C_PR_PENDING"  "${pr_glyph} #${number}" ;;
        *)                 fg "$C_PR_PENDING"  "${pr_glyph} #${number}" ;;
    esac
}
```

- [ ] **Step 4: Run test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-chips.sh
```

Expected: `PASS: chips`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-chips.sh
git commit -m "feat: effort_chip and pr_chip renderers"
```

---

## Task 7: dirty_indicator + git status cache

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-git-cache.sh`

**Note on testing approach:** Git state depends on the cwd. Tests will create a throwaway git repo in a temp dir and run from there.

- [ ] **Step 1: Write failing unit test**

Create `~/.claude/statusline/test/unit/test-git-cache.sh`:

```bash
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
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-git-cache.sh
```

Expected: FAIL.

- [ ] **Step 3: Implement `dirty_count` with cache + portable stat**

Add to `statusline.sh` after `pr_chip`:

```bash
# ─── Portable stat-mtime ──────────────────────────────────────────────
file_mtime() {
    stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

# ─── dirty_count SESSION_ID — git porcelain count, cached 5s ──────────
# Returns: integer count of dirty files, or empty string if not in a git repo.
dirty_count() {
    local session_id=${1:-default}
    local cache="/tmp/statusline-git-${session_id}"
    local now mtime age
    now=$(date +%s)

    if [[ -f "$cache" ]]; then
        mtime=$(file_mtime "$cache")
        age=$(( now - mtime ))
        if (( age < 5 )); then
            cat "$cache"
            return 0
        fi
    fi

    # Cache stale or missing → regenerate
    if ! have git || ! git rev-parse --git-dir >/dev/null 2>&1; then
        echo "" > "$cache"
        cat "$cache"
        return 0
    fi
    git status --porcelain 2>/dev/null | wc -l | tr -d ' ' > "$cache"
    cat "$cache"
}

# ─── dirty_indicator N — render "✎N" or "✓" ───────────────────────────
dirty_indicator() {
    local count=$1
    if [[ -z "$count" ]]; then
        return 0  # not a git repo → nothing
    fi
    if (( count > 0 )); then
        fg "$C_DIRTY" "✎${count}"
    else
        fg "$C_CLEAN" "✓"
    fi
}
```

- [ ] **Step 4: Run test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-git-cache.sh
```

Expected: `PASS: dirty_count + cache`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-git-cache.sh
git commit -m "feat: dirty_count with 5s session-scoped cache + portable stat"
```

---

## Task 8: identity_row composer (normal + agent active)

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-identity.sh`

- [ ] **Step 1: Write failing unit test**

Create `~/.claude/statusline/test/unit/test-identity.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# Normal mode
out=$(identity_row \
    model="Opus 4.7" \
    effort=high \
    owner=henryavila repo=arch \
    worktree=filament-v4-migration \
    branch=feature/filament-v4-migration \
    dirty_count=3 \
    pr_number=1234 pr_state=pending \
    agent="")

want_substrings=("Opus 4.7" "HIGH" "henryavila/arch" "⎇" "feature/filament-v4-migration" "✎3" "#1234")
for s in "${want_substrings[@]}"; do
    if [[ "$out" != *"$s"* ]]; then
        echo "  FAIL: normal identity_row missing '$s'"; fail=1
    fi
done
(( fail == 0 )) && echo "  ok: normal identity row contains all expected segments"

# Agent active mode
out=$(identity_row \
    model="Opus 4.7" \
    effort=high \
    owner=henryavila repo=arch \
    worktree=filament-v4-migration \
    branch=feature/filament-v4-migration \
    dirty_count=3 \
    pr_number=1234 pr_state=pending \
    agent="Explore")

if [[ "$out" == *"agent:Explore"* && "$out" != *"HIGH"* ]]; then
    echo "  ok: agent mode replaces effort with agent name"
else
    echo "  FAIL: agent mode should hide HIGH chip"; fail=1
fi

# Missing PR
out=$(identity_row model="Opus" effort=high owner=h repo=r \
    worktree= branch=main dirty_count=0 pr_number= pr_state= agent="")
if [[ "$out" != *"#"* ]]; then
    echo "  ok: missing PR hides chip"
else
    echo "  FAIL: missing PR should not render '#'"; fail=1
fi

# Missing effort
out=$(identity_row model="Opus" effort="" owner=h repo=r \
    worktree= branch=main dirty_count=0 pr_number= pr_state= agent="")
if [[ "$out" != *"HIGH"* && "$out" != *"MED"* && "$out" != *"MAX"* ]]; then
    echo "  ok: missing effort hides chip"
else
    echo "  FAIL: missing effort should not render any effort label"; fail=1
fi

(( fail == 0 )) && { echo "PASS: identity_row"; exit 0; } || { echo "FAIL: identity_row"; exit 1; }
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-identity.sh
```

Expected: FAIL.

- [ ] **Step 3: Implement `identity_row` using keyword-argument style**

Add to `statusline.sh`:

```bash
# ─── identity_row — compose row 1 ─────────────────────────────────────
# Usage: identity_row key=value key=value ...
# Keys: model effort owner repo worktree branch dirty_count
#       pr_number pr_state agent
identity_row() {
    local model="" effort="" owner="" repo=""
    local worktree="" branch="" dirty_count=""
    local pr_number="" pr_state="" agent=""

    local arg
    for arg in "$@"; do
        case "$arg" in
            model=*)        model=${arg#model=} ;;
            effort=*)       effort=${arg#effort=} ;;
            owner=*)        owner=${arg#owner=} ;;
            repo=*)         repo=${arg#repo=} ;;
            worktree=*)     worktree=${arg#worktree=} ;;
            branch=*)       branch=${arg#branch=} ;;
            dirty_count=*)  dirty_count=${arg#dirty_count=} ;;
            pr_number=*)    pr_number=${arg#pr_number=} ;;
            pr_state=*)     pr_state=${arg#pr_state=} ;;
            agent=*)        agent=${arg#agent=} ;;
        esac
    done

    local sparkle="✦"
    local git_glyph=$''   # nf-fa-code-fork  
    local wt_glyph=$'⎇'

    # ── Left group: model + (effort | agent) ─────────────
    if [[ -n "$agent" ]]; then
        fg "$C_MODEL_DIM" "${sparkle} Opus"  # dimmed
        printf ' '
        sep "·"
        printf ' '
        fg "$C_AGENT" "${git_glyph} agent:${agent}"
        printf '%s[5m' "$esc"  # blink on
        fg "$C_AGENT" " ●"
        printf '%s[25m' "$esc"  # blink off
    else
        fg "$C_MODEL" "${sparkle} ${model}"
        if [[ -n "$effort" ]]; then
            printf ' '
            sep "·"
            printf ' '
            effort_chip "$effort"
        fi
    fi

    # ── Middle group: repo › [⎇ ]branch dirty ────────────
    if [[ -n "$owner" && -n "$repo" ]]; then
        printf '  '
        fg "$C_REPO" "${owner}/${repo}"
        printf ' '
        sep "›"
        printf ' '
        if [[ -n "$worktree" ]]; then
            fg "$C_WORKTREE" "${wt_glyph} "
        fi
        if [[ -n "$branch" ]]; then
            fg "$C_BRANCH" "${git_glyph} ${branch}"
        fi
        if [[ -n "$dirty_count" ]]; then
            printf ' '
            dirty_indicator "$dirty_count"
        fi
    fi

    # ── Right group: PR chip ─────────────────────────────
    if [[ -n "$pr_number" ]]; then
        printf '   '
        pr_chip "$pr_number" "$pr_state"
    fi

    printf '\n'
}
```

- [ ] **Step 4: Run test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-identity.sh
```

Expected: `PASS: identity_row`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-identity.sh
git commit -m "feat: identity_row composer (normal + agent-active modes)"
```

---

## Task 9: fuel_row composer (3 bars)

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`
- Create: `~/.claude/statusline/test/unit/test-fuel.sh`

- [ ] **Step 1: Write failing unit test**

Create `~/.claude/statusline/test/unit/test-fuel.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0

# All three present
out=$(fuel_row ctx=23 five_hour=34 seven_day=62)
for label in "ctx" "5h" "7d"; do
    [[ "$out" == *"$label"* ]] || { echo "  FAIL: fuel_row missing label '$label'"; fail=1; }
done
[[ "$out" == *"23%"* && "$out" == *"34%"* && "$out" == *"62%"* ]] \
    || { echo "  FAIL: fuel_row missing percentage"; fail=1; }

# 5h absent → no 5h bar
out=$(fuel_row ctx=23 five_hour= seven_day=62)
if [[ "$out" == *"5h"* ]]; then
    echo "  FAIL: 5h should be hidden when five_hour empty"; fail=1
else
    echo "  ok: 5h hidden when absent"
fi

# Both rate limits absent → only ctx bar
out=$(fuel_row ctx=23 five_hour= seven_day=)
if [[ "$out" == *"5h"* || "$out" == *"7d"* ]]; then
    echo "  FAIL: both rate bars should be hidden"; fail=1
else
    echo "  ok: only ctx bar when rate limits absent"
fi

(( fail == 0 )) && { echo "PASS: fuel_row"; exit 0; } || { echo "FAIL: fuel_row"; exit 1; }
```

- [ ] **Step 2: Run test — verify it FAILS**

```bash
bash ~/.claude/statusline/test/unit/test-fuel.sh
```

Expected: FAIL.

- [ ] **Step 3: Implement `fuel_row`**

Add to `statusline.sh`:

```bash
# ─── fuel_row — compose row 2 (the 3 bars) ────────────────────────────
fuel_row() {
    local ctx="" five_hour="" seven_day=""
    local arg
    for arg in "$@"; do
        case "$arg" in
            ctx=*)        ctx=${arg#ctx=} ;;
            five_hour=*)  five_hour=${arg#five_hour=} ;;
            seven_day=*)  seven_day=${arg#seven_day=} ;;
        esac
    done

    # ctx — always render even if 0
    : "${ctx:=0}"
    fg "$C_REPO" "ctx"; printf ' '
    pip_bar "$ctx"
    printf ' '
    fg "$(zone_color "$ctx")" "$(printf '%2d%%' "$ctx")"

    # 5h
    if [[ -n "$five_hour" ]]; then
        printf '   '
        fg "$C_REPO" "5h"; printf '  '
        pip_bar "$five_hour"
        printf ' '
        fg "$(zone_color "$five_hour")" "$(printf '%2d%%' "$five_hour")"
    fi

    # 7d
    if [[ -n "$seven_day" ]]; then
        printf '   '
        fg "$C_REPO" "7d"; printf '  '
        pip_bar "$seven_day"
        printf ' '
        fg "$(zone_color "$seven_day")" "$(printf '%2d%%' "$seven_day")"
    fi

    printf '\n'
}
```

- [ ] **Step 4: Run test — verify it PASSES**

```bash
bash ~/.claude/statusline/test/unit/test-fuel.sh
```

Expected: `PASS: fuel_row`

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/unit/test-fuel.sh
git commit -m "feat: fuel_row composer with conditional 5h/7d bars"
```

---

## Task 10: main() — wire stdin/jq parsing to row builders

**Files:**
- Modify: `~/.claude/statusline/statusline.sh`

- [ ] **Step 1: Replace placeholder `main` with real implementation**

Replace the existing `main()` function in `statusline.sh`:

```bash
# ─── main ─────────────────────────────────────────────────────────────
main() {
    # Dependency probe
    if ! have jq; then
        minimal_fallback
        return 0
    fi

    local input jq_out
    input=$(cat)

    # Parse once with jq — emit shell-safe assignments via @sh, then eval them.
    # Each field uses // "" fallback so absent fields → empty bash vars.
    jq_out=$(printf '%s' "$input" | jq -r '
        "MODEL="      + ((.model.display_name // .model.id // "?") | @sh) + "\n" +
        "SESSION_ID=" + ((.session_id // "default") | @sh) + "\n" +
        "EFFORT="     + ((.effort.level // "") | @sh) + "\n" +
        "OWNER="      + ((.workspace.repo.owner // "") | @sh) + "\n" +
        "REPO="       + ((.workspace.repo.name // "") | @sh) + "\n" +
        "WORKTREE="   + ((.workspace.git_worktree // "") | @sh) + "\n" +
        "CTX="        + ((.context_window.used_percentage // 0 | floor) | tostring | @sh) + "\n" +
        "FIVE_HOUR="  + ((.rate_limits.five_hour.used_percentage // "") | tostring | @sh) + "\n" +
        "SEVEN_DAY="  + ((.rate_limits.seven_day.used_percentage // "") | tostring | @sh) + "\n" +
        "PR_NUMBER="  + ((.pr.number // "") | tostring | @sh) + "\n" +
        "PR_STATE="   + ((.pr.review_state // "") | @sh) + "\n" +
        "AGENT="      + ((.agent.name // "") | @sh)
    ')
    eval "$jq_out"

    # Derive branch (not in JSON for normal sessions — git is source of truth)
    local BRANCH=""
    if have git && git rev-parse --git-dir >/dev/null 2>&1; then
        BRANCH=$(git branch --show-current 2>/dev/null || echo "")
    fi

    # Derive dirty count
    local DIRTY=""
    if have git && git rev-parse --git-dir >/dev/null 2>&1; then
        DIRTY=$(dirty_count "$SESSION_ID")
    fi

    # Cast FIVE_HOUR / SEVEN_DAY (jq emits floats like "23.5") to int
    [[ -n "$FIVE_HOUR" ]] && FIVE_HOUR=$(printf '%.0f' "$FIVE_HOUR")
    [[ -n "$SEVEN_DAY" ]] && SEVEN_DAY=$(printf '%.0f' "$SEVEN_DAY")

    # Render
    identity_row \
        model="$MODEL" \
        effort="$EFFORT" \
        owner="$OWNER" repo="$REPO" \
        worktree="$WORKTREE" \
        branch="$BRANCH" \
        dirty_count="$DIRTY" \
        pr_number="$PR_NUMBER" pr_state="$PR_STATE" \
        agent="$AGENT"

    fuel_row \
        ctx="$CTX" \
        five_hour="$FIVE_HOUR" \
        seven_day="$SEVEN_DAY"
}
```

- [ ] **Step 2: Smoke-test interactively with a JSON fixture**

```bash
~/.claude/statusline/test/run-fixture.sh 01-calm
```

Expected: PASS (or a clear diff if the expected file needs to be re-blessed because branch/dirty are derived from the actual repo state — see Step 3).

- [ ] **Step 3: Re-bless `expected/01-calm.txt` if needed**

If the actual output differs from the hand-written expected only in dynamic fields (branch name, dirty count), regenerate:

```bash
cd ~/.claude/statusline
test/run-fixture.sh 01-calm 2>&1 | head -5
# If only branch differs, re-bless:
./statusline.sh < test/fixtures/01-calm.json > test/expected/01-calm.txt
# Manually inspect:
cat -v test/expected/01-calm.txt
```

Important: the "bless" step is a one-time correction when test was hand-written incorrectly. Subsequent fixtures should set their own context (synthetic git state) so blessing is the *initial* state-capture, not a "make tests green" shortcut.

- [ ] **Step 4: Run all tests — verify they PASS**

```bash
~/.claude/statusline/test/run-all.sh
```

Expected: All unit tests + `01-calm` fixture pass.

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add statusline.sh test/expected/01-calm.txt
git commit -m "feat: main() wires jq parsing → identity_row + fuel_row"
```

---

## Task 11: Bless remaining fixtures (states 02-07)

**Files:**
- Create: `~/.claude/statusline/test/fixtures/02-mid-session.json` through `07-main-tree.json`
- Create: corresponding `test/expected/*.txt`

**Strategy:** for each spec state, write a fixture, run the script in a controlled git state (via env vars / pre-set worktree), capture the output as the expected file, then visually compare to the demo `STATE N` from `/tmp/statusline-demo-final.sh` to validate correctness.

- [ ] **Step 1: Write fixture `02-mid-session.json`**

```bash
cat > ~/.claude/statusline/test/fixtures/02-mid-session.json <<'EOF'
{
  "session_id": "test-02",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"},
    "git_worktree": "filament-v4-migration"
  },
  "effort": {"level": "high"},
  "context_window": {"used_percentage": 23},
  "rate_limits": {
    "five_hour": {"used_percentage": 34},
    "seven_day": {"used_percentage": 62}
  },
  "pr": {"number": 1234, "review_state": "pending"}
}
EOF
```

- [ ] **Step 2: Bless expected output**

```bash
cd ~/.claude/statusline
./statusline.sh < test/fixtures/02-mid-session.json > test/expected/02-mid-session.txt
```

- [ ] **Step 3: Visually verify against demo STATE 2**

Compare `cat test/expected/02-mid-session.txt` against the demo's STATE 2 output. Should look identical (modulo synthetic git state).

- [ ] **Step 4: Write fixture `05-agent.json` (structural difference: adds `agent` block)**

```bash
cat > ~/.claude/statusline/test/fixtures/05-agent.json <<'EOF'
{
  "session_id": "test-05",
  "model": {"id": "claude-opus-4-7", "display_name": "Opus 4.7"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"},
    "git_worktree": "filament-v4-migration"
  },
  "effort": {"level": "high"},
  "context_window": {"used_percentage": 23},
  "rate_limits": {
    "five_hour": {"used_percentage": 34},
    "seven_day": {"used_percentage": 62}
  },
  "pr": {"number": 1234, "review_state": "pending"},
  "agent": {"name": "Explore"}
}
EOF
./statusline.sh < ~/.claude/statusline/test/fixtures/05-agent.json > ~/.claude/statusline/test/expected/05-agent.txt
```

- [ ] **Step 5: Write remaining fixtures 03/04/06/07 by copy-and-edit**

Each is the same shape as `02-mid-session.json` (no `agent` block) with these field changes:

- **03-caution.json:** `effort=high`, `ctx=65`, `five_hour=72`, `seven_day=68`, PR pending
- **04-danger.json:** `effort=max`, `ctx=92`, `five_hour=89`, `seven_day=75`, PR `changes_requested`
- **06-pr-approved.json:** `effort=high`, `ctx=28`, `five_hour=42`, `seven_day=65`, PR `approved`
- **07-main-tree.json:** `effort=medium`, `ctx=15`, `five_hour=22`, `seven_day=50`, **omit** `workspace.git_worktree` AND `pr` entirely

For each, bless the expected output:

```bash
for n in 03-caution 04-danger 06-pr-approved 07-main-tree; do
    ./statusline.sh < test/fixtures/${n}.json > test/expected/${n}.txt
done
```

- [ ] **Step 6: Run all tests — verify all 7 fixtures pass**

```bash
~/.claude/statusline/test/run-all.sh
```

Expected: 7 fixture passes + all unit tests pass.

- [ ] **Step 7: Commit**

```bash
cd ~/.claude/statusline
git add test/fixtures/0[2-7]*.json test/expected/0[2-7]*.txt
git commit -m "test: integration fixtures for states 02-07"
```

---

## Task 12: Absence-handling fixtures

**Files:**
- Create: `~/.claude/statusline/test/fixtures/10-no-effort.json` through `14-no-rate-limits-no-pr.json`
- Create: corresponding `test/expected/*.txt`

- [ ] **Step 1: Write fixture `10-no-effort.json` (model with no effort support)**

```bash
cat > ~/.claude/statusline/test/fixtures/10-no-effort.json <<'EOF'
{
  "session_id": "test-10",
  "model": {"id": "claude-haiku-4-5", "display_name": "Haiku 4.5"},
  "workspace": {
    "current_dir": "/home/henry/arch",
    "repo": {"host": "github.com", "owner": "henryavila", "name": "arch"}
  },
  "context_window": {"used_percentage": 12},
  "rate_limits": {
    "five_hour": {"used_percentage": 18},
    "seven_day": {"used_percentage": 45}
  }
}
EOF
```

- [ ] **Step 2: Bless and verify no effort chip in output**

```bash
cd ~/.claude/statusline
./statusline.sh < test/fixtures/10-no-effort.json > test/expected/10-no-effort.txt
grep -q "MED\|HIGH\|MAX\|LOW\|XHIGH" test/expected/10-no-effort.txt && echo "BUG: effort visible" || echo "OK: no effort"
```

Expected: "OK: no effort"

- [ ] **Step 3: Write fixtures 11 (no repo), 12 (no PR), 13 (no rate limits), 14 (no rate limits + no PR)**

For each: copy a working fixture, remove the relevant section(s), bless the output, verify the hidden field is indeed absent.

- [ ] **Step 4: Run all tests**

```bash
~/.claude/statusline/test/run-all.sh
```

Expected: all unit + all fixture tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/.claude/statusline
git add test/fixtures/1[0-4]*.json test/expected/1[0-4]*.txt
git commit -m "test: absence-handling fixtures (no effort/repo/PR/rate-limits)"
```

---

## Task 13: Performance budget verification (<50ms)

**Files:**
- Create: `~/.claude/statusline/test/perf.sh`

- [ ] **Step 1: Write `test/perf.sh`**

```bash
cat > ~/.claude/statusline/test/perf.sh <<'EOF'
#!/usr/bin/env bash
# Measures avg latency over N runs. Fails if avg > BUDGET_MS.
set -uo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
script="$dir/../statusline.sh"
fixture="$dir/fixtures/02-mid-session.json"
budget_ms=50
runs=10

total_ns=0
for i in $(seq 1 $runs); do
    start=$(date +%s%N)
    "$script" < "$fixture" > /dev/null
    end=$(date +%s%N)
    total_ns=$(( total_ns + end - start ))
done
avg_ms=$(( total_ns / runs / 1000000 ))

echo "Average: ${avg_ms}ms over ${runs} runs (budget ${budget_ms}ms)"
if (( avg_ms <= budget_ms )); then
    echo "PASS: performance budget"
    exit 0
else
    echo "FAIL: exceeded budget"
    exit 1
fi
EOF
chmod +x ~/.claude/statusline/test/perf.sh
```

- [ ] **Step 2: Run it**

```bash
~/.claude/statusline/test/perf.sh
```

Expected: PASS with avg ~10-30ms. If it FAILS:
- Check if jq is invoked multiple times (consolidate into 1 call)
- Check if git status is being called repeatedly (cache hit ratio)
- Consider porting hot paths to a single `awk` invocation

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/statusline
git add test/perf.sh
git commit -m "test: performance budget check (<50ms avg)"
```

---

## Task 14: Portability test (stat fallback + missing deps)

**Files:**
- Create: `~/.claude/statusline/test/portability.sh`

- [ ] **Step 1: Write `test/portability.sh`**

```bash
cat > ~/.claude/statusline/test/portability.sh <<'EOF'
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
EOF
chmod +x ~/.claude/statusline/test/portability.sh
```

- [ ] **Step 2: Run it**

```bash
~/.claude/statusline/test/portability.sh
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd ~/.claude/statusline
git add test/portability.sh
git commit -m "test: cross-platform portability checks"
```

---

## Task 15: Swap settings.json (with rollback path)

**Files:**
- Modify: `~/.claude/settings.json`
- Create: `~/.claude/settings.json.bak-pre-statusline-redesign`

- [ ] **Step 1: Back up current `settings.json`**

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak-pre-statusline-redesign
```

- [ ] **Step 2: View current statusLine block**

```bash
jq '.statusLine' ~/.claude/settings.json
```

Expected output (matches what was probed at conversation start):

```json
{
  "type": "command",
  "command": "~/.claude/ccline/ccline",
  "padding": 0
}
```

- [ ] **Step 3: Update statusLine in-place via jq**

```bash
tmp=$(mktemp)
jq '.statusLine = {
  "type": "command",
  "command": "~/.claude/statusline/statusline.sh",
  "padding": 0,
  "refreshInterval": 30
}' ~/.claude/settings.json > "$tmp" && mv "$tmp" ~/.claude/settings.json
```

- [ ] **Step 4: Validate JSON**

```bash
jq '.statusLine' ~/.claude/settings.json
```

Expected:

```json
{
  "type": "command",
  "command": "~/.claude/statusline/statusline.sh",
  "padding": 0,
  "refreshInterval": 30
}
```

- [ ] **Step 5: Document rollback in CHANGELOG**

Append to `~/.claude/statusline/CHANGELOG.md`:

```markdown
## v1.0.0 — 2026-05-26

- Replaced ccline with custom pip-style statusline
- Zone-driven colors (60/90 thresholds), worktree marker, git dirty indicator, agent pulse

### Rollback

If anything goes wrong, restore the old statusline:

```bash
cp ~/.claude/settings.json.bak-pre-statusline-redesign ~/.claude/settings.json
```

Then restart Claude Code.
```

- [ ] **Step 6: Commit**

```bash
cd ~/.claude/statusline
git add CHANGELOG.md
git commit -m "chore: swap settings.json to new statusline + document rollback"
```

---

## Task 16: Live smoke test + final acceptance walkthrough

**Files:** None (verification only)

- [ ] **Step 1: Restart Claude Code OR send a new message to trigger statusline re-render**

The user must send any prompt to Claude Code (the script runs after each assistant message).

- [ ] **Step 2: Walk the spec's acceptance criteria 1-14**

For each criterion in `DESIGN.md` § Acceptance Criteria:

1. ☐ 7 demo states render — visually compare to `/tmp/statusline-demo-final.sh` output
2. ☐ Color thresholds at 60% and 90% — verify with synthetic high-ctx session
3. ☐ Bar fills accurate — count pips at known % values (test/perf already covers this)
4. ☐ Worktree marker iff `workspace.git_worktree` present — compare worktree vs main-tree sessions
5. ☐ Git dirty updates within 5s — touch a file, wait 5s, verify chip updates
6. ☐ Agent dispatch dims model, hides effort, pulses agent — dispatch via `Agent` tool, observe
7. ☐ PR chip glyph/color across 4 states — simulated via fixture tests
8. ☐ Effort chip hidden when absent — fixture 10 covers
9. ☐ 5h/7d bars hidden when rate_limits absent — fixture 13/14 cover
10. ☐ Exec time < 50ms — perf.sh confirms
11. ☐ No tofu/boxes — visual check
12. ☐ settings.json updated, old ccline reference gone — `grep ccline ~/.claude/settings.json` should return nothing
13. ☐ Runs on WSL + native Ubuntu — portability.sh confirms (manually verify on native Ubuntu if accessible)
14. ☐ Graceful degradation when jq/git missing — test-deps.sh confirms

- [ ] **Step 3: If any criterion fails, file as a follow-up task**

For each failing criterion, create a fresh task at the bottom of this PLAN.md describing the gap and the fix, then continue.

- [ ] **Step 4: Tag v1.0.0**

```bash
cd ~/.claude/statusline
git tag -a v1.0.0 -m "v1.0.0: zone-driven pip statusline"
```

- [ ] **Step 5: Update CHANGELOG.md "Unreleased" section to be empty**

The v1.0.0 section already exists from Task 15. Add an "Unreleased" stub above it:

```markdown
## Unreleased

(nothing yet)

## v1.0.0 — 2026-05-26
...
```

- [ ] **Step 6: Final commit**

```bash
cd ~/.claude/statusline
git add CHANGELOG.md
git commit -m "chore: tag v1.0.0 release"
```

---

## Done

When all 16 tasks are checked off, the new statusline is live and the spec's acceptance criteria are fully covered. The repo at `~/.claude/statusline/` is the canonical source for this tool going forward.

Future work tracked in `CHANGELOG.md` under "Unreleased" and in the **Future Expansion** section of `DESIGN.md`.
