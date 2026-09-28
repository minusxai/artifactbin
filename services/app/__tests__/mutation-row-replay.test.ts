import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as create} from '@/app/api/artifacts/route';
import {POST as mutate} from '@/app/api/artifacts/[id]/mutate/route';
import {POST as browserMutate} from '@/app/a/[id]/mutate/route';
import {getArtifactById} from '@/lib/artifacts';
useAppHarness();

it.each(['row','value'] as const)('fingerprints the named mutation %s and shares its identity with the browser',async(field)=>{
 const owner=await mintToken('mxmx_test_row_replay');
 const publish=async(body:object)=>{const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return (await response.json()).id as string;};
 const ds=await publish({dataset:[{id:'one',note:'old'},{id:'two',note:'old'}],access:'readwrite'});
 const doc=await publish({markup:`<Helmet><Import name="items" src="ref:${ds}" /><Query name="rows">{\`select * from items.rows\`}</Query><Mutation name="change" expectedAffected={1}>{\`update items.rows set note=$_value where id=$_row.id\`}</Mutation></Helmet><DataTable data="$rows" rowKey="id"><Column col="id" /><Column col="note"><input type="text" value="$_row.note" run="$change" /></Column></DataTable>`});
 const context={params:Promise.resolve({id:doc})},key='mxmx_test_row_replay_once';
 const body={name:'change',args:{},row:{id:'one'},value:'new'};
 const send=(value:object)=>mutate(request(`/api/artifacts/${doc}/mutate`,{method:'POST',token:owner.token,json:value,headers:{'Idempotency-Key':key}}),context);
 const first=await send(body);expect(first.status,await first.clone().text()).toBe(200);const saved=await first.json();
 expect(await (await send(body)).json()).toEqual(saved);
 const changed=await send({...body,...(field==='row'?{row:{id:'two'}}:{value:'different'})});
 expect(changed.status).toBe(409);expect((await changed.json()).error).toBe('idempotency_mismatch');
 const browser=await browserMutate(request(`/a/${doc}/mutate`,{method:'POST',token:owner.token,json:{mutation:body.name,args:body.args,row:body.row,value:body.value,operationKey:key}}),context);
 expect(browser.status,await browser.clone().text()).toBe(200);
 expect(await browser.json()).toEqual({ok:true,dataset:ds,version:saved.version,affected:saved.affected,rowCount:saved.rowCount});
 expect((await getArtifactById(ds))!.version).toBe(2);
});
