/**
 * THE TYPED REQUEST SEAM. One builder for what a route test sends —
 * bearer, proxy-attached actor, cookie, origin — so the identity/CSRF distinctions a hand-written builder
 * blurs stay explicit: a bearer is not an actor, a cookie is not a session, and naming two credentials at once is
 * refused rather than silently merged.
 */
import { describe, expect, it } from 'vitest';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { request, useAppHarness } from './harness';

useAppHarness();

describe('request()', () => {
  it('a bearer rides the Authorization header and reaches the route as that credential', async () => {
    const t = await mintToken('t');
    const r = request('/api/artifacts', { token: t.token });
    expect(r.headers.get('authorization')).toBe(`Bearer ${t.token}`);
    expect((await listArtifacts(r)).status).toBe(200);
  });
  it('an attached actor arrives the way the proxy hands it over — no header, no cookie', async () => {
    const t = await mintToken('t');
    const r = request('/api/artifacts', { actor: { credential: 'bearer', tokenId: t.id, userId: t.userId!, email: t.email!, emailVerified: true } });
    expect(r.headers.get('authorization')).toBeNull();
    expect(r.headers.get('cookie')).toBeNull();
    expect((await listArtifacts(r)).status).toBe(200);
  });
  it('json bodies set the content type; method defaults to GET', () => {
    const r = request('/api/x', { method: 'POST', json: { a: 1 } });
    expect(r.method).toBe('POST');
    expect(r.headers.get('content-type')).toContain('application/json');
    expect(request('/api/x').method).toBe('GET');
  });
  it('origin: "same" is the app\'s own origin; any other string is sent verbatim', () => {
    const same = request('/api/x', { origin: 'same' });
    expect(same.headers.get('origin')).toBe(new URL(same.url).origin);
    expect(request('/api/x', { origin: 'https://evil.example' }).headers.get('origin')).toBe('https://evil.example');
  });
  it('refuses a bearer AND an actor in one request — two credentials is a test bug', async () => {
    const t = await mintToken('t');
    expect(() => request('/api/x', { token: t.token, actor: { credential: 'bearer', tokenId: t.id, userId: t.userId!, email: t.email!, emailVerified: true } })).toThrow(/one credential/i);
  });
});
