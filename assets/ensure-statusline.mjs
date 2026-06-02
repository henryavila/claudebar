#!/usr/bin/env node
// claudebar self-heal — runs as a Claude Code hook (SessionStart +
// UserPromptSubmit) AND as the one-shot the OS daemon executes (launchd /
// systemd / cron). One payload, two delivery paths.
//
// If ~/.claude/settings.json ever loses its `statusLine` entry, the heal hook
// registration, or the auto-update hook (observed after settings rewrites / TUI
// toggles or a co-installed tool overwriting hooks.*), this restores ALL of them
// (full parity, via healAll). Re-registering the hooks keeps the heal
// self-sustaining: otherwise the first rewrite that drops the hook entry would
// permanently disable hook-driven healing — which is exactly why the OS daemon
// runs this same script from outside Claude Code's control. It is deliberately
// silent and best-effort:
//   - prints NOTHING to stdout (SessionStart/UserPromptSubmit stdout is injected
//     into the model's context; the daemon discards stdout anyway)
//   - never exits non-zero (a failing hook must not block a session)
//   - only writes when something is actually missing (no churn otherwise — this
//     also bounds the launchd/systemd WatchPath self-trigger to one extra no-op)
//
// Imports ./settings.js, which install/update copy alongside this file into
// ~/.config/claudebar/, so the heal logic stays identical to the installer.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const { readSettings, writeSettingsAtomic, healAll } = await import(
    path.join(__dirname, 'settings.js')
  );
  const settingsPath =
    process.env.CLAUDEBAR_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
  const settings = readSettings(settingsPath);
  if (settings) {
    const { changed } = healAll(settings);
    if (changed) writeSettingsAtomic(settingsPath, settings);
  }
} catch {
  // Swallow everything — a self-heal hook must never break a session start.
}

process.exit(0);
