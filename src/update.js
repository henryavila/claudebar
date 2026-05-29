import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseTOML } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';
import { migrateConfig, parseSchemaVersion, CURRENT_SCHEMA_VERSION } from './config-migrator.js';
import { readSettings, writeSettingsAtomic, ensureStatusLine, ensureHealHook } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return pkg.version;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function update({ configDir, settingsPath, log } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  settingsPath ??= path.join(os.homedir(), '.claude', 'settings.json');
  log ??= console.log;

  const versionFile = path.join(configDir, '.version');
  if (!fs.existsSync(versionFile)) {
    log(`Not installed. Run: npx @henryavila/claudebar install`);
    return { updated: false };
  }

  // Self-heal runs on EVERY update — even when already on the latest version.
  // The common trigger ("settings.json lost its statusLine after a Claude Code
  // update / TUI toggle") is independent of the claudebar version, so it must
  // run before the up-to-date early return.
  fs.copyFileSync(path.join(ASSETS_DIR, 'ensure-statusline.mjs'), path.join(configDir, 'ensure-statusline.mjs'));
  fs.copyFileSync(path.join(__dirname, 'settings.js'), path.join(configDir, 'settings.js'));
  const settings = readSettings(settingsPath);
  if (settings) {
    const { changed: slRestored } = ensureStatusLine(settings);
    const { changed: hookAdded } = ensureHealHook(settings);
    if (slRestored || hookAdded) {
      writeSettingsAtomic(settingsPath, settings);
      if (slRestored) log(`Restored statusLine in settings.json`);
      if (hookAdded) log(`Registered self-heal SessionStart hook`);
    }
  }

  const installed = fs.readFileSync(versionFile, 'utf8').trim();
  const latest = getVersion();

  if (installed === latest) {
    log(`Already up to date (v${installed}).`);
    return { updated: false };
  }

  log(`Updating v${installed} → v${latest}...`);

  fs.copyFileSync(path.join(ASSETS_DIR, 'statusline.sh'), path.join(configDir, 'statusline.sh'));
  fs.chmodSync(path.join(configDir, 'statusline.sh'), 0o755);
  fs.copyFileSync(path.join(ASSETS_DIR, 'toml-parser.sh'), path.join(configDir, 'toml-parser.sh'));
  log(`Replaced statusline.sh and toml-parser.sh`);

  const configToml = path.join(configDir, 'config.toml');
  if (fs.existsSync(configToml)) {
    const backup = `${configToml}.bak-${timestamp()}`;
    fs.copyFileSync(configToml, backup);
    log(`Backed up config.toml to ${path.basename(backup)}`);

    const content = fs.readFileSync(configToml, 'utf8');
    const fromVersion = parseSchemaVersion(content);
    if (fromVersion < CURRENT_SCHEMA_VERSION) {
      const parsed = parseTOML(content);
      const { config: migrated } = migrateConfig(parsed, fromVersion);
      const compiled = compileConfig(migrated);
      fs.writeFileSync(path.join(configDir, 'config.sh'), compiled);
      log(`Migrated config v${fromVersion} → v${CURRENT_SCHEMA_VERSION}`);
    } else {
      const parsed = parseTOML(content);
      const compiled = compileConfig(parsed);
      fs.writeFileSync(path.join(configDir, 'config.sh'), compiled);
      log(`Recompiled config.sh`);
    }
  }

  fs.writeFileSync(versionFile, latest);
  log(`Updated to v${latest}.`);
  return { updated: true };
}

export default async function main(args) {
  await update();
}
