/** HTML row controls use stable row IDs and expected revisions, replacing JSX row snapshots. */
import {describe,it,expect} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import { identityForUser } from '@/lib/accounts';
import {createRetainedDatasetGraphql} from '@/lib/dataset-graphql';
import { setDatasetPolicy } from '@/__tests__/harness';
import {loadDatasetRows} from '@/lib/datasets';
import {getArtifactById} from '@/lib/artifacts';
import {useAppHarness,request,mintAccountToken} from './harness';
useAppHarness();
async function fixture(){
 const owner=await mintAccountToken('native-row-controls'),actor=identityForUser(owner.userId,owner.id);
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{id:1,status:'backlog'},{id:1,status:'backlog'}],access:'readwrite'}}));expect(response.status).toBe(201);const {id}=await response.json();
 await setDatasetPolicy(actor,id,{version:2,allow:[{actions:['read','insert','update','delete'],from:{user:owner.userId}}]},0);
 const api=createRetainedDatasetGraphql(),binding={kind:'dataset' as const,name:'tasks',datasetId:id,mode:'live' as const},signal=new AbortController().signal;
 const table=(await api.schema(actor,binding,signal)).tables[0]!,status=table.columns.find(c=>c.label==='status')!;
 const rows=await api.read(actor,binding,{tableId:table.id,first:100},signal);
 const update=(rowId:string,expectedRevision='1')=>api.write(actor,binding,{tableId:table.id,expectedRevision,requestId:crypto.randomUUID(),changes:[{kind:'UPDATE',rowId,cells:[{columnId:status.id,value:{type:'STRING',value:'active'}}]}]},signal);
 return {api,actor,binding,signal,id,table,status,rows,update};
}
describe('native editable row actions',()=>{
 it('updates exactly one stable row even when user keys and complete row values are duplicated',async()=>{
  const f=await fixture();expect(new Set(f.rows.rows.map(row=>row.id)).size).toBe(2);
  expect((await f.update(f.rows.rows[0]!.id)).outcome).toBe('committed');
  expect((await loadDatasetRows((await getArtifactById(f.id))!)).map(row=>row.status).sort()).toEqual(['active','backlog']);
 });
 it('refuses a stale snapshot without overwriting a committed row action',async()=>{
  const f=await fixture();expect((await f.update(f.rows.rows[0]!.id)).outcome).toBe('committed');
  expect((await f.update(f.rows.rows[1]!.id)).outcome).toBe('rejected');expect((await getArtifactById(f.id))?.version).toBe(2);
 });
 it('rejects invented row and column identities without persisting partial changes',async()=>{
  const f=await fixture();expect((await f.update('invented-row')).outcome).toBe('rejected');
  await expect(f.api.write(f.actor,f.binding,{tableId:f.table.id,expectedRevision:'1',requestId:crypto.randomUUID(),changes:[{kind:'UPDATE',rowId:f.rows.rows[0]!.id,cells:[{columnId:'invented-column',value:{type:'STRING',value:'bad'}}]}]},f.signal)).rejects.toThrow();
  expect((await getArtifactById(f.id))?.version).toBe(1);
 });
});
