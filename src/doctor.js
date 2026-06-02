import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { parseTOML } from './toml-parser.js';
import { DEFAULT_MODE } from './auto-update.js';
import { daemonStatus as defaultDaemonStatus } from './daemon.js';

function check(name, fn) {
  try {
    const msg = fn();
    return { name, pass: true, message: msg };
  } catch (e) {
    return { name, pass: false, message: e.message };
  }
}

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim();
}

export async function doctor({ configDir, settingsPath, log, daemonStatus } = {}) {
  configDir ??= path.join(os.homedir(), '.config', 'claudebar');
  settingsPath ??= path.join(os.homedir(), '.claude', 'settings.json');
  log ??= console.log;
  daemonStatus ??= defaultDaemonStatus;

  const results = [];

  results.push(check('bash', () => {
    const version = run('bash --version').split('\n')[0];
    return version;
  }));

  results.push(check('jq', () => {
    const p = run('which jq');
    return `jq: ${p}`;
  }));

  results.push(check('git', () => {
    const p = run('which git');
    return `git: ${p}`;
  }));

  results.push(check('256-color', () => {
    const term = process.env.TERM || '';
    if (term.includes('256color') || term === 'xterm-kitty' || term === 'tmux-256color') {
      return `TERM=${term}`;
    }
    throw new Error(`TERM=${term} — set TERM=xterm-256color`);
  }));

  results.push(check('statusline.sh', () => {
    const script = path.join(configDir, 'statusline.sh');
    if (!fs.existsSync(script)) throw new Error(`not found — run: npx @henryavila/claudebar install`);
    return script;
  }));

  results.push(check('config.toml', () => {
    const config = path.join(configDir, 'config.toml');
    if (!fs.existsSync(config)) throw new Error(`not found — run: npx @henryavila/claudebar install`);
    return `config.toml: valid`;
  }));

  results.push(check('config.sh', () => {
    const toml = path.join(configDir, 'config.toml');
    const sh = path.join(configDir, 'config.sh');
    if (!fs.existsSync(sh)) throw new Error(`not found — recompiling...`);
    if (fs.existsSync(toml)) {
      const tomlMtime = fs.statSync(toml).mtimeMs;
      const shMtime = fs.statSync(sh).mtimeMs;
      if (tomlMtime > shMtime) throw new Error(`config.sh stale — run: npx @henryavila/claudebar config`);
    }
    return `config.sh: current`;
  }));

  results.push(check('settings.json', () => {
    if (!fs.existsSync(settingsPath)) throw new Error(`not found at ${settingsPath}`);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmd = settings?.statusLine?.command || '';
    if (!cmd.includes('claudebar')) throw new Error(`statusLine not pointing to claudebar`);
    return `statusLine → ${cmd}`;
  }));

  results.push(check('self-heal hook', () => {
    if (!fs.existsSync(settingsPath)) throw new Error(`settings.json not found`);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const sessionStart = settings?.hooks?.SessionStart ?? [];
    const present = sessionStart.some((entry) =>
      (entry?.hooks ?? []).some(
        (h) => typeof h?.command === 'string' && h.command.includes('ensure-statusline')
      )
    );
    if (!present) throw new Error(`not registered — run: npx @henryavila/claudebar update`);
    if (!fs.existsSync(path.join(configDir, 'ensure-statusline.mjs'))) {
      throw new Error(`hook registered but ensure-statusline.mjs missing — run: npx @henryavila/claudebar update`);
    }
    return `SessionStart → ensure-statusline.mjs`;
  }));

  results.push(check('auto-update', () => {
    if (!fs.existsSync(path.join(configDir, 'auto-update.mjs'))) {
      throw new Error(`payload missing — run: npx @henryavila/claudebar update`);
    }
    if (!fs.existsSync(settingsPath)) throw new Error(`settings.json not found`);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const sessionStart = settings?.hooks?.SessionStart ?? [];
    const present = sessionStart.some((entry) =>
      (entry?.hooks ?? []).some(
        (h) => typeof h?.command === 'string' && h.command.includes('auto-update')
      )
    );
    if (!present) throw new Error(`hook not registered — run: npx @henryavila/claudebar update`);
    let mode = DEFAULT_MODE;
    const toml = path.join(configDir, 'config.toml');
    if (fs.existsSync(toml)) {
      mode = parseTOML(fs.readFileSync(toml, 'utf8')).update?.auto_update ?? DEFAULT_MODE;
    }
    return `mode=${mode} (SessionStart → auto-update.mjs)`;
  }));

  results.push(check('daemon', () => {
    // Honor the opt-out: a disabled daemon is not a failure (hook heal still runs).
    let enabled = true;
    const toml = path.join(configDir, 'config.toml');
    if (fs.existsSync(toml)) {
      try { enabled = parseTOML(fs.readFileSync(toml, 'utf8')).daemon?.enabled !== false; } catch { /* default on */ }
    }
    if (!enabled) return `disabled via [daemon] enabled=false (hook heal active)`;

    const st = daemonStatus({ configDir, settingsPath });
    if (st.mechanism === 'unsupported') return `${process.platform} not supported (hook heal active)`;
    if (!st.registered) throw new Error(`not registered — run: npx @henryavila/claudebar update`);
    return `${st.mechanism} ${st.active ? '(active)' : '(registered)'}`;
  }));

  results.push(check('version', () => {
    const versionFile = path.join(configDir, '.version');
    if (!fs.existsSync(versionFile)) throw new Error(`not installed`);
    const installed = fs.readFileSync(versionFile, 'utf8').trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(import.meta.url.replace('file://', '')), '..', 'package.json'), 'utf8'));
    const latest = pkg.version;
    if (installed !== latest) throw new Error(`v${installed} installed, v${latest} available — run: npx @henryavila/claudebar update`);
    return `v${installed} (latest)`;
  }));

  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? '✓' : '✗';
    log(`  ${icon} ${r.name}: ${r.message}`);
    if (!r.pass) allPass = false;
  }

  return { pass: allPass, results };
}

export default async function main(args) {
  const { pass } = await doctor();
  process.exit(pass ? 0 : 1);
}
