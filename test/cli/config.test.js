import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from '../../src/config.js';

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
