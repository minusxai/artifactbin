import {expect,it} from 'vitest';
import {presenceGeometry,presenceRoster,PRESENCE_HEARTBEAT_MS,PRESENCE_POINTER_THROTTLE_MS,PRESENCE_REAUTHORIZE_MS,PRESENCE_TTL_MS} from '../model';
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
 // Two heartbeats may be lost before a live reader expires.
 expect(PRESENCE_TTL_MS).toBeGreaterThanOrEqual(3*PRESENCE_HEARTBEAT_MS);
});
