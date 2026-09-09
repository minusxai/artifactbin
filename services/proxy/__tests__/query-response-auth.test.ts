import {expect,it,vi} from 'vitest';
import {createProxy,type ProxyOptions} from '../src/parts';
import {REVALIDATE_ACTOR_HEADER} from '@artifactbin/contracts';
const marker=REVALIDATE_ACTOR_HEADER;
const hold=<T,>()=>{let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};};
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
