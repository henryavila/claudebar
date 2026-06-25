import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  GLM_HOSTS,
  DEFAULT_TTL_MINUTES,
  MIN_TTL_MINUTES,
  detectGlm,
  quotaEndpoint,
  parseQuota,
  clampTtl,
  isStale,
  readCache,
  writeCache,
  fetchQuota,
  refreshQuota,
} from '../../src/quota.js';

// --- detectGlm (pure gate) --------------------------------------------------

describe('quota.detectGlm', () => {
  for (const host of GLM_HOSTS) {
    it(`true for GLM host ${host} + token`, () => {
      assert.equal(detectGlm({ ANTHROPIC_BASE_URL: `https://${host}/api/anthropic`, ANTHROPIC_AUTH_TOKEN: 'k' }), true);
    });
  }
  it('false for a non-GLM host (api.anthropic.com) even with a token', () => {
    assert.equal(detectGlm({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com', ANTHROPIC_AUTH_TOKEN: 'k' }), false);
  });
  it('false when the token is missing even on a GLM host', () => {
    assert.equal(detectGlm({ ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic' }), false);
  });
  it('false on empty env', () => {
    assert.equal(detectGlm({}), false);
  });
});

// --- quotaEndpoint (pure) ---------------------------------------------------

describe('quota.quotaEndpoint', () => {
  it('derives host from ANTHROPIC_BASE_URL and appends the monitor path', () => {
    assert.equal(quotaEndpoint('https://api.z.ai/api/anthropic'), 'https://api.z.ai/api/monitor/usage/quota/limit');
  });
  it('works for the China host too', () => {
    assert.equal(quotaEndpoint('https://open.bigmodel.cn/api/anthropic'), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit');
  });
  it('null on missing input', () => {
    assert.equal(quotaEndpoint(''), null);
    assert.equal(quotaEndpoint(undefined), null);
  });
  it('null on an unparseable URL', () => {
    assert.equal(quotaEndpoint('not a url'), null);
  });
});

// --- parseQuota (pure) ------------------------------------------------------

describe('quota.parseQuota', () => {
  it('pulls the TOKENS_LIMIT percentage (the 5h chip)', () => {
    assert.deepEqual(parseQuota({ data: { limits: [
      { type: 'TOKENS_LIMIT', percentage: 23 },
      { type: 'TIME_LIMIT', percentage: 5, currentValue: 1, usage: 100 },
    ] } }), { fiveHourPct: 23 });
  });
  it('clamps an out-of-range percentage to [0,100]', () => {
    assert.equal(parseQuota({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 150 }] } }).fiveHourPct, 100);
    assert.equal(parseQuota({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: -5 }] } }).fiveHourPct, 0);
  });
  it('null when there is no TOKENS_LIMIT entry', () => {
    assert.equal(parseQuota({ data: { limits: [{ type: 'TIME_LIMIT', percentage: 5 }] } }), null);
  });
  it('null when the percentage is missing/non-numeric', () => {
    assert.equal(parseQuota({ data: { limits: [{ type: 'TOKENS_LIMIT' }] } }), null);
    assert.equal(parseQuota({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 'xx' }] } }), null);
  });
  it('null on any shape mismatch', () => {
    assert.equal(parseQuota(null), null);
    assert.equal(parseQuota({}), null);
    assert.equal(parseQuota({ data: {} }), null);
    assert.equal(parseQuota({ data: { limits: 'nope' } }), null);
  });
});

// --- clampTtl / isStale (pure) ---------------------------------------------

describe('quota.clampTtl', () => {
  it('default 5 min on non-numeric input', () => {
    assert.equal(clampTtl(undefined), DEFAULT_TTL_MINUTES);
    assert.equal(clampTtl('abc'), DEFAULT_TTL_MINUTES);
  });
  it('floors to the minimum (1 min)', () => {
    assert.equal(clampTtl(0), MIN_TTL_MINUTES);
    assert.equal(clampTtl(-3), MIN_TTL_MINUTES);
  });
  it('floors fractional minutes', () => {
    assert.equal(clampTtl(2.9), 2);
  });
  it('passes a sane value through', () => {
    assert.equal(clampTtl(10), 10);
  });
});

describe('quota.isStale', () => {
  const ttl = 5;
  it('fresh (just under TTL) → false', () => {
    const now = 1_000_000;
    assert.equal(isStale(now - (5 * 60_000 - 1), ttl, now), false);
  });
  it('at/over TTL → true', () => {
    const now = 1_000_000;
    assert.equal(isStale(now - 5 * 60_000, ttl, now), true);
  });
  it('missing fetchedAt → true', () => {
    assert.equal(isStale(undefined, ttl, 1_000_000), true);
    assert.equal(isStale(NaN, ttl, 1_000_000), true);
  });
});

// --- cache I/O (real fs on a temp dir) -------------------------------------

describe('quota cache read/write', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-quota-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('round-trips a written cache', () => {
    const cache = path.join(dir, 'quota-cache.json');
    writeCache(cache, { fiveHourPct: 42, fetchedAt: 123 });
    assert.deepEqual(readCache(cache), { fiveHourPct: 42, fetchedAt: 123 });
  });

  it('readCache returns null when the file is missing', () => {
    assert.equal(readCache(path.join(dir, 'nope.json')), null);
  });

  it('readCache returns null on corrupt JSON', () => {
    const cache = path.join(dir, 'quota-cache.json');
    fs.writeFileSync(cache, '{ not json');
    assert.equal(readCache(cache), null);
  });

  it('writeCache creates the parent dir if missing', () => {
    const cache = path.join(dir, 'nested', 'deep', 'quota-cache.json');
    assert.equal(writeCache(cache, { fiveHourPct: 7, fetchedAt: 1 }), true);
    assert.equal(readCache(cache).fiveHourPct, 7);
  });
});

// --- fetchQuota (injected fetch) -------------------------------------------

describe('quota.fetchQuota', () => {
  const glmEnv = { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'tok' };

  it('GETs the monitor endpoint with the RAW token (no Bearer) and parses', async () => {
    let captured;
    const fetch = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, json: async () => ({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 31 }] } }) };
    };
    const out = await fetchQuota({ env: glmEnv, fetch });
    assert.equal(captured.url, 'https://api.z.ai/api/monitor/usage/quota/limit');
    assert.equal(captured.opts.method, 'GET');
    assert.equal(captured.opts.headers.Authorization, 'tok', 'raw token, no Bearer prefix');
    assert.deepEqual(out, { fiveHourPct: 31 });
  });

  it('null on a non-OK response', async () => {
    const fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    assert.equal(await fetchQuota({ env: glmEnv, fetch }), null);
  });

  it('null when fetch throws', async () => {
    const fetch = async () => { throw new Error('network down'); };
    assert.equal(await fetchQuota({ env: glmEnv, fetch }), null);
  });

  it('null when the body has no TOKENS_LIMIT', async () => {
    const fetch = async () => ({ ok: true, json: async () => ({ data: { limits: [] } }) });
    assert.equal(await fetchQuota({ env: glmEnv, fetch }), null);
  });
});

// --- refreshQuota (ties it together) ---------------------------------------

describe('quota.refreshQuota', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claudebar-quota-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('skips with reason:not-glm on a non-GLM env and writes nothing', async () => {
    const cache = path.join(dir, 'quota-cache.json');
    const res = await refreshQuota({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, cachePath: cache });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not-glm');
    assert.ok(!fs.existsSync(cache), 'no cache written');
  });

  it('fetches, stamps fetchedAt=now(), and writes the cache', async () => {
    const cache = path.join(dir, 'quota-cache.json');
    const fetch = async () => ({ ok: true, json: async () => ({ data: { limits: [{ type: 'TOKENS_LIMIT', percentage: 17 }] } }) });
    const res = await refreshQuota({
      env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 't' },
      cachePath: cache, fetch, now: () => 999,
    });
    assert.equal(res.ok, true);
    assert.equal(res.data.fetchedAt, 999);
    assert.deepEqual(readCache(cache), { fiveHourPct: 17, fetchedAt: 999 });
  });

  it('reports fetch-failed and writes nothing when the API errors', async () => {
    const cache = path.join(dir, 'quota-cache.json');
    const res = await refreshQuota({
      env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/anthropic', ANTHROPIC_AUTH_TOKEN: 't' },
      cachePath: cache, fetch: async () => ({ ok: false, json: async () => ({}) }),
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'fetch-failed');
    assert.ok(!fs.existsSync(cache));
  });
});
