# npm Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package claudebar as `@henryavila/claudebar` on npm with a `npx` CLI for install/update/config/doctor/uninstall/install-font, a TOML config system, and GitHub Actions CI/CD. Eliminate the need to clone a git repo.

**Architecture:** Move `statusline.sh` to `assets/`, symlink at root. Convert palette to conditional defaults (`${VAR:-default}`). Add config loading block that sources `config.sh` (compiled from `config.toml` by `toml-parser.sh`). Node.js ESM CLI with zero npm deps dispatches subcommands. Chip toggle guards (`CHIP_*`) enable/disable individual segments.

**Tech Stack:** Bash 3.2+ (statusline runtime), Node.js 18+ ESM (CLI only), TOML config format, GitHub Actions OIDC publishing

**Spec:** `docs/superpowers/specs/2026-05-26-config-system-design.md`

**Naming mismatches:** TOML uses user-friendly keys (`effort_high`, `effort_xhigh`, `separator`); the compiler maps these to existing bash variables (`C_EFFORT_HI`, `C_EFFORT_XHI`, `C_SEP`). No bash variable renames needed.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `statusline.sh` | Convert to symlink | Root symlink → `assets/statusline.sh` |
| `assets/statusline.sh` | Create (move) | Config loading block, conditional defaults, chip toggles |
| `assets/toml-parser.sh` | Create | Bash TOML → config.sh compiler (~50 lines) |
| `assets/default-config.toml` | Create | Config template with all options commented |
| `package.json` | Create | `@henryavila/claudebar` v2.0.0, zero deps |
| `bin/cli.js` | Create | npx entry point with subcommand dispatch |
| `src/install.js` | Create | Install flow (copy assets, patch settings.json) |
| `src/update.js` | Create | Update flow (replace files, migrate config) |
| `src/config.js` | Create | Open $EDITOR, validate, recompile |
| `src/doctor.js` | Create | 10 diagnostic checks |
| `src/uninstall.js` | Create | Remove statusLine, rm config dir |
| `src/install-font.js` | Create | Cross-platform Nerd Font install |
| `src/toml-parser.js` | Create | Node.js TOML parser with validation |
| `src/config-compiler.js` | Create | TOML object → config.sh string |
| `src/config-migrator.js` | Create | Config schema migration engine |
| `test/unit/test-config-override.sh` | Create | Verify conditional default overrides |
| `test/unit/test-toml-parser.sh` | Create | Bash TOML parser tests |
| `test/unit/test-config-loading.sh` | Create | Config loading pipeline tests |
| `test/unit/test-chip-toggle.sh` | Create | Chip toggle guard tests |
| `test/cli/toml-parser.test.js` | Create | Node.js TOML parser tests |
| `test/cli/config-compiler.test.js` | Create | Node.js compiler tests |
| `test/cli/install.test.js` | Create | Install command tests |
| `test/cli/doctor.test.js` | Create | Doctor command tests |
| `test/cli/uninstall.test.js` | Create | Uninstall command tests |
| `test/cli/config.test.js` | Create | Config command tests |
| `test/cli/update.test.js` | Create | Update command tests |
| `test/cli/config-migrator.test.js` | Create | Migration engine tests |
| `test/cli/install-font.test.js` | Create | Font install tests |
| `test/portability.sh` | Modify | Also scan `assets/toml-parser.sh` |
| `install.sh` | Modify | Add deprecation notice |
| `uninstall.sh` | Modify | Add deprecation notice |
| `.gitignore` | Modify | Add `node_modules/` |
| `.github/workflows/test.yml` | Create | CI on push/PR |
| `.github/workflows/publish.yml` | Create | npm publish on release |

---

## Task 1: Move statusline.sh to assets/ with symlink

**Files:**
- Move: `statusline.sh` → `assets/statusline.sh`
- Create: `statusline.sh` (symlink → `assets/statusline.sh`)

Not a TDD task — restructure only.

- [ ] **Step 1: Create assets/ and move the script**

```bash
mkdir -p assets
git mv statusline.sh assets/statusline.sh
```

- [ ] **Step 2: Create the symlink at repo root**

```bash
ln -s assets/statusline.sh statusline.sh
```

- [ ] **Step 3: Verify symlink resolution**

Run: `ls -la statusline.sh && head -1 statusline.sh`
Expected: symlink to `assets/statusline.sh`, first line `#!/usr/bin/env bash`

- [ ] **Step 4: Verify all tests pass through symlink**

Run: `bash test/run-all.sh && bash test/perf.sh && bash test/portability.sh`
Expected: All pass. Tests resolve `$dir/../statusline.sh` → symlink → `assets/statusline.sh`.

- [ ] **Step 5: Commit**

Message: `refactor: move statusline.sh to assets/ with root symlink for npm packaging`

---

## Task 2: Convert palette to conditional defaults

**Files:**
- Create: `test/unit/test-config-override.sh`
- Modify: `assets/statusline.sh`

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-config-override.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

fail=0
check() {
    local desc=$1 want=$2 got=$3
    if [[ "$got" == "$want" ]]; then
        echo "  ok: $desc"
    else
        echo "  FAIL: $desc — expected='$want' got='$got'"
        fail=1
    fi
}

script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

# 1. Color override
got=$(C_MODEL=99 bash -c 'source "'"$script"'"; echo "$C_MODEL"')
check "C_MODEL overridden to 99" "99" "$got"

# 2. Default preserved when unset
got=$(bash -c 'unset C_MODEL; source "'"$script"'"; echo "$C_MODEL"')
check "C_MODEL defaults to 213" "213" "$got"

# 3. Glyph override
got=$(GLYPH_PENCIL=X bash -c 'source "'"$script"'"; echo "$GLYPH_PENCIL"')
check "GLYPH_PENCIL overridden to X" "X" "$got"

# 4. Window duration override
got=$(WINDOW_5H_SECONDS=9999 bash -c 'source "'"$script"'"; echo "$WINDOW_5H_SECONDS"')
check "WINDOW_5H_SECONDS overridden to 9999" "9999" "$got"

# 5. Threshold override changes zone_color
got=$(THRESHOLD_WARNING=40 THRESHOLD_CRITICAL=70 bash -c '
    source "'"$script"'"
    echo "$(zone_color 30) $(zone_color 50) $(zone_color 80)"
')
check "custom thresholds: 30=green 50=yellow 80=red" "76 220 196" "$got"

# 6. Default thresholds unchanged
got=$(bash -c '
    unset THRESHOLD_WARNING THRESHOLD_CRITICAL
    source "'"$script"'"
    echo "$THRESHOLD_WARNING $THRESHOLD_CRITICAL"
')
check "default thresholds 60 90" "60 90" "$got"

# 7. C_SEP override
got=$(C_SEP=123 bash -c 'source "'"$script"'"; echo "$C_SEP"')
check "C_SEP overridden to 123" "123" "$got"

# 8. C_EFFORT_HI override
got=$(C_EFFORT_HI=111 bash -c 'source "'"$script"'"; echo "$C_EFFORT_HI"')
check "C_EFFORT_HI overridden to 111" "111" "$got"

if (( fail == 0 )); then echo "PASS: config override"; exit 0
else echo "FAIL: config override"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-config-override.sh`
Expected: FAIL — `readonly VAR=VALUE` rejects env overrides; `THRESHOLD_*` variables don't exist.

- [ ] **Step 3: Implement**

Modify `assets/statusline.sh`:

**Replace palette block (lines 9-31) with conditional defaults:**
```bash
readonly C_MODEL=${C_MODEL:-213}
readonly C_MODEL_DIM=${C_MODEL_DIM:-240}
readonly C_EFFORT_LOW=${C_EFFORT_LOW:-76}
readonly C_EFFORT_MED=${C_EFFORT_MED:-39}
readonly C_EFFORT_HI=${C_EFFORT_HI:-220}
readonly C_EFFORT_XHI=${C_EFFORT_XHI:-208}
readonly C_EFFORT_MAX=${C_EFFORT_MAX:-197}
readonly C_REPO=${C_REPO:-245}
readonly C_WORKTREE=${C_WORKTREE:-147}
readonly C_BRANCH=${C_BRANCH:-76}
readonly C_DIRTY=${C_DIRTY:-178}
readonly C_CLEAN=${C_CLEAN:-82}
readonly C_PR_PENDING=${C_PR_PENDING:-220}
readonly C_PR_APPROVED=${C_PR_APPROVED:-82}
readonly C_PR_CHANGES=${C_PR_CHANGES:-196}
readonly C_PR_DRAFT=${C_PR_DRAFT:-240}
readonly C_BAR_GREEN=${C_BAR_GREEN:-76}
readonly C_BAR_YELLOW=${C_BAR_YELLOW:-220}
readonly C_BAR_RED=${C_BAR_RED:-196}
readonly C_BAR_DIM=${C_BAR_DIM:-238}
readonly C_AGENT=${C_AGENT:-141}
readonly C_TMUX=${C_TMUX:-105}
readonly C_SEP=${C_SEP:-238}
```

**Replace window durations (lines 38-39):**
```bash
readonly WINDOW_5H_SECONDS=${WINDOW_5H_SECONDS:-18000}
readonly WINDOW_7D_SECONDS=${WINDOW_7D_SECONDS:-604800}
```

**Add thresholds (new block, after window durations):**
```bash
readonly THRESHOLD_WARNING=${THRESHOLD_WARNING:-60}
readonly THRESHOLD_CRITICAL=${THRESHOLD_CRITICAL:-90}
```

**Replace glyph block (lines 53-57):**
```bash
readonly GLYPH_PENCIL=${GLYPH_PENCIL:-$'\xef\x81\x80'}
readonly GLYPH_GIT=${GLYPH_GIT:-$'\xee\x9c\xa5'}
readonly GLYPH_PR=${GLYPH_PR:-$'\xef\x90\x87'}
readonly GLYPH_TMUX=${GLYPH_TMUX:-$'\xef\x86\xb2'}
readonly GLYPH_GEAR=${GLYPH_GEAR:-$'\xef\x82\x85'}
```

**Update `zone_color()` to use threshold variables:**
```bash
zone_color() {
    local pct=$1
    if   (( pct >= THRESHOLD_CRITICAL )); then echo "$C_BAR_RED"
    elif (( pct >= THRESHOLD_WARNING ));  then echo "$C_BAR_YELLOW"
    else                                       echo "$C_BAR_GREEN"
    fi
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-config-override.sh`
Expected: PASS

- [ ] **Step 5: Verify no regressions**

Run: `bash test/run-all.sh`
Expected: All 21 fixtures + unit tests pass (same defaults = identical output).

- [ ] **Step 6: Commit**

Message: `feat: convert palette to conditional defaults and extract zone thresholds`

---

## Task 3: Create assets/toml-parser.sh (bash TOML parser)

**Files:**
- Create: `test/unit/test-toml-parser.sh`
- Create: `assets/toml-parser.sh`

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-toml-parser.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

fail=0
check() {
    local desc=$1 want=$2 got=$3
    if [[ "$got" == "$want" ]]; then echo "  ok: $desc"
    else echo "  FAIL: $desc — expected='$want' got='$got'"; fail=1; fi
}

source "$repo_root/assets/toml-parser.sh"

compile_str() {
    local tmpfile; tmpfile=$(mktemp)
    printf '%s\n' "$1" > "$tmpfile"
    compile_config "$tmpfile"
    rm -f "$tmpfile"
}

# 1. Colors → C_UPPER_KEY=value
got=$(compile_str '[colors]
model = 99
branch = 40')
check "colors: model" "C_MODEL=99" "$(echo "$got" | grep 'C_MODEL=')"
check "colors: branch" "C_BRANCH=40" "$(echo "$got" | grep 'C_BRANCH=')"

# 2. Naming mismatches
got=$(compile_str '[colors]
effort_high = 111
effort_xhigh = 222
separator = 123')
check "mismatch: effort_high → C_EFFORT_HI" "C_EFFORT_HI=111" "$(echo "$got" | grep 'C_EFFORT_HI=')"
check "mismatch: effort_xhigh → C_EFFORT_XHI" "C_EFFORT_XHI=222" "$(echo "$got" | grep 'C_EFFORT_XHI=')"
check "mismatch: separator → C_SEP" "C_SEP=123" "$(echo "$got" | grep 'C_SEP=')"

# 3. Thresholds → THRESHOLD_*
got=$(compile_str '[thresholds]
warning = 50
critical = 85')
check "thresholds: warning" "THRESHOLD_WARNING=50" "$(echo "$got" | grep 'THRESHOLD_WARNING=')"
check "thresholds: critical" "THRESHOLD_CRITICAL=85" "$(echo "$got" | grep 'THRESHOLD_CRITICAL=')"

# 4. Chips → CHIP_*=1|0
got=$(compile_str '[chips]
tmux = false
pr = true
dirty = false')
check "chips: tmux=false" "CHIP_TMUX=0" "$(echo "$got" | grep 'CHIP_TMUX=')"
check "chips: pr=true" "CHIP_PR=1" "$(echo "$got" | grep 'CHIP_PR=')"
check "chips: dirty=false" "CHIP_DIRTY=0" "$(echo "$got" | grep 'CHIP_DIRTY=')"

# 5. Layout → LAYOUT_*
got=$(compile_str '[layout]
force = compact
refresh_interval = 15')
check "layout: force" "LAYOUT_FORCE=compact" "$(echo "$got" | grep 'LAYOUT_FORCE=')"
check "layout: refresh_interval" "LAYOUT_REFRESH_INTERVAL=15" "$(echo "$got" | grep 'LAYOUT_REFRESH_INTERVAL=')"

# 6. Glyphs → GLYPH_*
got=$(compile_str '[glyphs]
sparkle = *
pencil = P')
check "glyphs: sparkle" "GLYPH_SPARKLE=*" "$(echo "$got" | grep 'GLYPH_SPARKLE=')"
check "glyphs: pencil" "GLYPH_PENCIL=P" "$(echo "$got" | grep 'GLYPH_PENCIL=')"

# 7. Comments and blank lines ignored
got=$(compile_str '# Full-line comment
[colors]
# model = 50
model = 99

')
lines=$(echo "$got" | grep -c '=' || true)
check "comments/blanks: 1 assignment only" "1" "$lines"

# 8. Inline comments stripped
got=$(compile_str '[colors]
model = 99  # hot pink')
check "inline comment stripped" "C_MODEL=99" "$(echo "$got" | grep 'C_MODEL=')"

# 9. Whitespace around =
got=$(compile_str '[colors]
model=99
branch =  40')
check "no-space: model=99" "C_MODEL=99" "$(echo "$got" | grep 'C_MODEL=')"
check "extra-space: branch=40" "C_BRANCH=40" "$(echo "$got" | grep 'C_BRANCH=')"

# 10. Quoted string values
got=$(compile_str '[layout]
force = "compact"')
check "quoted string stripped" "LAYOUT_FORCE=compact" "$(echo "$got" | grep 'LAYOUT_FORCE=')"

# 11. Multiple sections
got=$(compile_str '[colors]
model = 99
[thresholds]
warning = 50
[chips]
tmux = false')
for line in "C_MODEL=99" "THRESHOLD_WARNING=50" "CHIP_TMUX=0"; do
    check "multi-section: $line" "$line" "$(echo "$got" | grep "${line%%=*}=")"
done

if (( fail == 0 )); then echo "PASS: toml-parser"; exit 0
else echo "FAIL: toml-parser"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-toml-parser.sh`
Expected: FAIL — `assets/toml-parser.sh` does not exist.

- [ ] **Step 3: Implement**

Create `assets/toml-parser.sh`:

```bash
#!/usr/bin/env bash
# Minimal TOML → bash variable compiler for claudebar config.
# Supports: [section] headers, key = value, # comments, booleans.
# Does NOT support: nested tables, arrays, multi-line strings.
# Uses tr (not ${var^^}) for bash 3.2 compatibility.

compile_config() {
    local file=$1
    local section=""

    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%%#*}"
        line=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        [[ -z "$line" ]] && continue

        if [[ "$line" =~ ^\[([a-z_]+)\]$ ]]; then
            section="${BASH_REMATCH[1]}"
            continue
        fi

        if [[ "$line" =~ ^([a-z_]+)[[:space:]]*=[[:space:]]*(.*) ]]; then
            local key="${BASH_REMATCH[1]}"
            local val="${BASH_REMATCH[2]}"
            val=$(printf '%s' "$val" | sed "s/^[\"']//;s/[\"']$//;s/[[:space:]]*$//")
            local upper_key
            upper_key=$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')

            case "$section" in
                colors)
                    local var
                    case "$key" in
                        effort_high)  var="C_EFFORT_HI" ;;
                        effort_xhigh) var="C_EFFORT_XHI" ;;
                        separator)    var="C_SEP" ;;
                        *)            var="C_${upper_key}" ;;
                    esac
                    printf '%s=%s\n' "$var" "$val"
                    ;;
                thresholds) printf 'THRESHOLD_%s=%s\n' "$upper_key" "$val" ;;
                chips)
                    case "$val" in
                        true)  val=1 ;; false) val=0 ;;
                    esac
                    printf 'CHIP_%s=%s\n' "$upper_key" "$val"
                    ;;
                layout) printf 'LAYOUT_%s=%s\n' "$upper_key" "$val" ;;
                glyphs) printf 'GLYPH_%s=%s\n' "$upper_key" "$val" ;;
            esac
        fi
    done < "$file"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-toml-parser.sh`
Expected: PASS

- [ ] **Step 5: Verify no regressions + portability**

Run: `bash test/run-all.sh && bash test/portability.sh`
Expected: All pass. `toml-parser.sh` is standalone — no existing code affected.

- [ ] **Step 6: Commit**

Message: `feat: add bash TOML parser for runtime config compilation`

---

## Task 4: Config loading block + default-config.toml + portability update

**Files:**
- Create: `test/unit/test-config-loading.sh`
- Create: `assets/default-config.toml`
- Modify: `assets/statusline.sh` (add config loading block)
- Modify: `test/portability.sh` (scan `assets/toml-parser.sh`)

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-config-loading.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail

fail=0
check() {
    local desc=$1 want=$2 got=$3
    if [[ "$got" == "$want" ]]; then echo "  ok: $desc"
    else echo "  FAIL: $desc — expected='$want' got='$got'"; fail=1; fi
}

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cp "$repo_root/assets/statusline.sh" "$tmpdir/statusline.sh"
cp "$repo_root/assets/toml-parser.sh" "$tmpdir/toml-parser.sh"
chmod +x "$tmpdir/statusline.sh"

# 1. No config.toml → defaults
got=$(bash -c 'source "'"$tmpdir"'/statusline.sh"; echo "$C_MODEL"')
check "no config.toml → C_MODEL=213" "213" "$got"

# 2. Config.toml present → override
cat > "$tmpdir/config.toml" <<'TOML'
[colors]
model = 99
branch = 40
[thresholds]
warning = 50
TOML
rm -f "$tmpdir/config.sh"

got=$(bash -c 'source "'"$tmpdir"'/statusline.sh"; echo "$C_MODEL $C_BRANCH $THRESHOLD_WARNING"')
check "config.toml overrides applied" "99 40 50" "$got"

# 3. config.sh cache created
if [[ -f "$tmpdir/config.sh" ]]; then echo "  ok: config.sh cache created"
else echo "  FAIL: config.sh should exist"; fail=1; fi

# 4. config.sh NOT recompiled when fresh
sleep 1; touch "$tmpdir/config.sh"
mtime_before=$(stat -c %Y "$tmpdir/config.sh" 2>/dev/null || stat -f %m "$tmpdir/config.sh")
bash -c 'source "'"$tmpdir"'/statusline.sh"' >/dev/null
mtime_after=$(stat -c %Y "$tmpdir/config.sh" 2>/dev/null || stat -f %m "$tmpdir/config.sh")
check "fresh config.sh not recompiled" "$mtime_before" "$mtime_after"

# 5. config.sh recompiled when TOML is newer
sleep 1
cat > "$tmpdir/config.toml" <<'TOML'
[colors]
model = 77
TOML
got=$(bash -c 'source "'"$tmpdir"'/statusline.sh"; echo "$C_MODEL"')
check "stale config.sh recompiled → C_MODEL=77" "77" "$got"

if (( fail == 0 )); then echo "PASS: config loading"; exit 0
else echo "FAIL: config loading"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-config-loading.sh`
Expected: FAIL — config loading block doesn't exist yet.

- [ ] **Step 3: Implement**

**3a. Add config loading block to `assets/statusline.sh`.**

Insert after `have() { ... }` (line 6), before the palette comment:

```bash

# ─── Config loading ──────────────────────────────────────────────────
_CB_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_CB_CONFIG_TOML="$_CB_SCRIPT_DIR/config.toml"
_CB_CONFIG_SH="$_CB_SCRIPT_DIR/config.sh"

if [[ -f "$_CB_CONFIG_TOML" ]]; then
    if [[ ! -f "$_CB_CONFIG_SH" ]] || [[ "$_CB_CONFIG_TOML" -nt "$_CB_CONFIG_SH" ]]; then
        source "$_CB_SCRIPT_DIR/toml-parser.sh"
        compile_config "$_CB_CONFIG_TOML" > "$_CB_CONFIG_SH"
    fi
    source "$_CB_CONFIG_SH"
fi
```

**3b. Create `assets/default-config.toml`:**

```toml
# claudebar config v1
#
# All options shown with defaults, commented out.
# Uncomment and change only what you want.
# Recompiles automatically on next statusline render.
#
# Docs: https://github.com/henryavila/claudebar

[layout]
# force = "auto"
# refresh_interval = 30

[chips]
# model = true
# effort = true
# tmux = true
# repo = true
# branch = true
# worktree = true
# dirty = true
# pr = true
# agent = true
# ctx_bar = true
# five_hour_bar = true
# seven_day_bar = true
# countdown = true
# time_marker = true

[thresholds]
# warning = 60
# critical = 90

[colors]
# model = 213
# model_dim = 240
# effort_low = 76
# effort_med = 39
# effort_high = 220
# effort_xhigh = 208
# effort_max = 197
# repo = 245
# worktree = 147
# branch = 76
# dirty = 178
# clean = 82
# pr_pending = 220
# pr_approved = 82
# pr_changes = 196
# pr_draft = 240
# bar_green = 76
# bar_yellow = 220
# bar_red = 196
# bar_dim = 238
# agent = 141
# tmux = 105
# separator = 238

[glyphs]
# sparkle = "✦"
# pencil = ""
# git = ""
# pr = ""
# tmux = ""
# gear = ""
# worktree = "⎇"
```

**3c. Update `test/portability.sh` to also scan `toml-parser.sh`:**

Add variable after line 6: `parser="$dir/../assets/toml-parser.sh"`

Replace check #3 (bash 4+ features) to loop over both files:
```bash
for src in "$script" "$parser"; do
    label=$(basename "$src")
    if grep -nE 'declare -A|declare -n|local -n|mapfile|readarray|\$\{[a-zA-Z_]+@[Uu]\}|\$\{[a-zA-Z_]+,,\}|\$\{[a-zA-Z_]+\^\^\}' "$src" >/dev/null; then
        echo "FAIL: bash 4+ or 5+ syntax found in $label"; fail=1
    else
        echo "  ok: no bash 4+/5+ syntax in $label"
    fi
done
```

Similarly update check #4 (syntax check) to loop over both files.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-config-loading.sh`
Expected: PASS

- [ ] **Step 5: Verify no regressions**

Run: `bash test/run-all.sh && bash test/portability.sh`
Expected: All pass. No `config.toml` in `assets/` → config loading block is a no-op during tests.

- [ ] **Step 6: Commit**

Message: `feat: add config loading block, default-config.toml, and extend portability checks`

---

## Task 5: Chip toggle declarations + guards in render functions

**Files:**
- Create: `test/unit/test-chip-toggle.sh`
- Modify: `assets/statusline.sh` (add CHIP_* defaults + guards in render functions)

- [ ] **Step 1: Write the failing test**

Create `test/unit/test-chip-toggle.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"

fail=0

run_fn() {
    local env_str=$1; shift
    local fn=$1; shift
    env $env_str bash -c "source '$script'; $fn $*" 2>/dev/null
}

# CHIP_PR=0 hides PR chip
out=$(run_fn "CHIP_PR=0" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number=42 pr_state=pending agent=""')
if [[ "$out" != *"#42"* ]]; then echo "  ok: CHIP_PR=0 hides PR"
else echo "  FAIL: CHIP_PR=0 should hide #42"; fail=1; fi

# CHIP_PR=1 (default) shows PR chip
out=$(run_fn "" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number=42 pr_state=pending agent=""')
if [[ "$out" == *"#42"* ]]; then echo "  ok: CHIP_PR=1 shows PR"
else echo "  FAIL: default CHIP_PR should show #42"; fail=1; fi

# CHIP_EFFORT=0 hides effort
out=$(run_fn "CHIP_EFFORT=0" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"HIGH"* ]]; then echo "  ok: CHIP_EFFORT=0 hides effort"
else echo "  FAIL: CHIP_EFFORT=0 should hide HIGH"; fail=1; fi

# CHIP_MODEL=0 hides model name
out=$(run_fn "CHIP_MODEL=0" identity_row \
    'model="Opus 4.7" effort=high owner=h repo=r worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"Opus"* ]]; then echo "  ok: CHIP_MODEL=0 hides model"
else echo "  FAIL: CHIP_MODEL=0 should hide Opus"; fail=1; fi

# CHIP_REPO=0 hides repo
out=$(run_fn "CHIP_REPO=0" identity_row \
    'model="Opus 4.7" effort=high owner=henryavila repo=arch worktree= branch=main dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"henryavila/arch"* ]]; then echo "  ok: CHIP_REPO=0 hides repo"
else echo "  FAIL: CHIP_REPO=0 should hide repo"; fail=1; fi

# CHIP_BRANCH=0 hides branch
out=$(run_fn "CHIP_BRANCH=0" identity_row \
    'model="Opus 4.7" effort= owner=h repo=r worktree= branch=feat-x dirty_count=0 pr_number= pr_state= agent=""')
if [[ "$out" != *"feat-x"* ]]; then echo "  ok: CHIP_BRANCH=0 hides branch"
else echo "  FAIL: CHIP_BRANCH=0 should hide branch"; fail=1; fi

# CHIP_DIRTY=0 hides dirty count
out=$(run_fn "CHIP_DIRTY=0" identity_row \
    'model="Opus 4.7" effort= owner=h repo=r worktree= branch=main dirty_count=5 pr_number= pr_state= agent=""')
if [[ "$out" != *"5"* ]]; then echo "  ok: CHIP_DIRTY=0 hides dirty"
else echo "  FAIL: CHIP_DIRTY=0 should hide dirty count"; fail=1; fi

# CHIP_CTX_BAR=0 hides context bar
out=$(run_fn "CHIP_CTX_BAR=0" fuel_row \
    'ctx=50 five_hour=30 seven_day=20 five_hour_resets_at= seven_day_resets_at=')
if [[ "$out" != *"ctx"* ]]; then echo "  ok: CHIP_CTX_BAR=0 hides ctx"
else echo "  FAIL: CHIP_CTX_BAR=0 should hide ctx label"; fail=1; fi

if (( fail == 0 )); then echo "PASS: chip toggle"; exit 0
else echo "FAIL: chip toggle"; exit 1; fi
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash test/unit/test-chip-toggle.sh`
Expected: FAIL — `CHIP_*` variables don't exist and guards aren't in render functions.

- [ ] **Step 3: Implement**

**3a. Add CHIP_* defaults after the palette block in `assets/statusline.sh`:**

```bash
# ─── Chip toggle defaults ────────────────────────────────────────────
readonly CHIP_MODEL=${CHIP_MODEL:-1}
readonly CHIP_EFFORT=${CHIP_EFFORT:-1}
readonly CHIP_TMUX=${CHIP_TMUX:-1}
readonly CHIP_REPO=${CHIP_REPO:-1}
readonly CHIP_BRANCH=${CHIP_BRANCH:-1}
readonly CHIP_WORKTREE=${CHIP_WORKTREE:-1}
readonly CHIP_DIRTY=${CHIP_DIRTY:-1}
readonly CHIP_PR=${CHIP_PR:-1}
readonly CHIP_AGENT=${CHIP_AGENT:-1}
readonly CHIP_CTX_BAR=${CHIP_CTX_BAR:-1}
readonly CHIP_FIVE_HOUR_BAR=${CHIP_FIVE_HOUR_BAR:-1}
readonly CHIP_SEVEN_DAY_BAR=${CHIP_SEVEN_DAY_BAR:-1}
readonly CHIP_COUNTDOWN=${CHIP_COUNTDOWN:-1}
readonly CHIP_TIME_MARKER=${CHIP_TIME_MARKER:-1}
```

**3b. Add guards in `identity_row()`:**

Wrap model chip: `if (( CHIP_MODEL )); then ... fi`
Wrap effort chip: add `&& (( CHIP_EFFORT ))` to existing effort condition
Wrap agent chip: add `&& (( CHIP_AGENT ))` to existing agent condition
Wrap tmux chip: add `&& (( CHIP_TMUX ))` to existing TMUX condition
Wrap repo segment: `if [[ -n "$repo" ]] && (( CHIP_REPO )); then ... fi`
Wrap branch: add `&& (( CHIP_BRANCH ))` condition
Wrap worktree marker: add `&& (( CHIP_WORKTREE ))` condition
Wrap dirty indicator: add `&& (( CHIP_DIRTY ))` condition
Wrap PR chip: add `&& (( CHIP_PR ))` to existing pr_number condition

**3c. Add guards in `fuel_row()`:**

Wrap ctx gauge: `if (( CHIP_CTX_BAR )); then ... fi`
Wrap 5h gauge: `if (( CHIP_FIVE_HOUR_BAR )); then ... fi`
Wrap 7d gauge: `if (( CHIP_SEVEN_DAY_BAR )); then ... fi`
Inside each gauge: guard countdown text with `if (( CHIP_COUNTDOWN ))`
Inside each gauge: pass marker=0 when `! (( CHIP_TIME_MARKER ))`

**3d. Same pattern for `compact_row1/2/3`.**

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash test/unit/test-chip-toggle.sh`
Expected: PASS

- [ ] **Step 5: Verify no regressions**

Run: `bash test/run-all.sh`
Expected: All pass. CHIP_* defaults to 1 = all chips visible = identical output.

- [ ] **Step 6: Commit**

Message: `feat: add chip toggle guards for all statusline segments`

---

## Task 6: npm package scaffold

**Files:**
- Create: `package.json`
- Create: `bin/cli.js`
- Modify: `.gitignore` (add `node_modules/`)

Not a TDD task.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@henryavila/claudebar",
  "version": "2.0.0",
  "type": "module",
  "description": "Zone-driven statusline for Claude Code with TOML config",
  "bin": {
    "claudebar": "./bin/cli.js"
  },
  "files": [
    "bin/",
    "src/",
    "assets/",
    "README.md",
    "CHANGELOG.md"
  ],
  "engines": {
    "node": ">= 18.0.0"
  },
  "scripts": {
    "test": "node --test test/cli/*.test.js && bash test/run-all.sh",
    "test:cli": "node --test test/cli/*.test.js",
    "test:bash": "bash test/run-all.sh"
  },
  "keywords": ["claude-code", "statusline", "terminal", "claudebar"],
  "author": "Henry Avila",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/henryavila/claudebar"
  }
}
```

- [ ] **Step 2: Create bin/cli.js**

```javascript
#!/usr/bin/env node
import { argv, exit } from 'node:process';

const [,, command, ...args] = argv;

const commands = {
  install:       () => import('../src/install.js'),
  update:        () => import('../src/update.js'),
  config:        () => import('../src/config.js'),
  doctor:        () => import('../src/doctor.js'),
  uninstall:     () => import('../src/uninstall.js'),
  'install-font': () => import('../src/install-font.js'),
};

if (!command || command === '--help' || command === '-h') {
  console.log(`\
claudebar — zone-driven statusline for Claude Code

Usage: claudebar <command>

Commands:
  install        Install statusline to ~/.config/claudebar/
  update         Update to latest version (preserves config)
  config         Edit config.toml in $EDITOR
  doctor         Diagnose installation
  uninstall      Remove statusline
  install-font   Install a Nerd Font

Options:
  --help, -h     Show this help
  --version, -v  Show version`);
  exit(0);
}

if (command === '--version' || command === '-v') {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  console.log(pkg.version);
  exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}\nRun "claudebar --help" for usage.`);
  exit(1);
}

const mod = await commands[command]();
await mod.default(args);
```

- [ ] **Step 3: Update .gitignore**

Add `node_modules/` to `.gitignore`.

- [ ] **Step 4: Verify**

Run: `node bin/cli.js --help && node bin/cli.js --version`
Expected: Help text prints, version shows `2.0.0`.

- [ ] **Step 5: Commit**

Message: `feat: add npm package scaffold with CLI entry point`

---

## Task 7: Node.js TOML parser + config compiler

**Files:**
- Create: `src/toml-parser.js`
- Create: `src/config-compiler.js`
- Create: `src/config-migrator.js`
- Create: `test/cli/toml-parser.test.js`
- Create: `test/cli/config-compiler.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/cli/toml-parser.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTOML, validateConfig } from '../../src/toml-parser.js';

describe('parseTOML', () => {
  it('parses sections and key-value pairs', () => {
    const config = parseTOML('[colors]\nmodel = 99\nbranch = 40');
    assert.equal(config.colors.model, 99);
    assert.equal(config.colors.branch, 40);
  });

  it('ignores comments and blank lines', () => {
    const config = parseTOML('# comment\n[colors]\n# model = 50\nmodel = 99\n\n');
    assert.equal(config.colors.model, 99);
    assert.equal(Object.keys(config.colors).length, 1);
  });

  it('strips inline comments', () => {
    const config = parseTOML('[colors]\nmodel = 99  # hot pink');
    assert.equal(config.colors.model, 99);
  });

  it('parses booleans in chips section', () => {
    const config = parseTOML('[chips]\ntmux = false\npr = true');
    assert.equal(config.chips.tmux, false);
    assert.equal(config.chips.pr, true);
  });

  it('parses quoted strings', () => {
    const config = parseTOML('[layout]\nforce = "compact"');
    assert.equal(config.layout.force, 'compact');
  });

  it('handles whitespace around =', () => {
    const config = parseTOML('[colors]\nmodel=99\nbranch =  40');
    assert.equal(config.colors.model, 99);
    assert.equal(config.colors.branch, 40);
  });

  it('parses multiple sections', () => {
    const config = parseTOML('[colors]\nmodel = 99\n[thresholds]\nwarning = 50\n[chips]\ntmux = false');
    assert.equal(config.colors.model, 99);
    assert.equal(config.thresholds.warning, 50);
    assert.equal(config.chips.tmux, false);
  });

  it('parses glyphs as strings', () => {
    const config = parseTOML('[glyphs]\nsparkle = "✦"\npencil = X');
    assert.equal(config.glyphs.sparkle, '✦');
    assert.equal(config.glyphs.pencil, 'X');
  });
});

describe('validateConfig', () => {
  it('passes valid config', () => {
    const result = validateConfig({ colors: { model: 99 }, thresholds: { warning: 60, critical: 90 } });
    assert.equal(result.valid, true);
  });

  it('rejects color out of range', () => {
    const result = validateConfig({ colors: { model: 300 } });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].message.includes('0-255'));
  });

  it('rejects warning >= critical', () => {
    const result = validateConfig({ thresholds: { warning: 90, critical: 60 } });
    assert.equal(result.valid, false);
  });

  it('rejects unknown section', () => {
    const result = validateConfig({ unknown: { foo: 1 } });
    assert.equal(result.valid, false);
  });

  it('rejects non-boolean chip', () => {
    const result = validateConfig({ chips: { tmux: 'yes' } });
    assert.equal(result.valid, false);
  });

  it('rejects invalid layout force', () => {
    const result = validateConfig({ layout: { force: 'tiny' } });
    assert.equal(result.valid, false);
  });
});
```

Create `test/cli/config-compiler.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileConfig } from '../../src/config-compiler.js';

describe('compileConfig', () => {
  it('compiles colors to C_UPPER=value', () => {
    const out = compileConfig({ colors: { model: 99, branch: 40 } });
    assert.ok(out.includes('C_MODEL=99'));
    assert.ok(out.includes('C_BRANCH=40'));
  });

  it('handles naming mismatches', () => {
    const out = compileConfig({ colors: { effort_high: 111, effort_xhigh: 222, separator: 123 } });
    assert.ok(out.includes('C_EFFORT_HI=111'));
    assert.ok(out.includes('C_EFFORT_XHI=222'));
    assert.ok(out.includes('C_SEP=123'));
  });

  it('compiles thresholds to THRESHOLD_UPPER=value', () => {
    const out = compileConfig({ thresholds: { warning: 50 } });
    assert.ok(out.includes('THRESHOLD_WARNING=50'));
  });

  it('compiles chips booleans to CHIP_UPPER=1|0', () => {
    const out = compileConfig({ chips: { tmux: false, pr: true } });
    assert.ok(out.includes('CHIP_TMUX=0'));
    assert.ok(out.includes('CHIP_PR=1'));
  });

  it('compiles layout to LAYOUT_UPPER=value', () => {
    const out = compileConfig({ layout: { force: 'compact' } });
    assert.ok(out.includes('LAYOUT_FORCE=compact'));
  });

  it('compiles glyphs to GLYPH_UPPER=value', () => {
    const out = compileConfig({ glyphs: { sparkle: '✦' } });
    assert.ok(out.includes('GLYPH_SPARKLE=✦'));
  });

  it('empty config produces no assignments', () => {
    const out = compileConfig({});
    const lines = out.split('\n').filter(l => l.includes('='));
    assert.equal(lines.length, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/cli/toml-parser.test.js test/cli/config-compiler.test.js`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

Create `src/toml-parser.js`, `src/config-compiler.js`, `src/config-migrator.js` with the full implementations. The TOML parser returns structured objects, the compiler maps to bash variables with the same naming mismatch table as the bash parser, and the migrator has a skeleton v1 identity.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/cli/toml-parser.test.js test/cli/config-compiler.test.js`
Expected: PASS

- [ ] **Step 5: Verify full suite**

Run: `npm test`
Expected: Both Node.js CLI tests and bash tests pass.

- [ ] **Step 6: Commit**

Message: `feat: add Node.js TOML parser, config compiler, and migration engine`

---

## Task 8: CLI install command

**Files:**
- Create: `src/install.js`
- Create: `test/cli/install.test.js`
- Modify: `bin/cli.js` (already wired)

- [ ] **Step 1: Write the failing test**

Create `test/cli/install.test.js`:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install } from '../../src/install.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-install-test-'));
}

describe('install', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: {} }, null, 2));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates config directory', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(configDir));
  });

  it('copies statusline.sh and makes it executable', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    const script = path.join(configDir, 'statusline.sh');
    assert.ok(fs.existsSync(script));
    const stat = fs.statSync(script);
    assert.ok(stat.mode & 0o111, 'should be executable');
  });

  it('generates config.toml from defaults', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'config.toml')));
    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.ok(content.includes('claudebar config v1'));
  });

  it('does NOT overwrite existing config.toml', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), 'my custom config');
    await install({ configDir, settingsPath, log: () => {} });
    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.equal(content, 'my custom config');
  });

  it('writes .version file', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, '.version')));
  });

  it('backs up and patches settings.json', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.type, 'command');
    assert.ok(settings.statusLine.command.includes('statusline.sh'));
    assert.deepEqual(settings.permissions, {});
    // Backup exists
    const backups = fs.readdirSync(claudeDir).filter(f => f.startsWith('settings.json.bak-'));
    assert.ok(backups.length >= 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/cli/install.test.js`
Expected: FAIL

- [ ] **Step 3: Implement `src/install.js`**

Full implementation using `node:fs`, `node:path`, `node:url`, `node:child_process` — all stdlib. Key: resolve package assets via `import.meta.url`, JSON patch via `JSON.parse`/`JSON.stringify` (no jq needed).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/cli/install.test.js`
Expected: PASS

- [ ] **Step 5: Verify full suite**

Run: `npm test`
Expected: All pass.

- [ ] **Step 6: Commit**

Message: `feat: add CLI install command`

---

## Task 9: CLI doctor command

**Files:**
- Create: `src/doctor.js`
- Create: `test/cli/doctor.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/cli/doctor.test.js` — test each diagnostic check with mocked filesystem state (pass/fail scenarios for statusline.sh exists, config.toml exists, config.sh freshness, settings.json points correctly).

- [ ] **Step 2: Run test, verify fails**
- [ ] **Step 3: Implement `src/doctor.js`** — 10 checks using `child_process.execSync` for shell probes, `fs` for file checks.
- [ ] **Step 4: Run test, verify passes**
- [ ] **Step 5: Verify full suite**: `npm test`
- [ ] **Step 6: Commit**

Message: `feat: add CLI doctor command with 10 diagnostic checks`

---

## Task 10: CLI uninstall command

**Files:**
- Create: `src/uninstall.js`
- Create: `test/cli/uninstall.test.js`

- [ ] **Step 1: Write the failing test**

Test cases: user declines confirmation → no changes; user confirms → backup created, statusLine removed from settings.json (other keys preserved), config dir removed.

- [ ] **Step 2: Run test, verify fails**
- [ ] **Step 3: Implement `src/uninstall.js`** — readline confirmation, backup, JSON patch, rm.
- [ ] **Step 4: Run test, verify passes**
- [ ] **Step 5: Verify full suite**: `npm test`
- [ ] **Step 6: Commit**

Message: `feat: add CLI uninstall command`

---

## Task 11: CLI config command

**Files:**
- Create: `src/config.js`
- Create: `test/cli/config.test.js`

- [ ] **Step 1: Write the failing test**

Test: generates config.toml if absent; after mock editor writes valid TOML → config.sh recompiled; after mock editor writes invalid TOML → errors reported.

- [ ] **Step 2: Run test, verify fails**
- [ ] **Step 3: Implement `src/config.js`** — spawn `$EDITOR` (sync), validate on save, recompile.
- [ ] **Step 4: Run test, verify passes**
- [ ] **Step 5: Verify full suite**: `npm test`
- [ ] **Step 6: Commit**

Message: `feat: add CLI config command with validation and auto-recompile`

---

## Task 12: CLI update command + config migrator tests

**Files:**
- Create: `src/update.js`
- Create: `test/cli/update.test.js`
- Create: `test/cli/config-migrator.test.js`

- [ ] **Step 1: Write the failing tests**

update.test.js: fake v1 install, run update, verify files replaced, config migrated, .version updated.
config-migrator.test.js: test sequential migration (v1→v2), new keys added with defaults, deprecated keys commented.

- [ ] **Step 2: Run tests, verify fail**
- [ ] **Step 3: Implement `src/update.js`** — read .version, compare, replace files, migrate config, recompile.
- [ ] **Step 4: Run tests, verify pass**
- [ ] **Step 5: Verify full suite**: `npm test`
- [ ] **Step 6: Commit**

Message: `feat: add CLI update command with config migration`

---

## Task 13: CLI install-font command

**Files:**
- Create: `src/install-font.js`
- Create: `test/cli/install-font.test.js`

- [ ] **Step 1: Write the failing test**

Test platform detection with mocked env vars (WSL_DISTRO_NAME, process.platform). Test cask name derivation (JetBrainsMono → font-jetbrains-mono-nerd-font). Test URL construction.

- [ ] **Step 2: Run test, verify fails**
- [ ] **Step 3: Implement** — platform detection, per-platform install strategy (macOS: brew cask, Linux: download+fc-cache, WSL2: powershell).
- [ ] **Step 4: Run test, verify passes**
- [ ] **Step 5: Verify full suite**: `npm test`
- [ ] **Step 6: Commit**

Message: `feat: add CLI install-font command with cross-platform support`

---

## Task 14: GitHub Actions CI/CD

**Files:**
- Create: `.github/workflows/test.yml`
- Create: `.github/workflows/publish.yml`

Not a TDD task.

- [ ] **Step 1: Create `.github/workflows/test.yml`**

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm test
```

- [ ] **Step 2: Create `.github/workflows/publish.yml`**

```yaml
name: Publish to npm

on:
  release:
    types: [published]

permissions:
  contents: read
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org
      - run: npm ci
      - run: npm test
      - run: npm publish --provenance --access public
```

- [ ] **Step 3: Verify YAML syntax**

Run: `node -e "const yaml = require('yaml'); yaml.parse(require('fs').readFileSync('.github/workflows/test.yml','utf8'))"`
(or just review manually — GitHub Actions will validate on push)

- [ ] **Step 4: Commit**

Message: `ci: add GitHub Actions for testing and npm publishing`

---

## Task 15: Deprecation notices + documentation

**Files:**
- Modify: `install.sh` (add deprecation warning)
- Modify: `uninstall.sh` (add deprecation warning)
- Modify: `README.md` (update install section)
- Modify: `CHANGELOG.md` (add v2.0.0 entry)

Not a TDD task.

- [ ] **Step 1: Add deprecation to install.sh**

Add at the top of `main()` function:
```bash
warn "This installer is deprecated. Use: npx @henryavila/claudebar install"
```

- [ ] **Step 2: Add deprecation to uninstall.sh**

Same pattern in its `main()`.

- [ ] **Step 3: Update README.md**

Replace git clone install instructions with:
```bash
npx @henryavila/claudebar install
```

Add configuration section:
```bash
npx @henryavila/claudebar config
```

Keep "from source" section for developers.

- [ ] **Step 4: Update CHANGELOG.md**

Add v2.0.0 entry with: npm distribution, TOML config system, CLI commands, chip toggles, GitHub Actions CI/CD.

- [ ] **Step 5: Verify**

Run: `bash install.sh --non-interactive 2>&1 | head -3` — should show deprecation warning.
Review README renders correctly.

- [ ] **Step 6: Commit**

Message: `docs: add deprecation notices and update README for npm distribution`

---

## Task 16: Final integration verification

Not a TDD task — end-to-end smoke test.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: All Node.js CLI tests + all bash tests pass.

- [ ] **Step 2: Manual install test**

```bash
tmpdir=$(mktemp -d)
HOME="$tmpdir" mkdir -p "$tmpdir/.claude"
HOME="$tmpdir" echo '{}' > "$tmpdir/.claude/settings.json"
HOME="$tmpdir" node bin/cli.js install
HOME="$tmpdir" node bin/cli.js doctor
HOME="$tmpdir" node bin/cli.js uninstall
rm -rf "$tmpdir"
```

- [ ] **Step 3: Performance check**

Run: `bash test/perf.sh`
Expected: <50ms average maintained.

- [ ] **Step 4: Portability check**

Run: `bash test/portability.sh`
Expected: All checks pass for both `statusline.sh` and `toml-parser.sh`.
