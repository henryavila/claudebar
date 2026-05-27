import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { doctor } from '../../src/doctor.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-doctor-test-'));
}

describe('doctor', () => {
  let tmpDir, configDir, claudeDir, settingsPath;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    configDir = path.join(tmpDir, '.config', 'claudebar');
    claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });
    settingsPath = path.join(claudeDir, 'settings.json');
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('fails when statusline.sh is missing', async () => {
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'statusline.sh');
    assert.equal(check.pass, false);
  });

  it('passes when statusline.sh exists', async () => {
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), '#!/usr/bin/env bash');
    fs.writeFileSync(settingsPath, '{}');
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'statusline.sh');
    assert.equal(check.pass, true);
  });

  it('detects correct settings.json pointer', async () => {
    fs.writeFileSync(path.join(configDir, 'statusline.sh'), '');
    fs.writeFileSync(path.join(configDir, 'config.toml'), '');
    fs.writeFileSync(path.join(configDir, 'config.sh'), '');
    fs.writeFileSync(path.join(configDir, '.version'), '1.0.0');
    fs.writeFileSync(settingsPath, JSON.stringify({
      statusLine: { command: '~/.config/claudebar/statusline.sh' },
    }));
    const { results } = await doctor({ configDir, settingsPath, log: () => {} });
    const check = results.find(r => r.name === 'settings.json');
    assert.equal(check.pass, true);
  });
});
