// Auto-update core. The DECISION (should we update? at what level?) runs in the
// already-installed, trusted local code and reads nothing from the network but a
// version string. Only applyUpdate() pulls new code — exactly what the manual
// `update` already does. Dependency-free (node builtins only): no `semver` npm
// package, just a small strict parser we test ourselves.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseTOML } from './toml-parser.js';

export const PKG = '@henryavila/claudebar';
export const DEFAULT_MODE = 'patch';
export const DEFAULT_INTERVAL_HOURS = 24;

const CONFIG_DIR = path.join(os.homedir(), '.config', 'claudebar');
const STAMP_NAME = '.last-update-check';
const AVAILABLE_NAME = '.update-available';
const LOG_NAME = '.auto-update.log';

// Parse a strict three-part semver into { major, minor, patch, prerelease } or
// null when the input is not a clean release version. We deliberately treat a
// pre-release (1.2.0-rc.1) as parseable-but-flagged so callers can refuse to
// auto-apply it; anything else non-conforming is null (→ caller bails to none).
export function parseSemver(v) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

// Compare release cores only (ignores prerelease tag): -1 / 0 / 1.
function compareCore(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

// Pure decision. Returns { action: 'apply'|'notify'|'none', reason }.
//   mode 'patch' → auto-apply only a hotfix (z bump); minor/major notify.
//   mode 'all'   → auto-apply any forward release.
//   mode 'off'   → always none.
// Non-forward, non-semver, or pre-release latest all collapse to a safe none
// (never throws — the network can hand us garbage).
export function decideUpdate(installed, latest, mode) {
  if (mode === 'off') return { action: 'none', reason: 'auto-update off' };

  const cur = parseSemver(installed);
  const next = parseSemver(latest);
  if (!cur || !next) return { action: 'none', reason: 'unparseable version' };

  // Never auto-pull a pre-release of the latest tag.
  if (next.prerelease) return { action: 'none', reason: 'latest is a pre-release' };

  const cmp = compareCore(next, cur);
  if (cmp <= 0) return { action: 'none', reason: 'already up to date' };

  const level =
    next.major !== cur.major ? 'major' : next.minor !== cur.minor ? 'minor' : 'patch';

  if (mode === 'all') return { action: 'apply', reason: `${level} update` };

  // mode === 'patch' (the default): only a hotfix installs itself.
  if (level === 'patch') return { action: 'apply', reason: 'hotfix' };
  return { action: 'notify', reason: `${level} update available` };
}

// Set the auto_update mode inside a config.toml's text, returning the new
// content. Pure (no I/O). Handles every shape: an already-active line, the
// commented template line, an [update] section missing the key, or no section
// at all. Never touches auto_update_interval_hours.
export function setModeInToml(content, mode) {
  const line = `auto_update = "${mode}"`;
  if (/^auto_update[ \t]*=.*$/m.test(content)) {
    return content.replace(/^auto_update[ \t]*=.*$/m, line);
  }
  if (/^#[ \t]*auto_update[ \t]*=.*$/m.test(content)) {
    return content.replace(/^#[ \t]*auto_update[ \t]*=.*$/m, line);
  }
  if (/^\[update\][ \t]*$/m.test(content)) {
    return content.replace(/^(\[update\][ \t]*\n)/m, `$1${line}\n`);
  }
  const sep = content.endsWith('\n') || content === '' ? '' : '\n';
  return `${content}${sep}\n[update]\n${line}\n`;
}

// --- Default I/O dependencies (overridable for tests) -----------------------

// Read mode + interval from ~/.config/claudebar/config.toml. Best-effort: any
// failure (missing file, parse error) falls back to the locked defaults so a
// broken config never blocks a session start.
export function readConfig(configDir = CONFIG_DIR) {
  try {
    const raw = fs.readFileSync(path.join(configDir, 'config.toml'), 'utf8');
    const cfg = parseTOML(raw);
    const mode = cfg.update?.auto_update ?? DEFAULT_MODE;
    const intervalHours = cfg.update?.auto_update_interval_hours ?? DEFAULT_INTERVAL_HOURS;
    return { mode, intervalHours };
  } catch {
    return { mode: DEFAULT_MODE, intervalHours: DEFAULT_INTERVAL_HOURS };
  }
}

// Read the latest published version string from the npm registry using the
// native fetch (Node 18+). Returns the version string, or null on any failure
// (offline, non-2xx, malformed JSON) — never throws.
export async function fetchLatestVersion(url = `https://registry.npmjs.org/${PKG}/latest`) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return typeof json?.version === 'string' ? json.version : null;
  } catch {
    return null;
  }
}

// Spawn the same code path as the manual update, fully detached, logging to
// ~/.config/claudebar/.auto-update.log. Returns immediately; never blocks the
// session. Best-effort — a spawn failure is swallowed.
export function applyUpdate(configDir = CONFIG_DIR) {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    const logPath = path.join(configDir, LOG_NAME);
    const out = fs.openSync(logPath, 'a');
    const child = spawn('npx', ['-y', `${PKG}@latest`, 'update'], {
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
  } catch {
    /* best-effort */
  }
}

// --- Orchestration ----------------------------------------------------------

function readStamp(stampPath) {
  try {
    const n = Number(fs.readFileSync(stampPath, 'utf8').trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

// Orchestrate one auto-update cycle. Reads config → timestamp throttle gate →
// fetch latest → decide → apply/notify. Returns a small result object and never
// throws. All I/O is injected (defaults to the real implementations) so the flow
// is fully testable. Called detached from the SessionStart hook.
export async function runAutoUpdate(opts = {}) {
  const {
    configDir = CONFIG_DIR,
    now = Date.now(),
    installedVersion,
    readConfig: readCfg = () => readConfig(configDir),
    fetchLatest = () => fetchLatestVersion(),
    apply = () => applyUpdate(configDir),
  } = opts;

  const stampPath = path.join(configDir, STAMP_NAME);
  const availablePath = path.join(configDir, AVAILABLE_NAME);

  try {
    const { mode, intervalHours } = readCfg();

    // "off" is fully inert — no network, no clock churn, no files touched.
    if (mode === 'off') return { action: 'none', skipped: 'off' };

    // Throttle gate: a single read + arithmetic on the common path.
    const last = readStamp(stampPath);
    const intervalMs = (intervalHours ?? DEFAULT_INTERVAL_HOURS) * 3600 * 1000;
    if (last && now - last < intervalMs) {
      return { action: 'none', skipped: 'throttled' };
    }

    // Past the gate: stamp NOW (before fetch) so an offline blip updates the
    // clock and we don't busy-retry every session.
    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(stampPath, String(now));
    } catch {
      /* best-effort */
    }

    const latest = await fetchLatest();
    if (!latest) return { action: 'none', reason: 'offline' };

    const decision = decideUpdate(installedVersion, latest, mode);

    if (decision.action === 'apply') {
      apply();
    } else if (decision.action === 'notify') {
      try {
        fs.writeFileSync(availablePath, `${latest}\n`);
      } catch {
        /* best-effort */
      }
    } else {
      // Caught up (or non-forward): clear any stale notification chip state.
      try {
        fs.rmSync(availablePath, { force: true });
      } catch {
        /* best-effort */
      }
    }

    return { ...decision, version: latest };
  } catch {
    // Absolute backstop — auto-update must never break a session start.
    return { action: 'none', reason: 'error' };
  }
}
