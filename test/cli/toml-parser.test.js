import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTOML, validateConfig } from '../../src/toml-parser.js';

describe('parseTOML', () => {
  it('parses sections and key-value pairs', () => {
    const config = parseTOML('[colors]\nmodel = 99\nbranch = 40');
    assert.equal(config.colors.model, 99);
    assert.equal(config.colors.branch, 40);
  });

  it('ignores comments and blank lines', () => {
    const config = parseTOML('# comment\n[colors]\n# model = 50\nmodel = 99\n\n');
    assert.equal(config.colors.model, 99);
    assert.equal(Object.keys(config.colors).length, 1);
  });

  it('strips inline comments', () => {
    const config = parseTOML('[colors]\nmodel = 99  # hot pink');
    assert.equal(config.colors.model, 99);
  });

  it('parses booleans in chips section', () => {
    const config = parseTOML('[chips]\ntmux = false\npr = true');
    assert.equal(config.chips.tmux, false);
    assert.equal(config.chips.pr, true);
  });

  it('parses quoted strings', () => {
    const config = parseTOML('[layout]\nforce = "compact"');
    assert.equal(config.layout.force, 'compact');
  });

  it('handles whitespace around =', () => {
    const config = parseTOML('[colors]\nmodel=99\nbranch =  40');
    assert.equal(config.colors.model, 99);
    assert.equal(config.colors.branch, 40);
  });

  it('parses multiple sections', () => {
    const config = parseTOML('[colors]\nmodel = 99\n[thresholds]\nwarning = 50\n[chips]\ntmux = false');
    assert.equal(config.colors.model, 99);
    assert.equal(config.thresholds.warning, 50);
    assert.equal(config.chips.tmux, false);
  });

  it('parses glyphs as strings', () => {
    const config = parseTOML('[glyphs]\nsparkle = "✦"\npencil = X');
    assert.equal(config.glyphs.sparkle, '✦');
    assert.equal(config.glyphs.pencil, 'X');
  });

  it('parses the [update] section (string mode + numeric interval)', () => {
    const config = parseTOML('[update]\nauto_update = "patch"\nauto_update_interval_hours = 24');
    assert.equal(config.update.auto_update, 'patch');
    assert.equal(config.update.auto_update_interval_hours, 24);
    assert.equal(typeof config.update.auto_update_interval_hours, 'number');
  });

  it('parses [daemon] enabled as a real boolean (not the string "false")', () => {
    assert.equal(parseTOML('[daemon]\nenabled = false').daemon.enabled, false);
    assert.equal(parseTOML('[daemon]\nenabled = true').daemon.enabled, true);
    // a header with only commented keys should not materialize a section.
    assert.equal(parseTOML('[daemon]\n# enabled = true').daemon, undefined);
  });

  it('parses [quota] enabled and refresh interval with the right types', () => {
    const cfg = parseTOML('[quota]\nenabled = false\nrefresh_interval_minutes = 1');
    assert.equal(cfg.quota.enabled, false);
    assert.equal(cfg.quota.refresh_interval_minutes, 1);
    assert.equal(typeof cfg.quota.refresh_interval_minutes, 'number');
  });

  it('ignores sections that only contain commented defaults', () => {
    assert.deepEqual(parseTOML('[future]\n# enabled = true\n# interval = 5'), {});
  });

  it('does not reject future template sections when all their keys are commented', () => {
    const result = validateConfig(parseTOML('[layout]\nforce = "compact"\n\n[future]\n# enabled = true\n'));
    assert.equal(result.valid, true);
  });
});

describe('validateConfig', () => {
  it('passes valid config', () => {
    const result = validateConfig({ colors: { model: 99 }, thresholds: { warning: 60, critical: 90 } });
    assert.equal(result.valid, true);
  });

  it('rejects color out of range', () => {
    const result = validateConfig({ colors: { model: 300 } });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].message.includes('0-255'));
  });

  it('rejects warning >= critical', () => {
    const result = validateConfig({ thresholds: { warning: 90, critical: 60 } });
    assert.equal(result.valid, false);
  });

  it('rejects unknown section', () => {
    const result = validateConfig({ unknown: { foo: 1 } });
    assert.equal(result.valid, false);
  });

  it('still rejects an unknown section when it has active settings', () => {
    const result = validateConfig(parseTOML('[future]\nenabled = true'));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('[future]')));
  });

  it('rejects non-boolean chip', () => {
    const result = validateConfig({ chips: { tmux: 'yes' } });
    assert.equal(result.valid, false);
  });

  it('rejects invalid layout force', () => {
    const result = validateConfig({ layout: { force: 'tiny' } });
    assert.equal(result.valid, false);
  });

  it('passes a valid [update] section', () => {
    for (const mode of ['patch', 'all', 'off']) {
      const result = validateConfig({ update: { auto_update: mode, auto_update_interval_hours: 24 } });
      assert.equal(result.valid, true, `${mode} should be valid`);
    }
  });

  it('rejects an invalid auto_update mode', () => {
    const result = validateConfig({ update: { auto_update: 'sometimes' } });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.message.includes('auto_update')));
  });

  it('rejects a non-positive-integer interval', () => {
    assert.equal(validateConfig({ update: { auto_update_interval_hours: 0 } }).valid, false);
    assert.equal(validateConfig({ update: { auto_update_interval_hours: -1 } }).valid, false);
    assert.equal(validateConfig({ update: { auto_update_interval_hours: 1.5 } }).valid, false);
  });

  it('accepts a boolean [daemon] enabled and rejects a non-boolean', () => {
    assert.equal(validateConfig({ daemon: { enabled: true } }).valid, true);
    assert.equal(validateConfig({ daemon: { enabled: false } }).valid, true);
    assert.equal(validateConfig({ daemon: { enabled: 'yes' } }).valid, false);
  });

  it('accepts a valid [quota] section', () => {
    assert.equal(validateConfig({ quota: { enabled: true, refresh_interval_minutes: 1 } }).valid, true);
  });
});
