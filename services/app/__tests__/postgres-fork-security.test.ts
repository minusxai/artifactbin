import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('@/lib/datasets/execute',()=>({executeCatalog:vi.fn(async()=>({columns:[{name:'id',type:'number'}],rows:[{id:1}]}))}));
import {POST as create} from '@/app/api/artifacts/route';
import {POST as forkRoute} from '@/app/api/my/artifacts/[id]/fork/route';
import {POST as tables} from '@/app/a/[id]/tables/route';
import {saveConnection} from '@/lib/datasets/connections';
import {mintToken} from '@/lib/tokens';
import {claimToken,createUser} from '@/lib/users';
import {request,useAppHarness} from './harness';
const harness=useAppHarness();const current={id:'',email:''};
vi.mock('@/auth',()=>({auth:async()=>current.id?{user:{id:current.id,email:current.email}}:null}));
const ctx=(id:string)=>({params:Promise.resolve({id})});
beforeEach(()=>{current.id='';current.email='';});
async function user(name:string){const account=await createUser({email:`mxmx_test_pg_fork_${name}@example.com`});const token=await mintToken(name);await claimToken(account.id,token.token);return {account,token};}
async function postgresDataset(datasetOwner:Awaited<ReturnType<typeof user>>,connectionOwner=datasetOwner){
 const connection=await saveConnection({userId:connectionOwner.account.id,tokenId:connectionOwner.token.id},{name:'db',host:'db.example',port:5432,database:'app',username:'reader',password:'secret',ssl:true});
 const made=await create(request('/api/artifacts',{method:'POST',token:datasetOwner.token.token,json:{dataset:[{id:1}],visibility:'public'}}));const id=(await made.json()).id as string;const db=await harness.db();const row=(await db.query<{meta:Record<string,unknown>}>('SELECT meta FROM artifacts WHERE id=$1',[id])).rows[0];
 await db.query('UPDATE artifacts SET meta=$2::jsonb WHERE id=$1',[id,JSON.stringify({...row.meta,catalog:{kind:'postgres',connectionId:connection.id,defaultSchema:'public',refreshSeconds:60,tables:[{schema:'public',name:'rows',source:{schema:'public',table:'rows'},columns:[{name:'id',type:'number'}]}]}})]);return id;
}
it('refuses a reader fork after a live Postgres read while allowing the connection owner',async()=>{
 const owner=await user('owner'),reader=await user('reader'),id=await postgresDataset(owner);const warm=await tables(request(`/a/${id}/tables`,{method:'POST',actor:{credential:'session',userId:reader.account.id,email:reader.account.email??'',emailVerified:true},json:{sql:'select * from rows'}}),ctx(id));expect(warm.status).toBe(200);
 const db=await harness.db();const before=Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n);current.id=reader.account.id;current.email=reader.account.email??'';const denied=await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id));expect(denied.status).toBe(403);expect(await denied.json()).toMatchObject({error:'connection_owner_only',hint:expect.stringContaining('ownership')});expect(Number((await db.query<{n:string}>('SELECT count(*) n FROM artifacts')).rows[0].n)).toBe(before);
 current.id=owner.account.id;current.email=owner.account.email??'';expect((await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id))).status).toBe(201);
});
it('refuses even the dataset owner when the catalog names another account connection',async()=>{
 const connectionOwner=await user('connection_owner'),datasetOwner=await user('dataset_owner'),id=await postgresDataset(datasetOwner,connectionOwner);current.id=datasetOwner.account.id;current.email=datasetOwner.account.email??'';
 const response=await forkRoute(request(`/api/my/artifacts/${id}/fork`,{method:'POST'}),ctx(id));expect(response.status).toBe(403);expect(await response.json()).toMatchObject({error:'connection_owner_only'});
});
