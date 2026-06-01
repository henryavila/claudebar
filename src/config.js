import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseTOML, validateConfig } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';
import { setModeInToml, DEFAULT_MODE } from './auto-update.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

export async function config({ configDir, editor, log } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  editor ??= process.env.EDITOR || process.env.VISUAL || 'vi';
  log ??= console.log;

  const configToml = path.join(configDir, 'config.toml');
  const configSh = path.join(configDir, 'config.sh');

  if (!fs.existsSync(configToml)) {
    fs.mkdirSync(configDir, { recursive: true });
    const defaultConfig = path.join(ASSETS_DIR, 'default-config.toml');
    fs.copyFileSync(defaultConfig, configToml);
    log(`Generated config.toml from defaults`);
  }

  const result = spawnSync(editor, [configToml], { stdio: 'inherit' });
  if (result.status !== 0) {
    log(`Editor exited with code ${result.status}`);
    return { valid: false };
  }

  const content = fs.readFileSync(configToml, 'utf8');
  const parsed = parseTOML(content);
  const validation = validateConfig(parsed);

  if (!validation.valid) {
    log(`\nConfig validation errors:`);
    for (const err of validation.errors) {
      log(`  ✗ ${err.message}`);
    }
    return { valid: false, errors: validation.errors };
  }

  const compiled = compileConfig(parsed);
  fs.writeFileSync(configSh, compiled);
  log(`Config applied. Changes take effect on next statusline render.`);
  return { valid: true };
}

// `config auto-update [patch|all|off]` — change (or report) the auto-update mode
// without opening an editor. Generates a default config.toml if none exists.
export async function configAutoUpdate({ configDir, mode, log } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  log ??= console.log;

  const configToml = path.join(configDir, 'config.toml');
  if (!fs.existsSync(configToml)) {
    fs.mkdirSync(configDir, { recursive: true });
    fs.copyFileSync(path.join(ASSETS_DIR, 'default-config.toml'), configToml);
    log(`Generated config.toml from defaults`);
  }

  // No mode → report the current effective value (default when unset).
  if (!mode) {
    const current = parseTOML(fs.readFileSync(configToml, 'utf8')).update?.auto_update ?? DEFAULT_MODE;
    log(`auto-update mode: ${current}`);
    return { mode: current };
  }

  if (!['patch', 'all', 'off'].includes(mode)) {
    log(`Invalid mode "${mode}" — choose patch, all, or off.`);
    return { valid: false };
  }

  fs.writeFileSync(configToml, setModeInToml(fs.readFileSync(configToml, 'utf8'), mode));
  log(`auto-update mode set to: ${mode}`);
  return { valid: true, mode };
}

export default async function main(args) {
  if (args?.[0] === 'auto-update') {
    await configAutoUpdate({ mode: args[1] });
    return;
  }
  await config();
}
