import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseTOML } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';

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
    settings.statusLine = {
      type: 'command',
      command: `~/.config/claudebar/statusline.sh`,
      padding: 0,
      refreshInterval: 30,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    log(`Patched settings.json with statusLine`);
  } else {
    log(`settings.json not found at ${settingsPath} — skipped patching`);
  }

  log(`\nInstall complete. Restart Claude Code or send a message to see the statusline.`);
}

export default async function main(args) {
  await install();
}
