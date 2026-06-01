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

  // The SessionStart heal only recovers a dropped statusLine at the next session
  // start. The clobber happens mid-session (Claude Code re-persists settings on a
  // TUI toggle), so we also register on UserPromptSubmit, which fires once per
  // turn — recovering the bar within one prompt. Validated live: Claude Code
  // re-reads the statusLine block from disk, so a mid-session re-write redraws it.
  it('registers the heal hook on UserPromptSubmit as well as SessionStart', () => {
    const s = {};
    const { changed } = ensureHealHook(s);
    assert.equal(changed, true);
    const ss = s.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
    const ups = s.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(ss.some((c) => c.includes('ensure-statusline')), 'SessionStart heal present');
    assert.ok(ups.some((c) => c.includes('ensure-statusline')), 'UserPromptSubmit heal present');
  });

  it('is idempotent across both events — no duplicates, no change on re-run', () => {
    const s = {};
    ensureHealHook(s);
    const { changed } = ensureHealHook(s);
    assert.equal(changed, false);
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const count = s.hooks[event]
        .flatMap((e) => e.hooks)
        .filter((h) => h.command.includes('ensure-statusline')).length;
      assert.equal(count, 1, `${event} has exactly one heal hook`);
    }
  });

  // Migration path: a settings.json from an older claudebar (heal registered only
  // on SessionStart) must gain the UserPromptSubmit registration on the next
  // ensureHealHook run (install/update/heal), without duplicating SessionStart.
  it('back-fills UserPromptSubmit when only SessionStart had the heal', () => {
    const s = {
      hooks: {
        SessionStart: [
          { matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/ensure-statusline.mjs' }] },
        ],
      },
    };
    const { changed } = ensureHealHook(s);
    assert.equal(changed, true, 'back-fill counts as a change');
    const ss = s.hooks.SessionStart.flatMap((e) => e.hooks).filter((h) => h.command.includes('ensure-statusline')).length;
    const ups = (s.hooks.UserPromptSubmit ?? []).flatMap((e) => e.hooks).filter((h) => h.command.includes('ensure-statusline')).length;
    assert.equal(ss, 1, 'SessionStart not duplicated');
    assert.equal(ups, 1, 'UserPromptSubmit back-filled');
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

  it('removes the heal hook from UserPromptSubmit too (not just SessionStart)', () => {
    const s = {
      hooks: {
        UserPromptSubmit: [
          { matcher: '*', hooks: [{ type: 'command', command: '/keep/lint.sh' }] },
        ],
      },
    };
    ensureHealHook(s); // registers on both events
    const { changed } = removeHealHook(s);
    assert.equal(changed, true);
    const ups = s.hooks.UserPromptSubmit.flatMap((e) => e.hooks.map((h) => h.command));
    assert.ok(ups.some((c) => c.includes('lint.sh')), 'foreign UserPromptSubmit hook preserved');
    assert.ok(!ups.some((c) => c.includes('ensure-statusline')), 'heal hook removed from UserPromptSubmit');
    assert.ok(!s.hooks.SessionStart, 'SessionStart pruned (heal was its only entry)');
  });
});
