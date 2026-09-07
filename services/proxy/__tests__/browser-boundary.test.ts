import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { actorOf, inProcess } from '@artifactbin/utils';
import { createProxy, type ProxyOptions } from '../src/parts';
import { mintTestToken, testDb, testProxyOptions } from './helpers';

const main = 'https://example.test', controls = 'https://i.example.test';
let options: ProxyOptions, bearer: string;
beforeAll(async () => {
  const upstream = new Hono();
  upstream.all('*', c => c.json(actorOf(c.req.raw)));
  options = await testProxyOptions({ upstream: inProcess(upstream),
    sessions: { resolve: async () => ({ userId: 'full' }), resolveRead: async () => ({ userId: 'reader' }) } });
  options.env = { ...options.env, APP__PUBLIC_BASE_URL: main, APP__CONTROLS_ORIGIN: controls };
  bearer = await mintTestToken({ id: 'boundary-token', userId: 'agent', pg: testDb().pg() });
});
const call = (host: string, path: string, method = 'GET', headers: Record<string, string> = {}) =>
  createProxy(options).request(`${host}${path}`, { method, headers });
const trusted = { origin: controls, 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' };
describe('the composed proxy browser boundary', () => {
  it('resolves only read authority on main artifact reads, never ambient account authority', async () => {
    expect(await (await call(main, '/a/abc123')).json()).toEqual({ credential: 'read-session', userId: 'reader' });
    expect(await (await call(main, '/a/abc123/assets?kind=script&u=https://cdn.example/bundle.js')).json()).toEqual({ credential: 'read-session', userId: 'reader' });
    expect(await (await call(main, '/')).json()).toEqual({ credential: 'none' });
    expect(await (await call(main, '/api/artifacts')).json()).toEqual({ credential: 'none' });
    expect(await (await call(main, '/api/page/session')).json()).toEqual({ credential: 'none' });
    expect(await (await call(main, '/api/page/home')).json()).toEqual({ credential: 'none' });
    expect(await (await call(main, '/a/abc123/query', 'POST')).json()).toEqual({ credential: 'read-session', userId: 'reader' });
  });
  it.each(['/api/my/artifacts', '/api/page/artifact/abc123', '/api/auth/get-session', '/api/session/token', '/a/abc123/mutate'])(
    'denies main-host browser account endpoint %s', async path => {
      expect((await call(main, path, path.endsWith('mutate') ? 'POST' : 'GET')).status).toBe(403);
      expect((await call(main, path, 'POST')).status).toBe(403);
    });
  it('allows trusted APIs only with a protected header and trusted browser origin', async () => {
    expect(await (await call(controls, '/api/my/artifacts', 'POST', trusted)).json()).toEqual({ credential: 'session', userId: 'full' });
    const attacks: Record<string, string>[] = [{}, { origin: controls }, { ...trusted, origin: main }, { ...trusted, origin: 'null' },
      { ...trusted, origin: 'https://evil.example.test' }, { 'x-artifactbin-csrf': '1' }];
    for (const headers of attacks) {
      expect((await call(controls, '/api/my/artifacts', 'POST', headers)).status).toBe(403);
    }
    expect((await call(controls, '/api/my/artifacts', 'GET', {})).status).toBe(403);
    expect((await call(controls, '/api/my/artifacts', 'GET', { 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await call(controls, '/api/my/artifacts', 'OPTIONS', { origin: main, 'access-control-request-headers': 'x-artifactbin-csrf' })).status).toBe(403);
  });
  it('keeps agent bearer requests separate, with no cookie fallback for invalid tokens', async () => {
    expect(await (await call(main, '/api/artifacts', 'POST', { authorization: `Bearer ${bearer}` })).json()).toMatchObject({ credential: 'bearer', userId: 'agent' });
    expect(await (await call(main, '/api/artifacts', 'POST', { authorization: 'Bearer invalid' })).json()).toEqual({ credential: 'none' });
  });
  it('preserves non-token credentials for the separate operator verifier without granting an actor',async()=>{
    const proxy=createProxy({...options,upstream:async(request,actor)=>Response.json({authorization:request.headers.get('authorization'),actor})});
    for(const authorization of ['Bearer invalid','bearer invalid','Bearer']){
      const response=await proxy.request(main+'/api/artifacts',{headers:{authorization}});
      expect(await response.json()).toEqual({authorization,actor:{credential:'none'}});
    }
    const accepted=await proxy.request(main+'/api/artifacts',{headers:{authorization:`bearer ${bearer}`}});
    expect((await accepted.json()).actor.credential).toBe('bearer');
  });
  it('does not forward main-host cookies to legacy app handlers that might decode them independently', async () => {
    const proxy = createProxy({...options, upstream: async (request, actor) => Response.json({cookie: request.headers.get('cookie'), actor})});
    for (const path of ['/api/page/home', '/a/abc123']) {
      const response = await proxy.request(main + path, {headers: {cookie: 'mx-agent-session=old; better-auth.session_token=old; __Secure-mx-read=read'}});
      const body = await response.json();
      expect(body.cookie).toBeNull();
      expect(body.actor.credential).toBe(path.startsWith('/a/') ? 'read-session' : 'none');
    }
    const response = await proxy.request(controls + '/api/page/home', {headers: {...trusted, cookie: 'trusted=kept'}});
    expect((await response.json()).cookie).toBe('trusted=kept');
  });
  it('admits native EventSource only for a same-origin document stream, not account APIs or cross-origin streams', async () => {
    const stream = { accept: 'text/event-stream', 'sec-fetch-site': 'same-origin' };
    expect((await call(controls, '/a/abc123/events', 'GET', stream)).status).toBe(200);
    expect((await call(controls, '/api/my/artifacts', 'GET', stream)).status).toBe(403);
    expect((await call(controls, '/a/abc123/events', 'GET', { ...stream, origin: main, 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await call(controls, '/a/abc123/events', 'GET', { accept: 'text/event-stream' })).status).toBe(403);
  });
  it('rejects unknown hosts and never serves author content on the trusted host', async () => {
    expect((await call('https://evil.example.test', '/')).status).toBe(421);
    for (const path of ['/a/abc123/raw', '/@user/abc123-title', '/assets/' + 'a'.repeat(64)]) {
      expect((await call(controls, path)).status).toBe(404);
    }
  });
  it('makes only the dedicated controls route frameable; account pages are top-level', async () => {
    for (const path of ['/login', '/account', '/tokens/new', '/']) {
      expect((await call(controls, path)).headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    }
    expect((await call(controls, '/controls/a/abc123')).headers.get('content-security-policy')).toContain(`frame-ancestors ${main}`);
  });
});
