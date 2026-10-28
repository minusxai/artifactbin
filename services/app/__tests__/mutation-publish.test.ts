/** Native publication grants read bindings; dataset write authority stays with the dataset. */
import {expect,it} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {observedRequest} from '@/__tests__/conditional-request';
import {getArtifactById} from '@/lib/artifacts';
import {requestOrSessionActor} from '@/lib/accounts';
import {createRetainedDatasetGraphql} from '@/lib/dataset-graphql/retained';
import {getDb} from '@/lib/platform';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {mintAccountToken,request,useAppHarness} from './harness';
useAppHarness();
const signal=new AbortController().signal,ctx=(id:string)=>({params:Promise.resolve({id})});
const html=(id:string,extra='')=>`<!doctype html><html><head><link rel="af-dataset" data-af-name="votes" href="ref:${id}">${extra}</head><body>Votes</body></html>`;
async function fixture(access='readwrite'){
 const token=await mintAccountToken('native-mutation-publication'),actor=await requestOrSessionActor(request('/',{token:token.token}));
 const made=await create(request('/api/artifacts',{method:'POST',token:token.token,json:{dataset:[{choice:'ramen',who:'seed'}],access,visibility:'public'}}));expect(made.status).toBe(201);
 const id=(await made.json()).id as string,binding={kind:'dataset' as const,name:'votes',datasetId:id,mode:'live' as const},api=createRetainedDatasetGraphql(),table=(await api.schema(actor,binding,signal)).tables[0]!;
 const publish=(body:string=html(id),credential=token.token)=>create(request('/api/artifacts',{method:'POST',token:credential,json:{html:body,visibility:'public'}}));
 const update=async(revision='1',caller=actor)=>{const rows=await api.read(caller,binding,{tableId:table.id,first:1},signal);return api.write(caller,binding,{tableId:table.id,expectedRevision:revision,requestId:`update-${revision}`,changes:[{kind:'UPDATE',rowId:rows.rows[0]!.id,cells:[{columnId:table.columns.find(c=>c.label==='choice')!.id,value:{type:'STRING',value:'tacos'}}]}]},signal);};
 return {token,actor,id,binding,api,table,publish,update};
}
it('persists the native dataset binding without adding page-level write authority',async()=>{
 const f=await fixture(),response=await f.publish();expect(response.status).toBe(201);const row=(await getArtifactById((await response.json()).id))!;
 expect(row.meta.htmlLinks).toEqual([f.binding]);expect((await getArtifactById(f.id))!.version).toBe(1);
});
it('allows a read-only binding but refuses its dataset write',async()=>{
 const f=await fixture('read');expect((await f.publish()).status).toBe(201);expect((await f.update()).outcome).toBe('rejected');expect((await getArtifactById(f.id))!.version).toBe(1);
});
it('a public dataset binding does not confer its owners write permission on another publisher',async()=>{
 const f=await fixture(),other=await mintAccountToken('native-other-publisher'),actor=await requestOrSessionActor(request('/',{token:other.token}));
 expect((await f.publish(html(f.id),other.token)).status).toBe(201);expect((await f.update('1',actor)).outcome).toBe('rejected');
});
it('never compiles SQL-looking native page text at publication',async()=>{
 const f=await fixture(),before=await getArtifactById(f.id),body=html(f.id).replace('Votes</body>','<pre>delete from votes.rows; select missing_column</pre></body>');
 expect((await f.publish(body)).status).toBe(201);expect(await getArtifactById(f.id)).toEqual(before);
});
it('refuses ambiguous duplicate namespace declarations',async()=>{
 const f=await fixture();expect((await f.publish(html(f.id,`<link rel="af-dataset" data-af-name="votes" href="ref:${f.id}">`))).status).toBe(400);
});
it('refuses publication that references a private dataset the publisher cannot read',async()=>{
 const f=await fixture(),other=await mintAccountToken('native-private-link');
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 expect((await f.publish(html(f.id),other.token)).status).toBe(400);
});
it('an authorized native dataset write commits its stable row update',async()=>{
 const f=await fixture();expect((await f.publish()).status).toBe(201);expect((await f.update()).outcome).toBe('committed');expect(await loadDatasetRows((await getArtifactById(f.id))!)).toEqual([{choice:'tacos',who:'seed'}]);
});
it('a stale native write is rejected without overwriting the current row',async()=>{
 const f=await fixture();expect((await f.update()).outcome).toBe('committed');expect((await f.update()).outcome).toBe('committed');
 // Same request identity and payload returns its original durable receipt; a new stale payload is refused.
 const rows=await f.api.read(f.actor,f.binding,{tableId:f.table.id,first:1},signal);
 expect((await f.api.write(f.actor,f.binding,{tableId:f.table.id,expectedRevision:'1',requestId:'different-stale-write',changes:[{kind:'DELETE',rowId:rows.rows[0]!.id}]},signal)).outcome).toBe('rejected');expect((await getArtifactById(f.id))!.version).toBe(2);
});
it('rechecks dataset writability after the native page was published',async()=>{
 const f=await fixture();expect((await f.publish()).status).toBe(201);
 const ro=await replace(await observedRequest(`/api/artifacts/${f.id}`,{method:'PUT',token:f.token.token,json:{dataset:[{choice:'ramen',who:'seed'}],access:'read'}}),ctx(f.id));expect(ro.status).toBe(200);
 expect((await f.update(String((await getArtifactById(f.id))!.version))).outcome).toBe('rejected');
});
