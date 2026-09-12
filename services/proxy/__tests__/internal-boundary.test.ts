/**
 * THE INTERNAL SURFACE IS NOT REACHABLE FROM OUTSIDE.
 *
 * The mint moved behind `/api/internal/tokens` when the public anonymous door
 * was deleted: the CLI's device approval is the only way a credential is
 * issued, and the proxy is the only caller of the route that issues it. This
 * pins both halves — the prefix is a 404 for every client no matter what it
 * sends, and the proxy's OWN call (made on the upstream seam, never through
 * the parts) still reaches the app.
 */
import { describe, it, expect } from 'vitest';
import { assemble } from '@artifactbin/utils';
import { INTERNAL_MINT_PATH } from '@artifactbin/contracts';
import { proxyParts } from '../src/parts';
import { mintTestToken, resetTestDb, testDb, RELAXED_POLICY_FILE, testProxyOptions } from './helpers';

const BROWSER = { 'content-type': 'application/json', origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

const proxyFor = async (upstream?: (req: Request) => Promise<Response>) =>
  assemble(await proxyParts(await testProxyOptions({
    env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE },
    ...(upstream ? { upstream } : {}),
  })));

describe('/api/internal/* at the edge', () => {
  it('answers a uniform 404 and never reaches the app', async () => {
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{"token":"mx_x"}', { status: 201 }); });
    const res = await proxy.fetch(new Request(`http://localhost${INTERNAL_MINT_PATH}`, { method: 'POST' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
    expect(reached).toBe(false);
  });

  it('refuses the product\'s own page too — this is not a browser check', async () => {
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{}', { status: 201 }); });
    const res = await proxy.fetch(new Request(`http://localhost${INTERNAL_MINT_PATH}`, { method: 'POST', headers: BROWSER }));
    expect(res.status).toBe(404);
    expect(reached).toBe(false);
  });

  it('refuses a holder of a real credential, and every method and depth of the prefix', async () => {
    await resetTestDb();
    const token = await mintTestToken({ id: 'tok_internal', userId: 'user_1', query: testDb().query });
    let reached = false;
    const proxy = await proxyFor(async () => { reached = true; return new Response('{}', { status: 200 }); });
    for (const path of ['/api/internal', '/api/internal/tokens', '/api/internal/tokens/deeper', '/api/internal?x=1']) {
      for (const method of ['GET', 'POST', 'DELETE']) {
        const res = await proxy.fetch(new Request(`http://localhost${path}`, {
          method, headers: { authorization: `Bearer ${token}` },
        }));
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
    expect(reached).toBe(false);
  });

  it('leaves the ordinary API alone — the prefix is the whole rule', async () => {
    let reached = 0;
    const proxy = await proxyFor(async () => { reached += 1; return new Response('{"ok":true}'); });
    // (not /api/start: that one is the page's button, refused 403 to a bare
    // client by the browser-only door — a different rule, tested next door.)
    for (const path of ['/api/artifacts', '/api/tokens', '/api/tokens/claim']) {
      expect((await proxy.fetch(new Request(`http://localhost${path}`, { method: 'POST' }))).status, path).not.toBe(404);
    }
    expect(reached).toBe(3);
  });

  it('the proxy\'s own upstream call is not a client, so the mint still happens', async () => {
    // What routes/oauth `mintFor` does: build the Request and hand it to the
    // upstream directly. It never passes through the parts, which is exactly
    // why the boundary above can be absolute.
    const seen: string[] = [];
    const options = await testProxyOptions({
      env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE },
      upstream: async (request) => { seen.push(new URL(request.url).pathname); return new Response('{"id":"tok_1","token":"mx_x"}', { status: 201 }); },
    });
    assemble(await proxyParts(options));
    const res = await options.upstream(new Request(`http://localhost${INTERNAL_MINT_PATH}`, { method: 'POST' }), { credential: 'none' });
    expect(res.status).toBe(201);
    expect(seen).toEqual([INTERNAL_MINT_PATH]);
  });
});
