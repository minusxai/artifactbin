import {expect,it,vi} from 'vitest';
import {useAppHarness,request,mintAccountToken} from '@/__tests__/harness';
import {POST as create} from '@/app/api/artifacts/route';
import {requestOrSessionActor,createUser,identityForUser} from '@/lib/accounts';
import {getVersionFor,updateSharingFor} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import {createRetainedDatasetGraphql} from '../retained';
import {authorizeDatasetBinding} from '../index';
useAppHarness();
const signal=new AbortController().signal,anonymous=identityForUser(null);
async function fixture(visibility:'public'|'private'){
 const owner=await mintAccountToken('pinned_dataset_fixture'),req=request('/api/artifacts',{method:'POST',token:owner.token,json:{dataset:[{amount:1}],access:'readwrite',visibility}}),actor=await requestOrSessionActor(req),response=await create(req);
 expect(response.status).toBe(201);const {id}=await response.json(),live={kind:'dataset' as const,name:'data',datasetId:id,mode:'live' as const},pinned={...live,mode:'pinned' as const,revision:'1'},api=createRetainedDatasetGraphql(),schema=await api.schema(actor,live,signal),table=schema.tables[0]!;
 const advance=async()=>{
  const read=await api.read(actor,live,{tableId:table.id,first:1},signal);
  expect((await api.write(actor,live,{tableId:table.id,expectedRevision:read.revision,requestId:'advance-pinned-dataset',changes:[{kind:'UPDATE',rowId:read.rows[0]!.id,cells:[{columnId:table.columns[0]!.id,value:{type:'NUMBER',value:2}}]}]},signal)).outcome).toBe('committed');
 };
 return {id,actor,live,pinned,api,table,advance};
}
it('keeps an explicitly pinned public dataset readable after its head advances and revokes it with current access',async()=>{
 const f=await fixture('public'),before=await f.api.read(anonymous,f.pinned,{tableId:f.table.id,first:1},signal);
 await f.advance();
 await expect(authorizeDatasetBinding(anonymous,f.pinned)).resolves.toBeUndefined();
 expect((await f.api.read(anonymous,f.pinned,{tableId:f.table.id,first:1},signal)).rows).toEqual(before.rows);
 expect((await f.api.read(anonymous,f.live,{tableId:f.table.id,first:1},signal)).rows[0]!.cells[0]!.value.value).toBe(2);
 expect(await getVersionFor(anonymous,f.id,1)).toBeNull();
 await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);
 await expect(f.api.read(anonymous,f.pinned,{tableId:f.table.id,first:1},signal)).rejects.toThrow('dataset_not_found');
});
it('keeps a private viewer pin readable after a head update without granting editor history access',async()=>{
 const f=await fixture('private'),user=await createUser({email:'dataset-viewer@example.test'}),viewer=identityForUser(user.id);
 await updateSharingFor(f.actor,f.id,{shares:[{email:user.email,role:'viewer'}]});
 const before=await f.api.read(viewer,f.pinned,{tableId:f.table.id,first:1},signal);await f.advance();
 expect((await f.api.read(viewer,f.pinned,{tableId:f.table.id,first:1},signal)).rows).toEqual(before.rows);
 expect(await getVersionFor(viewer,f.id,1)).toBeNull();
 await updateSharingFor(f.actor,f.id,{shares:[]});
 await expect(authorizeDatasetBinding(viewer,f.pinned)).rejects.toThrow('dataset_not_found');
 await expect(f.api.read(viewer,f.pinned,{tableId:f.table.id,first:1},signal)).rejects.toThrow('dataset_not_found');
});

it('rechecks current readership when access changes while an archive is loading',async()=>{
 const f=await fixture('public');await f.advance();
 const db=await getDb(),original=db.query.bind(db);let revoked=false;
 const spy=vi.spyOn(db,'query').mockImplementation(async(sql:string,values?:unknown[])=>{
  const result=await original(sql,values);
  if(!revoked&&sql.includes('FROM artifact_versions v')){revoked=true;await original("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);}
  return result;
 });
 try{await expect(authorizeDatasetBinding(anonymous,f.pinned)).rejects.toThrow('dataset_not_found');expect(revoked).toBe(true);}
 finally{spy.mockRestore();}
});
