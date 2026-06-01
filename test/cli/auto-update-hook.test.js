import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');

// Reproduce the installed layout: auto-update.mjs + its imports (auto-update.js,
// toml-parser.js) side by side, exactly as install/update place them in
// ~/.config/claudebar/. The .mjs resolves __dirname as the install dir.
function makeInstallDir(mode = 'off') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-au-hook-'));
  fs.copyFileSync(path.join(REPO, 'assets', 'auto-update.mjs'), path.join(dir, 'auto-update.mjs'));
  fs.copyFileSync(path.join(REPO, 'src', 'auto-update.js'), path.join(dir, 'auto-update.js'));
  fs.copyFileSync(path.join(REPO, 'src', 'toml-parser.js'), path.join(dir, 'toml-parser.js'));
  fs.writeFileSync(path.join(dir, '.version'), '1.1.0');
  // Default the fixture to mode=off so the check is inert (no network) in tests.
  fs.writeFileSync(path.join(dir, 'config.toml'), `[update]\nauto_update = "${mode}"\n`);
  return dir;
}

function runHook(dir, args = []) {
  return execFileSync('node', [path.join(dir, 'auto-update.mjs'), ...args], { encoding: 'utf8' });
}

describe('auto-update.mjs (SessionStart hook)', () => {
  let dir;
  beforeEach(() => { dir = makeInstallDir('off'); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('bare invocation exits 0 and is silent (SessionStart stdout is injected into context)', () => {
    let out;
    assert.doesNotThrow(() => { out = runHook(dir); });
    assert.equal(out, '', 'must stay silent');
  });

  it('--run worker with mode=off is inert: exits 0, no stamp, no network', () => {
    assert.doesNotThrow(() => runHook(dir, ['--run']));
    assert.ok(!fs.existsSync(path.join(dir, '.last-update-check')), 'off must not create a stamp');
  });
});
