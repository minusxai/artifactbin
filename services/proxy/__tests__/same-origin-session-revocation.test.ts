import { expect, it } from 'vitest';
import { encodeAgentSession, setCookieHeader, clearCookieHeader } from '@artifactbin/utils';
import { createProxy } from '../src/parts';
import { mintTestToken, testDb, testProxyOptions } from './helpers';

it('revokes copied browser cookies after disconnect without revoking another browser holding the token', async () => {
  const main = 'https://example.test';
  const proof = { origin: main, 'x-artifactbin-csrf': '1', 'sec-fetch-site': 'same-origin' };
  const options = await testProxyOptions();
  await mintTestToken({ id: 'tok_same_origin_revoke', userId: null, pg: testDb().pg() });
  let serial = 0;
  const proxy = createProxy({ ...options, secure: true, env: { ...options.env, APP__PUBLIC_BASE_URL: main },
    upstream: async (request, actor) => {
      if (new URL(request.url).pathname === '/api/session/token') {
        const cookie = request.method === 'DELETE' ? clearCookieHeader(true) : setCookieHeader(encodeAgentSession({ tokenIds: ['tok_same_origin_revoke'], sessionId: String(++serial).padEnd(43, 'x') }, options.cookieSecret), true);
        return new Response(null, { status: 204, headers: { 'set-cookie': cookie } });
      }
      return Response.json(actor);
    } });
  const adopt = async () => {
    const response = await proxy.request(main + '/api/session/token', { method: 'POST', headers: proof });
    expect(response.status).toBe(204);
    return response.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ');
  };
  const one = await adopt(), two = await adopt();
  const account = async (cookie: string) => (await proxy.request(main + '/api/my/artifacts', { headers: { ...proof, cookie } })).json();
  expect(await account(one)).toMatchObject({ credential: 'agent-cookie', tokenId: 'tok_same_origin_revoke' });
  expect((await proxy.request(main + '/api/session/token', { method: 'DELETE', headers: { ...proof, cookie: one } })).status).toBe(204);
  expect(await account(one)).toEqual({ credential: 'none' });
  expect(await account(two)).toMatchObject({ credential: 'agent-cookie', tokenId: 'tok_same_origin_revoke' });
  expect(await account(two+'; '+two)).toEqual({credential:'none'});
  await testDb().query("UPDATE auth.credentials SET expires_at=now()-interval '1 second' WHERE kind='agent-browser'");
  expect(await account(two)).toEqual({credential:'none'});
});

it('never resurrects legacy signed cookies without a registered browser nonce, even without identity storage',async()=>{
  const main='https://example.test',options=await testProxyOptions();
  await mintTestToken({id:'tok_legacy_browser',userId:null,pg:testDb().pg()});
  const cookie=setCookieHeader(encodeAgentSession({tokenIds:['tok_legacy_browser']},options.cookieSecret),true).split(';')[0];
  for(const identityDb of [options.identityDb,undefined]){
    const proxy=createProxy({...options,identityDb,secure:true,env:{...options.env,APP__PUBLIC_BASE_URL:main},upstream:async(request,actor)=>Response.json({actor,cookie:request.headers.get('cookie')})});
    const response=await proxy.request(main+'/api/my/artifacts',{headers:{cookie,origin:main,'sec-fetch-site':'same-origin'}});
    expect(await response.json()).toEqual({actor:{credential:'none'},cookie:null});
  }
});
