import {afterEach,expect,it,vi} from 'vitest';
import {stackHealth} from '..';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const up=async()=>true;
it('probes each configured service’s own /health once, in parallel, without credentials or redirects',async()=>{
 const calls:Array<{url:string;init:RequestInit}>=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{calls.push({url,init});return new Response('ok');}));
 expect(await stackHealth({sql:'http://sql.internal/',browser:'http://browser.internal//',events:null},up)).toEqual({ok:true,failing:[]});
 expect(calls.map(c=>c.url).sort()).toEqual(['http://browser.internal/health','http://sql.internal/health']);
 for(const {init} of calls){expect(init.redirect).toBe('manual');expect(init.signal).toBeInstanceOf(AbortSignal);expect(init).not.toHaveProperty('headers');}
});
it('names every service that answers non-2xx, a redirect, refuses or times out, then the database, in order',async()=>{
 const deadline=new AbortController(),timeouts:number[]=[];
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{timeouts.push(ms);return deadline.signal;});
 vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>{
  if(url.startsWith('http://sql'))return Promise.resolve(new Response('',{status:302,headers:{location:'/login'}}));
  if(url.startsWith('http://browser'))return Promise.reject(new TypeError('connect ECONNREFUSED'));
  return new Promise((_,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason)));
 }));
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
