#!/usr/bin/env node
import { argv, exit } from 'node:process';

const [,, command, ...args] = argv;

const commands = {
  install:        () => import('../src/install.js'),
  update:         () => import('../src/update.js'),
  config:         () => import('../src/config.js'),
  doctor:         () => import('../src/doctor.js'),
  uninstall:      () => import('../src/uninstall.js'),
  'install-font': () => import('../src/install-font.js'),
};

if (!command || command === '--help' || command === '-h') {
  console.log(`\
claudebar — zone-driven statusline for Claude Code

Usage: claudebar <command>

Commands:
  install        Install statusline to ~/.config/claudebar/
  update         Update to latest version (preserves config)
  config         Edit config.toml in $EDITOR
  doctor         Diagnose installation
  uninstall      Remove statusline
  install-font   Install a Nerd Font

Options:
  --help, -h     Show this help
  --version, -v  Show version`);
  exit(0);
}

if (command === '--version' || command === '-v') {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  console.log(pkg.version);
  exit(0);
}

if (!commands[command]) {
  console.error(`Unknown command: ${command}\nRun "claudebar --help" for usage.`);
  exit(1);
}

const mod = await commands[command]();
await mod.default(args);
