import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { uninstall as rawUninstall } from '../../src/uninstall.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-uninstall-test-'));
}

// Wrapper so the real OS daemon deregistration (launchctl/systemctl) never runs
// on the test machine. `deregisterDaemon` defaults to a recording spy.
let daemonCalls;
const uninstall = (opts = {}) => rawUninstall({ deregisterDaemon: (o) => daemonCalls.push(o), ...opts });

describe('uninstall', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    daemonCalls = [];
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

  it('removes the auto-update SessionStart hook (preserving foreign hooks)', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          statusLine: { type: 'command', command: '~/.config/claudebar/statusline.sh' },
          hooks: {
            SessionStart: [
              { matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/auto-update.mjs' }] },
              { matcher: '*', hooks: [{ type: 'command', command: '/x/version-check.sh' }] },
            ],
          },
        },
        null,
        2
      )
    );
    await uninstall({ configDir, settingsPath, confirm: async () => true, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (settings.hooks?.SessionStart ?? []).flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(!cmds.some((c) => c.includes('auto-update')), 'auto-update hook removed');
    assert.ok(cmds.some((c) => c.includes('version-check.sh')), 'foreign hook preserved');
  });

  it('creates backup of settings.json', async () => {
    await uninstall({
      configDir, settingsPath, confirm: async () => true, log: () => {},
    });
    const backups = fs.readdirSync(claudeDir).filter(f => f.startsWith('settings.json.bak-'));
    assert.ok(backups.length >= 1);
  });

  it('deregisters the OS daemon before removing configDir', async () => {
    await uninstall({ configDir, settingsPath, confirm: async () => true, log: () => {} });
    assert.equal(daemonCalls.length, 1, 'daemon deregistered once');
    assert.equal(daemonCalls[0].configDir, configDir);
  });

  it('does NOT deregister the daemon when the user declines', async () => {
    await uninstall({ configDir, settingsPath, confirm: async () => false, log: () => {} });
    assert.equal(daemonCalls.length, 0, 'no changes on abort');
  });
});
