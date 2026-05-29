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

// A stable marker substring used to find OUR hook among any others the user
// (or another tool) has registered under SessionStart.
const HEAL_HOOK_MARKER = 'ensure-statusline';

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

// Register the self-healing SessionStart hook, preserving any hooks the user
// already has (e.g. atomic-skills version-check). Idempotent — keyed off the
// HEAL_HOOK_MARKER substring. Mutates `settings` in place.
export function ensureHealHook(settings) {
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  const already = settings.hooks.SessionStart.some((entry) =>
    (entry?.hooks ?? []).some(
      (h) => typeof h?.command === 'string' && h.command.includes(HEAL_HOOK_MARKER)
    )
  );
  if (already) return { changed: false };
  settings.hooks.SessionStart.push({
    matcher: '*',
    hooks: [{ type: 'command', command: HEAL_HOOK_COMMAND }],
  });
  return { changed: true };
}

// Remove the self-healing hook (used by `uninstall`). Drops our hook entries
// and prunes any matcher objects left empty, without touching other hooks.
export function removeHealHook(settings) {
  const list = settings?.hooks?.SessionStart;
  if (!Array.isArray(list)) return { changed: false };
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
    if (pruned.length > 0) settings.hooks.SessionStart = pruned;
    else delete settings.hooks.SessionStart;
  }
  return { changed };
}
