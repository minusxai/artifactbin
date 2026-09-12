/**
 * THE APP COUNTS NO DOOR OF ITS OWN (P2 §H) — one loop, not five.
 *
 * A rate limit is enforced in exactly one place: the proxy's policy file decides which budgets a
 * request spends and its limiter counts them BEFORE forwarding. A second count in the same
 * co-hosted process halves the configured ceiling — the live bug §H found, where a stranger's
 * effective cap was 5 against an env that said 10.
 *
 * The app half of that split is one claim: every one of these handlers serves the request past
 * every cap, whatever the caller writes in `X-Forwarded-For`, because there is no budget to spend
 * and so nothing a forged head can buy. It used to be written five times across three files — the
 * same loop-N-times-expecting-201 pattern, ~93 real requests, to prove an absence. It is one
 * parameterised case now.
 *
 * WHAT IS PINNED ELSEWHERE, deliberately:
 *   - that the app makes no limiter call AT ALL — statically, `lib/__tests__/retired-names.test.ts`
 *   - the engine's own rules (max/window/per-IP, BURST raising a holder's ceiling on the SAME
 *     bucket) — `services/utils/__tests__/rate-limits.test.ts`, where the limits live
 *   - the trusted-hop selection that keys the limit — `__tests__/client-ip.test.ts`
 *   - that `start_doc` fires on `/api/start`, and the internal mint's unreachability — the proxy's
 *     own suite
 */
import { describe, expect, it } from 'vitest';
import { loadPolicyFile, resolvePolicyFilePath } from '@artifactbin/proxy';
import { POST as internalMint } from '@/app/api/internal/tokens/route';
import { POST as startDocument } from '@/app/api/start/route';
import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

/**
 * Past BOTH the stranger cap and the holder ceiling (max×burst, burst ≥ 2), read from THE POLICY
 * FILE this suite points at — there is no ceiling anywhere else to read, and no multiplier to keep
 * in step by hand.
 */
const policy = loadPolicyFile(resolvePolicyFilePath(process.env)).policies.start_doc!;
const PAST_EVERY_CAP = policy.max * policy.burst + 2;

/** The limiter reads the address the outermost trusted proxy saw — the LAST hop. */
const REAL = '203.0.113.7';

const call = (path: string, forwardedFor: string, token?: string) =>
  new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': forwardedFor, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

/**
 * Each row is a door the app serves and does not count. `head` is what the CALLER wrote in front of
 * the real client address — a fresh forgery per call used to be the way to buy a new budget.
 */
const DOORS: Array<[label: string, handler: (request: Request) => Promise<Response>, path: string, head: (i: number) => string, bearer?: true]> = [
  ['the internal mint, an honest chain', internalMint, '/api/internal/tokens', () => `client, ${REAL}`],
  ['the internal mint, a fresh forgery per call', internalMint, '/api/internal/tokens', (i) => `spoof-${i}, ${REAL}`],
  ['the internal mint, an empty / whitespace-only forged head', internalMint, '/api/internal/tokens', () => `   ,  ${REAL}`],
  ['the internal mint, no forwarded chain at all', internalMint, '/api/internal/tokens', () => REAL],
  ['POST /api/start for a stranger', startDocument, '/api/start', () => `client, ${REAL}`],
  ['POST /api/start, a fresh forgery per call', startDocument, '/api/start', (i) => `spoof-${i}, ${REAL}`],
  // The old hole this guarded was app-side HOLDER arithmetic; with the count gone from the app
  // there is no arithmetic left to get wrong here.
  ['POST /api/start for a bearer', startDocument, '/api/start', () => `client, ${REAL}`, true],
];

describe("the app counts no valve of its own — the proxy's start_doc policy is the only count", () => {
  it.each(DOORS)('%s is served past every cap', async (label, handler, path, head, bearer) => {
    const token = bearer ? (await mintToken('no-app-side-door')).token : undefined;
    for (let i = 0; i < PAST_EVERY_CAP; i++) {
      const response = await handler(call(path, head(i), token));
      expect(response.status, `${label}: call ${i + 1} of ${PAST_EVERY_CAP}`).toBe(201);
    }
  });

  it('mints are genuinely served, not merely un-refused', async () => {
    const response = await internalMint(call('/api/internal/tokens', `spoof, ${REAL}`));
    expect(response.status).toBe(201);
    expect((await response.json()).token).toMatch(/^mx_/);
  });
});
