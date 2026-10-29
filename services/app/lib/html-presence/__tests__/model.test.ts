import {expect,it} from 'vitest';
import {presenceFrame,presenceGeometry,presenceRoster,PRESENCE_FRAME_INTERVAL_MS,PRESENCE_GUEST_LABEL,PRESENCE_HEARTBEAT_MS,PRESENCE_POINTER_THROTTLE_MS,PRESENCE_REAUTHORIZE_MS,PRESENCE_ROSTER_CAP,PRESENCE_TTL_MS} from '../model';
it('bounds public geometry and strips text and arbitrary fields',()=>{
 expect(presenceGeometry({cursor:{nodeId:'a',x:.5,y:.2,token:'secret'},selection:[{nodeId:'a',start:1,end:3,length:5,fingerprint:'1234abcd',quote:'private'}]})).toEqual({cursor:{nodeId:'a',x:.5,y:.2},selection:[{nodeId:'a',start:1,end:3,length:5,fingerprint:'1234abcd'}]});
 expect(presenceGeometry({cursor:{nodeId:'a',x:Infinity,y:0},selection:[{nodeId:'a',start:3,end:1,length:5,fingerprint:'1234abcd'}]})).toEqual({cursor:null,selection:null});
});
it('expires at the TTL boundary and never paints a different saved revision',()=>{
 const entry={id:'one',label:'Reader',revision:'2',cursor:null,selection:null,seen:100};
 expect(presenceRoster([entry],'2',100+PRESENCE_TTL_MS-1)).toHaveLength(1);
 expect(presenceRoster([entry],'2',100+PRESENCE_TTL_MS)).toEqual([]);
 expect(presenceRoster([entry],'3',101)).toEqual([]);
 expect(presenceRoster([entry],'2',99)).toEqual([]);
});
it('pins the load-bearing timings: a 15s heartbeat inside a 45s TTL, 250ms pointer coalescing and a 60s safety re-authorization',()=>{
 expect(PRESENCE_HEARTBEAT_MS).toBe(15_000);expect(PRESENCE_TTL_MS).toBe(45_000);expect(PRESENCE_POINTER_THROTTLE_MS).toBe(250);expect(PRESENCE_REAUTHORIZE_MS).toBe(60_000);
 expect(PRESENCE_FRAME_INTERVAL_MS).toBe(1_000);expect(PRESENCE_ROSTER_CAP).toBe(25);expect(PRESENCE_GUEST_LABEL).toBe('Guest');
 // Two heartbeats may be lost before a live reader expires.
 expect(PRESENCE_TTL_MS).toBeGreaterThanOrEqual(3*PRESENCE_HEARTBEAT_MS);
});
it('caps a frame at 25 entries, named readers before guests and then the most recently active, and counts every live reader',()=>{
 const viewer=(i:number,label:string,seen:number)=>({id:String(i).padStart(64,'0'),label,revision:'1',seen,cursor:null,selection:null});
 const guests=Array.from({length:40},(_,i)=>viewer(i,PRESENCE_GUEST_LABEL,1_000+i));
 const named=[viewer(100,'alex',10),viewer(101,'sam',20)];
 const expired=viewer(200,'old',1_000-PRESENCE_TTL_MS);const otherRevision={...viewer(201,'next',1_050),revision:'2'};
 const frame=presenceFrame([...guests,named[0]!,expired,named[1]!,otherRevision],'1',1_100);
 expect(frame.total).toBe(42);expect(frame.viewers).toHaveLength(PRESENCE_ROSTER_CAP);
 expect(frame.viewers.slice(0,2).map(v=>v.label)).toEqual(['sam','alex']);
 expect(frame.viewers.slice(2).map(v=>v.seen)).toEqual(Array.from({length:23},(_,i)=>1_039-i));
 expect(presenceFrame(guests.slice(0,3),'1',1_100)).toEqual({viewers:[...guests.slice(0,3)].reverse(),total:3});
 expect(presenceFrame([],'1',0)).toEqual({viewers:[],total:0});
});
