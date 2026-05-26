# Claude Code Statusline

Custom statusline for Claude Code. Replaces ccline.

See `DESIGN.md` for the design spec, `PLAN.md` for implementation, `CHANGELOG.md` for version history.

## Install

### Quick (recommended): use the installer

1. Copy this directory to `~/.claude/statusline/` on the target machine
2. Run the installer:

   ```bash
   ~/.claude/statusline/install.sh
   ```

   It will:
   - Check prerequisites (bash 4+, jq, git, 256-color terminal)
   - Prompt you to visually confirm Nerd Font renders correctly
   - Backup your existing `~/.claude/settings.json` (timestamped)
   - Patch the `statusLine` block to point at the new script

3. Restart Claude Code or send any message — statusline renders.

### Manual

If you prefer not to run the installer:

1. Ensure `jq` and `git` are installed: `which jq git`
2. Edit `~/.claude/settings.json`:

   ```json
   "statusLine": {
     "type": "command",
     "command": "~/.claude/statusline/statusline.sh",
     "padding": 0,
     "refreshInterval": 30
   }
   ```

3. Restart Claude Code.

## Test

```bash
./test/run-all.sh
./test/perf.sh
./test/portability.sh
```

## Uninstall

```bash
~/.claude/statusline/uninstall.sh
```

Lists every backup `install.sh` created (one per install run), defaults to the most recent, restores the prior `~/.claude/settings.json`, and snapshots the current state first in case you change your mind. Files in `~/.claude/statusline/` are left in place — delete with `rm -rf ~/.claude/statusline` once you're sure.

To re-enable later: `~/.claude/statusline/install.sh`.

### Manual rollback

If `uninstall.sh` doesn't work for some reason, restore by hand:

```bash
ls ~/.claude/settings.json.bak-*       # see all backups
cp ~/.claude/settings.json.bak-<TIMESTAMP> ~/.claude/settings.json
```
