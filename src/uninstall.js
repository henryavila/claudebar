import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { removeHealHook, removeAutoUpdateHook } from './settings.js';
import { uninstallDaemon } from './daemon.js';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function askConfirm(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });
}

export async function uninstall({ configDir, settingsPath, confirm, log, deregisterDaemon } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  settingsPath ??= path.join(os.homedir(), '.claude', 'settings.json');
  confirm ??= () => askConfirm('Remove claudebar from ~/.config/claudebar/? [y/N] ');
  log ??= console.log;
  deregisterDaemon ??= uninstallDaemon;

  const ok = await confirm();
  if (!ok) {
    log('Aborted. No changes made.');
    return { aborted: true };
  }

  // Deregister the OS daemon FIRST — the unload commands (launchctl/systemctl)
  // and poll-script removal run while configDir still exists. Best-effort: a
  // failure here must never block removing the rest of the install.
  try {
    deregisterDaemon({ configDir, settingsPath, log });
  } catch (e) {
    log(`Daemon: removal failed (${e.message}) — continuing uninstall`);
  }

  if (fs.existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-${timestamp()}`;
    fs.copyFileSync(settingsPath, backup);
    log(`Backed up settings.json to ${path.basename(backup)}`);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    delete settings.statusLine;
    const { changed: hookRemoved } = removeHealHook(settings);
    const { changed: autoRemoved } = removeAutoUpdateHook(settings);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    log(`Removed statusLine from settings.json`);
    if (hookRemoved) log(`Removed self-heal SessionStart hook`);
    if (autoRemoved) log(`Removed auto-update SessionStart hook`);
  } else {
    log(`settings.json not found at ${settingsPath} — skipped`);
  }

  if (fs.existsSync(configDir)) {
    fs.rmSync(configDir, { recursive: true, force: true });
    log(`Removed ${configDir}`);
  }

  log(`Uninstalled. Restart Claude Code to take effect.`);
  return { aborted: false };
}

export default async function main(args) {
  await uninstall();
}
