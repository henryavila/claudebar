import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusLineBlock,
  ensureStatusLine,
  setStatusLine,
  ensureHealHook,
  removeHealHook,
  STATUSLINE_COMMAND,
} from '../../src/settings.js';

describe('settings.statusLineBlock', () => {
  it('points at the installed claudebar script', () => {
    const block = statusLineBlock();
    assert.equal(block.type, 'command');
    assert.equal(block.command, STATUSLINE_COMMAND);
    assert.ok(block.command.includes('claudebar'));
  });
});

describe('settings.ensureStatusLine (restore-if-missing)', () => {
  it('restores statusLine when absent', () => {
    const s = { hooks: {} };
    const { changed } = ensureStatusLine(s);
    assert.equal(changed, true);
    assert.equal(s.statusLine.command, STATUSLINE_COMMAND);
  });

  it('is a no-op when statusLine already present', () => {
    const s = { statusLine: { type: 'command', command: '/custom/path.sh' } };
    const { changed } = ensureStatusLine(s);
    assert.equal(changed, false);
    assert.equal(s.statusLine.command, '/custom/path.sh', 'must not clobber user customization');
  });
});

describe('settings.setStatusLine (force opt-in)', () => {
  it('sets the claudebar block when missing', () => {
    const s = {};
    const { changed } = setStatusLine(s);
    assert.equal(changed, true);
    assert.equal(s.statusLine.command, STATUSLINE_COMMAND);
  });

  it('is idempotent when the identical claudebar block exists', () => {
    const s = { statusLine: statusLineBlock() };
    const { changed } = setStatusLine(s);
    assert.equal(changed, false);
  });
});

describe('settings.ensureHealHook', () => {
  it('adds a SessionStart hook when none exists', () => {
    const s = {};
    const { changed } = ensureHealHook(s);
    assert.equal(changed, true);
    const cmds = s.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')));
  });

  it('is idempotent — does not duplicate the hook', () => {
    const s = {};
    ensureHealHook(s);
    const { changed } = ensureHealHook(s);
    assert.equal(changed, false);
    const count = s.hooks.SessionStart.flatMap((e) => e.hooks).filter((h) =>
      h.command.includes('ensure-statusline')
    ).length;
    assert.equal(count, 1);
  });

  it('preserves pre-existing SessionStart hooks', () => {
    const s = {
      hooks: {
        SessionStart: [
          { matcher: '*', hooks: [{ type: 'command', command: '/other/version-check.sh' }] },
        ],
      },
    };
    ensureHealHook(s);
    const cmds = s.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('version-check.sh')), 'existing hook kept');
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook added');
  });
});

describe('settings.removeHealHook', () => {
  it('removes our hook but keeps others', () => {
    const s = {
      hooks: {
        SessionStart: [
          { matcher: '*', hooks: [{ type: 'command', command: '/other/version-check.sh' }] },
        ],
      },
    };
    ensureHealHook(s);
    const { changed } = removeHealHook(s);
    assert.equal(changed, true);
    const cmds = s.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes('version-check.sh')), 'other hook preserved');
    assert.ok(!cmds.some((c) => c.includes('ensure-statusline')), 'heal hook gone');
  });

  it('drops the SessionStart key when our hook was the only one', () => {
    const s = {};
    ensureHealHook(s);
    const { changed } = removeHealHook(s);
    assert.equal(changed, true);
    assert.ok(!s.hooks.SessionStart, 'empty SessionStart pruned');
  });

  it('is a no-op when no heal hook present', () => {
    const s = { hooks: { SessionStart: [] } };
    const { changed } = removeHealHook(s);
    assert.equal(changed, false);
  });
});
