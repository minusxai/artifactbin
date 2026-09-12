/**
 * THE AGENT COOKIE'S LIFECYCLE — registration, the authority it carries, and every way it stops
 * carrying it: revoked browser session, expired nonce, a primary token that is no longer live, and the
 * old cookie shape that has no browser nonce at all.
 *
 * It was filed as `session-cutover`, a name describing a migration that has landed. What the cases
 * actually exercise is current behaviour the session part does not: `session.test.ts` RESOLVES a cookie
 * that already exists, while these register one and take it away again.
 */
import {beforeEach,describe,expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {encodeAgentSession,setCookieHeader} from '@artifactbin/utils';
import {createProxy,type ProxyOptions} from '../src/parts';
import {ensureProxySchema} from '../src/schema';
import {testDb} from './helpers';

const secret='agent-cookie-lifecycle-secret'.padEnd(32,'0');
const sessionId='s'.repeat(43);
const token={id:'tok_live',userId:null};
const options=():ProxyOptions=>({
  env:{PROXY__RATE_LIMIT_CONFIG_FILE:'../proxy/dev_rate_limits.yml'},cookieSecret:secret,identityDb:testDb(),
  sessions:{resolve:async()=>null},
  tokens:{byToken:async()=>null,byId:async(id:string)=>id===token.id?token:null,invalidate:()=>{}},
  upstream:async(_request:Request,actor:unknown)=>Response.json(actor),
});
const cookie=async()=>setCookieHeader(encodeAgentSession({tokenIds:[token.id],sessionId},secret),false).split(';')[0]!;

describe('the agent browser cookie',()=>{
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
  it('rejects an expired browser nonce',async()=>{
    await testDb().query("INSERT INTO auth.credentials(kind,credential_hash,subject_id,expires_at) VALUES ('agent-browser',$1,$2,now()-interval '1 second')",[createHash('sha256').update(sessionId).digest('hex'),token.id]);
    expect(await (await createProxy(options()).request('http://app.test/a/x',{headers:{cookie:await cookie()}})).json()).toEqual({credential:'none'});
  });
  it('keeps the account session but drops held token authority from a revoked browser cookie',async()=>{
    await testDb().query("INSERT INTO auth.credentials(kind,credential_hash,subject_id,expires_at,deleted_at) VALUES ('agent-browser',$1,$2,now()+interval '30 days',now())",[createHash('sha256').update(sessionId).digest('hex'),token.id]);
    const configured=options();configured.sessions={resolve:async()=>({userId:'usr_other',email:'other@example.test'})};
    expect(await (await createProxy(configured).request('http://app.test/a/x',{headers:{cookie:await cookie()}})).json()).toEqual({credential:'session',userId:'usr_other',email:'other@example.test'});
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
  it('does not register a cookie whose primary token is no longer live',async()=>{
    const deadValue=encodeAgentSession({tokenIds:['tok_dead'],sessionId},secret);
    const configured=options();configured.upstream=async()=>new Response(null,{status:204,headers:{'set-cookie':`mx-agent-session=${deadValue}; Path=/`}});
    const response=await createProxy(configured).request('http://app.test/api/session/token',{method:'POST'});
    expect(response.headers.getSetCookie().at(-1)).toContain('Max-Age=0');
    expect((await testDb().query("SELECT 1 FROM auth.credentials WHERE kind='agent-browser'")).rows).toHaveLength(0);
  });
});
