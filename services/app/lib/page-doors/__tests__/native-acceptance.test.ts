/** The downstream native acceptance scenario through supported page SQL handlers. */
import {expect,it} from 'vitest';
import {mintAccountToken,request,useAppHarness} from '@/__tests__/harness';
import {POST as publish} from '@/app/api/artifacts/route';
import {POST as sql} from '@/app/api/artifacts/[id]/sql/route';
import {MARKER_PREFIX,OPERATIONS,publishBody} from '@/testing/native-acceptance.mjs';
useAppHarness();
it('publishes native HTML, reads SQL as owner and guest, and refuses a guest write',async()=>{
 const owner=await mintAccountToken('native-acceptance');
 const dataset=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{ready:1}],visibility:'unlisted'}}));
 const data=await dataset.json();
 const body=publishBody(MARKER_PREFIX+'sql',data.id);
 const created=await publish(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));
 expect(created.status).toBe(201);const {id}=await created.json();
 const call=(text:string,token?:string)=>sql(request(`/api/artifacts/${id}/sql`,{method:'POST',token,json:{sql:text,params:{},revision:'1'}}),{params:Promise.resolve({id})});
 for(const token of [owner.token,undefined]){const reply=await call(OPERATIONS.read.sql,token);expect(reply.status).toBe(200);expect((await reply.json()).rows).toEqual(OPERATIONS.read.rows);}
 const refused=await call(OPERATIONS.guestWrite.sql);expect(refused.status).toBe(403);expect(await refused.json()).toHaveProperty('error','permission_denied');
});
