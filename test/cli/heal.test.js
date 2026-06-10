import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');

// Reproduce the installed layout: ensure-statusline.mjs + settings.js sitting
// side by side in a directory, exactly as install/update place them in
// ~/.config/claudebar/. The script imports ./settings.js from there.
function makeInstallDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-heal-test-'));
  fs.copyFileSync(path.join(REPO, 'assets', 'ensure-statusline.mjs'), path.join(dir, 'ensure-statusline.mjs'));
  fs.copyFileSync(path.join(REPO, 'src', 'settings.js'), path.join(dir, 'settings.js'));
  return dir;
}

function runHeal(installDir, settingsPath, { daemon = false } = {}) {
  const env = { ...process.env, CLAUDEBAR_SETTINGS: settingsPath };
  if (daemon) env.CLAUDEBAR_DAEMON = '1';
  return execFileSync('node', [path.join(installDir, 'ensure-statusline.mjs')], {
    env,
    encoding: 'utf8',
  });
}

describe('ensure-statusline.mjs (self-heal hook)', () => {
  let installDir, settingsPath;

  beforeEach(() => {
    installDir = makeInstallDir();
    settingsPath = path.join(installDir, 'settings.json');
  });

  afterEach(() => { fs.rmSync(installDir, { recursive: true, force: true }); });

  it('restores a dropped statusLine', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'));
  });

  it('produces no stdout (SessionStart stdout is injected into context)', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    const out = runHeal(installDir, settingsPath);
    assert.equal(out, '', 'must stay silent');
  });

  it('leaves an already-configured statusLine untouched', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: 'command', command: '/keep/me.sh' } }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.command, '/keep/me.sh');
  });

  it('exits 0 and does nothing when settings.json is absent', () => {
    const missing = path.join(installDir, 'nope.json');
    // execFileSync throws on non-zero exit; absence of throw asserts exit 0.
    assert.doesNotThrow(() => runHeal(installDir, missing));
    assert.ok(!fs.existsSync(missing), 'does not create settings.json from nothing');
  });

  // Helper: collect the command strings registered under SessionStart.
  function sessionStartCommands(settings) {
    return (settings.hooks?.SessionStart ?? []).flatMap((e) =>
      (e.hooks ?? []).map((h) => h.command)
    );
  }

  // Integration — the DEPLOYED heal script must wire the mid-session recovery
  // event (UserPromptSubmit), not just SessionStart. This guards the end-to-end
  // path: ensure-statusline.mjs → ensureHealHook → both events.
  it('registers the heal on UserPromptSubmit for mid-session recovery', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const ups = (settings.hooks?.UserPromptSubmit ?? []).flatMap((e) =>
      (e.hooks ?? []).map((h) => h.command)
    );
    assert.ok(ups.some((c) => c.includes('ensure-statusline')), 'UserPromptSubmit heal registered');
  });

  // Regression — the exact field-validated user state: Claude Code (or a
  // co-installed tool overwriting hooks.SessionStart) left settings.json with
  // NO statusLine AND NO ensure-statusline hook, while an unrelated
  // version-check SessionStart hook survived. Healing must restore BOTH the
  // statusLine and its own hook registration, and preserve the foreign hook.
  it('restores its own heal hook (and statusLine) when both were dropped', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              {
                matcher: '*',
                hooks: [
                  { type: 'command', command: '/Users/henry/.atomic-skills/hooks/version-check.sh' },
                ],
              },
            ],
          },
          effortLevel: 'high',
          skipDangerousModePermissionPrompt: true,
        },
        null,
        2
      )
    );
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = sessionStartCommands(settings);
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored');
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook re-registered');
    assert.ok(cmds.some((c) => c.includes('version-check.sh')), 'foreign hook preserved');
  });

  // Full parity — the deployed heal payload (also run by the OS daemon) must
  // restore the auto-update hook too, not just statusLine + heal hook. A clobber
  // that strips every hook should come back whole from one heal run.
  it('restores the auto-update hook as well (full parity via healAll)', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const cmds = sessionStartCommands(settings);
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored');
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook restored');
    assert.ok(cmds.some((c) => c.includes('auto-update')), 'auto-update hook restored');
  });

  // Edge — only the heal hook was dropped (statusLine still points somewhere
  // the user chose). Heal must re-add its hook without clobbering statusLine.
  it('re-registers its hook without touching a present statusLine', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ statusLine: { type: 'command', command: '/keep/me.sh' }, hooks: {} }, null, 2)
    );
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine.command, '/keep/me.sh', 'statusLine untouched');
    assert.ok(
      sessionStartCommands(settings).some((c) => c.includes('ensure-statusline')),
      'heal hook re-registered'
    );
  });

  // Edge — hook already present, statusLine dropped. Heal restores statusLine
  // and must NOT duplicate its own hook.
  it('restores statusLine without duplicating an existing heal hook', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          hooks: {
            SessionStart: [
              { matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/ensure-statusline.mjs' }] },
            ],
          },
        },
        null,
        2
      )
    );
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored');
    const healCount = sessionStartCommands(settings).filter((c) => c.includes('ensure-statusline')).length;
    assert.equal(healCount, 1, 'heal hook not duplicated');
  });

  // Daemon mode (CLAUDEBAR_DAEMON=1) — the OS daemon runs this same script on
  // every settings.json write. It must NOT restore statusLine during a transient
  // fullscreen-TUI drop (would write-fight the TUI), and must defer to a live hook
  // heal; it acts only on a genuine hook-less clobber.
  it('daemon run leaves a fullscreen-TUI statusLine drop alone (no fight)', () => {
    // tui:fullscreen + statusLine dropped, hooks intact — must not write.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          tui: 'fullscreen',
          hooks: {
            SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/ensure-statusline.mjs' }] }],
          },
        },
        null,
        2
      )
    );
    const before = fs.readFileSync(settingsPath, 'utf8');
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;
    runHeal(installDir, settingsPath, { daemon: true });
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), before, 'daemon must not touch a fullscreen toggle');
    assert.equal(fs.statSync(settingsPath).mtimeMs, mtimeBefore, 'file not rewritten');
  });

  it('daemon run defers to a live heal hook (does not restore statusLine itself)', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        { hooks: { SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/ensure-statusline.mjs' }] }] } },
        null,
        2
      )
    );
    runHeal(installDir, settingsPath, { daemon: true });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(settings.statusLine, undefined, 'hook heal will recover statusLine at next turn');
  });

  it('daemon run heals a catastrophic clobber (hooks gone, not fullscreen)', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath, { daemon: true });
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored');
    const cmds = sessionStartCommands(settings);
    assert.ok(cmds.some((c) => c.includes('ensure-statusline')), 'heal hook restored');
    assert.ok(cmds.some((c) => c.includes('auto-update')), 'auto-update restored');
  });

  // Hook path during fullscreen (CLAUDEBAR_DAEMON unset) — CC's fullscreen TUI is
  // a persistent, user-chosen rendering mode (CC 2.1.89+) that has no inline
  // statusLine; while active CC re-persists settings WITHOUT the statusLine block.
  // The per-turn UserPromptSubmit heal must NOT restore it then, or CC hot-reloads
  // the statusLine and drops out of fullscreen once per prompt. Fullscreen gates
  // BOTH paths — not just the daemon.
  it('hook run leaves a fullscreen-TUI statusLine drop alone (no per-turn fight)', () => {
    // tui:fullscreen + statusLine dropped, heal hook intact — hook path must not write.
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(
        {
          tui: 'fullscreen',
          hooks: {
            SessionStart: [{ matcher: '*', hooks: [{ type: 'command', command: 'node ~/.config/claudebar/ensure-statusline.mjs' }] }],
          },
        },
        null,
        2
      )
    );
    const before = fs.readFileSync(settingsPath, 'utf8');
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;
    runHeal(installDir, settingsPath); // daemon:false (hook path)
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), before, 'hook must not touch a fullscreen toggle');
    assert.equal(fs.statSync(settingsPath).mtimeMs, mtimeBefore, 'file not rewritten');
  });

  // Regression guard for the original mid-session heal: with NO tui key, a dropped
  // statusLine must still be restored by the hook path within one turn.
  it('hook run still restores a dropped statusLine when not in fullscreen', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored off fullscreen');
  });

  // Boundary — only the exact string "fullscreen" gates. Any other tui value
  // (e.g. "default") is a normal rendering mode that DOES carry a statusLine, so
  // a dropped statusLine must be restored.
  it('hook run restores statusLine when tui is set but not "fullscreen"', () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ tui: 'default', hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(settings.statusLine?.command.includes('claudebar'), 'statusLine restored for tui:default');
  });

  // Edge — fullscreen takes precedence even over a catastrophic clobber that also
  // stripped the heal hook. Healing settings.json while CC is fullscreen would
  // still trigger the reload/exit; the daemon-timer path recovers once fullscreen
  // exits (the tui key is gone then). The hook path stands down entirely here.
  it('hook run does not heal even a hook-less clobber while fullscreen', () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ tui: 'fullscreen', hooks: {} }, null, 2)
    );
    const before = fs.readFileSync(settingsPath, 'utf8');
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;
    runHeal(installDir, settingsPath);
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), before, 'fullscreen gate wins over clobber');
    assert.equal(fs.statSync(settingsPath).mtimeMs, mtimeBefore, 'file not rewritten while fullscreen');
  });

  // Idempotency — when both statusLine and the hook are already correct, a heal
  // run must not churn the file (no-op write would dirty mtime / git status).
  it('does not rewrite settings.json when nothing is missing', () => {
    // Seed once via heal so the file is in canonical post-heal form.
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }, null, 2));
    runHeal(installDir, settingsPath);
    const before = fs.readFileSync(settingsPath, 'utf8');
    const mtimeBefore = fs.statSync(settingsPath).mtimeMs;
    runHeal(installDir, settingsPath);
    const after = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(after, before, 'content unchanged on second heal');
    assert.equal(fs.statSync(settingsPath).mtimeMs, mtimeBefore, 'file not rewritten');
  });
});
