import {afterEach,expect,it,vi} from 'vitest';
import {stackHealth} from '..';
import {stubFetch} from '@/test/helpers/fetch-stub';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const up=async()=>true;
it.each([5000,undefined])('refuses remote SQL with an incompatible or absent read policy (%s)',async queryTimeoutMs=>{
 stubFetch({'*/read-policy':{version:1,queryTimeoutMs}},{fallback:()=>new Response('ok')});
 expect(await stackHealth({sql:'http://sql.internal',browser:null,events:null},up)).toEqual({ok:false,failing:['sql']});
});
it('probes liveness without credentials and verifies SQL policy under the same deadline',async()=>{
 const calls:Array<{url:string;init:RequestInit}>=[];
 stubFetch({'*/read-policy':{version:1,queryTimeoutMs:30000}},{fallback:()=>new Response('ok'),onCall:(url,init)=>{calls.push({url,init:init!});}});
 expect(await stackHealth({sql:'http://sql.internal/',browser:'http://browser.internal//',events:null},up)).toEqual({ok:true,failing:[]});
 expect(calls.map(c=>c.url).sort()).toEqual(['http://browser.internal/health','http://sql.internal/health','http://sql.internal/read-policy']);
 for(const {url,init} of calls){expect(init.redirect).toBe('manual');expect(init.signal).toBeInstanceOf(AbortSignal);if(url.endsWith('/health'))expect(init).not.toHaveProperty('headers');}
 expect(calls.find(c=>c.url.endsWith('/read-policy'))!.init.signal).toBe(calls.find(c=>c.url==='http://sql.internal/health')!.init.signal);
});
it('names every service that answers non-2xx, a redirect, refuses or times out, then the database, in order',async()=>{
 const deadline=new AbortController(),timeouts:number[]=[];
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{timeouts.push(ms);return deadline.signal;});
 stubFetch({
  'http://sql*':()=>new Response('',{status:302,headers:{location:'/login'}}),
  'http://browser*':()=>Promise.reject(new TypeError('connect ECONNREFUSED')),
 },{fallback:(_url,init)=>new Promise((_,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason)))});
 const health=stackHealth({sql:'http://sql',browser:'http://browser',events:'http://events'},async()=>false);
 await Promise.resolve();deadline.abort(new DOMException('timed out','TimeoutError'));
 expect(await health).toEqual({ok:false,failing:['sql','browser','events','db']});
 expect(timeouts).toEqual([2000,2000,2000]);
});
it('reads a database probe that throws as degraded and never throws itself',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));
 expect(await stackHealth({sql:null,browser:null,events:null},async()=>{throw Error('refused');})).toEqual({ok:false,failing:['db']});
 expect(await stackHealth({sql:null,browser:null,events:'http://events'},up)).toEqual({ok:false,failing:['events']});
});
