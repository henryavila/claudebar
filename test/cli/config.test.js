import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config, configAutoUpdate } from '../../src/config.js';
import { parseTOML } from '../../src/toml-parser.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-config-test-'));
}

describe('config', () => {
  let tmpDir, configDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('generates config.toml if absent', async () => {
    const result = await config({
      configDir,
      editor: 'true',
      log: () => {},
    });
    assert.ok(fs.existsSync(path.join(configDir, 'config.toml')));
    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.ok(content.includes('claudebar config v1'));
  });

  it('recompiles config.sh after editor exits 0', async () => {
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[colors]\nmodel = 99');
    const result = await config({
      configDir,
      editor: 'true',
      log: () => {},
    });
    assert.equal(result.valid, true);
    assert.ok(fs.existsSync(path.join(configDir, 'config.sh')));
    const sh = fs.readFileSync(path.join(configDir, 'config.sh'), 'utf8');
    assert.ok(sh.includes('C_MODEL=99'));
  });
});

describe('configAutoUpdate (config auto-update <mode>)', () => {
  let tmpDir, configDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    fs.mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('sets a valid mode into config.toml', async () => {
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[update]\n# auto_update = "patch"\n');
    const r = await configAutoUpdate({ configDir, mode: 'off', log: () => {} });
    assert.equal(r.mode, 'off');
    assert.equal(parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8')).update?.auto_update, 'off');
  });

  it('generates config.toml from defaults when absent, then sets the mode', async () => {
    const r = await configAutoUpdate({ configDir, mode: 'all', log: () => {} });
    assert.equal(r.mode, 'all');
    assert.ok(fs.existsSync(path.join(configDir, 'config.toml')));
    assert.equal(parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8')).update?.auto_update, 'all');
  });

  it('rejects an invalid mode without writing', async () => {
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[update]\nauto_update = "patch"\n');
    const r = await configAutoUpdate({ configDir, mode: 'sometimes', log: () => {} });
    assert.equal(r.valid, false);
    assert.equal(parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8')).update?.auto_update, 'patch', 'unchanged');
  });

  it('with no mode reports the current effective mode (default patch)', async () => {
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[colors]\nmodel = 99\n'); // no [update]
    const logs = [];
    const r = await configAutoUpdate({ configDir, mode: undefined, log: (m) => logs.push(m) });
    assert.equal(r.mode, 'patch', 'falls back to default when unset');
    assert.ok(logs.join('\n').includes('patch'));
  });
});
