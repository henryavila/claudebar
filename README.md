# claudebar

[![npm version](https://img.shields.io/npm/v/@henryavila/claudebar)](https://www.npmjs.com/package/@henryavila/claudebar)
[![npm downloads](https://img.shields.io/npm/dm/@henryavila/claudebar)](https://www.npmjs.com/package/@henryavila/claudebar)
[![license](https://img.shields.io/npm/l/@henryavila/claudebar)](LICENSE)
[![node](https://img.shields.io/node/v/@henryavila/claudebar)](package.json)

A two-row, zone-driven statusline for [Claude Code](https://docs.claude.com/en/docs/claude-code/overview). Designed for the subscriber tier: rate-limit awareness matters more than dollar cost.

<p align="center">
  <img src="docs/screenshots/all-states.png" alt="claudebar across 8 realistic session states" width="800">
</p>

## What it does

Reads the JSON [session context](https://code.claude.com/docs/en/statusline#available-data) Claude Code feeds it via stdin after every message, and prints two ANSI-colored rows:

```
✦ Opus 4.7 · HIGH · tmux:session:1.2  owner/repo › ⎇  branch  3   #1234 ⏳
ctx ▰▰▱▱▱▱▱▱▱▱ 23%   5h  ▰▰▰▱▱▱▱▱▱▱ 34%   7d  ▰▰▰▰▰▰▱▱▱▱ 62%
```

Identity row (top) — *what session is this?*
Fuel-gauge row (bottom) — *how much runway do I have?*

## Features

- **Pip-style fuel gauges** with **zone-driven colors**: green `<60%`, yellow `60-89%`, red `≥90%` — applied independently to context window, 5-hour rate limit, and 7-day rate limit. The bar shape tells you "how full"; the color tells you "how worried".
- **Quota reset countdown + time-elapsed marker** on the `5h` and `7d` chips: `5h · 2h18m  ▰▰▰▰│▰▰▱▱▱▱ 60%`. The text tells you *when* the window resets; the `│` inside the bar shows *how far* into the window you already are. When the marker is **inside** the fill, you're burning faster than time allows; **past** the fill, you have margin.
- **Identity row** shows model, [reasoning effort](https://docs.claude.com/en/api/messages#extended-thinking), tmux pane context, repo, worktree, branch, dirty file count, and PR review state.
- **Agent-active mode**: when a subagent is dispatched, the model name dims and a pulsing chip shows the agent name — at-a-glance "my turn is paused".
- **Tmux integration**: when running inside tmux, the identity row gains a `tmux:session:window.pane` chip to disambiguate multiple Claude sessions across panes.
- **TOML configuration**: every color, threshold, glyph, and chip toggle is configurable via `~/.config/claudebar/config.toml`. Changes recompile automatically on the next render.
- **Graceful degradation**: rate-limit bars hide when not on a subscriber tier; PR chip hides without a PR; effort chip hides on models without effort support; worktree marker hides outside worktrees. No placeholder text, no orphan separators.
- **Cross-platform**: macOS, Ubuntu/Debian, Arch, Fedora, WSL2 — same bash script, no edits.

### Each state at a glance

| State | Render |
|---|---|
| **Calm** — start of session, low context, clean tree | <img src="docs/screenshots/01-calm.png" width="700"> |
| **Mid-session** — worktree, dirty tree, PR pending | <img src="docs/screenshots/02-mid-session.png" width="700"> |
| **Caution** — yellow zone (60-89%) | <img src="docs/screenshots/03-caution.png" width="700"> |
| **Danger** — red zone (≥90%) + PR changes requested | <img src="docs/screenshots/04-danger.png" width="700"> |
| **Subagent dispatched** — model dims, agent chip pulses | <img src="docs/screenshots/05-agent.png" width="700"> |
| **PR approved** — clean tree, green PR chip | <img src="docs/screenshots/06-pr-approved.png" width="700"> |
| **Main working tree** — no worktree, no PR, minimal chrome | <img src="docs/screenshots/07-main-working-tree.png" width="700"> |
| **Tmux integration** — `tmux:session:window.pane` chip | <img src="docs/screenshots/08-tmux-integration.png" width="700"> |

## Install

```bash
npx @henryavila/claudebar install
```

This:

1. Copies the statusline script to `~/.config/claudebar/`.
2. Generates a fully documented `config.toml` with all defaults (commented out).
3. Backs up `~/.claude/settings.json` with a timestamp.
4. Patches `settings.json` to point at the installed script.
5. Runs diagnostic checks to confirm everything works.

Send any message in Claude Code (or restart it) — the new statusline renders.

### Prerequisites

- `jq` and `git` (the script uses them at runtime)
- A 256-color terminal (anything modern)
- A [Nerd Font](https://www.nerdfonts.com/) installed and active in your terminal

Don't have a Nerd Font? Install one:

```bash
npx @henryavila/claudebar install-font
```

Defaults to JetBrainsMono. Pass `--font FiraCode` (or any name from [nerd-fonts releases](https://github.com/ryanoasis/nerd-fonts/releases)) for a different family.

### Diagnostics

```bash
npx @henryavila/claudebar doctor
```

Checks bash, jq, git, 256-color, installed files, settings.json, and version — reports pass/fail for each.

## Configuration

```bash
npx @henryavila/claudebar config
```

Opens `~/.config/claudebar/config.toml` in `$EDITOR`. On save, validates the TOML and recompiles automatically. Changes take effect on the next statusline render (next message or 30-second tick).

The config file is self-documenting — every option is listed with its default, commented out. Uncomment only what you want to change.

### What you can configure

| Section | Controls |
|---|---|
| `[colors]` | Every color in the statusline (xterm-256 codes, 0-255) |
| `[thresholds]` | Zone boundaries: `warning` (green→yellow) and `critical` (yellow→red) |
| `[chips]` | Toggle any segment on/off: model, effort, tmux, repo, branch, worktree, dirty, PR, agent, each fuel gauge, countdown text, time marker |
| `[layout]` | Force `compact` or `full` layout, set refresh interval |
| `[glyphs]` | Override Nerd Font icons with any character |

### Example

```toml
[colors]
model = 99          # change model color to purple

[thresholds]
warning = 50        # go yellow earlier
critical = 80       # go red earlier

[chips]
tmux = false        # hide tmux chip
countdown = false   # hide countdown text on fuel gauges
```

## Update

```bash
npx @henryavila/claudebar update
```

Replaces the statusline script and toml-parser with the latest version. Your `config.toml` is backed up and preserved — new config options are added automatically via migration.

## Uninstall

```bash
npx @henryavila/claudebar uninstall
```

Backs up `settings.json`, removes the `statusLine` block, and deletes `~/.config/claudebar/`.

## How it works

Claude Code pipes a [JSON object](https://code.claude.com/docs/en/statusline#available-data) to the script's stdin after every assistant message (debounced 300ms) plus on a 30-second tick. The script:

1. Parses every needed field in a single `jq -r` invocation using `@sh` for shell-safe quoting.
2. Derives the current git branch and dirty-file count, with a 5-second session-scoped cache to avoid re-shelling `git` on every message.
3. If `config.toml` exists, auto-recompiles `config.sh` when the TOML is newer (adds <1ms overhead per render).
4. Composes two rows: `identity_row` (top) and `fuel_row` (bottom), with each chip checking its `CHIP_*` toggle and owning its preceding separator so absences don't leave orphan glyphs.
5. Prints ANSI-colored text to stdout. Claude Code displays it below the prompt.

See [`DESIGN.md`](DESIGN.md) for the full spec and [`CHANGELOG.md`](CHANGELOG.md) for version history.

## Mobile / compact layout

On narrow terminals or mobile connections, claudebar switches to a 3-row compact layout with 5-pip bars:

```
✦ Opus 4.7 · HIGH  #4 ⏳
claudebar ›  main ✓
ctx ▰▱▱▱▱  12%  5h ▰▱▱▱▱  18%  7d ▰▰▱▱▱  45%
```

### Automatic detection

When connecting via **mosh** (e.g., [Moshi](https://apps.apple.com/app/id1122890360) on iOS), compact layout activates automatically — the script detects `mosh-server` in the process tree.

**Moshi iOS setup:** Go to **Settings > Integrations > Export ENV** and enable `MOSHI_CLIENT`. This ensures detection even if the process-tree walk is blocked.

### Other mobile SSH apps

If you use a different mobile terminal app (Termius, Blink, Prompt, etc.) that connects via **plain SSH** (no mosh), automatic detection is not possible — the SSH protocol does not expose client identity to the server.

Set the override in your remote shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export CLAUDEBAR_LAYOUT=compact
```

Or configure it in `config.toml`:

```toml
[layout]
force = "compact"
```

### Detection priority

| Priority | Signal | How to use |
|----------|--------|------------|
| 1 | `CLAUDEBAR_LAYOUT=compact` | `export` in shell profile or app SSH config |
| 2 | `config.toml` `[layout] force` | `npx @henryavila/claudebar config` |
| 3 | `MOSHI_CLIENT=1` | Enable in Moshi iOS settings |
| 4 | `mosh-server` ancestor process | Automatic (mosh connections) |
| 5 | `$COLUMNS < 60` | Automatic (very narrow terminals) |

To force **full** layout on a mosh session: `export CLAUDEBAR_LAYOUT=full`.

## Testing

```bash
npm test                    # Node.js CLI tests + bash tests
npm run test:cli            # Node.js CLI tests only
npm run test:bash           # bash tests only
bash test/perf.sh           # asserts <50ms warm-cache execution
bash test/portability.sh    # checks no GNU-only flags, bash 3.2 compat
```

## Contributing

PRs welcome. Keep:

- `statusline.sh` performant (<50 ms warm) — single `jq` call, cache shell-outs.
- New visual elements documented in `DESIGN.md` with a screenshot in `docs/screenshots/`.
- TDD discipline — every new function gets a unit test in `test/unit/`.
- Cross-platform — `./test/portability.sh` must still pass.
- Zero npm dependencies — CLI uses Node.js stdlib only.

## License

MIT — see [`LICENSE`](LICENSE).

## Acknowledgements

- Visual inspiration: the 2-row layout of [powerlevel10k](https://github.com/romkatv/powerlevel10k). claudebar does **not** depend on p10k — it works in any shell.
- Pip-bar aesthetic inspired by Apple Watch / Linear progress indicators.
- Color palette: [Catppuccin Mocha](https://github.com/catppuccin/catppuccin) base background.
- Related community projects: [ccstatusline](https://github.com/sirmalloc/ccstatusline), [starship-claude](https://github.com/martinemde/starship-claude).
