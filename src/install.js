import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseTOML } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';
import { setStatusLine, ensureHealHook } from './settings.js';

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

export async function install({ configDir, settingsPath, log } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  settingsPath ??= path.join(os.homedir(), '.claude', 'settings.json');
  log ??= console.log;

  fs.mkdirSync(configDir, { recursive: true });

  const scriptSrc = path.join(ASSETS_DIR, 'statusline.sh');
  const scriptDst = path.join(configDir, 'statusline.sh');
  fs.copyFileSync(scriptSrc, scriptDst);
  fs.chmodSync(scriptDst, 0o755);
  log(`Copied statusline.sh to ${scriptDst}`);

  const parserSrc = path.join(ASSETS_DIR, 'toml-parser.sh');
  const parserDst = path.join(configDir, 'toml-parser.sh');
  fs.copyFileSync(parserSrc, parserDst);
  log(`Copied toml-parser.sh`);

  // Self-heal payload: the hook script + its shared settings logic. Copying
  // settings.js next to the .mjs lets the hook import it from the install dir.
  fs.copyFileSync(path.join(ASSETS_DIR, 'ensure-statusline.mjs'), path.join(configDir, 'ensure-statusline.mjs'));
  fs.copyFileSync(path.join(__dirname, 'settings.js'), path.join(configDir, 'settings.js'));
  log(`Copied self-heal hook (ensure-statusline.mjs + settings.js)`);

  const configToml = path.join(configDir, 'config.toml');
  if (!fs.existsSync(configToml)) {
    const defaultConfig = path.join(ASSETS_DIR, 'default-config.toml');
    fs.copyFileSync(defaultConfig, configToml);
    log(`Generated config.toml from defaults`);
  } else {
    log(`config.toml already exists — preserved`);
  }

  const configSh = path.join(configDir, 'config.sh');
  const tomlContent = fs.readFileSync(configToml, 'utf8');
  const parsed = parseTOML(tomlContent);
  const compiled = compileConfig(parsed);
  fs.writeFileSync(configSh, compiled);
  log(`Compiled config.sh`);

  const version = getVersion();
  fs.writeFileSync(path.join(configDir, '.version'), version);
  log(`Wrote .version: ${version}`);

  if (fs.existsSync(settingsPath)) {
    const backup = `${settingsPath}.bak-${timestamp()}`;
    fs.copyFileSync(settingsPath, backup);
    log(`Backed up settings.json to ${path.basename(backup)}`);

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    setStatusLine(settings);
    const { changed: hookAdded } = ensureHealHook(settings);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    log(`Patched settings.json with statusLine`);
    if (hookAdded) log(`Registered self-heal SessionStart hook`);
  } else {
    log(`settings.json not found at ${settingsPath} — skipped patching`);
  }

  log(`\nInstall complete. Restart Claude Code or send a message to see the statusline.`);
}

export default async function main(args) {
  await install();
}
