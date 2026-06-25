import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { install as rawInstall } from '../../src/install.js';
import { parseTOML } from '../../src/toml-parser.js';

const PKG_VERSION = JSON.parse(
  fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
).version;

// All install tests run through this wrapper so the real OS daemon registration
// (launchctl/systemctl, writes under ~/Library) never fires on the test machine.
// `registerDaemon` defaults to a recording spy; a test can still override it.
let daemonCalls;
const install = (opts = {}) => rawInstall({ registerDaemon: (o) => daemonCalls.push(o), ...opts });

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-install-test-'));
}

describe('install', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    daemonCalls = [];
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

  it('back-fills new default sections on reinstall without clobbering user settings', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.toml'),
      [
        '# claudebar config v1',
        '',
        '[layout]',
        'force = "compact"',
        '',
        '[chips]',
        'model = false',
        '',
        '[thresholds]',
        'warning = 55',
        'critical = 90',
        '',
        '[colors]',
        'model = 99',
        '',
        '[glyphs]',
        'sparkle = "*"',
        '',
        '[update]',
        '# auto_update = "patch"',
        '',
      ].join('\n')
    );

    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });

    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.match(content, /\[daemon\]/, 'daemon defaults added');
    assert.match(content, /\[quota\]/, 'quota defaults added');
    assert.match(content, /force = "compact"/, 'existing layout setting preserved');
    assert.match(content, /model = false/, 'existing chip setting preserved');

    const cfg = parseTOML(content);
    assert.equal(cfg.layout.force, 'compact');
    assert.equal(cfg.chips.model, false);
    assert.equal(cfg.daemon, undefined, 'comment-only daemon defaults do not become active settings');
    assert.equal(cfg.quota, undefined, 'comment-only quota defaults do not become active settings');
  });

  it('does not duplicate back-filled sections on repeated reinstall', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), '# claudebar config v1\n\n[layout]\nforce = "full"\n');

    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });
    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });

    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.equal((content.match(/^\[daemon\]$/gm) ?? []).length, 1);
    assert.equal((content.match(/^\[quota\]$/gm) ?? []).length, 1);
  });

  it('back-fills missing keys inside existing default sections without overwriting explicit opt-outs', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.toml'),
      [
        '# claudebar config v1',
        '',
        '[daemon]',
        'enabled = false',
        '',
        '[quota]',
        'enabled = false',
        '',
      ].join('\n')
    );

    await install({ configDir, settingsPath, log: () => {} });

    const content = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    assert.match(content, /enabled = false/, 'explicit opt-out preserved');
    assert.match(content, /# refresh_interval_minutes = 5/, 'missing quota interval template key added');
    assert.equal((content.match(/^\[daemon\]$/gm) ?? []).length, 1);
    assert.equal((content.match(/^\[quota\]$/gm) ?? []).length, 1);

    const cfg = parseTOML(content);
    assert.equal(cfg.daemon.enabled, false);
    assert.equal(cfg.quota.enabled, false);
    assert.equal(daemonCalls.length, 0, 'daemon opt-out still honored');
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

  it('copies the auto-update payload (auto-update.mjs + auto-update.js + toml-parser.js)', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.ok(fs.existsSync(path.join(configDir, 'auto-update.mjs')));
    assert.ok(fs.existsSync(path.join(configDir, 'auto-update.js')));
    assert.ok(fs.existsSync(path.join(configDir, 'toml-parser.js')), 'auto-update.js imports it');
  });

  it('registers the auto-update SessionStart hook (alongside the heal hook)', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = (settings.hooks?.SessionStart ?? []).flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('auto-update')), 'auto-update hook registered');
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook still present');
  });

  it('writes the interactively chosen auto_update mode into a fresh config.toml', async () => {
    await install({ configDir, settingsPath, chooseMode: async () => 'all', log: () => {} });
    const cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, 'all');
  });

  it('with no TTY choice (null) leaves config at the commented patch default', async () => {
    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });
    const cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, undefined, 'stays commented → readConfig falls back to patch');
  });

  it('does NOT prompt or overwrite the mode when config.toml already exists', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[update]\nauto_update = "off"\n');
    await install({
      configDir,
      settingsPath,
      chooseMode: async () => { throw new Error('must not prompt when an explicit mode exists'); },
      log: () => {},
    });
    const cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, 'off', 'existing user mode preserved');
  });

  it('offers the choice on reinstall when no explicit mode was set yet (commented template)', async () => {
    // First install kept the default: the auto_update line stays commented.
    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });
    let cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, undefined, 'precondition: no explicit mode after first install');
    // Reinstall in a TTY where the user now picks "all" → it must be written.
    await install({ configDir, settingsPath, chooseMode: async () => 'all', log: () => {} });
    cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, 'all', 'reinstall prompt wrote the chosen mode');
  });

  it('does NOT re-prompt on reinstall once an explicit mode exists', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[update]\nauto_update = "patch"\n');
    await install({
      configDir,
      settingsPath,
      chooseMode: async () => { throw new Error('must not prompt once a mode is set'); },
      log: () => {},
    });
    const cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, 'patch', 'existing explicit mode preserved');
  });

  it('reinstall with no TTY choice (null) leaves the commented default untouched', async () => {
    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });
    // Reinstall, still headless → no mode chosen, nothing written.
    await install({ configDir, settingsPath, chooseMode: async () => null, log: () => {} });
    const cfg = parseTOML(fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8'));
    assert.equal(cfg.update?.auto_update, undefined, 'still commented → falls back to patch');
  });

  // --- OS daemon registration (default on, opt-out) ---
  it('registers the OS daemon by default, passing the real config + settings paths', async () => {
    await install({ configDir, settingsPath, log: () => {} });
    assert.equal(daemonCalls.length, 1, 'daemon registered once');
    assert.equal(daemonCalls[0].configDir, configDir);
    assert.equal(daemonCalls[0].settingsPath, settingsPath);
  });

  it('skips daemon registration with --no-daemon (noDaemon: true)', async () => {
    await install({ configDir, settingsPath, log: () => {}, noDaemon: true });
    assert.equal(daemonCalls.length, 0, 'daemon NOT registered');
  });

  it('skips daemon registration when [daemon] enabled = false', async () => {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.toml'), '[daemon]\nenabled = false\n');
    await install({ configDir, settingsPath, log: () => {} });
    assert.equal(daemonCalls.length, 0, 'config opt-out honored');
  });

  it('a daemon registration failure does not abort the install', async () => {
    let reached = false;
    await install({
      configDir,
      settingsPath,
      log: () => {},
      registerDaemon: () => { throw new Error('launchctl exploded'); },
    });
    // install completed past the daemon step and wrote the version file.
    reached = fs.existsSync(path.join(configDir, '.version'));
    assert.ok(reached, 'install finished despite daemon error');
  });
});
