import {expect,it,vi} from 'vitest';
vi.mock('@/lib/datasets/postgres',()=>({discoverPostgres:vi.fn(async()=>[{schema:'source',name:'people',columns:[{name:'id',type:'number'},{name:'email',type:'string'}]}])}));
vi.mock('@/lib/datasets/execute',()=>({executeCatalog:vi.fn(async()=>({columns:[{name:'id',type:'number'}],rows:[{id:1}]}))}));
import {POST as create} from '@/app/api/artifacts/route';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {POST as mutate} from '@/app/a/[id]/mutate/route';
import {prepareCatalog} from '@/lib/datasets/catalog';
import {executeCatalog} from '@/lib/datasets/execute';
import type {ArtifactRow} from '@/lib/artifacts';
import {saveConnection} from '@/lib/datasets/connections';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
const harness=useAppHarness();
const ctx=(id:string)=>({params:Promise.resolve({id})});
const session=(user:{id:string;email:string|null})=>({credential:'session' as const,userId:user.id,email:user.email??'',emailVerified:true});
async function pgFixture(){
 const owner=await createUser({email:'mxmx_test_pg_owner@example.com'});const ownerToken=await mintToken('owner');await claimToken(owner.id,ownerToken.token);
 const friend=await createUser({email:'mxmx_test_pg_friend@example.com'});const connection=await saveConnection({userId:owner.id,tokenId:ownerToken.id},{name:'db',host:'db.example',port:5432,database:'app',username:'reader',password:'secret',ssl:true});
 const response=await create(request('/api/artifacts',{method:'POST',token:ownerToken.token,json:{dataset:[{id:1}],visibility:'public',access:'readwrite'}}));expect(response.status).toBe(201);const id=(await response.json()).id as string;
 const db=await harness.db();const row=(await db.query<{meta:Record<string,unknown>}>('SELECT meta FROM artifacts WHERE id=$1',[id])).rows[0];
 const catalog={kind:'postgres',connectionId:connection.id,defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'people',source:{schema:'source',table:'people'},columns:[{name:'id',type:'number'}]}]};
 await db.query('UPDATE artifacts SET meta=$2::jsonb WHERE id=$1',[id,JSON.stringify({...row.meta,catalog})]);
 return {owner,ownerToken,friend,connection,id,db,catalog};
}
it('lets a shared editor add models without connection ownership but refuses source exposure changes',async()=>{
 const f=await pgFixture();await f.db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')",[f.id,f.friend.email]);const previous=(await f.db.query<ArtifactRow>('SELECT * FROM artifacts WHERE id=$1',[f.id])).rows[0];const actor={userId:f.friend.id,tokenId:''};
 const model={...f.catalog,tables:[{schema:'public',name:'people',source:{schema:'source',table:'people'},columns:['id']},{schema:'public',name:'summary',sql:'select id from people'}]};
 const prepared=await prepareCatalog(model,actor,previous);expect(prepared,prepared instanceof Response?await prepared.clone().text():'').not.toBeInstanceOf(Response);
 const expanded={...f.catalog,tables:[{schema:'public',name:'people',source:{schema:'source',table:'people'},columns:['id','email']}]};
 const denied=await prepareCatalog(expanded,actor,previous);expect(denied).toBeInstanceOf(Response);expect((denied as Response).status).toBe(403);
 const changedConnection=await prepareCatalog({...model,connectionId:'conn_other'},actor,previous);expect(changedConnection).toBeInstanceOf(Response);expect((changedConnection as Response).status).toBe(403);
});
it('rechecks private dataset access before serving a previously cached Postgres result',async()=>{
 vi.mocked(executeCatalog).mockClear();
 const f=await pgFixture();await f.db.query("UPDATE artifacts SET visibility='private' WHERE id=$1",[f.id]);await f.db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'viewer')",[f.id,f.friend.email]);
 const first=await tables(request(`/a/${f.id}/tables`,{method:'POST',actor:session(f.friend),json:{sql:'select * from people'}}),ctx(f.id));expect(first.status).toBe(200);expect(executeCatalog).toHaveBeenCalledTimes(1);
 await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1 AND email=$2',[f.id,f.friend.email]);
 const revoked=await tables(request(`/a/${f.id}/tables`,{method:'POST',actor:session(f.friend),json:{sql:'select * from people'}}),ctx(f.id));expect(revoked.status).toBe(404);expect(executeCatalog).toHaveBeenCalledTimes(1);
});
it('reports Postgres mutations as inactive and refuses execution',async()=>{
 const f=await pgFixture();await f.db.query("UPDATE artifacts SET meta=meta-'catalog' WHERE id=$1",[f.id]);
 const doc=await create(request('/api/artifacts',{method:'POST',token:f.ownerToken.token,json:{markup:`<Helmet><Mutation name="edit" source="${f.id}">{\`update rows set id=2\`}</Mutation></Helmet><Button run="$edit">Edit</Button>`}}));expect(doc.status).toBe(201);const documentId=(await doc.json()).id as string;
 await f.db.query('UPDATE artifacts SET meta=jsonb_set(meta,\'{catalog}\',$2::jsonb) WHERE id=$1',[f.id,JSON.stringify(f.catalog)]);
 const response=await mutate(request(`/a/${documentId}/mutate`,{method:'POST',token:f.ownerToken.token,json:{mutation:'edit'}}),ctx(documentId));expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'dataset_read_only'});
});
