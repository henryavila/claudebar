import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  decideUpdate,
  runAutoUpdate,
  setModeInToml,
  DEFAULT_MODE,
  DEFAULT_INTERVAL_HOURS,
} from '../../src/auto-update.js';
import { parseTOML } from '../../src/toml-parser.js';

// `decideUpdate(installed, latest, mode)` is the PURE semver heart of
// auto-update: given the installed version, the latest published version, and
// the configured mode ("patch" | "all" | "off"), it returns
// { action: 'apply' | 'notify' | 'none', reason }. No I/O — deterministic.
//
// In "patch" mode only a hotfix (z bump) is auto-applied; minor/major just
// notify (so a feature/breaking release never installs itself). "all" applies
// everything forward; "off" is inert. Anything non-forward, non-semver, or a
// pre-release is `none` so the background updater can never do harm.
describe('decideUpdate (pure semver decision)', () => {
  it('patch bump in "patch" mode → apply', () => {
    const r = decideUpdate('1.1.0', '1.1.1', 'patch');
    assert.equal(r.action, 'apply');
  });

  it('minor bump in "patch" mode → notify (never auto-install a feature)', () => {
    const r = decideUpdate('1.1.0', '1.2.0', 'patch');
    assert.equal(r.action, 'notify');
  });

  it('major bump in "patch" mode → notify (never auto-install a breaking change)', () => {
    const r = decideUpdate('1.1.0', '2.0.0', 'patch');
    assert.equal(r.action, 'notify');
  });

  it('patch bump in "all" mode → apply', () => {
    const r = decideUpdate('1.1.0', '1.1.1', 'all');
    assert.equal(r.action, 'apply');
  });

  it('minor bump in "all" mode → apply', () => {
    const r = decideUpdate('1.1.0', '1.2.0', 'all');
    assert.equal(r.action, 'apply');
  });

  it('major bump in "all" mode → apply', () => {
    const r = decideUpdate('1.1.0', '2.0.0', 'all');
    assert.equal(r.action, 'apply');
  });

  it('any bump in "off" mode → none (off is inert)', () => {
    assert.equal(decideUpdate('1.1.0', '1.1.1', 'off').action, 'none');
    assert.equal(decideUpdate('1.1.0', '1.2.0', 'off').action, 'none');
    assert.equal(decideUpdate('1.1.0', '2.0.0', 'off').action, 'none');
  });

  it('latest == installed → none (no useless update) in every mode', () => {
    assert.equal(decideUpdate('1.1.1', '1.1.1', 'patch').action, 'none');
    assert.equal(decideUpdate('1.1.1', '1.1.1', 'all').action, 'none');
    assert.equal(decideUpdate('1.1.1', '1.1.1', 'off').action, 'none');
  });

  it('latest < installed (downgrade) → none (never regress)', () => {
    assert.equal(decideUpdate('1.2.0', '1.1.9', 'patch').action, 'none');
    assert.equal(decideUpdate('2.0.0', '1.9.9', 'all').action, 'none');
  });

  it('invalid / non-semver version (latest or installed) → none and no throw', () => {
    assert.doesNotThrow(() => decideUpdate('garbage', '1.1.1', 'patch'));
    assert.equal(decideUpdate('garbage', '1.1.1', 'patch').action, 'none');
    assert.equal(decideUpdate('1.1.1', 'not-a-version', 'all').action, 'none');
    assert.equal(decideUpdate('', '1.1.1', 'patch').action, 'none');
    assert.equal(decideUpdate('1.1.1', null, 'all').action, 'none');
    assert.equal(decideUpdate(undefined, undefined, 'patch').action, 'none');
  });

  it('pre-release latest → never auto-apply (none/notify, not apply)', () => {
    assert.notEqual(decideUpdate('1.1.0', '1.2.0-rc.1', 'patch').action, 'apply');
    assert.notEqual(decideUpdate('1.1.0', '1.1.1-beta.0', 'patch').action, 'apply');
    assert.notEqual(decideUpdate('1.1.0', '2.0.0-rc.1', 'all').action, 'apply');
  });
});

// runAutoUpdate orchestrates: read config → timestamp throttle gate → fetch
// latest → decide → apply/notify. Best-effort: never throws, always leaves the
// timestamp fresh once it passes the gate (so an offline blip can't busy-loop).
// All I/O (config read, network fetch, apply spawn, clock) is injected so the
// orchestration is deterministic and side-effect-free in tests.
describe('runAutoUpdate (orchestration)', () => {
  let dir;
  const HOUR = 3600 * 1000;
  const stampPath = () => path.join(dir, '.last-update-check');
  const availablePath = () => path.join(dir, '.update-available');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-au-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Build a deps bundle with sane fakes; tests override what they care about.
  function deps(overrides = {}) {
    const calls = { fetch: 0, apply: 0 };
    const base = {
      configDir: dir,
      now: 1_000_000 * HOUR, // fixed clock
      installedVersion: '1.1.0',
      readConfig: () => ({ mode: 'patch', intervalHours: DEFAULT_INTERVAL_HOURS }),
      fetchLatest: async () => {
        calls.fetch++;
        return '1.1.1';
      },
      apply: () => {
        calls.apply++;
      },
    };
    return { deps: { ...base, ...overrides }, calls };
  }

  it('exports the locked defaults', () => {
    assert.equal(DEFAULT_MODE, 'patch');
    assert.equal(DEFAULT_INTERVAL_HOURS, 24);
  });

  it('throttled: a recent check skips fetch entirely', async () => {
    const { deps: d, calls } = deps();
    fs.writeFileSync(stampPath(), String(d.now - 1 * HOUR)); // checked 1h ago, interval 24h
    const r = await runAutoUpdate(d);
    assert.equal(r.skipped, 'throttled');
    assert.equal(calls.fetch, 0, 'must not hit the network when throttled');
    assert.equal(calls.apply, 0);
  });

  it('past the interval: fetches, applies a hotfix, and refreshes the stamp', async () => {
    const { deps: d, calls } = deps();
    fs.writeFileSync(stampPath(), String(d.now - 30 * HOUR)); // 30h ago > 24h
    const r = await runAutoUpdate(d);
    assert.equal(r.action, 'apply');
    assert.equal(calls.fetch, 1);
    assert.equal(calls.apply, 1);
    assert.equal(Number(fs.readFileSync(stampPath(), 'utf8')), d.now, 'stamp refreshed to now');
  });

  it('first run (no stamp file) proceeds and creates the stamp', async () => {
    const { deps: d, calls } = deps();
    const r = await runAutoUpdate(d);
    assert.equal(r.action, 'apply');
    assert.equal(calls.fetch, 1);
    assert.ok(fs.existsSync(stampPath()), 'stamp created on first run');
  });

  it('offline (fetch returns null): none, no throw, stamp still refreshed', async () => {
    const { deps: d, calls } = deps({ fetchLatest: async () => null });
    const r = await runAutoUpdate(d);
    assert.equal(r.action, 'none');
    assert.equal(calls.apply, 0);
    assert.equal(Number(fs.readFileSync(stampPath(), 'utf8')), d.now, 'stamp refreshed even offline');
  });

  it('offline (fetch throws): swallowed, none, stamp still refreshed', async () => {
    const { deps: d, calls } = deps({
      fetchLatest: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    let r;
    await assert.doesNotReject(async () => {
      r = await runAutoUpdate(d);
    });
    assert.equal(r.action, 'none');
    assert.equal(calls.apply, 0);
    assert.equal(Number(fs.readFileSync(stampPath(), 'utf8')), d.now);
  });

  it('notify (minor in patch mode): writes .update-available, does NOT apply', async () => {
    const { deps: d, calls } = deps({ fetchLatest: async () => '1.2.0' });
    const r = await runAutoUpdate(d);
    assert.equal(r.action, 'notify');
    assert.equal(calls.apply, 0, 'minor must not auto-apply in patch mode');
    assert.ok(fs.existsSync(availablePath()), '.update-available written');
    assert.equal(fs.readFileSync(availablePath(), 'utf8').trim(), '1.2.0', 'records the available version');
  });

  it('mode off: inert — no fetch, no apply, no stamp churn', async () => {
    const { deps: d, calls } = deps({ readConfig: () => ({ mode: 'off', intervalHours: 24 }) });
    const r = await runAutoUpdate(d);
    assert.equal(calls.fetch, 0, 'off must not hit the network');
    assert.equal(calls.apply, 0);
    assert.ok(!fs.existsSync(stampPath()), 'off does not create a stamp');
  });

  it('up-to-date: none, and clears a stale .update-available', async () => {
    fs.writeFileSync(availablePath(), '9.9.9'); // stale notification
    const { deps: d, calls } = deps({ fetchLatest: async () => '1.1.0' }); // == installed
    const r = await runAutoUpdate(d);
    assert.equal(r.action, 'none');
    assert.equal(calls.apply, 0);
    assert.ok(!fs.existsSync(availablePath()), 'stale .update-available cleared when caught up');
  });
});

// Pure config-file editor used by both the interactive installer and the
// `config auto-update <mode>` subcommand. Activates/replaces the auto_update
// line wherever it lives, without disturbing the rest of the file.
describe('setModeInToml (pure config editor)', () => {
  it('activates the commented template line (fresh default config)', () => {
    const out = setModeInToml('[update]\n# auto_update = "patch"\n# auto_update_interval_hours = 24\n', 'all');
    const cfg = parseTOML(out);
    assert.equal(cfg.update?.auto_update, 'all');
    assert.ok(out.includes('auto_update_interval_hours'), 'interval line preserved');
    assert.ok(!/^auto_update_interval_hours/m.test(out), 'interval stays commented (not accidentally activated)');
  });

  it('replaces an already-active line', () => {
    const out = setModeInToml('[update]\nauto_update = "off"\n', 'patch');
    assert.equal(parseTOML(out).update?.auto_update, 'patch');
    assert.equal((out.match(/auto_update\s*=/g) || []).length, 1, 'no duplicate line');
  });

  it('inserts the key when [update] exists without it', () => {
    const out = setModeInToml('[colors]\nmodel = 99\n\n[update]\n', 'off');
    assert.equal(parseTOML(out).update?.auto_update, 'off');
  });

  it('appends an [update] section when none exists', () => {
    const out = setModeInToml('[colors]\nmodel = 99\n', 'all');
    assert.equal(parseTOML(out).update?.auto_update, 'all');
    assert.equal(parseTOML(out).colors?.model, 99, 'existing config preserved');
  });
});
