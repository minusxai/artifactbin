import {expect,it} from 'vitest';
import {presenceGeometry,presenceRoster,PRESENCE_TTL_MS} from '../model';
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
