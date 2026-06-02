import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  LABEL,
  SYSTEMD_UNIT,
  CRON_MARKER,
  PROFILE_MARKER_START,
  PROFILE_MARKER_END,
  SAFETY_INTERVAL_SECONDS,
  chooseMechanism,
  launchdPlist,
  systemdService,
  systemdPath,
  systemdTimer,
  cronEntry,
  profileBlock,
  pollScript,
  stripProfileBlock,
  withProfileBlock,
  stripCronEntry,
  withCronEntry,
  installDaemon,
  uninstallDaemon,
  daemonStatus,
} from '../../src/daemon.js';

// --- chooseMechanism (pure decision) ----------------------------------------

describe('daemon.chooseMechanism', () => {
  it('macOS → launchd', () => {
    assert.equal(chooseMechanism({ platform: 'darwin' }), 'launchd');
  });
  it('linux with systemd → systemd', () => {
    assert.equal(chooseMechanism({ platform: 'linux', hasSystemd: true, hasCron: true }), 'systemd');
  });
  it('WSL (linux) with systemd → systemd', () => {
    assert.equal(chooseMechanism({ platform: 'linux', hasSystemd: true, hasCron: false }), 'systemd');
  });
  it('linux/WSL without systemd but with cron → cron', () => {
    assert.equal(chooseMechanism({ platform: 'linux', hasSystemd: false, hasCron: true }), 'cron');
  });
  it('linux/WSL without systemd and without cron → profile', () => {
    assert.equal(chooseMechanism({ platform: 'linux', hasSystemd: false, hasCron: false }), 'profile');
  });
  it('unknown platform → unsupported', () => {
    assert.equal(chooseMechanism({ platform: 'win32' }), 'unsupported');
  });
});

// --- pure template generators -----------------------------------------------

describe('daemon template generators', () => {
  const opts = {
    label: LABEL,
    unit: SYSTEMD_UNIT,
    nodePath: '/opt/node/bin/node',
    scriptPath: '/home/u/.config/claudebar/ensure-statusline.mjs',
    settingsPath: '/home/u/.claude/settings.json',
    logPath: '/home/u/.config/claudebar/.daemon.log',
    pidFile: '/home/u/.config/claudebar/.daemon.pid',
    pollScriptPath: '/home/u/.config/claudebar/daemon-poll.sh',
    interval: SAFETY_INTERVAL_SECONDS,
  };

  it('launchdPlist watches settings.json and runs node + heal script', () => {
    const plist = launchdPlist(opts);
    assert.match(plist, /<key>Label<\/key>\s*<string>com\.henryavila\.claudebar\.heal<\/string>/);
    assert.ok(plist.includes('<string>/opt/node/bin/node</string>'));
    assert.ok(plist.includes('<string>/home/u/.config/claudebar/ensure-statusline.mjs</string>'));
    assert.match(plist, /<key>WatchPaths<\/key>[\s\S]*settings\.json/);
    assert.ok(plist.includes('<integer>300</integer>'));
    assert.ok(plist.includes('<key>RunAtLoad</key>'));
    // pins the exact target so the heal never depends on launchd's minimal $HOME
    assert.match(plist, /EnvironmentVariables[\s\S]*CLAUDEBAR_SETTINGS[\s\S]*\/home\/u\/\.claude\/settings\.json/);
  });

  it('launchdPlist XML-escapes special chars in paths', () => {
    const plist = launchdPlist({ ...opts, scriptPath: '/p/a & b/heal.mjs' });
    assert.ok(plist.includes('/p/a &amp; b/heal.mjs'));
    assert.ok(!plist.includes('a & b/heal'));
  });

  it('systemdService runs the heal one-shot with the settings path pinned', () => {
    const svc = systemdService(opts);
    assert.ok(svc.includes('Type=oneshot'));
    assert.ok(svc.includes('Environment=CLAUDEBAR_SETTINGS=/home/u/.claude/settings.json'));
    assert.ok(svc.includes('ExecStart=/opt/node/bin/node /home/u/.config/claudebar/ensure-statusline.mjs'));
  });

  it('systemdPath watches settings.json and points at the service', () => {
    const unit = systemdPath(opts);
    assert.ok(unit.includes('PathModified=/home/u/.claude/settings.json'));
    assert.ok(unit.includes(`Unit=${SYSTEMD_UNIT}.service`));
    assert.ok(unit.includes('WantedBy=default.target'));
  });

  it('systemdTimer is a periodic safety net', () => {
    const unit = systemdTimer(opts);
    assert.ok(unit.includes('OnUnitActiveSec=300s'));
    assert.ok(unit.includes(`Unit=${SYSTEMD_UNIT}.service`));
    assert.ok(unit.includes('WantedBy=timers.target'));
  });

  it('cronEntry carries the marker and a quoted minute-poll command with pinned settings', () => {
    const entry = cronEntry(opts);
    assert.ok(entry.includes(CRON_MARKER));
    assert.ok(entry.includes('* * * * * CLAUDEBAR_SETTINGS="/home/u/.claude/settings.json" "/opt/node/bin/node" "/home/u/.config/claudebar/ensure-statusline.mjs"'));
  });

  it('profileBlock launches the poll script and is marker-delimited', () => {
    const block = profileBlock(opts);
    assert.ok(block.startsWith(PROFILE_MARKER_START));
    assert.ok(block.trimEnd().endsWith(PROFILE_MARKER_END));
    assert.ok(block.includes('/home/u/.config/claudebar/daemon-poll.sh'));
  });

  it('pollScript is pidfile-guarded and loops the heal', () => {
    const sh = pollScript({ ...opts, interval: 60 });
    assert.ok(sh.startsWith('#!/usr/bin/env bash'));
    assert.ok(sh.includes('PIDFILE="/home/u/.config/claudebar/.daemon.pid"'));
    assert.ok(sh.includes('export CLAUDEBAR_SETTINGS="/home/u/.claude/settings.json"'));
    assert.ok(sh.includes('"/opt/node/bin/node" "/home/u/.config/claudebar/ensure-statusline.mjs"'));
    assert.ok(sh.includes('sleep 60'));
  });
});

// --- pure text editors ------------------------------------------------------

describe('daemon profile-block editors', () => {
  it('round-trips: adding then stripping leaves the original content', () => {
    const original = 'export PATH=/x\nalias g=git\n';
    const block = profileBlock({ pollScriptPath: '/c/daemon-poll.sh' });
    const added = withProfileBlock(original, block);
    assert.ok(added.includes(PROFILE_MARKER_START));
    assert.ok(added.includes('export PATH=/x'));
    const stripped = stripProfileBlock(added);
    assert.ok(!stripped.includes(PROFILE_MARKER_START));
    assert.ok(stripped.includes('export PATH=/x'));
    assert.ok(stripped.includes('alias g=git'));
  });

  it('withProfileBlock is idempotent — never stacks duplicate blocks', () => {
    const block = profileBlock({ pollScriptPath: '/c/daemon-poll.sh' });
    const once = withProfileBlock('# rc\n', block);
    const twice = withProfileBlock(once, block);
    const count = twice.split(PROFILE_MARKER_START).length - 1;
    assert.equal(count, 1);
  });
});

describe('daemon cron editors', () => {
  it('withCronEntry is idempotent and strips a stale heal line', () => {
    const entry = cronEntry({ nodePath: '/n', scriptPath: '/c/ensure-statusline.mjs' });
    const user = '0 9 * * * /usr/bin/backup\n';
    const once = withCronEntry(user, entry);
    assert.ok(once.includes('/usr/bin/backup'), 'user cron preserved');
    assert.equal(once.split(CRON_MARKER).length - 1, 1);
    const twice = withCronEntry(once, entry);
    assert.equal(twice.split(CRON_MARKER).length - 1, 1, 'no duplicate marker');
    assert.equal((twice.match(/ensure-statusline/g) ?? []).length, 1, 'single heal line');
  });

  it('stripCronEntry removes our line but keeps foreign jobs', () => {
    const entry = cronEntry({ nodePath: '/n', scriptPath: '/c/ensure-statusline.mjs' });
    const combined = withCronEntry('0 9 * * * /usr/bin/backup\n', entry);
    const stripped = stripCronEntry(combined);
    assert.ok(stripped.includes('/usr/bin/backup'));
    assert.ok(!stripped.includes(CRON_MARKER));
    assert.ok(!stripped.includes('ensure-statusline'));
  });
});

// --- install / uninstall / status (injected run + temp HOME) ----------------

// A recording fake for the OS commands, with a tiny stateful crontab so cron
// idempotency/uninstall can be exercised without touching the real crontab.
function makeRun(impl) {
  const calls = [];
  let crontab = '';
  const run = (cmd, args = [], opts = {}) => {
    calls.push({ cmd, args, opts });
    if (cmd === 'crontab' && args[0] === '-l') {
      if (crontab === '') { const e = new Error('no crontab for user'); e.status = 1; throw e; }
      return crontab;
    }
    if (cmd === 'crontab' && args[0] === '-') { crontab = opts.input ?? ''; return ''; }
    if (impl) return impl(cmd, args, opts);
    return '';
  };
  run.calls = calls;
  run.findCall = (cmd, pred) => calls.find((c) => c.cmd === cmd && (!pred || pred(c)));
  run.getCrontab = () => crontab;
  return run;
}

describe('daemon install/uninstall/status', () => {
  let home;
  const base = (run, platform) => ({
    home,
    run,
    log: () => {},
    platformInfo: { platform, isWSL: false, hasSystemd: platform === 'systemd-linux', hasCron: true },
  });

  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-daemon-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  // ---- launchd ----
  it('installDaemon (launchd) writes the plist and bootstraps it', () => {
    const run = makeRun();
    const res = installDaemon({ ...base(run, 'darwin'), nodePath: '/usr/local/bin/node' });
    assert.equal(res.mechanism, 'launchd');
    assert.equal(res.registered, true);
    const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    assert.ok(fs.existsSync(plist), 'plist written');
    const content = fs.readFileSync(plist, 'utf8');
    assert.ok(content.includes('/usr/local/bin/node'));
    assert.ok(content.includes(path.join(home, '.claude', 'settings.json')));
    const boot = run.findCall('launchctl', (c) => c.args.includes('bootstrap'));
    assert.ok(boot, 'launchctl bootstrap called');
    assert.ok(boot.args.some((a) => a.startsWith('gui/')), 'targets the gui domain');
  });

  it('installDaemon (launchd) falls back to load -w when bootstrap fails', () => {
    const run = makeRun((cmd, args) => {
      if (cmd === 'launchctl' && args.includes('bootstrap')) { const e = new Error('boom'); e.status = 1; throw e; }
      return '';
    });
    const res = installDaemon(base(run, 'darwin'));
    assert.equal(res.registered, true);
    assert.ok(run.findCall('launchctl', (c) => c.args.includes('load')), 'legacy load -w used');
  });

  it('uninstallDaemon (launchd) removes the plist and boots it out', () => {
    const run = makeRun();
    installDaemon(base(run, 'darwin'));
    const plist = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    assert.ok(fs.existsSync(plist));
    const run2 = makeRun();
    const res = uninstallDaemon({ home, run: run2, log: () => {} });
    assert.equal(res.removed, true);
    assert.ok(!fs.existsSync(plist), 'plist deleted');
    assert.ok(run2.findCall('launchctl', (c) => c.args.includes('bootout')), 'bootout called');
  });

  it('daemonStatus (launchd) reports registered + active', () => {
    const run = makeRun();
    installDaemon(base(run, 'darwin'));
    const st = daemonStatus({ home, run: makeRun(), platformInfo: { platform: 'darwin' } });
    assert.equal(st.mechanism, 'launchd');
    assert.equal(st.registered, true);
    assert.equal(st.active, true, 'launchctl print succeeds in the fake');
  });

  // ---- systemd ----
  it('installDaemon (systemd) writes 3 units and enables path + timer', () => {
    const run = makeRun();
    const res = installDaemon({
      home, run, log: () => {},
      platformInfo: { platform: 'linux', isWSL: false, hasSystemd: true, hasCron: true },
    });
    assert.equal(res.mechanism, 'systemd');
    const dir = path.join(home, '.config', 'systemd', 'user');
    for (const ext of ['service', 'path', 'timer']) {
      assert.ok(fs.existsSync(path.join(dir, `${SYSTEMD_UNIT}.${ext}`)), `${ext} unit written`);
    }
    assert.ok(run.findCall('systemctl', (c) => c.args.includes('daemon-reload')), 'daemon-reload');
    const enable = run.findCall('systemctl', (c) => c.args.includes('enable'));
    assert.ok(enable.args.includes(`${SYSTEMD_UNIT}.path`) && enable.args.includes(`${SYSTEMD_UNIT}.timer`));
  });

  it('uninstallDaemon (systemd) disables and removes the units', () => {
    const run = makeRun();
    installDaemon({ home, run, log: () => {}, platformInfo: { platform: 'linux', hasSystemd: true } });
    const run2 = makeRun();
    const res = uninstallDaemon({ home, run: run2, log: () => {} });
    assert.equal(res.removed, true);
    const dir = path.join(home, '.config', 'systemd', 'user');
    assert.ok(!fs.existsSync(path.join(dir, `${SYSTEMD_UNIT}.path`)), 'path unit removed');
    assert.ok(run2.findCall('systemctl', (c) => c.args.includes('disable')), 'disable called');
  });

  // ---- cron ----
  it('installDaemon (cron) writes a single managed entry, idempotently', () => {
    const run = makeRun();
    const pf = { platform: 'linux', isWSL: false, hasSystemd: false, hasCron: true };
    installDaemon({ home, run, log: () => {}, platformInfo: pf });
    installDaemon({ home, run, log: () => {}, platformInfo: pf }); // re-run
    const ct = run.getCrontab();
    assert.equal(ct.split(CRON_MARKER).length - 1, 1, 'exactly one managed entry');
    assert.ok(ct.includes('ensure-statusline.mjs'));
  });

  it('uninstallDaemon (cron) strips the managed entry but keeps user jobs', () => {
    const run = makeRun((cmd, args, opts) => '');
    // seed a user job, then install over it
    run('crontab', ['-'], { input: '0 9 * * * /usr/bin/backup\n' });
    installDaemon({ home, run, log: () => {}, platformInfo: { platform: 'linux', hasSystemd: false, hasCron: true } });
    uninstallDaemon({ home, run, log: () => {} });
    const ct = run.getCrontab();
    assert.ok(ct.includes('/usr/bin/backup'), 'user job preserved');
    assert.ok(!ct.includes(CRON_MARKER), 'managed entry gone');
  });

  // ---- profile fallback ----
  it('installDaemon (profile) writes the poll script + a marked profile block', () => {
    const run = makeRun();
    const res = installDaemon({
      home, run, log: () => {},
      platformInfo: { platform: 'linux', isWSL: true, hasSystemd: false, hasCron: false },
    });
    assert.equal(res.mechanism, 'profile');
    const poll = path.join(home, '.config', 'claudebar', 'daemon-poll.sh');
    assert.ok(fs.existsSync(poll), 'poll script written');
    assert.ok((fs.statSync(poll).mode & 0o111) !== 0, 'poll script executable');
    const profile = fs.readFileSync(path.join(home, '.profile'), 'utf8');
    assert.ok(profile.includes(PROFILE_MARKER_START) && profile.includes(PROFILE_MARKER_END));
  });

  it('uninstallDaemon (profile) strips the block and removes the poll script', () => {
    const run = makeRun();
    const pf = { platform: 'linux', isWSL: true, hasSystemd: false, hasCron: false };
    installDaemon({ home, run, log: () => {}, platformInfo: pf });
    uninstallDaemon({ home, run, log: () => {} });
    const profile = fs.readFileSync(path.join(home, '.profile'), 'utf8');
    assert.ok(!profile.includes(PROFILE_MARKER_START), 'block removed');
    assert.ok(!fs.existsSync(path.join(home, '.config', 'claudebar', 'daemon-poll.sh')), 'poll script removed');
  });

  // ---- systemd → cron → profile fallback (WSL hang resilience) ----
  it('falls back to cron and cleans up units when systemd --user fails', () => {
    const run = makeRun((cmd) => { if (cmd === 'systemctl') { const e = new Error('ETIMEDOUT'); throw e; } return ''; });
    const res = installDaemon({ home, run, log: () => {}, platformInfo: { platform: 'linux', hasSystemd: true, hasCron: true } });
    assert.equal(res.mechanism, 'cron');
    assert.equal(res.registered, true);
    const dir = path.join(home, '.config', 'systemd', 'user');
    assert.ok(!fs.existsSync(path.join(dir, `${SYSTEMD_UNIT}.path`)), 'half-written systemd units cleaned up');
    assert.ok(run.getCrontab().includes(CRON_MARKER), 'cron entry written as the fallback');
  });

  it('falls back to profile when systemd fails and cron is unavailable', () => {
    // bespoke run: systemctl hangs, crontab binary missing (ENOENT)
    const run = (cmd) => {
      if (cmd === 'systemctl') throw new Error('ETIMEDOUT');
      if (cmd === 'crontab') { const e = new Error('not found'); e.code = 'ENOENT'; throw e; }
      return '';
    };
    const res = installDaemon({ home, run, log: () => {}, platformInfo: { platform: 'linux', hasSystemd: true, hasCron: false } });
    assert.equal(res.mechanism, 'profile');
    assert.equal(res.registered, true);
    assert.ok(fs.existsSync(path.join(home, '.config', 'claudebar', 'daemon-poll.sh')), 'poll script written as last resort');
  });

  it('daemonStatus reports the ACTUALLY-installed mechanism (cron) even though detection would say systemd', () => {
    const run = makeRun((cmd) => { if (cmd === 'systemctl') throw new Error('ETIMEDOUT'); return ''; });
    installDaemon({ home, run, log: () => {}, platformInfo: { platform: 'linux', hasSystemd: true, hasCron: true } });
    // ask status with the SAME (systemd-claiming) platform — it must still see cron
    const st = daemonStatus({ home, run, platformInfo: { platform: 'linux', hasSystemd: true, hasCron: true } });
    assert.equal(st.mechanism, 'cron');
    assert.equal(st.registered, true);
  });

  // ---- best-effort guarantee ----
  it('installDaemon never throws — an unsupported platform returns registered:false', () => {
    const res = installDaemon({ home, run: makeRun(), log: () => {}, platformInfo: { platform: 'aix' } });
    assert.equal(res.registered, false);
    assert.equal(res.mechanism, 'unsupported');
  });

  it('uninstallDaemon is a silent no-op when nothing was installed', () => {
    const res = uninstallDaemon({ home, run: makeRun(), log: () => {} });
    assert.equal(res.removed, false);
  });
});
