import {expect,it,vi} from 'vitest';
import {createProxy,type ProxyOptions} from '../src/parts';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';
import {PGlite} from '@electric-sql/pglite';
import {createHumanAuth} from '../src/auth/human';
const marker=REVALIDATE_ACTOR_HEADER;
const hold=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
it.each(['delete','expire','unchanged'] as const)('revalidates a real database-backed session (%s) and replaces response headers safely',async(change)=>{
 const db=new PGlite(),baseURL='http://localhost:9401';let otp='';
 try {
  const auth=await createHumanAuth({pglite:db,baseURL,secret:'query-response-test-secret'.padEnd(32,'0'),mail:{send:async message=>{otp=message.otp??'';}}});
  const call=(path:string,body:unknown)=>auth.handler(new Request(baseURL+'/api/auth'+path,{method:'POST',headers:{'content-type':'application/json',origin:baseURL},body:JSON.stringify(body)}));
  const email='mxmx_test_query_boundary@example.com';
  expect((await call('/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
  const login=await call('/sign-in/email-otp',{email,otp});expect(login.status).toBe(200);
  const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  expect(await auth.sessions.resolve(new Request(baseURL,{headers:{cookie}}))).not.toBeNull();
  const started=hold<void>(),release=hold<void>();
  const proxy=createProxy({env:{},cookieSecret:'test',tokens:{byToken:async()=>null,byId:async()=>null,invalidate:()=>{}},sessions:auth.sessions,upstream:async()=>{started.resolve();await release.promise;return new Response('private-result',{headers:{[marker]:'1','content-length':'14','content-encoding':'gzip'}});}});
  const pending=proxy.request(baseURL+'/a/abcdef/query',{headers:{cookie}});await started.promise;
  if(change==='delete')await db.exec('DELETE FROM auth.session');
  if(change==='expire')await db.exec('UPDATE auth.session SET "expiresAt"=now()-interval \'1 second\'');
  release.resolve();const response=await pending;
  expect(response.status).toBe(change==='unchanged'?200:401);
  expect(response.headers.has(marker)).toBe(false);
  if(change==='unchanged')expect(await response.text()).toBe('private-result');
  else {
   expect(await response.text()).not.toContain('private-result');
   expect(response.headers.has('content-length')).toBe(false);
   expect(response.headers.has('content-encoding')).toBe(false);
  }
 } finally {await db.close();}
});
it('withholds a completed query when its Better Auth session was revoked in flight',async()=>{
 const started=hold<void>(),release=hold<void>();let loggedIn=true;
 const options:ProxyOptions={env:{},cookieSecret:'test',tokens:{byToken:async()=>null,byId:async()=>null,invalidate:()=>{}},sessions:{resolve:async()=>loggedIn?{userId:'user',email:'user@example.com',emailVerified:true}:null},upstream:async()=>{started.resolve();await release.promise;return new Response('private-result',{headers:{[marker]:'1'}});}};
 const app=createProxy(options),response=app.request('http://localhost/a/abcdef/query');await started.promise;loggedIn=false;release.resolve();
 const result=await response;expect(result.status).toBe(401);expect(await result.text()).not.toContain('private-result');expect(result.headers.has(marker)).toBe(false);
});
it('keeps an authorized result and strips the internal marker',async()=>{
 const resolve=vi.fn(async()=>({userId:'user',email:'user@example.com',emailVerified:true}));
 const app=createProxy({env:{},cookieSecret:'test',tokens:{byToken:async()=>null,byId:async()=>null,invalidate:()=>{}},sessions:{resolve},upstream:async()=>new Response('result',{headers:{[marker]:'1'}})});
 const result=await app.request('http://localhost/a/abcdef/query');expect(result.status).toBe(200);expect(await result.text()).toBe('result');expect(result.headers.has(marker)).toBe(false);expect(resolve).toHaveBeenCalledTimes(2);
});
it('fails closed when the session recheck errors and does not recheck unmarked responses',async()=>{
 let calls=0;const resolve=async()=>{if(++calls>1)throw new Error('session unavailable');return {userId:'user'};};
 const base:ProxyOptions={env:{},cookieSecret:'test',tokens:{byToken:async()=>null,byId:async()=>null,invalidate:()=>{}},sessions:{resolve},upstream:async()=>new Response('private',{headers:{[marker]:'1'}})};
 const refused=await createProxy(base).request('http://localhost/a/abcdef/query');expect(refused.status).toBe(401);expect(await refused.text()).not.toContain('private');
 calls=0;const normal=await createProxy({...base,upstream:async()=>new Response('normal')}).request('http://localhost/');expect(normal.status).toBe(200);expect(calls).toBe(1);
});
