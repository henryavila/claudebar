import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusLineBlock,
  ensureStatusLine,
  setStatusLine,
  ensureHealHook,
  removeHealHook,
  ensureAutoUpdateHook,
  removeAutoUpdateHook,
  healAll,
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

// The auto-update hook is SessionStart-ONLY (locked decision: the check never
// runs on UserPromptSubmit nor in the render path — only at session start, then
// throttled by a timestamp). It must coexist with the heal hook on SessionStart.
describe('settings.ensureAutoUpdateHook', () => {
  function sessionStartCommands(s) {
    return (s.hooks?.SessionStart ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  }

  it('adds a SessionStart hook when none exists', () => {
    const s = {};
    const { changed } = ensureAutoUpdateHook(s);
    assert.equal(changed, true);
    assert.ok(sessionStartCommands(s).some((c) => c.includes('auto-update')));
  });

  it('registers ONLY on SessionStart, never on UserPromptSubmit', () => {
    const s = {};
    ensureAutoUpdateHook(s);
    const ups = (s.hooks.UserPromptSubmit ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
    assert.ok(!ups.some((c) => c.includes('auto-update')), 'must not register on UserPromptSubmit');
  });

  it('is idempotent — does not duplicate the hook', () => {
    const s = {};
    ensureAutoUpdateHook(s);
    const { changed } = ensureAutoUpdateHook(s);
    assert.equal(changed, false);
    const count = sessionStartCommands(s).filter((c) => c.includes('auto-update')).length;
    assert.equal(count, 1);
  });

  it('coexists with the heal hook on SessionStart (both present, neither duplicated)', () => {
    const s = {};
    ensureHealHook(s);
    ensureAutoUpdateHook(s);
    const cmds = sessionStartCommands(s);
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal present');
    assert.ok(cmds.some((c) => c.includes('auto-update')), 'auto-update present');
    assert.equal(cmds.filter((c) => c.includes('auto-update')).length, 1);
  });

  it('preserves pre-existing SessionStart hooks', () => {
    const s = {
      hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: '/other/x.sh' }] }] },
    };
    ensureAutoUpdateHook(s);
    const cmds = sessionStartCommands(s);
    assert.ok(cmds.some((c) => c.includes('x.sh')), 'foreign hook kept');
    assert.ok(cmds.some((c) => c.includes('auto-update')), 'auto-update added');
  });
});

// healAll is the single "make settings whole" entry point shared by the hook
// payload and the OS daemon. It must restore statusLine + heal hook (both events)
// + auto-update hook from a total wipe, and stay a true no-op when nothing's gone.
describe('settings.healAll (full-parity restore)', () => {
  function commands(s, event) {
    return (s.hooks?.[event] ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  }

  it('restores statusLine + heal hooks + auto-update hook from an empty settings', () => {
    const s = {};
    const { changed } = healAll(s);
    assert.equal(changed, true);
    assert.equal(s.statusLine.command, STATUSLINE_COMMAND);
    assert.ok(commands(s, 'SessionStart').some((c) => c.includes('ensure-statusline')), 'heal on SessionStart');
    assert.ok(commands(s, 'UserPromptSubmit').some((c) => c.includes('ensure-statusline')), 'heal on UserPromptSubmit');
    assert.ok(commands(s, 'SessionStart').some((c) => c.includes('auto-update')), 'auto-update on SessionStart');
  });

  it('is a true no-op when statusLine and all hooks are already present', () => {
    const s = {};
    healAll(s);
    const { changed } = healAll(s);
    assert.equal(changed, false, 'second run must not churn the file');
  });

  it('reports changed when only the auto-update hook is missing', () => {
    const s = {};
    ensureStatusLine(s);
    ensureHealHook(s);
    const { changed } = healAll(s);
    assert.equal(changed, true, 'a partial gap still counts as a heal');
    assert.ok(commands(s, 'SessionStart').some((c) => c.includes('auto-update')), 'auto-update back-filled');
  });

  it('does not clobber a statusLine the user pointed elsewhere', () => {
    const s = { statusLine: { type: 'command', command: '/my/own.sh' } };
    healAll(s);
    assert.equal(s.statusLine.command, '/my/own.sh');
  });
});

// Daemon mode — the OS daemon fires on EVERY settings.json write (launchd
// WatchPaths / systemd .path), including the transient one Claude Code makes when
// it enters a fullscreen TUI and drops statusLine. Healing instantly there starts
// a write-fight (daemon restores → CC re-drops → …) that flickers the TUI and trips
// systemd's start-limit, killing the daemon. So the daemon-path heal acts ONLY on a
// genuine catastrophic clobber: skip while CC is in a fullscreen TUI, and skip while
// the heal hook still lives (the hook recovers statusLine at the next turn). The
// fullscreen skip applies to BOTH paths (CC's fullscreen is a persistent mode, so
// the per-turn hook would otherwise fight it once per prompt); the live-hook skip
// is daemon-only — the hook path does the restoring and does not defer to itself.
describe('settings.healAll (daemon mode — catastrophic-clobber-only gate)', () => {
  function commands(s, event) {
    return (s.hooks?.[event] ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  }

  it('skips entirely while Claude Code is in a fullscreen TUI', () => {
    // tui:fullscreen present, statusLine dropped, but hooks intact — the exact
    // transient state. Daemon must NOT write (no fight with the fullscreen TUI).
    const s = { tui: 'fullscreen' };
    ensureHealHook(s);
    const { changed } = healAll(s, { daemon: true });
    assert.equal(changed, false, 'daemon stays out of an active fullscreen toggle');
    assert.equal(s.statusLine, undefined, 'statusLine left dropped — CC restores it on exit');
  });

  it('skips restoring statusLine when the heal hook is still alive', () => {
    // statusLine dropped, no fullscreen marker, but the hook survives → the
    // UserPromptSubmit/SessionStart hook will recover statusLine at the next turn.
    const s = {};
    ensureHealHook(s);
    const { changed } = healAll(s, { daemon: true });
    assert.equal(changed, false, 'daemon defers to the live hook heal');
    assert.equal(s.statusLine, undefined);
  });

  it('heals fully on a catastrophic clobber (hooks gone, not fullscreen)', () => {
    // The case the daemon exists for: statusLine AND all hooks wiped, and CC is
    // NOT in a fullscreen TUI — nothing else can recover. Restore everything.
    const s = { hooks: {} };
    const { changed } = healAll(s, { daemon: true });
    assert.equal(changed, true);
    assert.equal(s.statusLine.command, STATUSLINE_COMMAND);
    assert.ok(commands(s, 'SessionStart').some((c) => c.includes('ensure-statusline')), 'heal hook restored');
    assert.ok(commands(s, 'UserPromptSubmit').some((c) => c.includes('ensure-statusline')), 'mid-session hook restored');
    assert.ok(commands(s, 'SessionStart').some((c) => c.includes('auto-update')), 'auto-update restored');
  });

  it('does NOT heal a hook-less clobber while still in fullscreen (waits for exit)', () => {
    // Even a full wipe is left alone while tui:fullscreen — acting now still
    // fights the TUI. The next daemon trigger after CC exits fullscreen (tui key
    // gone) finds hooks still missing and heals then.
    const s = { tui: 'fullscreen', hooks: {} };
    const { changed } = healAll(s, { daemon: true });
    assert.equal(changed, false);
    assert.equal(s.statusLine, undefined);
  });

  it('hook path (daemon:false) ALSO stands down while in a fullscreen TUI', () => {
    // CC's fullscreen TUI (2.1.89+) is a persistent, user-chosen mode and the
    // UserPromptSubmit heal fires every turn WHILE it is active. Restoring
    // statusLine then makes CC hot-reload and drop out of fullscreen, once per
    // prompt. So fullscreen gates BOTH paths — the hook does not restore here.
    const s = { tui: 'fullscreen' };
    ensureHealHook(s);
    const { changed } = healAll(s);
    assert.equal(changed, false, 'hook path stands down while fullscreen');
    assert.equal(s.statusLine, undefined, 'statusLine left dropped — CC owns it in fullscreen');
  });

  it('hook path (daemon:false) restores statusLine when NOT in fullscreen', () => {
    // Regression guard for mid-session recovery: off fullscreen the hook keeps its
    // one-turn unconditional restore. A live hook does NOT make it defer to itself.
    const s = {};
    ensureHealHook(s);
    const { changed } = healAll(s);
    assert.equal(changed, true);
    assert.equal(s.statusLine.command, STATUSLINE_COMMAND);
  });
});

describe('settings.removeAutoUpdateHook', () => {
  function sessionStartCommands(s) {
    return (s.hooks?.SessionStart ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command));
  }

  it('removes our hook but keeps others', () => {
    const s = {
      hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: '/other/x.sh' }] }] },
    };
    ensureAutoUpdateHook(s);
    const { changed } = removeAutoUpdateHook(s);
    assert.equal(changed, true);
    const cmds = sessionStartCommands(s);
    assert.ok(cmds.some((c) => c.includes('x.sh')), 'other hook preserved');
    assert.ok(!cmds.some((c) => c.includes('auto-update')), 'auto-update hook gone');
  });

  it('leaves the heal hook intact when removing only auto-update', () => {
    const s = {};
    ensureHealHook(s);
    ensureAutoUpdateHook(s);
    const { changed } = removeAutoUpdateHook(s);
    assert.equal(changed, true);
    const cmds = sessionStartCommands(s);
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook preserved');
    assert.ok(!cmds.some((c) => c.includes('auto-update')), 'auto-update hook removed');
  });

  it('is a no-op when no auto-update hook present', () => {
    const s = { hooks: { SessionStart: [] } };
    const { changed } = removeAutoUpdateHook(s);
    assert.equal(changed, false);
  });
});
