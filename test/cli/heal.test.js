import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');

// Reproduce the installed layout: ensure-statusline.mjs + settings.js sitting
// side by side in a directory, exactly as install/update place them in
// ~/.config/claudebar/. The script imports ./settings.js from there.
function makeInstallDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-heal-test-'));
  fs.copyFileSync(path.join(REPO, 'assets', 'ensure-statusline.mjs'), path.join(dir, 'ensure-statusline.mjs'));
  fs.copyFileSync(path.join(REPO, 'src', 'settings.js'), path.join(dir, 'settings.js'));
  return dir;
}

function runHeal(installDir, settingsPath) {
  return execFileSync('node', [path.join(installDir, 'ensure-statusline.mjs')], {
    env: { ...process.env, CLAUDEBAR_SETTINGS: settingsPath },
    encoding: 'utf8',
  });
}

describe('ensure-statusline.mjs (self-heal hook)', () => {
  let installDir, settingsPath;

  beforeEach(() => {
    installDir = makeInstallDir();
    settingsPath = path.join(installDir, 'settings.json');
  });

  afterEach(() => { fs.rmSync(installDir, { recursive: true, force: true }); });

  it('restores a dropped statusLine', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'));
  });

  it('produces no stdout (SessionStart stdout is injected into context)', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    const out = runHeal(installDir, settingsPath);
    assert.equal(out, '', 'must stay silent');
  });

  it('leaves an already-configured statusLine untouched', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: '/keep/me.sh' } }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.command, '/keep/me.sh');
  });

  it('exits 0 and does nothing when settings.json is absent', () => {
    const missing = path.join(installDir, 'nope.json');
    // execFileSync throws on non-zero exit; absence of throw asserts exit 0.
    assert.doesNotThrow(() => runHeal(installDir, missing));
    assert.ok(!fs.existsSync(missing), 'does not create settings.json from nothing');
  });
});
