/**
 * THE APP COUNTS NO MINT LIMIT (P2 §H).
 *
 * This file used to pin the app-side ANON_MINT valve: a credential RAISED the
 * ceiling on the same per-IP bucket rather than removing it — a holder got
 * MAX×BURST, a stranger MAX, one shared bucket. That rule is still the
 * product's, and it is still pinned — where the limit lives now:
 * `services/utils/__tests__/rate-limits.test.ts` ("BURST raises the ceiling for
 * a holder on the SAME bucket") pins the engine, and the `anon_mint` routes for
 * `/api/start` and `/api/tokens/anonymous` are the proxy's own suite.
 *
 * What THIS file pins is the app half of the split: the handlers serve the
 * mint and never refuse on a budget of their own — because a second count in
 * the same co-hosted process halves the configured ceiling (the live bug §H
 * found: a stranger's effective cap was 5 against an env that said 10).
 */
import { describe, expect, it } from 'vitest';
import { loadPolicyFile, resolvePolicyFilePath } from '@artifactbin/proxy';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as anonymousMint } from '@/app/api/tokens/anonymous/route';
import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

/**
 * Past BOTH the stranger cap and the holder ceiling (max×burst, burst ≥ 2), read from THE POLICY FILE this
 * suite points at — there is no ceiling anywhere else to read, and no multiplier to keep in step by hand.
 */
const mintPolicy = loadPolicyFile(resolvePolicyFilePath(process.env)).policies.anon_mint!;
const PAST_EVERY_CAP = mintPolicy.max * mintPolicy.burst + 2;
const IP = '203.0.113.42';
/** The limiter reads the address the outermost trusted proxy saw — the LAST hop. */
const mint = (extra: Record<string, string> = {}) => new Request('http://localhost:3000/api/tokens/anonymous', {
  method: 'POST',
  headers: { 'x-forwarded-for': `client, ${IP}`, ...extra },
});
const start = (token?: string) => startRoute(new Request('http://localhost:3000/api/start', {
  method: 'POST',
  headers: { 'x-forwarded-for': `client, ${IP}`, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
}));

describe('the app\'s mint handlers carry no door of their own', () => {
  it('POST /api/tokens/anonymous serves a stranger past every cap — the proxy\'s anon_mint policy is the only count', async () => {
    for (let i = 0; i < PAST_EVERY_CAP; i++) {
      const res = await anonymousMint(mint());
      expect(res.status, `mint ${i + 1} of ${PAST_EVERY_CAP}`).toBe(201);
    }
  });

  it('POST /api/start serves a stranger past every cap, in-process', async () => {
    for (let i = 0; i < PAST_EVERY_CAP; i++) {
      const res = await start();
      expect(res.status, `start ${i + 1} of ${PAST_EVERY_CAP}`).toBe(201);
    }
  });

  it('a BEARER is served past every cap too — no app-side holder logic to get wrong', async () => {
    // The old hole this file guarded was app-side holder arithmetic; with the
    // count gone from the app there is no arithmetic left to get wrong here.
    const t = await mintToken('gate');
    for (let i = 0; i < PAST_EVERY_CAP; i++) {
      const res = await start(t.token);
      expect(res.status, `bearer start ${i + 1} of ${PAST_EVERY_CAP}`).toBe(201);
    }
  });
});
