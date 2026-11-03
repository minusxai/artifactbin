/** HTML row controls address rows by their stable generated `_id`, replacing JSX row snapshots. */
import {describe,it,expect} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import { identityForUser } from '@/lib/accounts';
import { setDatasetPolicy } from '@/__tests__/harness';
import {loadDatasetRows} from '@/lib/datasets';
import {getArtifactById} from '@/lib/artifacts';
import {useAppHarness,request,mintAccountToken} from './harness';
import {linkedGql,liveLink} from './linked-datasets';
useAppHarness();
async function fixture(){
 const owner=await mintAccountToken('native-row-controls'),actor=identityForUser(owner.userId,owner.id);
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{id:1,status:'backlog'},{id:1,status:'backlog'}],access:'readwrite'}}));expect(response.status).toBe(201);const {id}=await response.json();
 await setDatasetPolicy(actor,id,{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:'*',filter:{},allow_aggregations:true}}]}]},0);
 const link=liveLink(id,'tasks');
 const rows=(await linkedGql(actor,link,'{ tasks { _id status } }')).data!.tasks as Array<{_id:string;status:string}>;
 const update=(rowId:string,set:Record<string,unknown>={status:'active'})=>linkedGql(actor,link,'mutation($id: ID!, $set: tasks_set_input!) { update_tasks_by_pk(pk_columns: {_id: $id}, _set: $set) { _id status } }',{variables:{id:rowId,set}});
 return {actor,link,id,rows,update};
}
describe('native editable row actions',()=>{
 it('updates exactly one stable row even when user keys and complete row values are duplicated',async()=>{
  const f=await fixture();expect(new Set(f.rows.map(row=>row._id)).size).toBe(2);
  expect((await f.update(f.rows[0]!._id)).data).toEqual({update_tasks_by_pk:{_id:f.rows[0]!._id,status:'active'}});
  expect((await loadDatasetRows((await getArtifactById(f.id))!)).map(row=>row.status).sort()).toEqual(['active','backlog']);
 });
 it('rejects invented row and column identities without persisting partial changes',async()=>{
  const f=await fixture();expect((await f.update('invented-row')).data?.update_tasks_by_pk??null).toBeNull();
  const version=(await getArtifactById(f.id))!.version;
  const invented=await f.update(f.rows[0]!._id,{invented:'bad'});expect(invented.errors?.length).toBeGreaterThan(0);expect(invented.data?.update_tasks_by_pk??null).toBeNull();
  expect((await getArtifactById(f.id))!.version).toBe(version);
  expect((await loadDatasetRows((await getArtifactById(f.id))!)).map(row=>row.status)).toEqual(['backlog','backlog']);
 });
});
