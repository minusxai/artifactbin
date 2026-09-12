/**
 * The valve is the PROXY's, and the app's endpoints carry no count of their
 * own (P2 §H: a door is enforced in exactly one place — a second count in the
 * same process halves the configured ceiling).
 *
 * `__tests__/client-ip.test.ts` pins the trusted-hop selection the proxy uses
 * to key the limit, and the proxy's own suite pins that the `start_doc` route
 * fires on `/api/start`; what THIS file pins is the app half of the split —
 * the handler serves the request, forged `X-Forwarded-For` or not, and never
 * refuses on a budget of its own. (The engine rules the old valve tests encoded —
 * max/window/per-IP, a forged head buying nothing — are pinned in
 * services/utils/__tests__/rate-limits.test.ts, where the limits live now.)
 */
import { describe, expect, it } from 'vitest';
import { POST as internalMint } from '@/app/api/internal/tokens/route';
import { POST as startDocument } from '@/app/api/start/route';

import { loadPolicyFile, resolvePolicyFilePath } from '@artifactbin/proxy';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();



/** A request whose forwarded chain the CALLER wrote the head of. */
const forwardedRequest = (path: string, forwardedFor: string) =>
  request(path, { method: 'POST', headers: { 'x-forwarded-for': forwardedFor }, json: {} });

/** What the proxy appends — the same real client throughout every test here. */
const REAL = '203.0.113.7';

/** The start ceiling, read from THE POLICY FILE this suite points at — the app holds no such number. */
const START_MAX = loadPolicyFile(resolvePolicyFilePath(process.env)).policies.start_doc!.max;

describe('the app counts no valve of its own — the proxy\'s start_doc policy is the only count', () => {
  it('the internal mint serves every call, a forged head changing nothing here', async () => {
    // A forged head used to be the way to buy a fresh budget; on the app side
    // there is no budget to buy, so the same spoof-each-call flood is served
    // in-process and the proxy in front does the refusing.
    for (let i = 0; i < START_MAX + 2; i++) {
      const res = await internalMint(forwardedRequest('/api/internal/tokens', `spoof-${i}, ${REAL}`));
      expect(res.status, `mint ${i + 1}`).toBe(201);
    }
  });

  it('an empty / whitespace-only forged head is served the same', async () => {
    for (let i = 0; i < START_MAX + 1; i++) {
      const res = await internalMint(forwardedRequest('/api/internal/tokens', `   ,  ${REAL}`));
      expect(res.status).toBe(201);
    }
  });

  it('a caller who sends NO forwarded header is served the same', async () => {
    for (let i = 0; i < START_MAX + 1; i++) {
      const res = await internalMint(forwardedRequest('/api/internal/tokens', REAL));
      expect(res.status).toBe(201);
    }
  });
});

describe('POST /api/start — no app-side door here either', () => {
  it('serves every start, a forged head changing nothing, the proxy counting the door', async () => {
    for (let i = 0; i < START_MAX + 2; i++) {
      const res = await startDocument(forwardedRequest('/api/start', `spoof-${i}, ${REAL}`));
      expect(res.status, `start ${i + 1}`).toBe(201);
    }
  });
});

describe('mints are genuinely served, not merely un-refused', () => {
  it('answers a real shown-once token', async () => {
    const res = await internalMint(forwardedRequest('/api/internal/tokens', `spoof, ${REAL}`));
    expect(res.status).toBe(201);
    expect((await res.json()).token).toMatch(/^mx_/);
  });
});
