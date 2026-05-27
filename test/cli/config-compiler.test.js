import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileConfig } from '../../src/config-compiler.js';

describe('compileConfig', () => {
  it('compiles colors to C_UPPER=value', () => {
    const out = compileConfig({ colors: { model: 99, branch: 40 } });
    assert.ok(out.includes('C_MODEL=99'));
    assert.ok(out.includes('C_BRANCH=40'));
  });

  it('handles naming mismatches', () => {
    const out = compileConfig({ colors: { effort_high: 111, effort_xhigh: 222, separator: 123 } });
    assert.ok(out.includes('C_EFFORT_HI=111'));
    assert.ok(out.includes('C_EFFORT_XHI=222'));
    assert.ok(out.includes('C_SEP=123'));
  });

  it('compiles thresholds to THRESHOLD_UPPER=value', () => {
    const out = compileConfig({ thresholds: { warning: 50 } });
    assert.ok(out.includes('THRESHOLD_WARNING=50'));
  });

  it('compiles chips booleans to CHIP_UPPER=1|0', () => {
    const out = compileConfig({ chips: { tmux: false, pr: true } });
    assert.ok(out.includes('CHIP_TMUX=0'));
    assert.ok(out.includes('CHIP_PR=1'));
  });

  it('compiles layout to LAYOUT_UPPER=value', () => {
    const out = compileConfig({ layout: { force: 'compact' } });
    assert.ok(out.includes('LAYOUT_FORCE=compact'));
  });

  it('compiles glyphs to GLYPH_UPPER=value', () => {
    const out = compileConfig({ glyphs: { sparkle: '✦' } });
    assert.ok(out.includes('GLYPH_SPARKLE=✦'));
  });

  it('empty config produces no assignments', () => {
    const out = compileConfig({});
    const lines = out.split('\n').filter(l => l.includes('='));
    assert.equal(lines.length, 0);
  });
});
