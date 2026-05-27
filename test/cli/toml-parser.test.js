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

  it('rejects non-boolean chip', () => {
    const result = validateConfig({ chips: { tmux: 'yes' } });
    assert.equal(result.valid, false);
  });

  it('rejects invalid layout force', () => {
    const result = validateConfig({ layout: { force: 'tiny' } });
    assert.equal(result.valid, false);
  });
});
