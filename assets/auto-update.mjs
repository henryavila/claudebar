#!/usr/bin/env node
// claudebar auto-update — runs as a Claude Code SessionStart hook.
//
// SessionStart must never wait on the network, so this script has two modes:
//   - bare invocation (the hook): re-spawn itself DETACHED with `--run` and exit
//     0 immediately. The session proceeds; the check happens in the background.
//   - `--run` (the detached worker): perform the throttled check + maybe apply,
//     then exit. Best-effort and silent — a failing hook must never block a
//     session, and SessionStart stdout is injected into the model's context.
//
// Imports ./auto-update.js (+ ./toml-parser.js), which install/update copy
// alongside this file into ~/.config/claudebar/, so the logic stays identical to
// the installer.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.argv.includes('--run')) {
  // Detached worker: do the actual check against the install dir.
  try {
    const { runAutoUpdate } = await import(path.join(__dirname, 'auto-update.js'));
    let installedVersion;
    try {
      installedVersion = fs.readFileSync(path.join(__dirname, '.version'), 'utf8').trim();
    } catch {
      /* unknown installed version → decideUpdate treats it as unparseable (none) */
    }
    await runAutoUpdate({ configDir: __dirname, installedVersion });
  } catch {
    // Swallow everything — auto-update must never surface an error.
  }
  process.exit(0);
}

// Hook invocation: detach the worker so SessionStart returns instantly.
try {
  const child = spawn(process.execPath, [__filename, '--run'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
} catch {
  // Swallow — if we can't spawn, the next session start retries.
}
process.exit(0);
