import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { update } from '../../src/update.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-update-test-'));
}

describe('update', () => {
  let tmpDir, configDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('reports not installed when .version missing', async () => {
    const logs = [];
    const result = await update({ configDir, log: (m) => logs.push(m) });
    assert.equal(result.updated, false);
    assert.ok(logs.join('\n').includes('Not installed'));
  });

  it('reports up to date when versions match', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), '1.0.0');
    const logs = [];
    const result = await update({ configDir, log: (m) => logs.push(m) });
    assert.equal(result.updated, false);
    assert.ok(logs.join('\n').includes('up to date'));
  });

  it('updates files when version differs', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), '0.9.0');
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), 'old');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '# claudebar config v1\n[colors]\nmodel = 99');
    fs.writeFileSync(path.join(configDir, 'config.sh'), '');
    const logs = [];
    const result = await update({ configDir, log: (m) => logs.push(m) });
    assert.equal(result.updated, true);
    const newScript = fs.readFileSync(path.join(configDir, 'statusline.sh'), 'utf8');
    assert.notEqual(newScript, 'old');
    const version = fs.readFileSync(path.join(configDir, '.version'), 'utf8');
    assert.equal(version, '1.0.0');
  });

  it('backs up config.toml during update', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), '0.9.0');
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), 'old');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '# claudebar config v1');
    fs.writeFileSync(path.join(configDir, 'config.sh'), '');
    await update({ configDir, log: () => {} });
    const backups = fs.readdirSync(configDir).filter(f => f.startsWith('config.toml.bak-'));
    assert.ok(backups.length >= 1);
  });
});
