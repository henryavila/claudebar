import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { daemonCommand } from '../../src/daemon-command.js';

// The CLI wrapper is thin glue over the (separately, thoroughly tested) daemon
// functions; here we just prove each subcommand dispatches to the right one and
// reports sensibly. All OS-touching deps are injected — nothing real is run.
describe('daemon-command', () => {
  function deps() {
    const calls = [];
    return {
      calls,
      installDaemon: () => { calls.push('install'); return { mechanism: 'launchd', registered: true, detail: '/x.plist' }; },
      uninstallDaemon: () => { calls.push('uninstall'); return { removed: true }; },
      daemonStatus: () => { calls.push('status'); return { mechanism: 'launchd', registered: true, active: true, detail: '/x.plist' }; },
      log: () => {},
    };
  }

  it('install dispatches to installDaemon', async () => {
    const d = deps();
    await daemonCommand({ sub: 'install', ...d });
    assert.deepEqual(d.calls, ['install']);
  });

  it('uninstall dispatches to uninstallDaemon', async () => {
    const d = deps();
    await daemonCommand({ sub: 'uninstall', ...d });
    assert.deepEqual(d.calls, ['uninstall']);
  });

  it('status (the default) dispatches to daemonStatus', async () => {
    const d = deps();
    await daemonCommand({ ...d });
    assert.deepEqual(d.calls, ['status']);
  });

  it('restart deregisters then re-registers', async () => {
    const d = deps();
    await daemonCommand({ sub: 'restart', ...d });
    assert.deepEqual(d.calls, ['uninstall', 'install']);
  });

  it('an unknown subcommand reports an error and runs nothing', async () => {
    const d = deps();
    const res = await daemonCommand({ sub: 'frobnicate', ...d });
    assert.equal(res.error, 'unknown subcommand');
    assert.deepEqual(d.calls, []);
  });
});
