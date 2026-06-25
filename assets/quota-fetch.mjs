#!/usr/bin/env node
// claudebar GLM quota refresh — spawned DETACHED by statusline.sh when the
// quota cache is stale. Polls the Z.ai monitor API for the 5-hour token quota
// and writes the percentage to quota-cache.json (a sibling of this file). The
// statusline reads that cache on the NEXT render — this process never blocks a
// render and never prints (its stdout/stderr are discarded by the spawner).
//
// Deliberately silent and best-effort, exactly like ensure-statusline.mjs:
//   - prints NOTHING to stdout
//   - never exits non-zero (a detached refresh failure must never surface)
//   - only writes when a usable percentage actually came back
//
// Runs only when the env is a GLM Coding Plan setup (refreshQuota gates on
// detectGlm); non-GLM renders never spawn this at all. Imports ./quota.js,
// which install/update copy alongside this file into ~/.config/claudebar/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_FILENAME, refreshQuota } from './quota.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cachePath = path.join(__dirname, CACHE_FILENAME);

try {
  await refreshQuota({ cachePath });
} catch {
  // Swallow everything — a detached quota refresh must never break anything.
}

process.exit(0);
