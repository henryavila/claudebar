// `claudebar daemon [install|uninstall|status|restart]` — manage the
// hook-independent OS self-heal backstop directly. install/uninstall already
// register/deregister it; this is for inspection and manual control.
import {
  installDaemon as defaultInstall,
  uninstallDaemon as defaultUninstall,
  daemonStatus as defaultStatus,
} from './daemon.js';

export async function daemonCommand({ sub, log, installDaemon, uninstallDaemon, daemonStatus } = {}) {
  log ??= console.log;
  sub ??= 'status';
  installDaemon ??= defaultInstall;
  uninstallDaemon ??= defaultUninstall;
  daemonStatus ??= defaultStatus;

  if (sub === 'install') {
    const res = installDaemon({ log });
    if (res.registered) log(`Daemon ready: ${res.mechanism} (${res.detail})`);
    else log(`Daemon not registered (${res.error?.message ?? res.detail ?? 'unsupported'}) — hook heal still active`);
    return res;
  }

  if (sub === 'uninstall') {
    const res = uninstallDaemon({ log });
    log(res.removed ? `Daemon removed.` : `No daemon was registered.`);
    return res;
  }

  if (sub === 'restart') {
    uninstallDaemon({ log });
    const res = installDaemon({ log });
    log(res.registered ? `Daemon restarted: ${res.mechanism}` : `Daemon restart failed — hook heal still active`);
    return res;
  }

  if (sub === 'status') {
    const st = daemonStatus({});
    log(`Mechanism : ${st.mechanism}`);
    log(`Registered: ${st.registered ? 'yes' : 'no'}`);
    log(`Active    : ${st.active ? 'yes' : 'no'}`);
    if (st.detail) log(`Path      : ${st.detail}`);
    return st;
  }

  log(`Unknown daemon subcommand: ${sub}\nUsage: claudebar daemon [install|uninstall|status|restart]`);
  return { error: 'unknown subcommand' };
}

export default async function main(args = []) {
  await daemonCommand({ sub: args[0] });
}
