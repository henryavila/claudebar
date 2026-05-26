# Changelog

## Unreleased

(nothing yet)

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
