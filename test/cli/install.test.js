import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install } from '../../src/install.js';

const PKG_VERSION = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-install-test-'));
}

describe('install', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: {} }, null, 2));
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates config directory', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(configDir));
  });

  it('copies statusline.sh and makes it executable', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    const script = path.join(configDir, 'statusline.sh');
    assert.ok(fs.existsSync(script));
    const stat = fs.statSync(script);
    assert.ok(stat.mode & 0o111, 'should be executable');
  });

  it('generates config.toml from defaults', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'config.toml')));
    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.ok(content.includes('claudebar config v1'));
  });

  it('does NOT overwrite existing config.toml', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), 'my custom config');
    await install({ configDir, settingsPath, log: () => {} });
    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.equal(content, 'my custom config');
  });

  it('writes .version file', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, '.version')));
    const version = fs.readFileSync(path.join(configDir, '.version'), 'utf8');
    assert.equal(version, PKG_VERSION);
  });

  it('backs up and patches settings.json', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.type, 'command');
    assert.ok(settings.statusLine.command.includes('statusline.sh'));
    assert.deepEqual(settings.permissions, {});
    const backups = fs.readdirSync(claudeDir).filter(f => f.startsWith('settings.json.bak-'));
    assert.ok(backups.length >= 1);
  });

  it('compiles config.sh', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'config.sh')));
  });

  it('copies the self-heal payload (ensure-statusline.mjs + settings.js)', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'ensure-statusline.mjs')));
    assert.ok(fs.existsSync(path.join(configDir, 'settings.js')));
  });

  it('registers the self-heal SessionStart hook', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (settings.hooks?.SessionStart ?? []).flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')));
  });

  it('preserves pre-existing SessionStart hooks', async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        { hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: '/x/version-check.sh' }] }] } },
        null,
        2
      )
    );
    await install({ configDir, settingsPath, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = settings.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('version-check.sh')), 'existing hook kept');
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook added');
  });
});
