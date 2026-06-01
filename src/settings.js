// Shared settings.json helpers — single source of truth for the statusLine
// block and the self-healing SessionStart hook. Dependency-free (node builtins
// only) so it can be copied verbatim into ~/.config/claudebar/ and imported by
// the standalone heal script (assets/ensure-statusline.mjs).
import fs from 'node:fs';

// The installed paths use a literal `~` so Claude Code expands them per-user.
// Keeping them here (not duplicated in install/update) guarantees install,
// update, and the heal hook all agree on what "configured" means.
export const STATUSLINE_COMMAND = '~/.config/claudebar/statusline.sh';
export const HEAL_HOOK_COMMAND = 'node ~/.config/claudebar/ensure-statusline.mjs';
export const AUTO_UPDATE_HOOK_COMMAND = 'node ~/.config/claudebar/auto-update.mjs';

// A stable marker substring used to find OUR hook among any others the user
// (or another tool) has registered under a hook event.
const HEAL_HOOK_MARKER = 'ensure-statusline';
const AUTO_UPDATE_HOOK_MARKER = 'auto-update';

// Auto-update is checked at SessionStart ONLY — never on UserPromptSubmit nor in
// the render path. The hook itself just spawns a detached, timestamp-throttled
// updater and exits, so the budget here is a single stat() on most sessions.
const AUTO_UPDATE_HOOK_EVENTS = ['SessionStart'];

// Events the heal hook registers under. SessionStart recovers a dropped
// statusLine at the next session start; UserPromptSubmit (fires once per turn)
// recovers it MID-session — Claude Code re-persists settings.json from its
// in-memory copy on a TUI toggle, dropping statusLine, and (validated live) it
// re-reads the statusLine block from disk, so rewriting it on the next turn
// redraws the bar without a restart.
const HEAL_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit'];

export function statusLineBlock() {
  return {
    type: 'command',
    command: STATUSLINE_COMMAND,
    padding: 0,
    refreshInterval: 30,
  };
}

// Read settings.json, returning the parsed object or null when the file does
// not exist. Throws only on genuinely malformed JSON (callers in the heal path
// swallow that to never block a session start).
export function readSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return null;
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

// Atomic write: stage to a sibling .tmp then rename, so a crash mid-write can
// never leave settings.json truncated. Preserves the 2-space + trailing-newline
// style the install/uninstall paths already use.
export function writeSettingsAtomic(settingsPath, settings) {
  const tmp = `${settingsPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, settingsPath);
}

// Returns true when settings already has a claudebar statusLine configured.
function hasClaudebarStatusLine(settings) {
  const cmd = settings?.statusLine?.command;
  return typeof cmd === 'string' && cmd.includes('claudebar');
}

// Restore-if-missing. Used by the heal hook and by `update` — it deliberately
// does NOT overwrite a statusLine the user pointed somewhere else, only fills
// the gap when the key was dropped entirely. Mutates `settings` in place.
export function ensureStatusLine(settings) {
  if (settings.statusLine && typeof settings.statusLine === 'object') {
    return { changed: false };
  }
  settings.statusLine = statusLineBlock();
  return { changed: true };
}

// Force-set the claudebar statusLine (used by `install`, the explicit opt-in).
// No-op when an identical claudebar block is already present so install stays
// idempotent and does not churn the file on re-run.
export function setStatusLine(settings) {
  if (hasClaudebarStatusLine(settings)) {
    const sl = settings.statusLine;
    if (sl.command === STATUSLINE_COMMAND && sl.type === 'command') {
      return { changed: false };
    }
  }
  settings.statusLine = statusLineBlock();
  return { changed: true };
}

// Register the self-healing hook under every HEAL_HOOK_EVENTS event, preserving
// any hooks the user already has (e.g. atomic-skills version-check). Idempotent
// per event — keyed off the HEAL_HOOK_MARKER substring — so an older install that
// only registered SessionStart gets UserPromptSubmit back-filled on the next run.
// Mutates `settings` in place. Returns changed:true if ANY event was modified.
export function ensureHealHook(settings) {
  settings.hooks ??= {};
  let changed = false;
  for (const event of HEAL_HOOK_EVENTS) {
    settings.hooks[event] ??= [];
    const already = settings.hooks[event].some((entry) =>
      (entry?.hooks ?? []).some(
        (h) => typeof h?.command === 'string' && h.command.includes(HEAL_HOOK_MARKER)
      )
    );
    if (already) continue;
    settings.hooks[event].push({
      matcher: '*',
      hooks: [{ type: 'command', command: HEAL_HOOK_COMMAND }],
    });
    changed = true;
  }
  return { changed };
}

// Register the auto-update hook under SessionStart, preserving any other hooks
// (including the heal hook, which shares this event). Idempotent — keyed off the
// AUTO_UPDATE_HOOK_MARKER substring. Mutates `settings` in place.
export function ensureAutoUpdateHook(settings) {
  settings.hooks ??= {};
  let changed = false;
  for (const event of AUTO_UPDATE_HOOK_EVENTS) {
    settings.hooks[event] ??= [];
    const already = settings.hooks[event].some((entry) =>
      (entry?.hooks ?? []).some(
        (h) => typeof h?.command === 'string' && h.command.includes(AUTO_UPDATE_HOOK_MARKER)
      )
    );
    if (already) continue;
    settings.hooks[event].push({
      matcher: '*',
      hooks: [{ type: 'command', command: AUTO_UPDATE_HOOK_COMMAND }],
    });
    changed = true;
  }
  return { changed };
}

// Remove the auto-update hook (used by `uninstall`). Drops our entries and prunes
// matcher objects left empty, leaving the heal hook and any foreign hooks intact.
export function removeAutoUpdateHook(settings) {
  let changedAny = false;
  for (const event of AUTO_UPDATE_HOOK_EVENTS) {
    const list = settings?.hooks?.[event];
    if (!Array.isArray(list)) continue;
    let changed = false;
    const pruned = [];
    for (const entry of list) {
      const hooks = entry?.hooks ?? [];
      const kept = hooks.filter(
        (h) => !(typeof h?.command === 'string' && h.command.includes(AUTO_UPDATE_HOOK_MARKER))
      );
      if (kept.length !== hooks.length) changed = true;
      if (kept.length > 0) pruned.push({ ...entry, hooks: kept });
      else if (!Array.isArray(entry?.hooks)) pruned.push(entry);
    }
    if (changed) {
      if (pruned.length > 0) settings.hooks[event] = pruned;
      else delete settings.hooks[event];
      changedAny = true;
    }
  }
  return { changed: changedAny };
}

// Remove the self-healing hook (used by `uninstall`) from every event it may be
// registered under. Drops our hook entries and prunes any matcher objects left
// empty, without touching other hooks. Returns changed:true if ANY event changed.
export function removeHealHook(settings) {
  let changedAny = false;
  for (const event of HEAL_HOOK_EVENTS) {
    const list = settings?.hooks?.[event];
    if (!Array.isArray(list)) continue;
    let changed = false;
    const pruned = [];
    for (const entry of list) {
      const hooks = entry?.hooks ?? [];
      const kept = hooks.filter(
        (h) => !(typeof h?.command === 'string' && h.command.includes(HEAL_HOOK_MARKER))
      );
      if (kept.length !== hooks.length) changed = true;
      if (kept.length > 0) pruned.push({ ...entry, hooks: kept });
      else if (!Array.isArray(entry?.hooks)) pruned.push(entry); // entry had no hooks array — leave as-is
    }
    if (changed) {
      if (pruned.length > 0) settings.hooks[event] = pruned;
      else delete settings.hooks[event];
      changedAny = true;
    }
  }
  return { changed: changedAny };
}
