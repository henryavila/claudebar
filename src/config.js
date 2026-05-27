import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { parseTOML, validateConfig } from './toml-parser.js';
import { compileConfig } from './config-compiler.js';
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

export default async function main(args) {
  await config();
}
