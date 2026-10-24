import {it,expect,vi,afterEach} from 'vitest';
import {useAppHarness,mintAccountToken,request} from '@/__tests__/harness';
import {POST} from '@/app/api/artifacts/route';
import {identityForUser} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {getArtifactById,changeMembership} from '@/lib/artifacts';
import {setDatasetPolicy} from '@/lib/document-data/dataset-policy';
import {catalogOf} from '@/lib/datasets/catalog';
import {loadDatasetRows} from '@/lib/datasets/dataset-store';
import {readHtmlPage} from '@/lib/html-publication';
import {getHtmlBackendVersion} from '@/lib/html-backends';
import {prepareRegisteredMutationBackend,commitRegisteredMutationBackend} from '../registry';
import {createRetainedRegisteredMutation} from '../retained';
import type {MutationProgram} from '../contracts';
useAppHarness();afterEach(()=>{vi.restoreAllMocks();});
const signal=()=>new AbortController().signal;
async function fixture(kind:'insert'|'delete'='insert'){
 const owner=await mintAccountToken('mxmx_test_registered_mutation_acceptance'),actor=identityForUser(owner.userId,owner.id);
 const make=async(json:object)=>{const response=await POST(request('/api/artifacts',{method:'POST',token:owner.token,json}));expect(response.status).toBe(201);return (await response.json()).id as string;};
 const datasetId=await make({dataset:[{body:'seed'},{body:'other'}],visibility:'private'});
 await setDatasetPolicy(actor,datasetId,{version:2,allow:[{actions:['read','insert','delete'],from:{user:'$owner'}}]},0);
 const pageId=await make({html:'<html><body>Registered actions</body></html>',visibility:'private'});
 await changeMembership(actor,pageId,{action:'join'});
 const original=await readHtmlPage(actor,pageId),page={...original,version:original.version+1,revision:String(original.version+1)};
 const program:MutationProgram={name:kind,kind,sql:kind==='insert'?'INSERT INTO forms.rows(body) VALUES ($body)':"DELETE FROM forms.rows WHERE body=$body OR $body='__all__'",target:{datasetId,schema:'forms',table:'rows'},values:{body:{type:'string',nullable:false,parameter:'body'}},builtins:[],expectedAffected:1,reset:['body']};
 const prepared=prepareRegisteredMutationBackend('actions',`backend_${pageId}`,page,program,{compilerSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64)});page.links=[prepared.link];
 const db=await getDb();await db.transaction(async tx=>{await tx.query("UPDATE artifacts SET version=$2,meta=jsonb_set(meta,'{htmlLinks}',$3::jsonb) WHERE id=$1",[pageId,page.version,JSON.stringify(page.links)]);await tx.query('INSERT INTO artifact_versions(artifact_id,version,title,format,source,meta) SELECT id,version,title,format,source,meta FROM artifacts WHERE id=$1',[pageId]);await commitRegisteredMutationBackend(tx,page,owner.userId!,prepared);});
 const backend=(await getHtmlBackendVersion(prepared.link.backendId,prepared.link.version))!;
 const service=()=>createRetainedRegisteredMutation(actor,page,prepared.link,backend,async()=>actor);
 const rows=async()=>{const row=(await getArtifactById(datasetId))!,table=catalogOf(row)!.tables[0]!;return loadDatasetRows({meta:{objectKey:table.objectKey}});};
 const run=(requestId:string,body:string)=>service().execute({requestId,values:{body}},signal());
 return {actor,pageId,page,datasetId,db,run,rows};
}
it('real insert/delete commit exactly one row and replay durable requests without another revision',async()=>{
 for(const kind of ['insert','delete'] as const){const f=await fixture(kind),before=(await getArtifactById(f.datasetId))!.version,input=kind==='insert'?'added':'seed';const first=await f.run(`request_${kind}_1234567890`,input);expect(first).toMatchObject({outcome:'committed',affected:1,reset:['body']});expect(await f.run(`request_${kind}_1234567890`,input)).toEqual(first);expect((await getArtifactById(f.datasetId))!.version).toBe(before+1);expect(await f.rows()).toEqual(kind==='insert'?[{body:'seed'},{body:'other'},{body:'added'}]:[{body:'other'}]);const receipts=await f.db.query<{response:{status:number;body:{mutationOperation?:{affected:number}}}}>('SELECT response FROM mutation_receipts');expect(receipts.rows.every(row=>row.response.status===200&&row.response.body.mutationOperation?.affected===1)).toBe(true);}
});
it('expectedAffected mismatch preserves rows and revision and has no successful receipt',async()=>{
 const f=await fixture('delete'),before=(await getArtifactById(f.datasetId))!.version;
 for(const body of ['missing','__all__']){const requestId=`request_mismatch_${body}_1234567890`;const result=await f.run(requestId,body);expect(result).toMatchObject({outcome:'rejected',reset:[]});expect(await f.run(requestId,body)).toEqual(result);}
 expect((await getArtifactById(f.datasetId))!.version).toBe(before);expect(await f.rows()).toEqual([{body:'seed'},{body:'other'}]);const receipts=await f.db.query<{response:{status:number}}>('SELECT response FROM mutation_receipts');expect(receipts.rows.length).toBe(2);expect(receipts.rows.every(row=>row.response.status===409)).toBe(true);
});
it('a page source change at the final transaction boundary refuses without saving data',async()=>{
 const f=await fixture(),before=(await getArtifactById(f.datasetId))!.version,transaction=f.db.transaction.bind(f.db);let injected=false;
 vi.spyOn(f.db,'transaction').mockImplementation(async work=>{if(!injected){injected=true;await f.db.query('UPDATE artifacts SET source=$2 WHERE id=$1',[f.pageId,'changed']);}return transaction(work);});
 await expect(f.run('request_source_1234567890','added')).rejects.toThrow('registered_mutation_unavailable');expect(injected).toBe(true);expect((await getArtifactById(f.datasetId))!.version).toBe(before);expect(await f.rows()).toHaveLength(2);expect((await f.db.query<{response:unknown}>('SELECT response FROM mutation_receipts')).rows.map(row=>row.response)).toEqual([null]);
});
it('grant revocation at the final transaction boundary refuses without saving data',async()=>{
 const f=await fixture(),before=(await getArtifactById(f.datasetId))!.version,transaction=f.db.transaction.bind(f.db);let injected=false;
 vi.spyOn(f.db,'transaction').mockImplementation(async work=>{if(!injected){injected=true;await f.db.query('UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1',[f.datasetId,JSON.stringify({version:2,allow:[]})]);}return transaction(work);});
 expect(await f.run('request_grants_1234567890','added')).toMatchObject({outcome:'rejected',reset:[]});expect(injected).toBe(true);expect((await getArtifactById(f.datasetId))!.version).toBe(before);expect(await f.rows()).toHaveLength(2);expect((await f.db.query<{response:{status:number}}>('SELECT response FROM mutation_receipts')).rows.map(row=>row.response.status)).toEqual([409]);
});
it('the real adapter refuses a saved historical registration after its page head advances',async()=>{
 const f=await fixture();await f.db.query('UPDATE artifacts SET version=version+1 WHERE id=$1',[f.pageId]);await expect(f.run('request_historical_1234567890','added')).rejects.toThrow();expect(await f.rows()).toHaveLength(2);expect((await f.db.query('SELECT response FROM mutation_receipts')).rows).toHaveLength(0);
});
