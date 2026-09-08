import {beforeAll, describe, expect, it} from 'vitest';
import {encodeAgentSession, setCookieHeader, clearCookieHeader} from '@artifactbin/utils';
import {createProxy} from '../src/parts';
import {mintTestToken, testDb, testProxyOptions} from './helpers';

const main='https://example.test', controls='https://i.example.test';
const trusted={origin:main,'x-artifactbin-csrf':'1'};
let proxy: ReturnType<typeof createProxy>, serial=0;
beforeAll(async () => {
  const options=await testProxyOptions();
  await mintTestToken({id:'tok_browser',userId:null,pg:testDb().pg()});
  proxy=createProxy({...options,secure:true,env:{...options.env,APP__PUBLIC_BASE_URL:main,APP__CONTROLS_ORIGIN:controls},
    upstream:async (request,actor)=>{
      if(new URL(request.url).pathname==='/api/session/token') {
        const cookie=request.method==='DELETE'?clearCookieHeader(true):setCookieHeader(encodeAgentSession({tokenIds:['tok_browser'],sessionId:String(++serial).padEnd(43,'x')},options.cookieSecret),true);
        return new Response(null,{status:204,headers:{'set-cookie':cookie}});
      }
      return Response.json({actor,cookie:request.headers.get('cookie')});
    }});
});
const adopt=async()=>{
  const response=await proxy.request(main+'/api/session/token',{method:'POST',headers:trusted});
  expect(response.status).toBe(204);
  expect(response.headers.getSetCookie().some(c=>c.startsWith('__Secure-mx-agent-read='))).toBe(false);
  return response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
};
describe('same-origin anonymous browser authority',()=>{
  it('issues no read cookies and revokes copied full cookies on disconnect without affecting another browser',async()=>{
    const one=await adopt(),two=await adopt();
    const read=async(cookie:string)=> (await proxy.request(main+'/a/abc123',{headers:{cookie}})).json();
    const account=async(cookie:string)=> (await proxy.request(main+'/api/my/artifacts',{headers:{...trusted,cookie}})).json();
    expect((await read(one)).actor).toMatchObject({credential:'agent-cookie',tokenId:'tok_browser'});
    expect((await account(one)).actor).toMatchObject({credential:'agent-cookie',tokenId:'tok_browser'});
    expect((await proxy.request(main+'/a/abc123/mutate',{method:'POST',headers:{cookie:one}})).status).toBe(403);
    expect((await proxy.request(main+'/api/session/token',{method:'DELETE',headers:{...trusted,cookie:one}})).status).toBe(204);
    expect((await read(one)).actor).toEqual({credential:'none'});
    const stale=await account(one);
    expect(stale.actor).toEqual({credential:'none'});
    expect(stale.cookie ?? '').not.toContain('__Host-mx-agent-session=');
    expect((await read(two)).actor).toMatchObject({credential:'agent-cookie',tokenId:'tok_browser'});
    expect((await account(two)).actor).toMatchObject({credential:'agent-cookie',tokenId:'tok_browser'});
    await testDb().query("UPDATE tokens SET deleted_at=now() WHERE id='tok_browser'");
    expect((await read(two)).actor).toEqual({credential:'none'});
    expect((await account(two)).actor).toEqual({credential:'none'});
  });
});
