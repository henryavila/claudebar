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
