import {expect,it,vi} from 'vitest';
vi.mock('@/lib/datasets/postgres',()=>({
 discoverPostgres:vi.fn(async()=>[{schema:'source',name:'people',columns:[{name:'id',type:'number'},{name:'email',type:'string'}]}]),
 queryPostgres:vi.fn(async()=>({columns:[{name:'id',type:'number'}],rows:[{id:1}]})),
}));
vi.mock('@/lib/datasets/execute',()=>({executeCatalog:vi.fn(async()=>({columns:[{name:'id',type:'number'}],rows:[{id:1}]}))}));
import {POST as create} from '@/app/api/artifacts/route';
import {PUT as replace} from '@/app/api/artifacts/[id]/route';
import {POST as revert} from '@/app/api/artifacts/[id]/revert/route';
import {POST as browserRevert} from '@/app/api/my/artifacts/[id]/revert/route';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {prepareCatalog} from '@/lib/datasets/catalog';
import {executeCatalog} from '@/lib/datasets/execute';
import {dataflowForRow,getArtifactById} from '@/lib/artifacts';
import {createDatasetSecret} from '@/lib/datasets/secrets';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {agentCookie,request,useAppHarness} from './harness';
const harness=useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
const session=(user:{id:string;email:string|null})=>({credential:'session' as const,userId:user.id,email:user.email??'',emailVerified:true});
const target={host:'db.example',port:5432,database:'app',username:'reader',ssl:true};
async function pgFixture(){
 const owner=await createUser({email:'mxmx_test_pg_owner@example.com'});const ownerToken=await mintToken('owner');await claimToken(owner.id,ownerToken.token);
 const friend=await createUser({email:'mxmx_test_pg_friend@example.com'});
 const secret=await createDatasetSecret({userId:owner.id,tokenId:ownerToken.id},'permissions-test-password',target);
 const connection={...target,passwordSecretId:secret.id};
 const definition={kind:'postgres',connection,defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'people',source:{schema:'source',table:'people'},columns:['id']}]};
 const response=await create(request('/api/artifacts',{method:'POST',token:ownerToken.token,json:{dataset:definition,visibility:'public'}}));expect(response.status,await response.clone().text()).toBe(201);const id=(await response.json()).id as string;
 const db=await harness.db();const previous=(await getArtifactById(id))!;
 return {owner,ownerToken,friend,connection,id,db,definition,previous};
}
it('lets a shared editor add notebook models, expand exposure and replace credentials without redirecting an existing secret',async()=>{
 const f=await pgFixture();await f.db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')",[f.id,f.friend.email]);const actor={userId:f.friend.id,tokenId:''};
 const model={...f.definition,notebook:{cells:[{id:'summary',name:'summary',sql:'select id from source.people'}]},tables:[...f.definition.tables,{schema:'public',name:'summary',modelCellId:'summary',columns:['id']}]};
 const prepared=await prepareCatalog(model,actor,f.previous);expect(prepared,prepared instanceof Response?await prepared.clone().text():'').not.toBeInstanceOf(Response);
 const expanded={...f.definition,tables:[{...f.definition.tables[0],columns:['id','email']}]};
 const allowed=await prepareCatalog(expanded,actor,f.previous);expect(allowed,allowed instanceof Response?await allowed.clone().text():'').not.toBeInstanceOf(Response);
 const redirected=await prepareCatalog({...model,connection:{...f.connection,host:'other.example'}},actor,f.previous);expect(redirected).toBeInstanceOf(Response);expect((redirected as Response).status).toBe(403);
 const newTarget={...target,host:'replacement.example'};const secret=await createDatasetSecret(actor,'replacement-test-password',newTarget,f.id);
 const replaced=await prepareCatalog({...model,connection:{...newTarget,passwordSecretId:secret.id}},actor,f.previous);expect(replaced,replaced instanceof Response?await replaced.clone().text():'').not.toBeInstanceOf(Response);
});
it('rechecks private dataset access before serving a previously cached Postgres result',async()=>{
 vi.mocked(executeCatalog).mockClear();
 const f=await pgFixture();await f.db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);await f.db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'viewer')",[f.id,f.friend.email]);
 const first=await tables(request(`/a/${f.id}/tables`,{method:'POST',actor:session(f.friend),json:{sql:'select * from people'}}),ctx(f.id));expect(first.status).toBe(200);expect(executeCatalog).toHaveBeenCalledTimes(1);expect(executeCatalog).toHaveBeenLastCalledWith(expect.anything(),'select * from people',{},expect.objectContaining({datasetId:f.id}));
 await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND email=$2',[f.id,f.friend.email]);
 const revoked=await tables(request(`/a/${f.id}/tables`,{method:'POST',actor:session(f.friend),json:{sql:'select * from people'}}),ctx(f.id));expect(revoked.status).toBe(404);expect(executeCatalog).toHaveBeenCalledTimes(1);
});
it('reports Postgres mutations as inactive and refuses execution after a writable source changes kind',async()=>{
 const f=await pgFixture();
 const made=await create(request('/api/artifacts',{method:'POST',token:f.ownerToken.token,json:{dataset:[{id:1}],visibility:'public',access:'readwrite'}}));expect(made.status).toBe(201);const id=(await made.json()).id as string;
 const doc=await create(request('/api/artifacts',{method:'POST',token:f.ownerToken.token,json:{markup:`<Helmet><Mutation name="edit" source="${id}">{\`update rows set id=2\`}</Mutation></Helmet><Button run="$edit">Edit</Button>`}}));expect(doc.status,await doc.clone().text()).toBe(201);const documentId=(await doc.json()).id as string;
 const document=(await getArtifactById(documentId))!;
 expect((await dataflowForRow(document,{viewer:{userId:f.owner.id,tokenId:f.ownerToken.id}}))?.state.mutationAccess).toEqual({edit:null});
 // Simulate an already-published source changing kind; stale access=readwrite
 // must never override the Postgres runtime's read-only policy.
 const secret=await createDatasetSecret({userId:f.owner.id,tokenId:f.ownerToken.id},'mutation-test-password',target,id);
 const catalog={...(f.previous.meta.catalog as Record<string,unknown>),connection:{...target,passwordSecretId:secret.id}};
 await f.db.query('UPDATE artifacts SET meta=jsonb_set(meta,\'{catalog}\',$2::jsonb) WHERE id=$1',[id,JSON.stringify(catalog)]);
 expect((await dataflowForRow(document,{viewer:{userId:f.owner.id,tokenId:f.ownerToken.id}}))?.state.mutationAccess).toEqual({edit:expect.any(String)});
 const response=await mutate(request(`/a/${documentId}/mutate`,{method:'POST',token:f.ownerToken.token,json:{mutation:'edit'}}),ctx(documentId));expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'dataset_read_only'});
});
it.each(['bearer','browser'] as const)('returns a controlled unavailable-secret revert response through %s without changing the head',async transport=>{
 const f=await pgFixture();
 const changed=await replace(request(`/api/artifacts/${f.id}`,{method:'PUT',token:f.ownerToken.token,json:{dataset:{...f.definition,refreshSeconds:0},expectedVersion:1}}),ctx(f.id));expect(changed.status,await changed.clone().text()).toBe(200);
 const before=(await getArtifactById(f.id))!;
 await f.db.query('UPDATE dataset_secrets SET ciphertext=$2 WHERE id=$1',[f.connection.passwordSecretId,'unavailable-test-ciphertext']);
 let result:unknown;
 try{
  result=transport==='bearer'
   ?await revert(request(`/api/artifacts/${f.id}/revert`,{method:'POST',token:f.ownerToken.token,json:{version:1}}),ctx(f.id))
   :await browserRevert(request(`/api/my/artifacts/${f.id}/revert`,{method:'POST',cookie:await agentCookie([f.ownerToken.id]),json:{version:1}}),ctx(f.id));
 }catch(error){result=error;}
 expect(await getArtifactById(f.id)).toMatchObject({version:before.version,edit_id:before.edit_id,source:before.source,meta:before.meta});
 expect(result).toBeInstanceOf(Response);const response=result as Response;expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:'dataset_error',details:['Dataset credentials are unavailable']});
});
