import {afterEach,expect,it,vi} from 'vitest';
import {createRelayTransport} from '../relay-transport';
import {STORY_ASSET_RESULT_MESSAGE,STORY_HELLO_MESSAGE,STORY_QUERY_RESULT_MESSAGE} from '../contract';

afterEach(()=>vi.useRealTimers());

function fixture(timeout=20000){
 vi.useFakeTimers();
 const posted:any[]=[];
 const target={postMessage:(message:unknown)=>posted.push(message)} as unknown as Window;
 const source=new EventTarget() as unknown as Window;
 const origin='https://i.artifactbin.dev';
 const transport=createRelayTransport(target,origin,source,timeout);
 const message=(data:unknown,from:Window=target,at=origin)=>source.dispatchEvent(new MessageEvent('message',{source:from,origin:at,data}));
 return {posted,target,source,origin,transport,message};
}

it('ignores readiness from the wrong window or origin and reuses pending IDs without adding timers',async()=>{
 const f=fixture();const result=f.transport.run({},['rows']);
 await vi.advanceTimersByTimeAsync(5000);const before=f.posted.length,timers=vi.getTimerCount();
 f.message(STORY_HELLO_MESSAGE,window);f.message(STORY_HELLO_MESSAGE,f.target,'https://evil.example');
 expect(f.posted).toHaveLength(before);
 f.message(STORY_HELLO_MESSAGE);f.message(STORY_HELLO_MESSAGE);
 expect(f.posted).toHaveLength(before+2);expect(vi.getTimerCount()).toBe(timers);
 expect(f.posted.every(message=>message.id===1)).toBe(true);
 f.message({type:STORY_QUERY_RESULT_MESSAGE,id:1,tables:{},errors:{}});await result;
 f.message(STORY_HELLO_MESSAGE);expect(f.posted).toHaveLength(before+2);expect(vi.getTimerCount()).toBe(0);
});

it('does not retry writes on readiness and leaves their original deadline intact',async()=>{
 const f=fixture();const write=f.transport.mutate!({},'increment');
 const rejected=expect(write).rejects.toThrow('the page did not answer the write');
 await vi.advanceTimersByTimeAsync(5000);f.message(STORY_HELLO_MESSAGE);
 expect(f.posted).toHaveLength(1);expect(vi.getTimerCount()).toBe(1);
 await vi.advanceTimersByTimeAsync(15000);await rejected;
 f.message(STORY_HELLO_MESSAGE);expect(f.posted).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});

it('does not replay expired queries or keep retries beyond a short deadline',async()=>{
 const f=fixture(100);const rejected=expect(f.transport.run({},['rows'])).rejects.toThrow('the page did not answer the query');
 await vi.advanceTimersByTimeAsync(100);await rejected;
 f.message(STORY_HELLO_MESSAGE);expect(f.posted).toHaveLength(1);expect(vi.getTimerCount()).toBe(0);
});

it('resends pending asset reads on readiness but not completed or aborted reads',async()=>{
 const f=fixture();const controller=new AbortController();
 const active=f.transport.importAsset!('https://cdn.example/live.png','image');
 const aborted=f.transport.importAsset!('https://cdn.example/aborted.png','image',controller.signal);
 const completed=f.transport.importAsset!('https://cdn.example/done.png','image');
 controller.abort();f.message({type:STORY_ASSET_RESULT_MESSAGE,id:3,url:'https://assets.example/done'});
 await aborted;await completed;await vi.advanceTimersByTimeAsync(5000);
 const before=f.posted.length;f.message(STORY_HELLO_MESSAGE);
 expect(f.posted).toHaveLength(before+1);expect(f.posted.at(-1)).toEqual(f.posted[0]);
 f.message({type:STORY_ASSET_RESULT_MESSAGE,id:1,url:'https://assets.example/live'});await active;
 f.message(STORY_HELLO_MESSAGE);expect(f.posted).toHaveLength(before+1);expect(vi.getTimerCount()).toBe(0);
});

it('resends an unanswered read when the trusted controls finally announces readiness',async()=>{
 vi.useFakeTimers();
 try {
  const posted: any[]=[];
  const target={postMessage:(m:unknown)=>posted.push(m)} as unknown as Window;
  const origin='https://i.artifactbin.dev';
  const t=createRelayTransport(target,origin,window,20000);
  const run=t.run({},['rows']);
  await vi.advanceTimersByTimeAsync(5000);
  const before=posted.length;
  window.dispatchEvent(new MessageEvent('message',{source:target,origin,data:STORY_HELLO_MESSAGE}));
  const after=posted.length;
  window.dispatchEvent(new MessageEvent('message',{source:target,origin,data:{type:STORY_QUERY_RESULT_MESSAGE,id:1,tables:{rows:{rows:[{count:0}],columns:[]}},errors:{},mutationAccess:{increment:null}}}));
  await run;
  expect(after).toBe(before+1);
  expect(posted.at(-1)).toEqual(posted[0]);
 }finally{vi.useRealTimers();}
});
