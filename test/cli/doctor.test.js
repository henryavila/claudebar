import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { doctor as rawDoctor } from '../../src/doctor.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-doctor-test-'));
}

// Default the daemon-status probe to a registered launchd so the existing checks
// don't hit the real OS (launchctl) or the real ~/Library. Tests can override.
const okDaemon = () => ({ mechanism: 'launchd', registered: true, active: true });
const doctor = (opts = {}) => rawDoctor({ daemonStatus: okDaemon, ...opts });

describe('doctor', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });
    settingsPath = path.join(claudeDir, 'settings.json');
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('fails when statusline.sh is missing', async () => {
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'statusline.sh');
    assert.equal(check.pass, false);
  });

  it('passes when statusline.sh exists', async () => {
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), '#!/usr/bin/env bash');
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'statusline.sh');
    assert.equal(check.pass, true);
  });

  it('detects correct settings.json pointer', async () => {
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), '');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '');
    fs.writeFileSync(path.join(configDir, 'config.sh'), '');
    fs.writeFileSync(path.join(configDir, '.version'), '1.0.0');
    fs.writeFileSync(settingsPath, JSON.stringify({
      statusLine: { command: '~/.config/claudebar/statusline.sh' },
    }));
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'settings.json');
    assert.equal(check.pass, true);
  });

  it('reports auto-update status: passes and shows the mode when wired up', async () => {
    fs.writeFileSync(path.join(configDir, 'auto-update.mjs'), '// hook');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[update]\nauto_update = "all"\n');
    fs.writeFileSync(settingsPath, JSON.stringify({
      hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/auto-update.mjs' }] }] },
    }));
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'auto-update');
    assert.ok(check, 'auto-update check present');
    assert.equal(check.pass, true);
    assert.ok(check.message.includes('all'), 'reports the configured mode');
  });

  it('auto-update check fails when the hook is not registered', async () => {
    fs.writeFileSync(path.join(configDir, 'auto-update.mjs'), '// hook');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[update]\nauto_update = "patch"\n');
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { SessionStart: [] } }));
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'auto-update');
    assert.equal(check.pass, false);
  });

  it('daemon check passes and reports the mechanism when registered', async () => {
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'daemon');
    assert.ok(check, 'daemon check present');
    assert.equal(check.pass, true);
    assert.ok(check.message.includes('launchd'));
  });

  it('daemon check fails when the supervisor is not registered', async () => {
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({
      configDir, settingsPath, log: () => {},
      daemonStatus: () => ({ mechanism: 'systemd', registered: false, active: false }),
    });
    const check = results.find(r => r.name === 'daemon');
    assert.equal(check.pass, false);
  });

  it('daemon check passes (not a failure) when opted out via config', async () => {
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[daemon]\nenabled = false\n');
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({
      configDir, settingsPath, log: () => {},
      daemonStatus: () => ({ mechanism: 'launchd', registered: false, active: false }),
    });
    const check = results.find(r => r.name === 'daemon');
    assert.equal(check.pass, true, 'opt-out is not a failure');
    assert.ok(check.message.includes('disabled'));
  });
});
