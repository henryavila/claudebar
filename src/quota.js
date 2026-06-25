// claudebar GLM quota fetch + cache.
//
// Polls the Z.ai monitor API for the GLM Coding Plan 5-hour token quota and
// caches the percentage, so the statusline can read it without a network call
// on every render. The fetcher runs detached — spawned by statusline.sh when
// the cache is stale — NOT on a timer and NOT from the OS daemon: the
// statusline (the only consumer) only runs inside Claude Code, so "the user is
// on GLM" and "the app is open" are both implied by a render. A background
// poller would hammer the API every 5 min with the terminal closed for no
// benefit — see the ad-hoc decision (Option C) in PROJECT-STATUS.md.
//
// API contract (reverse-engineered from the official plugin zai-org/
// zai-coding-plugins → plugins/glm-plan-usage/.../query-usage.mjs):
//   GET {host}/api/monitor/usage/quota/limit   (host from ANTHROPIC_BASE_URL)
//   Authorization: <ANTHROPIC_AUTH_TOKEN>      (RAW value — NO "Bearer " prefix)
//   → { data: { limits: [ { type: "TOKENS_LIMIT", percentage: <5h %> }, … ] } }
//
// Every impure dependency (fetch, fs, clock, env) is injectable, so the whole
// module is unit-testable without the network or a real home dir — same
// pattern as src/daemon.js. Everything is best-effort: a quota hiccup must
// never surface to the user; the bar just keeps the stale cache.
import fs from 'node:fs';
import path from 'node:path';

export const GLM_HOSTS = ['api.z.ai', 'open.bigmodel.cn', 'dev.bigmodel.cn'];
export const QUOTA_PATH = '/api/monitor/usage/quota/limit';
export const CACHE_FILENAME = 'quota-cache.json';
export const DEFAULT_TTL_MINUTES = 5;
export const MIN_TTL_MINUTES = 1;

// --- pure helpers -----------------------------------------------------------

// True when the inherited Claude Code env looks like a GLM Coding Plan setup:
// a GLM host in ANTHROPIC_BASE_URL AND a token present. The cheap gate that
// keeps non-GLM users from ever fetching (or even spawning the fetcher).
export function detectGlm(env = process.env) {
  const base = env.ANTHROPIC_BASE_URL || '';
  const token = env.ANTHROPIC_AUTH_TOKEN || '';
  if (!token) return false;
  return GLM_HOSTS.some((h) => base.includes(h));
}

// Derive the monitor URL from ANTHROPIC_BASE_URL (host only — the /api/anthropic
// path is dropped, the monitor path is appended). null on a missing/bad base.
export function quotaEndpoint(baseUrl) {
  if (!baseUrl) return null;
  try {
    const u = new URL(baseUrl);
    return `${u.protocol}//${u.host}${QUOTA_PATH}`;
  } catch {
    return null;
  }
}

// Pull the 5-hour token-quota percentage out of the monitor response.
// Best-effort: any shape mismatch → null (caller keeps the stale cache).
export function parseQuota(json) {
  const limits = json?.data?.limits;
  if (!Array.isArray(limits)) return null;
  const tokens = limits.find((l) => l && l.type === 'TOKENS_LIMIT');
  const pct = tokens?.percentage;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  return { fiveHourPct: Math.max(0, Math.min(100, pct)) };
}

// Clamp a user-configured TTL to the documented floor (1 min). Default 5.
export function clampTtl(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n)) return DEFAULT_TTL_MINUTES;
  if (n < MIN_TTL_MINUTES) return MIN_TTL_MINUTES;
  return Math.floor(n);
}

// Is a cached fetchedAt (epoch ms) stale given a TTL (minutes) and now (ms)?
// A missing/non-numeric fetchedAt is always stale.
export function isStale(fetchedAtMs, ttlMinutes, nowMs) {
  if (typeof fetchedAtMs !== 'number' || !Number.isFinite(fetchedAtMs)) return true;
  const ttlMs = clampTtl(ttlMinutes) * 60_000;
  return nowMs - fetchedAtMs >= ttlMs;
}

// --- cache I/O (fs injectable) ----------------------------------------------

// Read + parse the cache. Missing file / bad JSON → null. Otherwise a stable
// shape with null fields when the cached value is unusable.
export function readCache(cachePath, deps = {}) {
  const f = deps.fs ?? fs;
  try {
    const json = JSON.parse(f.readFileSync(cachePath, 'utf8'));
    return {
      fiveHourPct: typeof json.fiveHourPct === 'number' ? json.fiveHourPct : null,
      fetchedAt: typeof json.fetchedAt === 'number' ? json.fetchedAt : null,
    };
  } catch {
    return null;
  }
}

export function writeCache(cachePath, data, deps = {}) {
  const f = deps.fs ?? fs;
  try {
    f.mkdirSync(path.dirname(cachePath), { recursive: true });
    f.writeFileSync(cachePath, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

// --- fetch (network injectable) ---------------------------------------------

// Hit the monitor endpoint, return the parsed quota or null on any failure.
// `fetch` is injectable: tests pass a stub; production uses global fetch.
export async function fetchQuota({ env = process.env, fetch: _fetch = globalThis.fetch } = {}) {
  const endpoint = quotaEndpoint(env.ANTHROPIC_BASE_URL || '');
  if (!endpoint || typeof _fetch !== 'function') return null;
  try {
    const res = await _fetch(endpoint, {
      method: 'GET',
      headers: {
        // RAW token — the official plugin sends ANTHROPIC_AUTH_TOKEN verbatim,
        // with NO "Bearer " prefix. Adding one returns HTTP 401.
        Authorization: env.ANTHROPIC_AUTH_TOKEN || '',
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    return parseQuota(await res.json());
  } catch {
    return null;
  }
}

// --- top-level refresh (what the detached entry calls) ----------------------

// Fetch fresh quota and write it to the cache. Best-effort end to end: any
// failure is swallowed and reported as { ok:false } — a refresh runs detached
// and the bar keeps rendering from the stale cache, so it must never throw.
export async function refreshQuota({ env = process.env, cachePath, fetch: _fetch, fs: _fs = fs, now = Date.now } = {}) {
  if (!detectGlm(env)) return { ok: false, reason: 'not-glm' };
  const parsed = await fetchQuota({ env, fetch: _fetch });
  if (!parsed) return { ok: false, reason: 'fetch-failed' };
  const data = { ...parsed, fetchedAt: now() };
  writeCache(cachePath, data, { fs: _fs });
  return { ok: true, data };
}
