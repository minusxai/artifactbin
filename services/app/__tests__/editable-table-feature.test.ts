/** HTML row controls address rows by their stable generated `_id`, replacing JSX row snapshots. */
import {describe,it,expect} from 'vitest';
import {POST as create} from '@/app/api/artifacts/route';
import { identityForUser } from '@/lib/accounts';
import { setDatasetPolicy } from '@/__tests__/harness';
import {loadDatasetRows} from '@/lib/datasets';
import {getArtifactById} from '@/lib/artifacts';
import {useAppHarness,request,mintAccountToken} from './harness';
import {linkedSql,liveLink} from './linked-datasets';
useAppHarness();
async function fixture(){
 const owner=await mintAccountToken('native-row-controls'),actor=identityForUser(owner.userId,owner.id);
 const response=await create(request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{id:1,status:'backlog'},{id:1,status:'backlog'}],access:'readwrite'}}));expect(response.status).toBe(201);const {id}=await response.json();
 await setDatasetPolicy(actor,id,{version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:'*',filter:{},allow_aggregations:true}}]}]},0);
 const link=liveLink(id,'tasks');
 const rows=(await linkedSql(actor,link,'select _id, status from tasks')).rows! as Array<{_id:string;status:string}>;
 const update=(rowId:string,set:Record<string,unknown>={status:'active'})=>linkedSql(actor,link,`update tasks set ${Object.keys(set).map((key,i)=>'"'+key.replaceAll('"','""')+'" = $v'+i).join(', ')} where _id = $id`,{variables:{id:rowId,...Object.fromEntries(Object.values(set).map((v,i)=>['v'+i,v]))}});
 return {actor,link,id,rows,update};
}
describe('native editable row actions',()=>{
 it('updates exactly one stable row even when user keys and complete row values are duplicated',async()=>{
  const f=await fixture();expect(new Set(f.rows.map(row=>row._id)).size).toBe(2);
  expect((await f.update(f.rows[0]!._id)).returning).toEqual([{_id:f.rows[0]!._id,id:1,status:'active'}]);
  expect((await loadDatasetRows((await getArtifactById(f.id))!)).map(row=>row.status).sort()).toEqual(['active','backlog']);
 });
 it('rejects invented row and column identities without persisting partial changes',async()=>{
  const f=await fixture();expect((await f.update('invented-row')).affected??0).toBe(0);
  const version=(await getArtifactById(f.id))!.version;
  const invented=await f.update(f.rows[0]!._id,{invented:'bad'});expect(invented.error).toBeTruthy();expect(invented.affected??0).toBe(0);
  expect((await getArtifactById(f.id))!.version).toBe(version);
  expect((await loadDatasetRows((await getArtifactById(f.id))!)).map(row=>row.status)).toEqual(['backlog','backlog']);
 });
});
