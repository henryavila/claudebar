# Hook-path heal vs Claude Code fullscreen TUI — diagnosis & fix proposal

> Status: **diagnosed, not fixed** (as of 2026-06-09, claudebar v1.3.4 installed, CC 2.1.170)
> Observed on: `crc` (WSL2 Ubuntu, tmux 3.4, systemd daemon active)
> Follow-up to: PR #16 / `fix/daemon-fullscreen-conflict` (v1.3.2) — which fixed **only the daemon half** of this conflict.

## Symptom

While the user works in Claude Code's fullscreen rendering mode (`/tui fullscreen`,
available since CC 2.1.89), the TUI **repeatedly drops out of fullscreen back to
inline rendering**. Signature: the drop happens **right after submitting a prompt**,
every turn — not at random moments.

## Root cause

The `UserPromptSubmit` heal hook restores `statusLine` into `settings.json`
**while CC is still in fullscreen**, and CC hot-reloads `statusLine` from disk
(validated live in `.atomic-skills/initiatives/midsession-selfheal.md`). A
`statusLine` is incompatible with the fullscreen renderer, so CC falls back to
inline rendering. Full chain:

1. User enables `/tui fullscreen`. CC persists `"tui": "fullscreen"` in
   `~/.claude/settings.json` and, while the mode is active, re-persists settings
   **without** the `statusLine` block (fullscreen has no inline statusline — they
   are mutually exclusive by design).
2. claudebar's heal hook (`assets/ensure-statusline.mjs`, registered on
   `SessionStart` + `UserPromptSubmit` — `HEAL_HOOK_EVENTS`, `src/settings.js:30`)
   fires on the next prompt and calls `healAll(settings)` with `daemon: false`.
3. **The hook path is unconditional.** `healAll` (`src/settings.js`) only gates on
   `isFullscreenTui()` / `healHookPresent()` when `daemon === true`:

   ```js
   export function healAll(settings, { daemon = false } = {}) {
     if (daemon && (isFullscreenTui(settings) || healHookPresent(settings))) {
       return { changed: false };
     }
     const sl = ensureStatusLine(settings);   // ← runs even while tui:fullscreen
     ...
   }
   ```

4. `ensureStatusLine` sees `statusLine` missing (CC dropped it on purpose),
   restores it, `writeSettingsAtomic` lands on disk.
5. CC hot-reloads the `statusLine` block → exits fullscreen. User re-enables
   fullscreen → next prompt → goto 2. "Exits fullscreen over and over."

## Why PR #16 didn't cover this

PR #16 (v1.3.2) added the `daemon &&` gate because the **OS daemon** fires on
every `settings.json` write and an unconditional heal there caused a visible
write-fight. The hook path was *deliberately* left unconditional — the comment
says it "keeps its unconditional restore so mid-session recovery is unaffected".

That decision rested on a stale mental model from `midsession-selfheal`:
`"tui": "fullscreen"` was understood as a **transient overlay** that closes by
itself and gives the statusLine back. In current CC (2.1.89+), fullscreen is a
**persistent, user-chosen rendering mode** — the user stays in it for whole
sessions. Under that reality, the per-turn unconditional restore is continuous
sabotage of a mode the user explicitly picked, once per prompt.

## Evidence

- `~/.config/claudebar/settings.js` (installed 1.3.4) and `origin/main` both show
  the `daemon &&` gate — hook path unconditional. Confirmed via
  `git show origin/main:src/settings.js`.
- `journalctl --user -u claudebar-heal.service` on `crc` shows write bursts on
  `~/.claude/settings.json` (e.g. 4 path-unit triggers within the same second at
  2026-06-09 20:20:05) — the write ping-pong fingerprint. (The daemon itself
  no-ops thanks to the v1.3.2 gate; the triggers map writes by CC + the hook.)
- CC behavior facts (upstream): fullscreen mode persists its state in
  `settings.json`; `statusLine` is not rendered in fullscreen. Docs:
  <https://code.claude.com/docs/en/fullscreen.md>. The hot-reload of `statusLine`
  from disk was validated live in `midsession-selfheal` ("Empirical validation").
- Related upstream issues (rendering artifacts, NOT this bug — ruled out):
  [#51497](https://github.com/anthropics/claude-code/issues/51497) (fullscreen
  clips under tmux status bar), [#49086](https://github.com/anthropics/claude-code/issues/49086)
  (resize duplicates frames). Neither describes unsolicited fullscreen exits.

## Proposed fix (v1.3.5)

Apply the same fullscreen gate to the hook path — at minimum to the
`statusLine` restore; preferably to **all writes**, since any external write to
`settings.json` while CC is fullscreen risks triggering a reload/reconcile:

```js
export function healAll(settings, { daemon = false } = {}) {
  if (isFullscreenTui(settings)) return { changed: false };          // ← new: both paths
  if (daemon && healHookPresent(settings)) return { changed: false };
  ...
}
```

Behavioral consequences (all desirable):

- While fullscreen: heal stands down entirely. There is no statusline to heal —
  fullscreen doesn't render one.
- On leaving fullscreen (`/tui default`): if CC fails to bring `statusLine` back,
  the very next `UserPromptSubmit` restores it — within one turn, which was the
  original goal of `midsession-selfheal`. No recovery capability is lost.
- A *genuine* catastrophic clobber that also strips the hooks while fullscreen:
  covered by the daemon's 300s timer once fullscreen exits (the `tui` key is
  gone then, so the daemon gate opens). Acceptable worst case: bar returns
  ≤5 min after leaving fullscreen, or next prompt via SessionStart/heal hook.

Edge case to decide: a hand-rolled `settings.json` that has `tui: "fullscreen"`
**stale** (CC crashed mid-fullscreen and never cleaned the key?). Verify whether
CC removes the key on normal exit; if a stale key can persist, the daemon-timer
path should perhaps heal when no CC process is alive. Check before shipping.

## Test plan

In `test/cli/heal.test.js` style (mirror the existing v1.3.2 daemon-gate tests):

1. `healAll(settings)` (hook path) with `tui: "fullscreen"` and `statusLine`
   missing → `changed: false`, `statusLine` NOT restored.
2. Same but `tui` absent → `changed: true`, `statusLine` restored (regression
   guard for the original mid-session heal).
3. Daemon-path tests from v1.3.2 stay green (gate refactor must not regress).
4. Live validation: enable `/tui fullscreen`, submit several prompts → mode
   persists; run `/tui default` → bar back within one prompt.

## Notes for whoever picks this up

- **This checkout (`crc`) was stale**: branch `feat/native-daemon-selfheal`
  @ 03569a3 (v1.3.0), while origin/main is at v1.3.4. `git fetch` already run on
  2026-06-09; branch the fix off **latest `origin/main`**.
- Installed copy under `~/.config/claudebar/` is v1.3.4 (npm/auto-update), ahead
  of this checkout — don't diff against the working tree to reason about prod.
- User-level stopgap until the fix ships (per machine):
  `systemctl --user stop claudebar-heal.path claudebar-heal.timer` **and** remove
  the `UserPromptSubmit` heal entry from `~/.claude/settings.json` (stopping only
  one of the two is not enough — they restore each other).
