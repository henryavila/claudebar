---
initiative_id: locale-float-bug
status: shipped
started: 2026-06-02
last_updated: 2026-06-02T13:40:00Z
branch:
worktree:
plan_link:
wip_limit: 2
scope_paths:
  - assets/statusline.sh
  - test/unit/

stack: []

tasks: {}

parked: []

emerged: []

next_action: "SHIPPED in v1.3.1 (LC_NUMERIC=C + test/unit/test-locale-float.sh). Committed on fix/locale-float-bug, released to npm via OIDC."
---

# 7d/5h chips render 0% under a comma-decimal locale

## Context

User reported the `7d` chip showing `0%` while knowing real 7-day usage is non-zero.

Root cause (validated live, not deduced):

- `statusline.sh` runs under **bash 3.2.57** (the macOS system bash). Its builtin
  `printf '%.0f'` parses floats through `LC_NUMERIC` (strtod). Under the user's
  `LANG=pt_BR.UTF-8` / `LC_NUMERIC=pt_BR.UTF-8` (decimal separator = comma), it
  rejects **every** period-decimal float that `jq` emits — `23.5`, `4.7`, `0.3`,
  even `12.0` — with `printf: <n>: invalid number`, outputting **0**. Integers
  (`17`) survive by luck.
- The float→int cast happens at `statusline.sh:764-765`:
  `FIVE_HOUR=$(printf '%.0f' "$FIVE_HOUR")` / `SEVEN_DAY=$(printf '%.0f' "$SEVEN_DAY")`.
  Claude Code feeds `.rate_limits.{five_hour,seven_day}.used_percentage` as
  floats, so any fractional 5h/7d percentage collapses to 0%.

Reproduction under the real bash:

```
$ LC_NUMERIC=pt_BR.UTF-8 bash -c "printf '%.0f' 23.5"
bash: printf: 23.5: invalid number   → 0
$ LC_NUMERIC=C          bash -c "printf '%.0f' 23.5"
24
```

## Decisions

- Fix = `export LC_NUMERIC=C` near the top of `statusline.sh`. Set **only**
  `LC_NUMERIC` (NOT `LC_ALL`) so `LC_CTYPE` stays as-is and UTF-8 powerline
  glyphs keep rendering. All other numeric work uses integer `$(( ))`, unaffected;
  lines 764-765 are the only float printf sites (grep-confirmed).
- TDD: a `test/unit/` script that finds an available comma-decimal locale
  (`locale -a`), exports it, pipes a fractional payload to `statusline.sh`, and
  asserts the rounded percent (not 0%). Skips cleanly when no comma locale is
  installed (CI portability).

## Outcome (live-validated 2026-06-02)

- Real source is `assets/statusline.sh` (repo `statusline.sh` is a symlink to it).
- Fix: `export LC_NUMERIC=C` after `set -uo pipefail` (assets/statusline.sh:5-10).
  Only LC_NUMERIC, so LC_CTYPE/UTF-8 glyphs unaffected.
- Test: `test/unit/test-locale-float.sh` — probes `locale -a` for a comma-decimal
  locale (found `fa_IR` on this machine), feeds period-decimal floats (4.7, 23.5),
  asserts 5%/24% (not 0%). RED before fix, GREEN after. Skips when no comma locale.
- Suite: bash 40/0 (incl. new test), CLI 132/0.
- Deployed: copied to `~/.config/claudebar/statusline.sh` (atomic tmp+mv); install
  copy now identical to repo. Live render under `LC_NUMERIC=pt_BR.UTF-8` shows
  `5h 5%` / `7d 24%` for 4.7/23.5 inputs.
- NOT committed / NOT released yet — user to decide on version bump + npm publish.

## Links

- Sibling initiative (separate root cause, deferred): [[midsession-selfheal]] —
  multi-session settings.json clobber race.
