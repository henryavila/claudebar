// claudebar OS daemon — a hook-independent self-heal backstop.
//
// The hook-based heal (assets/ensure-statusline.mjs on SessionStart +
// UserPromptSubmit) recovers a clobbered statusLine — but ONLY while its own hook
// entry survives in settings.json. Claude Code re-persists settings.json from its
// in-memory snapshot on a TUI toggle, and that rewrite can drop the heal hook
// entry itself. Once the hook is gone, nothing ever runs the heal again (it can
// only re-register itself if it runs, but it only runs if registered) and the bar
// stays dead permanently.
//
// This module registers a NATIVE OS supervisor that runs the SAME heal payload
// (`node ensure-statusline.mjs`) from outside Claude Code's control, so recovery
// survives even a total settings wipe. It uses OS-native one-shot triggers — no
// always-running Node process:
//   - macOS  → launchd LaunchAgent, WatchPaths on settings.json (+ StartInterval net)
//   - Linux / WSL with systemd → systemd --user .path + .service (+ .timer net)
//   - fallback (old WSL / no systemd) → cron if available, else a managed ~/.profile
//     block launching a poll loop
//
// Everything that touches the real OS (launchctl/systemctl/crontab, file writes
// under ~/Library, ~/.config/systemd, the profile) goes through injectable deps
// (`run`, `paths`, `home`, `platformInfo`) so the whole lifecycle is unit-testable
// without registering anything on the test machine. Registration is best-effort:
// any failure is captured and returned, never thrown — a daemon hiccup must never
// abort an install.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Stable identifiers. The launchd Label, systemd unit base name, and the managed
// markers must never change across versions — uninstall/idempotency find OUR
// artifacts by these exact strings.
export const LABEL = 'com.henryavila.claudebar.heal';
export const SYSTEMD_UNIT = 'claudebar-heal';
export const PROFILE_MARKER_START = '# >>> claudebar daemon >>>';
export const PROFILE_MARKER_END = '# <<< claudebar daemon <<<';
export const CRON_MARKER = '# claudebar-heal (managed by claudebar daemon)';

// launchd WatchPaths / systemd .path are the primary instant triggers; these are
// only the periodic safety net. The cron/profile fallback has no watch, so the
// poll IS its recovery latency — kept tight (every minute).
export const SAFETY_INTERVAL_SECONDS = 300;
export const POLL_INTERVAL_SECONDS = 60;

const HEAL_SCRIPT = 'ensure-statusline.mjs';

// --- default I/O deps (all overridable for tests) ---------------------------

function defaultRun(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: 'pipe', timeout: 5000, ...opts });
}

function defaultConfigDir(home) {
  return path.join(home, '.config', 'claudebar');
}

function defaultSettingsPath(home) {
  return path.join(home, '.claude', 'settings.json');
}

// Run a command, swallowing failure. Returns { ok, out, error } so callers can
// branch without try/catch noise. Used for "remove if present" / fallback paths.
function tryRun(run, cmd, args, opts) {
  try {
    return { ok: true, out: run(cmd, args, opts) };
  } catch (error) {
    return { ok: false, error };
  }
}

// Run a thunk, swallowing failure (for process.kill and the like).
function silently(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

// --- platform detection (impure, injectable) --------------------------------

// True under Windows Subsystem for Linux. Reported for status/logging only —
// chooseMechanism treats WSL as plain linux (systemd if present, else fallback).
export function isWSL() {
  try {
    if (process.env.WSL_DISTRO_NAME) return true;
    return /microsoft|wsl/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

// True only when systemd is the init system AND a user bus is reachable (so
// `systemctl --user` will actually work). Both checks matter: containers/old WSL
// may have the binary but no running user instance.
export function hasSystemdUser(run = defaultRun) {
  try {
    if (!fs.existsSync('/run/systemd/system')) return false;
    run('systemctl', ['--user', 'show-environment']);
    return true;
  } catch {
    return false;
  }
}

// True when the `crontab` binary exists (even if the user has no crontab yet).
// `crontab -l` exits non-zero with "no crontab for user" when empty — that still
// means cron is available; only a spawn ENOENT means the binary is missing.
export function hasCron(run = defaultRun) {
  try {
    run('crontab', ['-l']);
    return true;
  } catch (e) {
    if (e && e.code === 'ENOENT') return false; // binary not found
    if (e && typeof e.status === 'number') return true; // ran, just no crontab
    return false;
  }
}

export function detectPlatformInfo(run = defaultRun) {
  const platform = process.platform;
  if (platform === 'linux') {
    return { platform, isWSL: isWSL(), hasSystemd: hasSystemdUser(run), hasCron: hasCron(run) };
  }
  return { platform, isWSL: false, hasSystemd: false, hasCron: false };
}

// Pure decision: which supervisor mechanism fits this environment. WSL is linux,
// so it falls through the linux branch (systemd → cron → profile).
export function chooseMechanism({ platform, hasSystemd, hasCron } = {}) {
  if (platform === 'darwin') return 'launchd';
  if (platform === 'linux') {
    if (hasSystemd) return 'systemd';
    if (hasCron) return 'cron';
    return 'profile';
  }
  return 'unsupported';
}

// --- pure template generators -----------------------------------------------

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function launchdPlist({ label, nodePath, scriptPath, settingsPath, logPath, interval }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${xmlEscape(label)}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xmlEscape(nodePath)}</string>
		<string>${xmlEscape(scriptPath)}</string>
	</array>
	<key>WatchPaths</key>
	<array>
		<string>${xmlEscape(settingsPath)}</string>
	</array>
	<key>StartInterval</key>
	<integer>${interval}</integer>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>${xmlEscape(logPath)}</string>
	<key>StandardErrorPath</key>
	<string>${xmlEscape(logPath)}</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>CLAUDEBAR_SETTINGS</key>
		<string>${xmlEscape(settingsPath)}</string>
	</dict>
</dict>
</plist>
`;
}

export function systemdService({ nodePath, scriptPath, settingsPath }) {
  return `[Unit]
Description=claudebar statusline self-heal (one-shot)

[Service]
Type=oneshot
Environment=CLAUDEBAR_SETTINGS=${settingsPath}
ExecStart=${nodePath} ${scriptPath}
`;
}

export function systemdPath({ unit, settingsPath }) {
  return `[Unit]
Description=Watch Claude Code settings.json for claudebar self-heal

[Path]
PathModified=${settingsPath}
Unit=${unit}.service

[Install]
WantedBy=default.target
`;
}

export function systemdTimer({ unit, interval }) {
  return `[Unit]
Description=claudebar self-heal periodic safety net

[Timer]
OnBootSec=1min
OnUnitActiveSec=${interval}s
Unit=${unit}.service

[Install]
WantedBy=timers.target
`;
}

// A single managed crontab entry: marker comment + the schedule line. Quoted
// paths survive spaces; CLAUDEBAR_SETTINGS pins the exact target file (cron runs
// with a minimal env); output discarded (the heal is silent).
export function cronEntry({ nodePath, scriptPath, settingsPath }) {
  return `${CRON_MARKER}\n* * * * * CLAUDEBAR_SETTINGS="${settingsPath}" "${nodePath}" "${scriptPath}" >/dev/null 2>&1`;
}

export function profileBlock({ pollScriptPath }) {
  return `${PROFILE_MARKER_START}\n[ -x "${pollScriptPath}" ] && ("${pollScriptPath}" >/dev/null 2>&1 &)\n${PROFILE_MARKER_END}`;
}

// The fallback poll loop (cron/profile mechanisms). Pidfile-guarded so repeated
// shell starts never spawn duplicates; re-heals every `interval` seconds.
export function pollScript({ nodePath, scriptPath, settingsPath, pidFile, interval }) {
  return `#!/usr/bin/env bash
# claudebar poll daemon — fallback heal loop when launchd/systemd are unavailable.
# Self-guarded by a pidfile so repeated shell starts don't spawn duplicates.
PIDFILE="${pidFile}"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi
echo $$ > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT
export CLAUDEBAR_SETTINGS="${settingsPath}"
while true; do
  "${nodePath}" "${scriptPath}" >/dev/null 2>&1 || true
  sleep ${interval}
done
`;
}

// --- pure text editors for shared files (crontab, profile) ------------------

// Remove our managed block (markers inclusive) from a profile/rc file's content.
export function stripProfileBlock(content) {
  const lines = content.split('\n');
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === PROFILE_MARKER_START) { inside = true; continue; }
    if (inside) {
      if (line.trim() === PROFILE_MARKER_END) inside = false;
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

export function withProfileBlock(content, block) {
  let base = stripProfileBlock(content).replace(/\n+$/, '');
  base = base.length ? base + '\n\n' : '';
  return `${base}${block}\n`;
}

// Remove our managed crontab entry: the marker line and any line that runs our
// heal script (so a stale entry from an older path is cleaned too).
export function stripCronEntry(content) {
  return content
    .split('\n')
    .filter((line) => line.trim() !== CRON_MARKER && !line.includes(HEAL_SCRIPT))
    .join('\n');
}

export function withCronEntry(content, entry) {
  let base = stripCronEntry(content).replace(/\n+$/, '');
  base = base.length ? base + '\n' : '';
  return `${base}${entry}\n`;
}

// --- path resolution --------------------------------------------------------

function resolvePaths(opts) {
  const home = opts.home ?? os.homedir();
  const configDir = opts.configDir ?? defaultConfigDir(home);
  const settingsPath = opts.settingsPath ?? defaultSettingsPath(home);
  const scriptPath = opts.scriptPath ?? path.join(configDir, HEAL_SCRIPT);
  const overrides = opts.paths ?? {};
  return {
    home,
    configDir,
    settingsPath,
    scriptPath,
    nodePath: opts.nodePath ?? process.execPath,
    logPath: path.join(configDir, '.daemon.log'),
    pidFile: path.join(configDir, '.daemon.pid'),
    pollScriptPath: path.join(configDir, 'daemon-poll.sh'),
    launchAgentsDir: overrides.launchAgentsDir ?? path.join(home, 'Library', 'LaunchAgents'),
    systemdUserDir: overrides.systemdUserDir ?? path.join(home, '.config', 'systemd', 'user'),
    profilePath: overrides.profilePath ?? path.join(home, '.profile'),
  };
}

function plistPathFor(p) {
  return path.join(p.launchAgentsDir, `${LABEL}.plist`);
}
function systemdUnitPaths(p) {
  return {
    service: path.join(p.systemdUserDir, `${SYSTEMD_UNIT}.service`),
    path: path.join(p.systemdUserDir, `${SYSTEMD_UNIT}.path`),
    timer: path.join(p.systemdUserDir, `${SYSTEMD_UNIT}.timer`),
  };
}

function uid() {
  return typeof process.getuid === 'function' ? process.getuid() : 0;
}

// --- install ----------------------------------------------------------------

// Register the OS supervisor. Best-effort and idempotent. Returns
// { mechanism, registered, detail, error? } — never throws.
export function installDaemon(opts = {}) {
  const run = opts.run ?? defaultRun;
  const log = opts.log ?? (() => {});
  const p = resolvePaths(opts);
  const platformInfo = opts.platformInfo ?? detectPlatformInfo(run);
  const mechanism = chooseMechanism(platformInfo);

  try {
    if (mechanism === 'launchd') return installLaunchd(p, run, log);
    if (mechanism === 'systemd') return installSystemd(p, run, log);
    if (mechanism === 'cron') return installCron(p, run, log);
    if (mechanism === 'profile') return installProfile(p, run, log);
    log(`Daemon: ${platformInfo.platform} not supported — skipped (hook heal still active)`);
    return { mechanism, registered: false, detail: 'unsupported platform' };
  } catch (error) {
    log(`Daemon: registration failed (${error.message}) — hook heal still active`);
    return { mechanism, registered: false, error };
  }
}

function installLaunchd(p, run, log) {
  fs.mkdirSync(p.launchAgentsDir, { recursive: true });
  const plist = plistPathFor(p);
  fs.writeFileSync(plist, launchdPlist({
    label: LABEL,
    nodePath: p.nodePath,
    scriptPath: p.scriptPath,
    settingsPath: p.settingsPath,
    logPath: p.logPath,
    interval: SAFETY_INTERVAL_SECONDS,
  }));
  const target = `gui/${uid()}`;
  // Reload cleanly: bootout an existing instance (ignore if absent), then bootstrap.
  tryRun(run, 'launchctl', ['bootout', `${target}/${LABEL}`]);
  const boot = tryRun(run, 'launchctl', ['bootstrap', target, plist]);
  if (!boot.ok) {
    // Legacy fallback for older macOS where bootstrap is unavailable.
    tryRun(run, 'launchctl', ['unload', plist]);
    run('launchctl', ['load', '-w', plist]);
  }
  log(`Daemon: registered launchd agent (WatchPaths on settings.json)`);
  return { mechanism: 'launchd', registered: true, detail: plist };
}

function installSystemd(p, run, log) {
  fs.mkdirSync(p.systemdUserDir, { recursive: true });
  const units = systemdUnitPaths(p);
  fs.writeFileSync(units.service, systemdService({ nodePath: p.nodePath, scriptPath: p.scriptPath, settingsPath: p.settingsPath }));
  fs.writeFileSync(units.path, systemdPath({ unit: SYSTEMD_UNIT, settingsPath: p.settingsPath }));
  fs.writeFileSync(units.timer, systemdTimer({ unit: SYSTEMD_UNIT, interval: SAFETY_INTERVAL_SECONDS }));
  run('systemctl', ['--user', 'daemon-reload']);
  run('systemctl', ['--user', 'enable', '--now', `${SYSTEMD_UNIT}.path`, `${SYSTEMD_UNIT}.timer`]);
  log(`Daemon: registered systemd --user units (.path watch + .timer net)`);
  return { mechanism: 'systemd', registered: true, detail: p.systemdUserDir };
}

function installCron(p, run, log) {
  const current = tryRun(run, 'crontab', ['-l']).out ?? '';
  const next = withCronEntry(current, cronEntry({ nodePath: p.nodePath, scriptPath: p.scriptPath, settingsPath: p.settingsPath }));
  run('crontab', ['-'], { input: next });
  log(`Daemon: registered cron entry (poll every minute)`);
  return { mechanism: 'cron', registered: true, detail: 'crontab' };
}

function installProfile(p, run, log) {
  fs.mkdirSync(p.configDir, { recursive: true });
  fs.writeFileSync(p.pollScriptPath, pollScript({
    nodePath: p.nodePath,
    scriptPath: p.scriptPath,
    settingsPath: p.settingsPath,
    pidFile: p.pidFile,
    interval: POLL_INTERVAL_SECONDS,
  }));
  fs.chmodSync(p.pollScriptPath, 0o755);
  const current = fs.existsSync(p.profilePath) ? fs.readFileSync(p.profilePath, 'utf8') : '';
  fs.writeFileSync(p.profilePath, withProfileBlock(current, profileBlock({ pollScriptPath: p.pollScriptPath })));
  log(`Daemon: installed poll fallback in ${path.basename(p.profilePath)} (starts on next shell)`);
  return { mechanism: 'profile', registered: true, detail: p.profilePath };
}

// --- uninstall --------------------------------------------------------------

// Remove EVERY supervisor artifact we may have left, regardless of the currently
// detected mechanism (the environment may have changed since install). Each step
// is gated by an existence/content check, so it is silent and cross-platform safe
// (never runs launchctl on linux, etc.). Best-effort; never throws.
export function uninstallDaemon(opts = {}) {
  const run = opts.run ?? defaultRun;
  const log = opts.log ?? (() => {});
  const p = resolvePaths(opts);
  let removedAny = false;

  // launchd
  const plist = plistPathFor(p);
  if (fs.existsSync(plist)) {
    tryRun(run, 'launchctl', ['bootout', `gui/${uid()}/${LABEL}`]);
    tryRun(run, 'launchctl', ['unload', plist]);
    fs.rmSync(plist, { force: true });
    log(`Daemon: removed launchd agent`);
    removedAny = true;
  }

  // systemd
  const units = systemdUnitPaths(p);
  if (Object.values(units).some((u) => fs.existsSync(u))) {
    tryRun(run, 'systemctl', ['--user', 'disable', '--now', `${SYSTEMD_UNIT}.path`, `${SYSTEMD_UNIT}.timer`]);
    for (const u of Object.values(units)) fs.rmSync(u, { force: true });
    tryRun(run, 'systemctl', ['--user', 'daemon-reload']);
    log(`Daemon: removed systemd --user units`);
    removedAny = true;
  }

  // cron
  const cron = tryRun(run, 'crontab', ['-l']);
  if (cron.ok && typeof cron.out === 'string' && cron.out.includes(CRON_MARKER)) {
    const next = stripCronEntry(cron.out).replace(/\n+$/, '');
    tryRun(run, 'crontab', ['-'], { input: next ? next + '\n' : '\n' });
    log(`Daemon: removed cron entry`);
    removedAny = true;
  }

  // profile fallback
  if (fs.existsSync(p.profilePath)) {
    const content = fs.readFileSync(p.profilePath, 'utf8');
    if (content.includes(PROFILE_MARKER_START)) {
      fs.writeFileSync(p.profilePath, stripProfileBlock(content));
      log(`Daemon: removed poll block from ${path.basename(p.profilePath)}`);
      removedAny = true;
    }
  }
  // Stop a running poll loop + remove its script.
  if (fs.existsSync(p.pidFile)) {
    const pid = Number(fs.readFileSync(p.pidFile, 'utf8').trim());
    if (Number.isInteger(pid) && pid > 0) silently(() => process.kill(pid));
    fs.rmSync(p.pidFile, { force: true });
  }
  fs.rmSync(p.pollScriptPath, { force: true });

  return { removed: removedAny };
}

// --- status (for doctor / CLI) ----------------------------------------------

// Best-effort report. `registered` = our supervisor artifact exists on disk /
// in the shared file. `active` = the OS confirms it's loaded/enabled (falls back
// to `registered` when the query can't run).
export function daemonStatus(opts = {}) {
  const run = opts.run ?? defaultRun;
  const p = resolvePaths(opts);
  const platformInfo = opts.platformInfo ?? detectPlatformInfo(run);
  const mechanism = chooseMechanism(platformInfo);

  if (mechanism === 'launchd') {
    const plist = plistPathFor(p);
    const registered = fs.existsSync(plist);
    const active = registered && tryRun(run, 'launchctl', ['print', `gui/${uid()}/${LABEL}`]).ok;
    return { mechanism, registered, active, detail: plist };
  }
  if (mechanism === 'systemd') {
    const units = systemdUnitPaths(p);
    const registered = fs.existsSync(units.path);
    const active = registered && (tryRun(run, 'systemctl', ['--user', 'is-active', `${SYSTEMD_UNIT}.path`]).out ?? '').trim() === 'active';
    return { mechanism, registered, active, detail: p.systemdUserDir };
  }
  if (mechanism === 'cron') {
    const cron = tryRun(run, 'crontab', ['-l']);
    const registered = cron.ok && typeof cron.out === 'string' && cron.out.includes(CRON_MARKER);
    return { mechanism, registered, active: registered, detail: 'crontab' };
  }
  if (mechanism === 'profile') {
    const registered = fs.existsSync(p.profilePath) && fs.readFileSync(p.profilePath, 'utf8').includes(PROFILE_MARKER_START);
    let active = false;
    if (fs.existsSync(p.pidFile)) {
      const pid = Number(fs.readFileSync(p.pidFile, 'utf8').trim());
      active = Number.isInteger(pid) && pid > 0 && silently(() => process.kill(pid, 0));
    }
    return { mechanism, registered, active, detail: p.profilePath };
  }
  return { mechanism, registered: false, active: false, detail: 'unsupported platform' };
}
