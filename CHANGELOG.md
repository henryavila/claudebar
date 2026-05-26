# Changelog

## Unreleased

(nothing yet)

## v1.2.0 — 2026-05-26

- Add `uninstall.sh` to disable the statusline by restoring a prior backup
- Lists all install-time backups, defaults to most recent, lets user pick interactively if multiple
- Snapshots current state as `settings.json.before-uninstall-<ts>` in case user wants to redo
- Validates restored JSON via jq when available; warns (not errors) if jq absent
- Files in `~/.claude/statusline/` are left in place; uninstall prints exact `rm -rf` command for full removal

## v1.1.0 — 2026-05-26

- Add `install.sh` for plug-and-play setup on macOS, native Ubuntu/Debian/Arch/Fedora, and WSL
- Validates prerequisites (bash 4+, jq, git, 256-color terminal, Nerd Font) with descriptive errors per-platform
- Auto-backs up `~/.claude/settings.json` with timestamp and patches `statusLine` block via jq
- README updated with install instructions

## v1.0.0 — 2026-05-26

- Replaced ccline with custom pip-style statusline
- Zone-driven colors (60/90 thresholds), worktree marker, git dirty indicator, agent pulse
- Initial implementation per `DESIGN.md` 2026-05-26

### Rollback

If anything goes wrong, restore the old statusline:

```bash
cp ~/.claude/settings.json.bak-pre-statusline-redesign ~/.claude/settings.json
```

Then restart Claude Code.
