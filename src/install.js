import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseTOML } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';
import { setStatusLine, ensureHealHook, ensureAutoUpdateHook } from './settings.js';
import { setModeInToml } from './auto-update.js';
import { installDaemon } from './daemon.js';

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

// Has the user already committed to an explicit auto_update mode? A commented
// template line or a missing key both read back as undefined → "not chosen yet",
// so a reinstall may offer the prompt. An unparseable custom config is treated as
// committed (return true) so we never risk clobbering a hand-edited file.
function hasExplicitMode(configToml) {
  try {
    const cfg = parseTOML(fs.readFileSync(configToml, 'utf8'));
    return cfg.update?.auto_update != null;
  } catch {
    return true;
  }
}

// Prompt for the mode and, if one is chosen, persist it. Shared by fresh install
// and the reinstall back-fill so both paths behave identically.
async function offerAutoUpdateChoice(configToml, chooseMode, log) {
  const mode = await chooseMode();
  if (mode) {
    applyAutoUpdateMode(configToml, mode);
    log(`Set auto-update mode: ${mode}`);
  }
}

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return pkg.version;
}

function sectionBlocks(tomlContent) {
  const blocks = [];
  let current = null;
  for (const line of tomlContent.split('\n')) {
    const section = line.match(/^\s*\[([a-z_]+)\]\s*$/);
    if (section) {
      if (current) blocks.push(current);
      current = { name: section[1], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

function trimTrailingBlankLines(lines) {
  const out = [...lines];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

function keyNames(sectionLines) {
  return new Set(
    sectionLines
      .map((line) => line.match(/^\s*#?\s*([a-z_]+)\s*=/)?.[1])
      .filter(Boolean)
  );
}

function defaultKeyLines(sectionLines) {
  return sectionLines
    .map((line) => {
      const match = line.match(/^\s*#?\s*([a-z_]+)\s*=/);
      return match ? { key: match[1], line } : null;
    })
    .filter(Boolean);
}

function appendMissingKeyLines(section, defaultBlock) {
  const existingKeys = keyNames(section.lines);
  const missing = defaultKeyLines(defaultBlock.lines).filter(({ key }) => !existingKeys.has(key));
  if (missing.length === 0) return [];

  section.lines = trimTrailingBlankLines(section.lines);
  section.lines.push(...missing.map(({ line }) => line), '');
  return missing.map(({ key }) => `[${section.name}] ${key}`);
}

function renderToml(preamble, sections) {
  const lines = [...preamble];
  for (const section of sections) lines.push(...section.lines);
  const rendered = lines.join('\n');
  return rendered.endsWith('\n') ? rendered : `${rendered}\n`;
}

function backfillDefaultSections(configToml, defaultConfig, log) {
  const current = fs.readFileSync(configToml, 'utf8');
  const parsed = sectionBlocks(current);
  if (parsed.length === 0) return;

  const preambleEnd = current.search(/^\s*\[[a-z_]+\]\s*$/m);
  const preamble = preambleEnd > 0 ? current.slice(0, preambleEnd).split('\n') : [];
  const existing = new Map(parsed.map((block) => [block.name, block]));
  const added = [];
  for (const block of sectionBlocks(fs.readFileSync(defaultConfig, 'utf8'))) {
    const existingBlock = existing.get(block.name);
    if (existingBlock) {
      added.push(...appendMissingKeyLines(existingBlock, block));
      continue;
    }

    const last = parsed[parsed.length - 1];
    if (last.lines[last.lines.length - 1] !== '') last.lines.push('');
    const newBlock = { name: block.name, lines: [...trimTrailingBlankLines(block.lines), ''] };
    parsed.push(newBlock);
    existing.set(newBlock.name, newBlock);
    added.push(`[${block.name}]`);
  }

  if (added.length > 0) {
    const next = renderToml(preamble, parsed);
    fs.writeFileSync(configToml, next);
    log(`Backfilled config.toml defaults: ${added.join(', ')}`);
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function install({ configDir, settingsPath, chooseMode, log, noDaemon, registerDaemon } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  settingsPath ??= path.join(os.homedir(), '.claude', 'settings.json');
  chooseMode ??= promptAutoUpdateMode;
  log ??= console.log;
  noDaemon ??= false;
  registerDaemon ??= installDaemon;

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

  // GLM quota payload: the detached refresh entry + its logic module. Copying
  // quota.js next to the .mjs lets it import from the install dir. statusline.sh
  // spawns this when the quota cache is stale on a GLM Coding Plan setup.
  fs.copyFileSync(path.join(ASSETS_DIR, 'quota-fetch.mjs'), path.join(configDir, 'quota-fetch.mjs'));
  fs.copyFileSync(path.join(__dirname, 'quota.js'), path.join(configDir, 'quota.js'));
  log(`Copied GLM quota refresh (quota-fetch.mjs + quota.js)`);

  const configToml = path.join(configDir, 'config.toml');
  const defaultConfig = path.join(ASSETS_DIR, 'default-config.toml');
  if (!fs.existsSync(configToml)) {
    fs.copyFileSync(defaultConfig, configToml);
    log(`Generated config.toml from defaults`);
    // Fresh install: offer the auto-update prompt. A null choice (no TTY) keeps
    // the shipped default ("patch", commented).
    await offerAutoUpdateChoice(configToml, chooseMode, log);
  } else {
    log(`config.toml already exists — preserved`);
    backfillDefaultSections(configToml, defaultConfig, log);
    // Reinstall: if the user never picked a mode (line still commented/absent),
    // offer the choice now. setModeInToml only touches the auto_update line, so
    // every other setting they customized is left exactly as-is. An already-set
    // mode is preserved — we never re-prompt or clobber it.
    if (!hasExplicitMode(configToml)) {
      await offerAutoUpdateChoice(configToml, chooseMode, log);
    }
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

  // OS daemon: the hook-independent backstop. Default on; opt out with
  // `--no-daemon` or `[daemon] enabled = false`. Best-effort — registerDaemon
  // never throws, so a launchctl/systemctl hiccup can't fail the install.
  const daemonEnabled = parsed.daemon?.enabled !== false && !noDaemon;
  if (daemonEnabled) {
    try {
      registerDaemon({ configDir, settingsPath, log });
    } catch (e) {
      log(`Daemon: registration failed (${e.message}) — hook heal still active`);
    }
  } else {
    log(`Daemon: disabled (${noDaemon ? '--no-daemon' : '[daemon] enabled = false'}) — hook heal only`);
  }

  log(`\nInstall complete. Restart Claude Code or send a message to see the statusline.`);
}

export default async function main(args = []) {
  await install({ noDaemon: args.includes('--no-daemon') });
}
