import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { update as rawUpdate } from '../../src/update.js';

const PKG_VERSION = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-update-test-'));
}

// Wrapper so the real OS daemon back-fill never runs on the test machine.
// `registerDaemon` defaults to a recording spy that reports a registered launchd.
let daemonCalls;
const update = (opts = {}) =>
  rawUpdate({ registerDaemon: (o) => { daemonCalls.push(o); return { mechanism: 'launchd', registered: true }; }, ...opts });

describe('update', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    daemonCalls = [];
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    fs.mkdirSync(configDir, { recursive: true });
    claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: {} }, null, 2));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('reports not installed when .version missing', async () => {
    const logs = [];
    const result = await update({ configDir, settingsPath, log: (m) => logs.push(m) });
    assert.equal(result.updated, false);
    assert.ok(logs.join('\n').includes('Not installed'));
  });

  it('reports up to date when versions match', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    const logs = [];
    const result = await update({ configDir, settingsPath, log: (m) => logs.push(m) });
    assert.equal(result.updated, false);
    assert.ok(logs.join('\n').includes('up to date'));
  });

  // Like the self-heal payload, auto-update must be back-filled on EVERY update
  // (even when already up to date) so existing installs gain it without a fresh
  // install. This guards the migration path for users stuck on a pre-auto-update
  // version — exactly the scenario that motivated the feature.
  it('back-fills the auto-update payload + hook even when up to date', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    await update({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'auto-update.mjs')), 'auto-update.mjs copied');
    assert.ok(fs.existsSync(path.join(configDir, 'auto-update.js')), 'auto-update.js copied');
    assert.ok(fs.existsSync(path.join(configDir, 'toml-parser.js')), 'toml-parser.js copied');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (settings.hooks?.SessionStart ?? []).flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('auto-update')), 'auto-update hook registered');
  });

  it('updates files when version differs', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), '0.9.0');
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), 'old');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '# claudebar config v1\n[colors]\nmodel = 99');
    fs.writeFileSync(path.join(configDir, 'config.sh'), '');
    const logs = [];
    const result = await update({ configDir, settingsPath, log: (m) => logs.push(m) });
    assert.equal(result.updated, true);
    const newScript = fs.readFileSync(path.join(configDir, 'statusline.sh'), 'utf8');
    assert.notEqual(newScript, 'old');
    const version = fs.readFileSync(path.join(configDir, '.version'), 'utf8');
    assert.equal(version, PKG_VERSION);
  });

  it('backs up config.toml during update', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), '0.9.0');
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), 'old');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '# claudebar config v1');
    fs.writeFileSync(path.join(configDir, 'config.sh'), '');
    await update({ configDir, settingsPath, log: () => {} });
    const backups = fs.readdirSync(configDir).filter(f => f.startsWith('config.toml.bak-'));
    assert.ok(backups.length >= 1);
  });

  it('restores a dropped statusLine even when already up to date', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    // settings.json has NO statusLine (the reported failure mode)
    const result = await update({ configDir, settingsPath, log: () => {} });
    assert.equal(result.updated, false, 'still reports up to date');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored');
  });

  it('registers the self-heal hook and copies its payload on update', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    await update({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'ensure-statusline.mjs')));
    assert.ok(fs.existsSync(path.join(configDir, 'settings.js')));
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (settings.hooks?.SessionStart ?? []).flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')));
  });

  it('does not clobber a user-customized statusLine', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: '/my/own.sh' } }, null, 2));
    await update({ configDir, settingsPath, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.command, '/my/own.sh');
  });

  // The daemon back-fill is the migration path: an install predating the feature
  // gains the hook-independent backstop on the next update, even when up to date.
  it('back-fills the OS daemon on update (even when up to date)', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    await update({ configDir, settingsPath, log: () => {} });
    assert.equal(daemonCalls.length, 1, 'daemon registered once');
    assert.equal(daemonCalls[0].configDir, configDir);
  });

  it('honors the [daemon] enabled = false opt-out on update', async () => {
    fs.writeFileSync(path.join(configDir, '.version'), PKG_VERSION);
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[daemon]\nenabled = false\n');
    await update({ configDir, settingsPath, log: () => {} });
    assert.equal(daemonCalls.length, 0, 'daemon skipped when disabled');
  });
});
