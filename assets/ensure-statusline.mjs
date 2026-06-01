#!/usr/bin/env node
// claudebar self-heal — runs as a Claude Code SessionStart hook.
//
// If ~/.claude/settings.json ever loses its `statusLine` entry OR this hook's
// own SessionStart registration (observed after settings rewrites / TUI toggles
// or a co-installed tool overwriting hooks.SessionStart), this restores them on
// the next session start. Re-registering itself keeps the heal self-sustaining:
// otherwise, the first rewrite that drops the hook entry would permanently
// disable auto-healing. It is deliberately silent and best-effort:
//   - prints NOTHING to stdout (SessionStart stdout is injected into context)
//   - never exits non-zero (a failing hook must not block a session)
//   - only writes when something is actually missing (no churn otherwise)
//
// Imports ./settings.js, which install/update copy alongside this file into
// ~/.config/claudebar/, so the heal logic stays identical to the installer.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const { readSettings, writeSettingsAtomic, ensureStatusLine, ensureHealHook } = await import(
    path.join(__dirname, 'settings.js')
  );
  const settingsPath =
    process.env.CLAUDEBAR_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
  const settings = readSettings(settingsPath);
  if (settings) {
    const { changed: slChanged } = ensureStatusLine(settings);
    const { changed: hookChanged } = ensureHealHook(settings);
    if (slChanged || hookChanged) writeSettingsAtomic(settingsPath, settings);
  }
} catch {
  // Swallow everything — a self-heal hook must never break a session start.
}

process.exit(0);
