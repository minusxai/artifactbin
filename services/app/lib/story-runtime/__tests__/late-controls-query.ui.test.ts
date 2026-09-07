import {expect,it,vi} from 'vitest';
import {createRelayTransport} from '../relay-transport';
import {STORY_HELLO_MESSAGE,STORY_QUERY_RESULT_MESSAGE} from '../contract';

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
