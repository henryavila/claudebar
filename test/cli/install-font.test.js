import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, caskName } from '../../src/install-font.js';

describe('install-font', () => {
  it('caskName converts CamelCase to kebab', () => {
    assert.equal(caskName('JetBrainsMono'), 'font-jet-brains-mono-nerd-font');
    assert.equal(caskName('FiraCode'), 'font-fira-code-nerd-font');
    assert.equal(caskName('Hack'), 'font-hack-nerd-font');
    assert.equal(caskName('CascadiaCode'), 'font-cascadia-code-nerd-font');
  });

  it('detectPlatform returns macos on Darwin', () => {
    if (process.platform === 'darwin') {
      assert.equal(detectPlatform(), 'macos');
    }
  });

  it('detectPlatform returns linux on Linux', () => {
    if (process.platform === 'linux' && !process.env.WSL_DISTRO_NAME) {
      assert.equal(detectPlatform(), 'linux');
    }
  });
});
