import {expect,it} from 'vitest';
import {createPresenceRoom} from '../room';
import type {PresenceViewer} from '../contract';
it('coalesces geometry without ACL reads, serializes checks and stops immediately on access revocation',async()=>{
 let notification=(_payload:string)=>{},changed=()=>{},heartbeat=()=>{},flush=()=>{},pending:((allowed:boolean)=>void)|undefined;
 let initial=true;let checks=0,concurrent=0,maximum=0,dropped=0,closed=0,cleared=0,scheduled=0;const sent:PresenceViewer[][]=[];
 const room=await createPresenceRoom({revision:'1',authorize:()=>{if(initial){initial=false;return Promise.resolve(true);}checks++;maximum=Math.max(maximum,++concurrent);return new Promise<boolean>(r=>{pending=value=>{concurrent--;r(value);};});},
  subscribe:async receive=>{notification=receive;return async()=>{dropped++;};},subscribeAcl:async callback=>{changed=callback;return async()=>{dropped++;};},send:viewers=>sent.push(viewers),close:()=>{closed++;},
  clock:{now:()=>100,setTimeout:work=>{scheduled++;flush=work;return 1;},clearTimeout:()=>{cleared++;},setInterval:work=>{heartbeat=work;return 2;},clearInterval:()=>{cleared++;}}
 });
 checks=0;
 const entry={id:'a'.repeat(64),label:'Reader',revision:'1',seen:100,cursor:{nodeId:'p',x:.5,y:.5},selection:null};
 for(let i=0;i<1000;i++)notification(JSON.stringify(entry));expect(checks).toBe(0);expect(scheduled).toBe(1);flush();expect(sent).toHaveLength(1);expect(sent[0]).toHaveLength(1);
 heartbeat();heartbeat();expect(checks).toBe(1);notification(JSON.stringify({...entry,cursor:null}));flush();expect(sent).toHaveLength(1);
 pending!(true);await Promise.resolve();expect(checks).toBe(2);expect(maximum).toBe(1);pending!(true);await Promise.resolve();flush();expect(sent).toHaveLength(2);
 changed();notification(JSON.stringify(entry));flush();expect(sent).toHaveLength(2);pending!(false);await Promise.resolve();expect(closed).toBe(1);expect(dropped).toBe(2);expect(cleared).toBe(2);
 notification(JSON.stringify(entry));room.dispose();expect(closed).toBe(1);
});
it('cleans listeners that attach after an early transport loss',async()=>{
 let drops=0;const room=await createPresenceRoom({revision:'1',authorize:async()=>true,subscribe:async(_receive,lost)=>{lost();return async()=>{drops++;};},subscribeAcl:async()=>async()=>{drops++;},send:()=>{},close:()=>{},clock:{now:()=>0,setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>2,clearInterval:()=>{}}});room.dispose();expect(drops).toBe(1);
});
it('revalidates after both subscriptions before sending the initial roster',async()=>{
 let closed=0,dropped=0,sent=0,scheduled=0;
 await createPresenceRoom({revision:'1',authorize:async()=>false,subscribe:async()=>async()=>{dropped++;},subscribeAcl:async()=>async()=>{dropped++;},send:()=>{sent++;},close:()=>{closed++;},clock:{now:()=>0,setTimeout:()=>{scheduled++;return 1;},clearTimeout:()=>{},setInterval:()=>{scheduled++;return 2;},clearInterval:()=>{}}});
 expect(closed).toBe(1);expect(dropped).toBe(2);expect(sent).toBe(0);expect(scheduled).toBe(0);
});
