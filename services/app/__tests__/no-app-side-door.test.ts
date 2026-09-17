import { describe, expect, it } from 'vitest';
import { POST as internalMint } from '@/app/api/internal/tokens/route';
import { POST as startDocument } from '@/app/api/start/route';
import { mintToken } from '@/lib/tokens';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();

// Repeated requests remain independent of caller-supplied forwarding headers.
const REPEATED_REQUESTS = 12;

const REAL = '203.0.113.7';

const viaDoor = (path: string, forwardedFor: string, token?: string) =>
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

describe("artifact handlers accept repeated requests without a request-rate policy", () => {
  it.each(DOORS)('%s serves repeated requests', async (label, handler, path, head, bearer) => {
    const token = bearer ? (await mintToken('no-app-side-door')).token : undefined;
    for (let i = 0; i < REPEATED_REQUESTS; i++) {
      const response = await handler(viaDoor(path, head(i), token));
      expect(response.status, `${label}: call ${i + 1} of ${REPEATED_REQUESTS}`).toBe(201);
    }
  });

  it('mints are genuinely served, not merely un-refused', async () => {
    const response = await internalMint(viaDoor('/api/internal/tokens', `spoof, ${REAL}`));
    expect(response.status).toBe(201);
    expect((await response.json()).token).toMatch(/^mx_/);
  });
});
