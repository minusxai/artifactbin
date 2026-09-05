/**
 * The anonymous-mint valve is the PROXY's, and the app's mint endpoints carry
 * no count of their own (P2 §H: a door is enforced in exactly one place — a
 * second count in the same process halves the configured ceiling).
 *
 * `__tests__/client-ip.test.ts` pins the trusted-hop selection the proxy uses
 * to key the limit, and the proxy's own suite pins that the `anon_mint` routes
 * fire on these paths; what THIS file pins is the app half of the split — the
 * handler serves the mint, forged `X-Forwarded-For` or not, and never refuses
 * on a budget of its own. (The engine rules the old valve tests encoded —
 * max/window/per-IP, a forged head buying nothing — are pinned in
 * services/utils/__tests__/rate-limits.test.ts, where the limits live now.)
 */
import { describe, expect, it } from 'vitest';
import { POST as mintAnonymous } from '@/app/api/tokens/anonymous/route';
import { POST as startDocument } from '@/app/api/start/route';

import { loadPolicyFile, resolvePolicyFilePath } from '@artifactbin/proxy';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();


const BASE = 'http://localhost:3000';

/** A request whose forwarded chain the CALLER wrote the head of. */
const forwardedRequest = (path: string, forwardedFor: string) =>
  request(path, { method: 'POST', headers: { 'x-forwarded-for': forwardedFor }, json: {} });

/** What the proxy appends — the same real client throughout every test here. */
const REAL = '203.0.113.7';

/** The mint ceiling, read from THE POLICY FILE this suite points at — the app holds no such number. */
const MINT_MAX = loadPolicyFile(resolvePolicyFilePath(process.env)).policies.anon_mint!.max;

describe('the app counts no mint valve of its own — the proxy\'s anon_mint policy is the only count', () => {
  it('POST /api/tokens/anonymous serves every mint, a forged head changing nothing here', async () => {
    // A forged head used to be the way to buy a fresh budget; on the app side
    // there is no budget to buy, so the same spoof-each-call flood is served
    // in-process and the proxy in front does the refusing.
    for (let i = 0; i < MINT_MAX + 2; i++) {
      const res = await mintAnonymous(forwardedRequest('/api/tokens/anonymous', `spoof-${i}, ${REAL}`));
      expect(res.status, `mint ${i + 1}`).toBe(201);
    }
  });

  it('an empty / whitespace-only forged head is served the same', async () => {
    for (let i = 0; i < MINT_MAX + 1; i++) {
      const res = await mintAnonymous(forwardedRequest('/api/tokens/anonymous', `   ,  ${REAL}`));
      expect(res.status).toBe(201);
    }
  });

  it('a caller who sends NO forwarded header is served the same', async () => {
    for (let i = 0; i < MINT_MAX + 1; i++) {
      const res = await mintAnonymous(forwardedRequest('/api/tokens/anonymous', REAL));
      expect(res.status).toBe(201);
    }
  });
});

describe('POST /api/start — no app-side door here either', () => {
  it('serves every start, a forged head changing nothing, the proxy counting the door', async () => {
    for (let i = 0; i < MINT_MAX + 2; i++) {
      const res = await startDocument(forwardedRequest('/api/start', `spoof-${i}, ${REAL}`));
      expect(res.status, `start ${i + 1}`).toBe(201);
    }
  });
});

describe('mints are genuinely served, not merely un-refused', () => {
  it('answers a real shown-once token', async () => {
    const res = await mintAnonymous(forwardedRequest('/api/tokens/anonymous', `spoof, ${REAL}`));
    expect(res.status).toBe(201);
    expect((await res.json()).token).toMatch(/^mx_/);
  });
});
