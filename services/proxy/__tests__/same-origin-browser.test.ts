import {createAgentBrowserSessions} from '../src/auth/agent-browser-session';
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { actorOf, inProcess, cookieName, encodeAgentSession } from '@artifactbin/utils';
import { createProxy, type ProxyOptions } from '../src/parts';
import { mintTestToken, testDb, testProxyOptions } from './helpers';

const main = 'https://example.test';
let options: ProxyOptions;
let bearer: string;
beforeAll(async () => {
  const upstream = new Hono();
  upstream.all('*', c => c.json(actorOf(c.req.raw)));
  options = await testProxyOptions({ upstream: inProcess(upstream), sessions: { resolve: async () => ({ userId: 'viewer' }) } });
  options.env = { ...options.env, APP__PUBLIC_BASE_URL: main };
  delete options.env.APP__CONTROLS_ORIGIN;
  bearer = await mintTestToken({ id: 'same-origin-agent', userId: 'agent', pg: testDb().pg() });
});
const call = (headers: Record<string, string>, path = '/api/my/artifacts') =>
  createProxy(options).request(main + path, { method: 'POST', headers });

describe('same-origin proxy authority without a controls hostname', () => {
  it('admits the first-party cookie mutation with the explicit CSRF header', async () => {
    const response = await call({ origin: main, 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ credential: 'session', userId: 'viewer' });
  });
  it.each<Record<string,string>>([
    {},
    { origin: main },
    { origin: 'null', 'x-artifactbin-csrf': '1' },
    { origin: 'https://evil.example.test', 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-site' },
    { origin: 'http://example.test', 'x-artifactbin-csrf': '1' },
    { 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' },
  ])('rejects cookie mutation with incomplete or foreign browser proof: %j', async headers => {
    expect((await call(headers)).status).toBe(403);
    expect((await call(headers, '/a/abc123/mutate')).status).toBe(403);
  });
  it('preserves independent bearer authentication without browser headers', async () => {
    const response = await call({ authorization: `Bearer ${bearer}` }, '/api/artifacts');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ credential: 'bearer', userId: 'agent' });
  });
  it('does not pass ambient cookies downstream with an invalid bearer',async()=>{
    const proxy=createProxy({...options,upstream:async(request,actor)=>Response.json({actor,cookie:request.headers.get('cookie')})});
    const response=await proxy.request(main+'/api/artifacts',{method:'POST',headers:{authorization:'Bearer invalid',cookie:'session=valid'}});
    expect(await response.json()).toEqual({actor:{credential:'none'},cookie:null});
  });
  it('rejects foreign and opaque private reads while admitting navigation and native same-origin streams',async()=>{
    const proxy=createProxy(options);
    for(const origin of ['null','https://evil.example.test','http://example.test']){
      expect((await proxy.request(main+'/api/page/session',{headers:{origin,'sec-fetch-site':'same-origin'}})).status).toBe(403);
    }
    expect((await proxy.request(main+'/account',{headers:{'sec-fetch-mode':'navigate','sec-fetch-site':'none'}})).status).toBe(200);
    expect((await proxy.request(main+'/account',{headers:{'sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-site':'cross-site'}})).status).toBe(200);
    expect((await proxy.request(main+'/api/page/session',{headers:{'sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-site':'cross-site'}})).status).toBe(403);
    expect((await proxy.request(main+'/a/abc123/events',{headers:{accept:'text/event-stream','sec-fetch-site':'same-origin'}})).status).toBe(200);
    expect((await proxy.request(main+'/api/page/session',{headers:{'sec-fetch-site':'same-origin'}})).status).toBe(200);
    expect((await proxy.request(main+'/api/page/session')).status).toBe(403);
    expect((await proxy.request(main+'/a/abc123/events',{headers:{accept:'text/event-stream'}})).status).toBe(403);
  });
  it('preserves held-token authority only with proof, and leaves truly anonymous declared mutations to their route ACL',async()=>{
    const proxy=createProxy({...options,sessions:{resolve:async()=>null}});
    await createAgentBrowserSessions(testDb()).register('p'.repeat(43),'same-origin-agent');
    const cookie=`${cookieName(false)}=${encodeAgentSession({sessionId:'p'.repeat(43),tokenIds:['same-origin-agent']},options.cookieSecret)}`;
    const allowed=await proxy.request(main+'/a/abc123/mutate',{method:'POST',headers:{cookie,origin:main,'x-artifactbin-csrf':'1'}});
    expect(await allowed.json()).toMatchObject({credential:'agent-cookie',tokenId:'same-origin-agent'});
    expect((await proxy.request(main+'/a/abc123/mutate',{method:'POST',headers:{cookie,origin:'null'}})).status).toBe(403);
    const anonymous=await proxy.request(main+'/a/abc123/mutate',{method:'POST'});
    expect(await anonymous.json()).toEqual({credential:'none'});
  });
});
