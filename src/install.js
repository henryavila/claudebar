import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseTOML } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';
import { setStatusLine, ensureHealHook, ensureAutoUpdateHook } from './settings.js';
import { setModeInToml } from './auto-update.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

// Default interactive picker for the auto-update mode. Only prompts on a real
// TTY; in CI / piped installs it returns null so the caller keeps the shipped
// default ("patch", on) without ever blocking. Returns 'patch'|'all'|'off'|null.
function promptAutoUpdateMode() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(null);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q =
    '\nAuto-update claudebar?\n' +
    '  1) Only hotfixes (1.1.x)  [recommended]\n' +
    '  2) All versions\n' +
    '  3) Off\n' +
    'Choose [1]: ';
  return new Promise((resolve) => {
    rl.question(q, (answer) => {
      rl.close();
      const a = answer.trim();
      if (a === '2') resolve('all');
      else if (a === '3') resolve('off');
      else resolve('patch'); // empty / 1 / anything else → recommended default
    });
  });
}

// Write the chosen mode into a freshly generated config.toml. No-op for null.
function applyAutoUpdateMode(configToml, mode) {
  if (!mode) return;
  fs.writeFileSync(configToml, setModeInToml(fs.readFileSync(configToml, 'utf8'), mode));
}

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return pkg.version;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function install({ configDir, settingsPath, chooseMode, log } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  settingsPath ??= path.join(os.homedir(), '.claude', 'settings.json');
  chooseMode ??= promptAutoUpdateMode;
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

  // Auto-update payload: the SessionStart hook + its logic. auto-update.js needs
  // toml-parser.js (to read the mode/interval from config.toml) sitting beside it.
  fs.copyFileSync(path.join(ASSETS_DIR, 'auto-update.mjs'), path.join(configDir, 'auto-update.mjs'));
  fs.copyFileSync(path.join(__dirname, 'auto-update.js'), path.join(configDir, 'auto-update.js'));
  fs.copyFileSync(path.join(__dirname, 'toml-parser.js'), path.join(configDir, 'toml-parser.js'));
  log(`Copied auto-update hook (auto-update.mjs + auto-update.js + toml-parser.js)`);

  const configToml = path.join(configDir, 'config.toml');
  if (!fs.existsSync(configToml)) {
    const defaultConfig = path.join(ASSETS_DIR, 'default-config.toml');
    fs.copyFileSync(defaultConfig, configToml);
    log(`Generated config.toml from defaults`);
    // Only a fresh install offers the auto-update prompt — never clobber a mode
    // the user already configured. A null choice (no TTY) keeps the default.
    const mode = await chooseMode();
    if (mode) {
      applyAutoUpdateMode(configToml, mode);
      log(`Set auto-update mode: ${mode}`);
    }
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
    const { changed: autoAdded } = ensureAutoUpdateHook(settings);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    log(`Patched settings.json with statusLine`);
    if (hookAdded) log(`Registered self-heal hooks (SessionStart + UserPromptSubmit)`);
    if (autoAdded) log(`Registered auto-update hook (SessionStart)`);
  } else {
    log(`settings.json not found at ${settingsPath} — skipped patching`);
  }

  log(`\nInstall complete. Restart Claude Code or send a message to see the statusline.`);
}

export default async function main(args) {
  await install();
}
