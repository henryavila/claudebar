# claudebar CONFIG System — Design Spec

**Date:** 2026-05-26
**Author:** Henry Avila (via brainstorming with Claude)
**Scope:** Configuration system + npx CLI + npm distribution + GitHub Actions CI/CD
**Affects:** `statusline.sh` (runtime config loading), new `bin/cli.js`, new `assets/`, new `.github/workflows/`

---

## Goal

Make every visual and behavioral aspect of claudebar configurable via a self-documenting
TOML file, distributed and managed through an `npx @henryavila/claudebar` CLI that
handles install, update, config editing, diagnostics, and uninstall. Eliminate the need
to clone a git repo or edit bash source code to customize the statusline.

---

## Constraints & Assumptions

| Dimension | Value |
|---|---|
| npm package | `@henryavila/claudebar` (scoped, public) |
| Config format | TOML (flat sections + key=value, no nested/arrays) |
| Config location | `~/.config/claudebar/config.toml` |
| Install target | `~/.config/claudebar/` |
| CLI runtime | Node.js 18+ (via npx) |
| Statusline runtime | bash 4+, jq, git (unchanged from current) |
| CI/CD | GitHub Actions — OIDC Trusted Publishing to npm |
| Performance budget | Config loading adds <1ms to the existing <50ms budget |
| Backward compat | Existing statusline.sh behavior unchanged when no config exists |
| Layout ordering | Fixed. Items cannot be reordered within or between rows. Toggle on/off only. |

---

## Architecture

### Repository Structure

```
claudebar/
├── package.json                  # @henryavila/claudebar
├── bin/
│   └── cli.js                    # npx entry point: install|update|config|doctor|uninstall
├── src/
│   ├── install.js                # Copy script, generate config, patch settings.json
│   ├── update.js                 # Update script + migrate config
│   ├── config.js                 # Open $EDITOR, validate + recompile on save
│   ├── doctor.js                 # Diagnostic checks
│   ├── uninstall.js              # Revert settings.json, remove ~/.config/claudebar/
│   ├── toml-parser.js            # Parse TOML for validation and migration (Node.js side)
│   ├── config-compiler.js        # TOML → config.sh (readonly VAR=value)
│   └── config-migrator.js        # Merge user overrides + new defaults per version
├── assets/
│   ├── statusline.sh             # The bash script (moved from repo root)
│   ├── default-config.toml       # Complete config template with all defaults + docs
│   └── toml-parser.sh            # Embedded bash TOML parser (~25 lines) for runtime
├── test/
│   ├── unit/                     # Existing unit tests + new config tests
│   ├── fixtures/                 # Existing integration fixtures
│   ├── run-all.sh                # Existing test runner
│   ├── perf.sh                   # Existing perf test
│   └── portability.sh            # Existing portability test
├── .github/
│   └── workflows/
│       ├── test.yml              # CI on push to main + PRs
│       └── publish.yml           # npm publish on GitHub Release
├── DESIGN.md
├── CHANGELOG.md
└── README.md
```

### Install Target (`~/.config/claudebar/`)

```
~/.config/claudebar/
├── statusline.sh       # Copied from npm package
├── config.toml         # User configuration (fully documented, all defaults commented)
├── config.sh           # Compiled cache (auto-generated from config.toml)
└── .version            # Installed version (used by update for migration)
```

### Data Flow

```
                     ┌─────────────────────────────────┐
  User edits         │  ~/.config/claudebar/            │
  config.toml ──────►│  config.toml ──► config.sh      │
                     │       ▲               │          │
                     │       │           source         │
  npx claudebar      │   validate +          │          │
  config ───────────►│   recompile           ▼          │
                     │              statusline.sh       │
  Claude Code        │                   │              │
  pipes JSON ───────►│               render ──► stdout  │
                     └─────────────────────────────────┘
```

---

## CLI Commands

### `npx @henryavila/claudebar install`

First-time setup. Idempotent — safe to re-run.

**Steps:**

1. Create `~/.config/claudebar/` if absent
2. Copy `statusline.sh` from npm package to `~/.config/claudebar/`
3. Make `statusline.sh` executable
4. Generate `config.toml` from `default-config.toml` template (skip if already exists)
5. Copy `toml-parser.sh` to `~/.config/claudebar/`
6. Compile `config.toml` → `config.sh`
7. Write installed version to `.version`
8. Backup `~/.claude/settings.json` (timestamped `.bak-YYYYMMDD-HHMMSS`)
9. Patch `settings.json` with `statusLine` block pointing to `~/.config/claudebar/statusline.sh`
10. Run `doctor` checks automatically
11. Print success message with next steps

**Idempotency:** If `~/.config/claudebar/` already exists, only overwrite `statusline.sh`
and `toml-parser.sh` (the code). Never overwrite `config.toml` (user data).

### `npx @henryavila/claudebar update`

Update to latest version. Preserves user configuration.

**Steps:**

1. Check `.version` to determine current installed version
2. Replace `statusline.sh` with version from npm package
3. Replace `toml-parser.sh` with version from npm package
4. Migrate `config.toml`:
   - Read current config version marker (`# claudebar config v{N}`)
   - Apply incremental migrations (v1→v2, v2→v3, etc.)
   - New keys: inserted with default value, commented out, in correct section
   - User overrides: preserved exactly as-is
   - Removed keys: commented out with `# DEPRECATED in v{N}:` prefix and explanation
5. Recompile `config.sh`
6. Update `.version`
7. Print changelog summary (what changed since previous version)

**Migration safety:** Before modifying `config.toml`, create `config.toml.bak-{timestamp}`.
If migration fails, restore from backup and print error.

### `npx @henryavila/claudebar config`

Open config for editing with automatic validation.

**Steps:**

1. If `config.toml` doesn't exist, generate from defaults
2. Open `config.toml` in `$EDITOR` (fallback: `$VISUAL`, then `vi`)
3. On editor exit, validate the TOML:
   - Syntax: well-formed TOML (sections, key=value)
   - Types: colors are integers 0-255, thresholds are integers 0-100, booleans are true/false
   - Constraints: `warning < critical`
4. If valid: recompile `config.sh`, print "Config applied"
5. If invalid: print specific error(s), ask "Re-edit? [Y/n]"

### `npx @henryavila/claudebar doctor`

Diagnose the installation. Reports pass/fail for each check.

**Checks:**

| # | Check | Pass | Fail |
|---|---|---|---|
| 1 | bash version | `bash 5.2.21` | `bash 3.2 — need 4+` |
| 2 | `jq` available | `jq: /usr/bin/jq` | `jq not found — install: apt install jq` |
| 3 | `git` available | `git: /usr/bin/git` | `git not found` |
| 4 | Terminal 256-color | `256 colors (TERM=xterm-256color)` | `8 colors — set TERM=xterm-256color` |
| 5 | `statusline.sh` exists + executable | `~/.config/claudebar/statusline.sh` | `not found — run: npx @henryavila/claudebar install` |
| 6 | `config.toml` exists | `config.toml: valid` | `not found — run: npx @henryavila/claudebar install` |
| 7 | `config.sh` up to date | `config.sh: current` | `config.sh stale — recompiling...` (auto-fix) |
| 8 | `settings.json` points to script | `statusLine → ~/.config/claudebar/statusline.sh` | `statusLine missing or wrong path` |
| 9 | Version match | `v1.2.0 (latest)` | `v1.1.0 installed, v1.2.0 available — run: npx @henryavila/claudebar update` |
| 10 | Nerd Font installed | `NerdFont: JetBrainsMono Nerd Font` | `NerdFont not detected — run: npx @henryavila/claudebar install-font` |

**Exit code:** 0 if all pass, 1 if any fail.

### `npx @henryavila/claudebar install-font [--font <name>]`

Install a Nerd Font so claudebar glyphs render correctly. Defaults to `JetBrainsMono` if
`--font` is omitted. Accepts any font name from the [ryanoasis/nerd-fonts](https://github.com/ryanoasis/nerd-fonts) releases (e.g., `FiraCode`, `Hack`, `CascadiaCode`).

**Platform detection** (evaluated top-to-bottom, first match wins):

| Condition | Platform | Install strategy |
|---|---|---|
| `$WSL_DISTRO_NAME` set or `/proc/version` contains `microsoft` | WSL2 | PowerShell on Windows host |
| `uname -s` = `Darwin` | macOS | Homebrew cask |
| `uname -s` = `Linux` | Linux native | Download to `~/.local/share/fonts/` |

**Steps per platform:**

#### macOS

1. Check if Homebrew is available (`command -v brew`). If not: print install hint and abort.
2. Derive cask name: `font-<lower-kebab>-nerd-font` (e.g., `font-jetbrains-mono-nerd-font`).
3. `brew install --cask <cask>`.
4. Verify: `fc-list | grep -i "<font name>"`. Print success or failure.
5. Remind user to select the font in their terminal app.

#### Linux native (Ubuntu/Debian/Arch/Fedora)

1. Determine latest release tag from GitHub API:
   `curl -sL https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest | jq -r .tag_name`
2. Download the font zip:
   `curl -fLO https://github.com/ryanoasis/nerd-fonts/releases/download/<tag>/<FontName>.zip`
3. Create `~/.local/share/fonts/<FontName>/` and unzip into it.
4. Run `fc-cache -fv`.
5. Verify: `fc-list | grep -i "<FontName>"`. Print success or failure.
6. Clean up downloaded zip.
7. Remind user to select the font in their terminal app.

#### WSL2

Fonts must be installed on the **Windows host** — the terminal emulator (Windows Terminal, etc.)
renders glyphs using Windows-side fonts.

1. Detect PowerShell path: `powershell.exe` or `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`.
2. Download via PowerShell:
   ```
   powershell.exe -Command "& {
     $tag = (Invoke-RestMethod 'https://api.github.com/repos/ryanoasis/nerd-fonts/releases/latest').tag_name;
     $url = \"https://github.com/ryanoasis/nerd-fonts/releases/download/$tag/<FontName>.zip\";
     $zip = \"$env:TEMP\\<FontName>.zip\";
     Invoke-WebRequest -Uri $url -OutFile $zip;
     Expand-Archive -Path $zip -DestinationPath \"$env:TEMP\\<FontName>\" -Force;
     $fonts = (New-Object -ComObject Shell.Application).Namespace(0x14);
     Get-ChildItem \"$env:TEMP\\<FontName>\\*.ttf\" | ForEach-Object { $fonts.CopyHere($_.FullName, 0x10) };
     Remove-Item $zip, \"$env:TEMP\\<FontName>\" -Recurse -Force
   }"
   ```
3. Print success message.
4. Warn: "Restart your terminal for the font to take effect."
5. If Windows Terminal is detected (`/mnt/c/Users/*/AppData/Local/Packages/Microsoft.WindowsTerminal*/`):
   suggest adding `"fontFace": "<FontName> Nerd Font"` to `settings.json`.

**Error handling:**

- Network failure (GitHub API or download): print error, suggest manual install from `https://www.nerdfonts.com/`.
- PowerShell not found in WSL: print manual instructions for Windows-side install.
- Font already installed (`fc-list` match on macOS/Linux, or user confirms): skip with "already installed".

**Integration with `install` and `doctor`:**

- `install` step 10 (after doctor): if Nerd Font check fails, offer `"Install a Nerd Font now? [Y/n]"`.
  If yes, delegate to `install-font`. If no, print manual install URL.
- `doctor` check 10 (new): Nerd Font detection via `fc-list` (macOS/Linux) or visual prompt
  (WSL, since Windows fonts aren't visible from Linux). Pass: `NerdFont: JetBrainsMono Nerd Font`.
  Fail: `NerdFont not detected — run: npx @henryavila/claudebar install-font`.

### `npx @henryavila/claudebar uninstall`

Reverse the installation.

**Steps:**

1. Confirm with user: "Remove claudebar from ~/.config/claudebar/? [y/N]"
2. Backup current `settings.json` (timestamped)
3. Remove `statusLine` block from `settings.json` via jq
4. Remove `~/.config/claudebar/` directory
5. Print "Uninstalled. Backup at ~/.claude/settings.json.bak-{timestamp}"

---

## Config Format

### File: `~/.config/claudebar/config.toml`

The config file is generated on install with **every option present but commented out**.
All defaults are visible. The user uncomments and changes only what they want.

### Version marker

First non-comment line:

```toml
# claudebar config v1
```

The version number tracks the config schema, not the package version. Incremented only
when the config format changes (new keys, removed keys, changed semantics).

### Sections

#### `[layout]`

| Key | Type | Default | Description |
|---|---|---|---|
| `force` | string | `"auto"` | Layout mode: `auto`, `compact`, `full` |
| `refresh_interval` | int | `30` | Claude Code refresh interval in seconds (5-300). Applied to `settings.json` on `install` and `update`. |

#### `[chips]`

Toggle individual segments on/off. All default to `true`.

| Key | Controls |
|---|---|
| `model` | Model name with sparkle prefix |
| `effort` | Reasoning effort level chip |
| `tmux` | Tmux session:window.pane chip |
| `repo` | Repository name (owner/repo) |
| `branch` | Git branch with icon |
| `worktree` | Worktree marker |
| `dirty` | Dirty file count / clean checkmark |
| `pr` | Pull request chip |
| `agent` | Agent-active chip |
| `ctx_bar` | Context window fuel gauge |
| `five_hour_bar` | 5-hour rate limit fuel gauge |
| `seven_day_bar` | 7-day rate limit fuel gauge |
| `countdown` | Countdown text on 5h/7d chips |
| `time_marker` | Time-elapsed marker inside bars |

#### `[thresholds]`

| Key | Type | Default | Constraint |
|---|---|---|---|
| `warning` | int | `60` | 0 < warning < critical |
| `critical` | int | `90` | warning < critical <= 100 |

#### `[colors]`

All values are xterm-256 color codes (integers 0-255).

| Key | Default | Segment |
|---|---|---|
| `model` | `213` | Model name (pink/magenta) |
| `model_dim` | `240` | Model name when agent active (grey) |
| `effort_low` | `76` | LOW chip (green) |
| `effort_med` | `39` | MED chip (cyan) |
| `effort_high` | `220` | HIGH chip (amber) |
| `effort_xhigh` | `208` | XHIGH chip (orange) |
| `effort_max` | `197` | MAX chip (hot pink) |
| `repo` | `245` | Repo name (dim grey) |
| `worktree` | `147` | Worktree marker (soft violet) |
| `branch` | `76` | Branch name (leaf green) |
| `dirty` | `178` | Dirty count (amber) |
| `clean` | `82` | Clean checkmark (bright green) |
| `pr_pending` | `220` | PR pending (amber) |
| `pr_approved` | `82` | PR approved (bright green) |
| `pr_changes` | `196` | PR changes requested (red) |
| `pr_draft` | `240` | PR draft (grey) |
| `bar_green` | `76` | Calm zone fill |
| `bar_yellow` | `220` | Caution zone fill |
| `bar_red` | `196` | Danger zone fill |
| `bar_dim` | `238` | Empty pip |
| `agent` | `141` | Agent chip (soft violet) |
| `tmux` | `105` | Tmux chip |
| `separator` | `238` | Separators (dim grey) |

#### `[glyphs]`

Override Nerd Font icons with any character or string.

| Key | Default | Glyph |
|---|---|---|
| `sparkle` | `✦` | Model name prefix |
| `pencil` | `` (U+F040) | Dirty file indicator |
| `git` | `` (U+E725) | Branch label |
| `pr` | `` (U+F407) | PR chip |
| `tmux` | `` (U+F1B2) | Tmux chip |
| `gear` | `` (U+F085) | Agent chip |
| `worktree` | `⎇` (U+2387) | Worktree marker |

---

## Config Compilation (TOML → config.sh)

### Compile step

The compiler reads `config.toml` and emits a bash file of `readonly` variable assignments:

**Input (`config.toml`):**
```toml
[colors]
model = 99
branch = 40

[thresholds]
warning = 50

[chips]
tmux = false
```

**Output (`config.sh`):**
```bash
# Auto-generated by claudebar — do not edit. Edit config.toml instead.
C_MODEL=99
C_BRANCH=40
THRESHOLD_WARNING=50
CHIP_TMUX=0
```

Note: `config.sh` uses plain assignments (not `readonly`) because `statusline.sh`
applies `readonly` on the defaults. Variables set by `config.sh` via `source` are
already in scope when the `: "${VAR:=default}"` line runs, so the default is skipped
and `readonly` locks the user's value.

### Variable naming convention

| TOML section | TOML key | Bash variable |
|---|---|---|
| `[colors]` | `model` | `C_MODEL` |
| `[colors]` | `effort_low` | `C_EFFORT_LOW` |
| `[thresholds]` | `warning` | `THRESHOLD_WARNING` |
| `[chips]` | `tmux` | `CHIP_TMUX` |
| `[layout]` | `force` | `LAYOUT_FORCE` |
| `[glyphs]` | `sparkle` | `GLYPH_SPARKLE` |

Booleans compile to `1` (true) / `0` (false).

### Validation rules (applied at compile time)

| Rule | Error message |
|---|---|
| Color not integer 0-255 | `[colors] model = "foo" — must be integer 0-255` |
| Threshold not integer 0-100 | `[thresholds] warning = 150 — must be integer 0-100` |
| warning >= critical | `[thresholds] warning (70) must be < critical (60)` |
| Chip not boolean | `[chips] tmux = "yes" — must be true or false` |
| Layout force invalid | `[layout] force = "tiny" — must be auto, compact, or full` |
| Unknown section | `[unknown] — not a valid section` |
| Unknown key | `[colors] foo = 1 — not a valid key` |

### Runtime loading in statusline.sh

At the top of `statusline.sh`, before the current palette block:

```bash
# ─── Config loading ──────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_CB_CONFIG_TOML="$SCRIPT_DIR/config.toml"
_CB_CONFIG_SH="$SCRIPT_DIR/config.sh"

if [[ -f "$_CB_CONFIG_TOML" ]]; then
    # Auto-recompile when TOML is newer than cache
    if [[ ! -f "$_CB_CONFIG_SH" ]] || [[ "$_CB_CONFIG_TOML" -nt "$_CB_CONFIG_SH" ]]; then
        source "$SCRIPT_DIR/toml-parser.sh"
        compile_config "$_CB_CONFIG_TOML" > "$_CB_CONFIG_SH"
    fi
    source "$_CB_CONFIG_SH"
fi
```

After this block, all existing `readonly C_*=...` declarations become conditional
defaults that lock the final value:

```bash
# ─── Palette defaults (overridden by config.sh when present) ─────────
# config.sh sets plain vars (C_MODEL=99). The := assigns the default only
# when unset. readonly locks whichever value won.
readonly C_MODEL=${C_MODEL:-213}
readonly C_MODEL_DIM=${C_MODEL_DIM:-240}
readonly C_EFFORT_LOW=${C_EFFORT_LOW:-76}
# ... etc for every configurable variable
```

This ensures:
- **No config file:** `C_MODEL` is unset → `${C_MODEL:-213}` → readonly 213
- **Partial config:** `config.sh` sets `C_MODEL=99` → `${C_MODEL:-213}` → readonly 99
- **Full config:** everything customized, all locked as readonly

### Chip toggle in render functions

Each render function checks `CHIP_*` before emitting:

```bash
# Before (current):
if [[ -n "$pr_number" ]]; then
    pr_chip "$pr_number" "$pr_state"
fi

# After (with config):
if [[ -n "$pr_number" ]] && (( ${CHIP_PR:-1} )); then
    pr_chip "$pr_number" "$pr_state"
fi
```

The `${CHIP_PR:-1}` pattern defaults to enabled when no config exists.

---

## Embedded Bash TOML Parser (`toml-parser.sh`)

Minimal parser supporting the subset of TOML that `config.toml` uses. Approximately
25-30 lines. Does NOT attempt to support full TOML spec — only:

- `[section]` headers
- `key = value` pairs (string, integer, boolean)
- `# comments` (full-line and inline)
- Whitespace tolerance around `=`

Unsupported (and not needed): nested tables, arrays, multi-line strings, date/time types.

The parser emits `readonly` bash assignments to stdout. The caller redirects to `config.sh`.

---

## npm Package

### `package.json` (key fields)

```json
{
  "name": "@henryavila/claudebar",
  "version": "1.0.0",
  "type": "module",
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
    "test": "node --test test/cli/*.test.js && bash test/run-all.sh"
  }
}
```

- `bin.claudebar` enables `npx @henryavila/claudebar <command>`
- `files` allowlist: only ship CLI, source, and assets — not test fixtures or docs
- `test` script runs both Node.js CLI tests and existing bash integration tests

### Assets bundled in npm package

| File | Purpose |
|---|---|
| `assets/statusline.sh` | The bash script Claude Code executes |
| `assets/default-config.toml` | Complete config template (all options documented + commented) |
| `assets/toml-parser.sh` | Embedded bash TOML parser for runtime recompilation |

---

## GitHub Actions

### `.github/workflows/test.yml`

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm test
```

### `.github/workflows/publish.yml`

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
      - run: npm install -g npm@latest
      - run: npm ci
      - run: npm test
      - run: npm publish --provenance --access public
```

Identical pattern to `@henryavila/mdprobe` and `@henryavila/atomic-skills`:
- OIDC Trusted Publishing — no NPM_TOKEN secret
- `--provenance` for SLSA attestation
- `--access public` required for scoped package
- Tests re-run in publish workflow as safety net

### Release flow

1. Bump `version` in `package.json`
2. Update `CHANGELOG.md`
3. Commit + push to `main`
4. Tag `v{semver}` and push
5. Create GitHub Release from tag
6. `publish.yml` fires → npm publish

---

## Migration System

### Config version tracking

The config schema version is tracked in two places:

1. **`config.toml`** — first non-comment line: `# claudebar config v1`
2. **`config-migrator.js`** — contains migration functions keyed by version

### Migration format

Each migration is a function that receives the parsed TOML (as an object) and returns
the updated object:

```javascript
const migrations = {
  2: (config) => {
    // v1 → v2: added [chips] countdown key
    config.chips ??= {};
    config.chips.countdown ??= true;
    return config;
  },
  3: (config) => {
    // v2 → v3: renamed [colors] separator → sep
    if (config.colors?.separator !== undefined) {
      config.colors.sep = config.colors.separator;
      delete config.colors.separator;
    }
    return config;
  }
};
```

### Migration rules

- Migrations are applied sequentially: v1→v2→v3→...→vN
- New keys are added with their default value
- Renamed keys are mapped (old value preserved, old key removed)
- Removed keys are kept as `# DEPRECATED in v{N}: <reason>`
- User-set values are NEVER changed by migration
- Backup is created before any migration

---

## Performance Impact

| Operation | Cost | When |
|---|---|---|
| mtime check (config.toml vs config.sh) | ~0.1ms | Every statusline render |
| `source config.sh` | ~0.5ms | Every statusline render |
| TOML → config.sh recompile | ~5ms | Only when config.toml changes |
| Chip toggle checks (`${CHIP_*:-1}`) | ~0.01ms per chip | Every statusline render |
| **Total added to render** | **<1ms** | — |

Stays well within the 50ms performance budget.

---

## Backward Compatibility

- **No config file:** statusline.sh behaves identically to current version. All `readonly`
  constants fall back to hardcoded defaults via `${VAR:=default}`.
- **Partial config:** only overridden values change. Unset keys keep defaults.
- **Existing install.sh:** deprecated but kept for users who cloned the repo directly.
  Prints a message suggesting `npx @henryavila/claudebar install` instead.
- **Existing env vars:** `CLAUDEBAR_LAYOUT`, `CLAUDEBAR_NOW_FOR_TESTING`,
  `CLAUDEBAR_BRANCH_FOR_TESTING`, `MOSHI_CLIENT` continue to work. Env vars take
  precedence over config.toml for layout detection (existing behavior preserved).

---

## Testing Strategy

### New tests (CLI — Node.js)

| Test | Validates |
|---|---|
| `test/cli/install.test.js` | Creates ~/.config/claudebar/, copies files, patches settings.json |
| `test/cli/config-compiler.test.js` | TOML → config.sh conversion, all variable types |
| `test/cli/config-migrator.test.js` | Version migration: add, rename, deprecate keys |
| `test/cli/toml-parser.test.js` | Parse sections, key=value, comments, whitespace |
| `test/cli/doctor.test.js` | Each diagnostic check pass/fail |
| `test/cli/uninstall.test.js` | Removes files, reverts settings.json |

### Updated tests (bash)

| Test | Change |
|---|---|
| `test/unit/test-config.sh` | New: test config.sh sourcing, defaults, overrides |
| `test/unit/test-chip-toggle.sh` | New: test chip visibility with CHIP_* vars |
| Existing integration fixtures | Unchanged — they test rendering, not config loading |

### Coverage target

80%+ on both CLI (Node.js) and bash changes.

---

## Acceptance Criteria

1. `npx @henryavila/claudebar install` sets up a working statusline from zero (no git clone)
2. `npx @henryavila/claudebar config` opens a fully documented config.toml in $EDITOR
3. Every color, threshold, chip, and glyph is configurable via config.toml
4. Changing config.toml and sending a message in Claude Code reflects changes immediately
5. `npx @henryavila/claudebar update` preserves user config while adding new options
6. `npx @henryavila/claudebar doctor` diagnoses all common setup problems
7. `npx @henryavila/claudebar uninstall` cleanly removes everything
8. No config file = identical behavior to current statusline.sh (full backward compat)
9. Config loading adds <1ms to render time
10. GitHub Release triggers npm publish via OIDC (no secrets)
11. All tests pass: CLI (Node.js) + bash unit + bash integration
12. 80%+ test coverage

---

## Out of Scope

| Excluded | Why |
|---|---|
| Reordering items within/between rows | Fixed layout is a deliberate design decision. Toggle on/off is sufficient. |
| Pre-built color themes (catppuccin, dracula) | Can be added in v2. Config system is the foundation that enables it. |
| Per-project config overrides (`.claudebar.toml`) | Can be added in v2 with config cascade. |
| GUI config editor | TOML + $EDITOR is sufficient for the target audience. |
| Full TOML spec support | Flat sections + key=value covers all needs. No arrays/nested tables. |

---

## Future Expansion (post-v1)

- **Themes:** `npx @henryavila/claudebar theme catppuccin` — pre-built palettes
- **Per-project overrides:** `.claudebar.toml` in project root, merged on top of global config
- **Config export/import:** `npx @henryavila/claudebar config export > my-theme.toml`
- **Interactive config:** `npx @henryavila/claudebar config --interactive` — TUI with live preview
