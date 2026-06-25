#!/usr/bin/env bash
# Unit test for the GLM quota gate + cache read (Option C).
#   _glm_active — env gate (only fires on a GLM Coding Plan setup).
#   glm_quota   — read the cached 5h %; spawn a detached refresh when stale.
# The spawn is exercised only via its guards (fetcher absent → no spawn, no
# lock), so this stays hermetic with zero network.
set -uo pipefail
script="$(cd "$(dirname "$0")/../.." && pwd)/statusline.sh"
source "$script"

fail=0
ok()  { echo "  ok: $1"; }
bad() { echo "  FAIL: $1"; fail=1; }

# Frozen clock so the freshness math is deterministic. now_ms = 1830000000000.
export CLAUDEBAR_NOW_FOR_TESTING=1830000000
NOPE="/nonexistent/quota-fetch.mjs"   # absent → spawn guard blocks; no network

# ── _glm_active gate ──────────────────────────────────────────────────
( ANTHROPIC_AUTH_TOKEN=tok ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic _glm_active ) \
  && ok "_glm_active: z.ai + token → active" || bad "_glm_active: z.ai + token should be active"
( ANTHROPIC_AUTH_TOKEN=tok ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic _glm_active ) \
  && ok "_glm_active: bigmodel → active" || bad "_glm_active: bigmodel should be active"

# Strip any inherited Claude Code creds so the negative cases are deterministic.
( unset ANTHROPIC_AUTH_TOKEN; ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic _glm_active ) \
  && bad "_glm_active: no token should be inactive" || ok "_glm_active: missing token → inactive"
( ANTHROPIC_AUTH_TOKEN=tok ANTHROPIC_BASE_URL=https://api.anthropic.com _glm_active ) \
  && bad "_glm_active: non-GLM host should be inactive" || ok "_glm_active: anthropic.com host → inactive"

# Master switch off — needs a FRESH bash process: `readonly` is inherited by
# subshells, so flipping QUOTA_ENABLED must happen before the first source.
bash -c 'export QUOTA_ENABLED=0; source "$1" >/dev/null 2>&1; ANTHROPIC_AUTH_TOKEN=tok ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic _glm_active' _ "$script" \
  && bad "_glm_active: disabled should be inactive" || ok "_glm_active: QUOTA_ENABLED=0 → inactive"

# ── glm_quota cache read ──────────────────────────────────────────────
tmp=$(mktemp -d)

# Fresh cache (1 min old, TTL 5) → returns pct, must NOT spawn.
printf '{"fiveHourPct":42,"fetchedAt":1829999940000}' > "$tmp/fresh.json"
got=$(glm_quota "$tmp/fresh.json" "$NOPE" 5)
[[ "$got" == "42" ]] && ok "glm_quota: fresh cache returns pct (42)" || bad "glm_quota: fresh expected 42 got '$got'"

# Stale cache (10 min old, TTL 5) → still returns pct; spawn is guard-blocked.
printf '{"fiveHourPct":77,"fetchedAt":1829999400000}' > "$tmp/stale.json"
got=$(glm_quota "$tmp/stale.json" "$NOPE" 5)
[[ "$got" == "77" ]] && ok "glm_quota: stale cache still returns pct (77), spawn guarded" || bad "glm_quota: stale expected 77 got '$got'"

# Missing cache → empty, and the whole block (incl. spawn) is skipped.
got=$(glm_quota "$tmp/missing.json" "$NOPE" 5)
[[ -z "$got" ]] && ok "glm_quota: missing cache → empty" || bad "glm_quota: missing expected empty got '$got'"

# Null pct in cache → empty.
printf '{"fiveHourPct":null,"fetchedAt":1829999940000}' > "$tmp/null.json"
got=$(glm_quota "$tmp/null.json" "$NOPE" 5)
[[ -z "$got" ]] && ok "glm_quota: null pct → empty" || bad "glm_quota: null pct expected empty got '$got'"

# No lock must be written when the fetcher is absent (spawn guard held).
[[ ! -f "$tmp/stale.json.lock" ]] && ok "glm_quota: no lock written when fetcher absent" || bad "glm_quota: lock written despite absent fetcher"

# Bootstrap: a cache-MISS with a real (dummy) fetcher MUST spawn it — this is
# how a fresh install ever gets a cache. The dummy writes a marker file so we
# can observe the backgrounded child actually ran.
dummy="$tmp/fetcher.mjs"
printf 'import fs from"node:fs";try{fs.writeFileSync(process.env.MARKER,"ran")}catch{}' > "$dummy"
marker="$tmp/marker"
export MARKER="$marker"
glm_quota "$tmp/brand-new-no-cache.json" "$dummy" 5 >/dev/null
sleep 1
[[ -f "$marker" ]] && ok "glm_quota: cache-miss spawns the fetcher (bootstrap)" || bad "glm_quota: cache-miss did not spawn the fetcher"
unset MARKER

rm -rf "$tmp"

if (( fail == 0 )); then
  echo "PASS: quota"
  exit 0
else
  echo "FAIL: quota"
  exit 1
fi
