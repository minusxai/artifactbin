/**
 * THE TYPED REQUEST SEAM (testmig-3), seeded RED by the orchestrator. One builder for what a route test sends —
 * bearer, proxy-attached actor, cookie, origin — so the identity/CSRF distinctions the 65 local builders encode
 * survive the rollout: a bearer is not an actor, a cookie is not a session, and naming two credentials at once is
 * refused rather than silently merged.
 */
import { describe, expect, it } from 'vitest';
import {PUBLIC_BASE_URL} from '@/lib/config';
import { GET as listArtifacts } from '@/app/api/artifacts/route';
import { POST as reject } from '@/app/api/tokens/reject/route';
import { AGENT_COOKIE, decodeAgentSession } from '@/lib/agent-session';
import { mintToken } from '@/lib/tokens';
import { agentCookie, cookieValue, request, useAppHarness } from './harness';

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
    const r = request('/api/artifacts', { actor: { credential: 'bearer', tokenId: t.id } });
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
    expect(same.headers.get('origin')).toBe(new URL(PUBLIC_BASE_URL).origin);
    expect(request('/api/x', { origin: 'https://evil.example' }).headers.get('origin')).toBe('https://evil.example');
  });
  it('adds browser proof only when explicitly requested and preserves hostile origin overrides',()=>{
    expect(request('/api/x',{method:'POST'}).headers.get('x-artifactbin-csrf')).toBeNull();
    const browser=request('/api/x',{method:'POST',browser:true});
    expect(browser.headers.get('origin')).toBe(new URL(PUBLIC_BASE_URL).origin);
    expect(browser.headers.get('x-artifactbin-csrf')).toBe('1');
    expect(request('/api/x',{browser:true,origin:'null'}).headers.get('origin')).toBe('null');
  });
  it('refuses a bearer AND an actor in one request — two credentials is a test bug', async () => {
    const t = await mintToken('t');
    expect(() => request('/api/x', { token: t.token, actor: { credential: 'bearer', tokenId: t.id } })).toThrow(/one credential/i);
  });
});

describe('agentCookie() and cookieValue()', () => {
  it('the cookie header round-trips through the app\'s own decoder', async () => {
    const header = await agentCookie(['tok_a', 'tok_b']);
    expect(header.startsWith(`${AGENT_COOKIE}=`)).toBe(true);
    expect(await decodeAgentSession(header.slice(AGENT_COOKIE.length + 1))).toEqual({ tokenIds: ['tok_a', 'tok_b'], sessionId:expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  });
  it('reads a rewritten cookie and recognises a cleared one', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const res = await reject(request('/api/tokens/reject', { browser: true, method: 'POST', json: { tokenId: a.id }, cookie: await agentCookie([a.id, b.id]) }));
    expect(res.status).toBe(204);
    const rewritten = cookieValue(res);
    expect(rewritten.cleared).toBe(false);
    expect(await decodeAgentSession(rewritten.value)).toEqual({ tokenIds: [b.id], sessionId:expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const last = await reject(request('/api/tokens/reject', { browser: true, method: 'POST', json: { tokenId: b.id }, cookie: rewritten.value ? `${AGENT_COOKIE}=${rewritten.value}` : '' }));
    expect(cookieValue(last).cleared).toBe(true);
    expect(cookieValue(new Response(null)).value).toBeNull();
  });
});
