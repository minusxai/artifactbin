import {beforeEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {encodeAgentSession,setCookieHeader} from '@artifactbin/utils';
import {createProxy} from '../src/parts';
import {ensureProxySchema} from '../src/schema';
import {testDb} from './helpers';

const secret='restore-session-cutover-secret'.padEnd(32,'0');
const sessionId='s'.repeat(43);
const token={id:'tok_live',userId:null};
const options=()=>({
  env:{PROXY__RATE_LIMIT_CONFIG_FILE:'../proxy/dev_rate_limits.yml'},cookieSecret:secret,identityDb:testDb(),
  sessions:{resolve:async()=>null},
  tokens:{byToken:async()=>null,byId:async(id:string)=>id===token.id?token:null,invalidate:()=>{}},
  upstream:async(_request:Request,actor:unknown)=>Response.json(actor),
});
const cookie=async()=>setCookieHeader(encodeAgentSession({tokenIds:[token.id],sessionId},secret),false).split(';')[0]!;

describe('agent browser session rollback compatibility',()=>{
  beforeEach(async()=>{await ensureProxySchema(testDb(),'auth');await testDb().query("DELETE FROM auth.credentials");});
  it('accepts a live newer cookie but never resurrects it after browser-session revocation',async()=>{
    await testDb().query("INSERT INTO auth.credentials(kind,credential_hash,subject_id,expires_at) VALUES ('agent-browser',$1,$2,now()+interval '30 days')",[createHash('sha256').update(sessionId).digest('hex'),token.id]);
    const proxy=createProxy(options());
    expect(await (await proxy.request('http://app.test/a/x',{headers:{cookie:await cookie()}})).json()).toMatchObject({credential:'agent-cookie',tokenId:token.id});
    await testDb().query("UPDATE auth.credentials SET deleted_at=now() WHERE kind='agent-browser'");
    expect(await (await proxy.request('http://app.test/a/x',{headers:{cookie:await cookie()}})).json()).toEqual({credential:'none'});
  });
  it('rejects a legacy cookie without a browser nonce',async()=>{
    const legacy=setCookieHeader(encodeAgentSession({tokenIds:[token.id]},secret),false).split(';')[0]!;
    expect(await (await createProxy(options()).request('http://app.test/a/x',{headers:{cookie:legacy}})).json()).toEqual({credential:'none'});
  });
  it('registers a new full cookie and revokes it when that browser disconnects',async()=>{
    const issued=await cookie();
    let response:Response|null=new Response(null,{status:204,headers:{'set-cookie':issued+'; Path=/; HttpOnly; SameSite=Lax'}});
    const configured=options();configured.upstream=async(_request,actor)=>response??Response.json(actor);
    const proxy=createProxy(configured);
    await proxy.request('http://app.test/api/session/token',{method:'POST'});
    response=null;
    expect(await (await proxy.request('http://app.test/a/x',{headers:{cookie:issued}})).json()).toMatchObject({credential:'agent-cookie'});
    response=new Response(null,{status:204,headers:{'set-cookie':'mx-agent-session=; Path=/; Max-Age=0'}});
    await proxy.request('http://app.test/api/session/token',{method:'DELETE',headers:{cookie:issued}});
    response=null;
    expect(await (await proxy.request('http://app.test/a/x',{headers:{cookie:issued}})).json()).toEqual({credential:'none'});
  });
});
