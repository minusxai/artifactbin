import {expect,it} from 'vitest';
import {createPresenceRoom} from '../room';
import type {PresenceFrame} from '../contract';
it('coalesces geometry without ACL reads, serializes checks and stops immediately on access revocation',async()=>{
 let now=100,notification=(_payload:string)=>{},changed=()=>{},heartbeat=()=>{},flush=()=>{},pending:((allowed:boolean)=>void)|undefined;
 let initial=true;let checks=0,concurrent=0,maximum=0,dropped=0,closed=0,cleared=0;const sent:PresenceFrame[]=[],delays:number[]=[];
 const room=await createPresenceRoom({revision:'1',authorize:()=>{if(initial){initial=false;return Promise.resolve(true);}checks++;maximum=Math.max(maximum,++concurrent);return new Promise<boolean>(r=>{pending=value=>{concurrent--;r(value);};});},
  subscribe:async receive=>{notification=receive;return async()=>{dropped++;};},subscribeAcl:async callback=>{changed=callback;return async()=>{dropped++;};},send:frame=>sent.push(frame),close:()=>{closed++;},
  clock:{now:()=>now,setTimeout:(work,ms)=>{if(ms<=1000){delays.push(ms);flush=work;}return 1;},clearTimeout:()=>{cleared++;},setInterval:work=>{heartbeat=work;return 2;},clearInterval:()=>{cleared++;}}
 });
 // The first frame on join is immediate, even when the room is empty.
 expect(sent).toEqual([{viewers:[],total:0}]);expect(delays).toEqual([]);
 checks=0;
 const entry={id:'a'.repeat(64),label:'Reader',revision:'1',seen:100,cursor:{nodeId:'p',x:.5,y:.5},selection:null};
 for(let i=0;i<1000;i++)notification(JSON.stringify(entry));expect(checks).toBe(0);expect(delays).toEqual([1_000]);expect(sent).toHaveLength(1);
 now=1_100;flush();expect(sent).toHaveLength(2);expect(sent[1]).toEqual({viewers:[entry],total:1});
 heartbeat();heartbeat();expect(checks).toBe(1);notification(JSON.stringify({...entry,cursor:null}));flush();expect(sent).toHaveLength(2);
 pending!(true);await Promise.resolve();expect(checks).toBe(2);expect(maximum).toBe(1);pending!(true);await Promise.resolve();now=2_100;flush();expect(sent).toHaveLength(3);
 changed();notification(JSON.stringify(entry));flush();expect(sent).toHaveLength(3);pending!(false);await Promise.resolve();expect(closed).toBe(1);expect(dropped).toBe(2);expect(cleared).toBeGreaterThanOrEqual(3);
 notification(JSON.stringify(entry));room.dispose();expect(closed).toBe(1);
});
it('sends each viewer at most one frame per second, latest state wins, and never repeats an unchanged frame',async()=>{
 let now=0,notification=(_payload:string)=>{},flush=()=>{};const sent:PresenceFrame[]=[],delays:number[]=[];
 await createPresenceRoom({revision:'1',authorize:async()=>true,subscribe:async receive=>{notification=receive;return async()=>{};},subscribeAcl:async()=>async()=>{},send:frame=>sent.push(frame),close:()=>{},
  clock:{now:()=>now,setTimeout:(work,ms)=>{if(ms<=1000){delays.push(ms);flush=work;}return 1;},clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}}});
 const a='a'.repeat(64),b='b'.repeat(64);
 const at=(id:string,x:number,seen=now)=>JSON.stringify({id,label:'Guest',revision:'1',seen,cursor:{nodeId:'p',x,y:.5},selection:null});
 expect(sent).toHaveLength(1);
 notification(at(a,.1));notification(at(a,.5));notification(at(a,.9));expect(delays).toEqual([1_000]);expect(sent).toHaveLength(1);
 now=1_000;flush();expect(sent).toHaveLength(2);expect(sent[1]!.viewers.map(v=>v.cursor?.x)).toEqual([.9]);
 now=1_500;notification(at(b,.3));expect(delays).toEqual([1_000,500]);expect(sent).toHaveLength(2);
 now=2_000;flush();expect(sent[2]).toMatchObject({total:2});
 // Past the window a change goes out at once; an identical roster is not sent again.
 now=5_000;notification(at(a,.9,0));expect(sent).toHaveLength(3);
 now=5_001;notification(JSON.stringify({id:b,gone:true}));expect(sent).toHaveLength(4);expect(sent[3]).toMatchObject({total:1});
 expect(delays).toHaveLength(2);
});
it('caps the roster in every frame and still counts the whole room',async()=>{
 let notification=(_payload:string)=>{},flush=()=>{};const sent:PresenceFrame[]=[];
 await createPresenceRoom({revision:'1',authorize:async()=>true,subscribe:async receive=>{notification=receive;return async()=>{};},subscribeAcl:async()=>async()=>{},send:frame=>sent.push(frame),close:()=>{},
  clock:{now:()=>1_000,setTimeout:work=>{flush=work;return 1;},clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}}});
 for(let i=0;i<60;i++)notification(JSON.stringify({id:i.toString(16).padStart(64,'0'),label:i===7?'alex':'Guest',revision:'1',seen:900+i,cursor:null,selection:null}));
 flush();const frame=sent.at(-1)!;
 expect(frame.total).toBe(60);expect(frame.viewers).toHaveLength(25);expect(frame.viewers[0]!.label).toBe('alex');expect(frame.viewers[1]!.seen).toBe(959);
});
it('cleans listeners that attach after an early transport loss',async()=>{
 let drops=0;const room=await createPresenceRoom({revision:'1',authorize:async()=>true,subscribe:async(_receive,lost)=>{lost();return async()=>{drops++;};},subscribeAcl:async()=>async()=>{drops++;},send:()=>{},close:()=>{},clock:{now:()=>0,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}}});room.dispose();expect(drops).toBe(1);
});
it('revalidates after both subscriptions before sending the initial roster',async()=>{
 let closed=0,dropped=0,sent=0,scheduled=0;
 await createPresenceRoom({revision:'1',authorize:async()=>false,subscribe:async()=>async()=>{dropped++;},subscribeAcl:async()=>async()=>{dropped++;},send:()=>{sent++;},close:()=>{closed++;},clock:{now:()=>0,setTimeout:()=>{scheduled++;return 1;},clearTimeout:()=>{},setInterval:()=>{scheduled++;return 2;},clearInterval:()=>{}}});
 expect(closed).toBe(1);expect(dropped).toBe(2);expect(sent).toBe(0);expect(scheduled).toBe(0);
});
it('re-authorizes at once on an ACL wakeup and otherwise only on the 60s safety interval, closing on either refusal',async()=>{
 const harness=()=>{const state={allowed:true,checks:0,closed:0,every:0,tick:()=>{},acl:()=>{}};return {state,ports:{revision:'1',authorize:async()=>{state.checks++;return state.allowed;},
  subscribe:async()=>async()=>{},subscribeAcl:async(changed:()=>void)=>{state.acl=changed;return async()=>{};},send:()=>{},close:()=>{state.closed++;},
  clock:{now:()=>0,setTimeout:()=>1,clearTimeout:()=>{},setInterval:(work:()=>void,ms:number)=>{state.tick=work;state.every=ms;return 2;},clearInterval:()=>{}}}};};
 const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
 // Revocation by ACL change: no timer needs to fire.
 const byAcl=harness();await createPresenceRoom(byAcl.ports);
 expect(byAcl.state.every).toBe(60_000);expect(byAcl.state.checks).toBe(1);
 byAcl.state.allowed=false;byAcl.state.acl();await settle();expect(byAcl.state.checks).toBe(2);expect(byAcl.state.closed).toBe(1);
 // Revocation nothing announced: the safety interval is what closes the room.
 const bySafety=harness();await createPresenceRoom(bySafety.ports);
 bySafety.state.tick();await settle();expect(bySafety.state.checks).toBe(2);expect(bySafety.state.closed).toBe(0);
 bySafety.state.allowed=false;await settle();expect(bySafety.state.closed).toBe(0);
 bySafety.state.tick();await settle();expect(bySafety.state.closed).toBe(1);
});
it('expires unique counts without activity and converges after reconnect heartbeats',async()=>{
 let now=1000,sequence=0;
 const timers=new Map<number,{at:number,work:()=>void,interval?:number}>();
 const clock={now:()=>now,setTimeout:(work:()=>void,ms:number)=>{const id=++sequence;timers.set(id,{at:now+ms,work});return id;},clearTimeout:(id:unknown)=>{timers.delete(id as number);},setInterval:(work:()=>void,ms:number)=>{const id=++sequence;timers.set(id,{at:now+ms,work,interval:ms});return id;},clearInterval:(id:unknown)=>{timers.delete(id as number);}};
 const advance=async(ms:number)=>{const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [id,timer]=next;now=timer.at;timers.delete(id);if(timer.interval)timers.set(id,{...timer,at:now+timer.interval});timer.work();await Promise.resolve();}now=end;};
 let receive=(_payload:string)=>{};const sent:PresenceFrame[]=[];
 const ports={revision:'1',readerIdentity:'a'.repeat(64),authorize:async()=>true,subscribe:async(fn:(payload:string)=>void)=>{receive=fn;return async()=>{};},subscribeAcl:async()=>async()=>{},send:(frame:PresenceFrame)=>sent.push(frame),close:()=>{},clock};
 try{
 let room=await createPresenceRoom(ports);
 const publish=()=>{for(let i=0;i<35;i++)receive(JSON.stringify({id:i.toString(16).padStart(64,'0'),colorId:'b'.repeat(64),label:'Same label',revision:'1',seen:now,cursor:null,selection:null}));};
 publish();await advance(1000);expect(sent.at(-1)?.readers?.total).toBe(1);
 room.dispose();room=await createPresenceRoom(ports);publish();await advance(1000);expect(sent.at(-1)?.readers?.total).toBe(1);
 await advance(44000);expect(sent.at(-1)?.readers?.total).toBe(0);expect(sent.at(-1)?.viewers).toEqual([]);
 room.dispose();expect(timers.size).toBe(0);
 }finally{timers.clear();}
});
it('closes explicitly on state overload instead of publishing a silently truncated count',async()=>{
 let receive=(_payload:string)=>{},closed=0;const sent:PresenceFrame[]=[];
 const room=await createPresenceRoom({revision:'1',readerIdentity:'own',authorize:async()=>true,subscribe:async fn=>{receive=fn;return async()=>{};},subscribeAcl:async()=>async()=>{},send:frame=>sent.push(frame),close:()=>{closed++;},clock:{now:()=>1000,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}}});
 for(let i=0;i<2049;i++)receive(JSON.stringify({id:i.toString(16).padStart(64,'0'),label:'Guest',revision:'1',seen:1000,cursor:null,selection:null}));
 expect(closed).toBe(1);expect(sent).toHaveLength(1);room.dispose();expect(closed).toBe(1);
});
