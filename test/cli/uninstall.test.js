import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { uninstall } from '../../src/uninstall.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-uninstall-test-'));
}

describe('uninstall', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });
    settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      statusLine: { type: 'command', command: '~/.config/claudebar/statusline.sh' },
      permissions: { allow: ['Bash(git *)'] },
    }, null, 2));
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), '#!/usr/bin/env bash\necho ok');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '# claudebar config v1');
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('aborts when user declines', async () => {
    const result = await uninstall({
      configDir, settingsPath, confirm: async () => false, log: () => {},
    });
    assert.equal(result.aborted, true);
    assert.ok(fs.existsSync(path.join(configDir, 'config.toml')));
  });

  it('removes statusLine from settings.json, preserves other keys', async () => {
    await uninstall({
      configDir, settingsPath, confirm: async () => true, log: () => {},
    });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine, undefined);
    assert.deepEqual(settings.permissions, { allow: ['Bash(git *)'] });
  });

  it('removes config directory', async () => {
    await uninstall({
      configDir, settingsPath, confirm: async () => true, log: () => {},
    });
    assert.equal(fs.existsSync(configDir), false);
  });

  it('creates backup of settings.json', async () => {
    await uninstall({
      configDir, settingsPath, confirm: async () => true, log: () => {},
    });
    const backups = fs.readdirSync(claudeDir).filter(f => f.startsWith('settings.json.bak-'));
    assert.ok(backups.length >= 1);
  });
});
