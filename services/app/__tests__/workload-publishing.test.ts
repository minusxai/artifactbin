/** Host-authorized publication belongs to a group and one durable occurrence, never a human token. */
import {expect,it,vi} from 'vitest';
import { trashRow } from '@/__tests__/artifact-fixtures';
import type {Actor,WorkloadBinding,WorkloadOperation} from '@artifactbin/contracts';
import {createAppHost} from '@/server/host';
import {createGroup} from '@/lib/groups';
import {getArtifactById} from '@/lib/artifacts';
import {setArtifactQuotaForTests} from '@/lib/artifacts/testing';
import {effectiveRole,reactionScope,annotationScope,editorScope,ownerScope,transactionAccessFacts} from '@/lib/artifact-access';
import {publicationNamespace} from '@/lib/artifacts';
import {getDb} from '@/lib/platform';
import {admitGroupMember,mintAccountToken,useAppHarness} from './harness';
import {nativeHtml} from './native-html-fixture';
useAppHarness();
const origin='http://127.0.0.1:7451';
const keyA='fixture_publication_key_a',keyB='fixture_publication_key_b';
async function fixture(){
 const owner=await mintAccountToken('mxmx_test_publication_owner');
 const editor=await mintAccountToken('mxmx_test_publication_editor');
 const group=await createGroup(owner.userId!,{handle:'publication_team',name:'Publication team'});
 const other=await createGroup(owner.userId!,{handle:'publication_other',name:'Other team'});
 await admitGroupMember(owner.userId!,group.id,editor.userId!,'editor');
 let maxArtifacts=100,maxBytes=16*1024*1024,hook:((op:WorkloadOperation)=>void|Promise<void>)|undefined;
 let live=true,role:'editor'|'viewer'='editor',publishing=true;
 const binding:{-readonly [K in keyof WorkloadBinding]:WorkloadBinding[K]}={issuerId:'fixture',subjectId:'fixture_schedule',grantId:'accepted_occurrence',groupId:group.id,executionId:'attempt_1',environmentId:'env_1',intentHash:'same_intent',epoch:1};
 let rootFolderId:string|null=null;
 const makeHost=()=>createAppHost({workloadAuthority:{authorize:async (offered,operation)=>{
  await hook?.(operation);
  if(!live||JSON.stringify(offered)!==JSON.stringify(binding))return {allowed:false as const};
  return {allowed:true as const,principal:{...binding},role,readArtifactIds:[],writeArtifactIds:[],rootFolderId,visibility:'private' as const,
   ...(publishing?{publication:{slot:'report',maxArtifacts,maxBytes}}:{})};
 }}});
 const host=await makeHost();
 const human:Actor={credential:'bearer',userId:owner.userId!,tokenId:owner.id};
 const editorActor:Actor={credential:'bearer',userId:editor.userId!,tokenId:editor.id};
 const request=(path:string,method='GET',body?:object,key?:string)=>new Request(origin+path,{method,headers:{'content-type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const humanCreate=async(body:object)=>{
  const r=await host.request(request('/api/artifacts','POST',{visibility:'private',destination:{type:'group',id:group.id},...body}),human);
  expect(r.status,await r.clone().text()).toBe(201);return (await r.json()).id as string;
 };
 const folder=await humanCreate({format:'folder',title:'Reports'});rootFolderId=folder;
 const unrelated=await humanCreate({html:nativeHtml('<p>Unrelated</p>')});
 const payload={html:nativeHtml('<p>Count: 7</p>'),visibility:'private',destination:{type:'group',id:group.id},parent_id:folder};
 const call=(path:string,method='GET',body?:object,key?:string)=>host.request(request(path,method,body,key),{credential:'workload',workload:{...binding}});
 return {host,makeHost,human,editorActor,request,humanCreate,call,payload,group,other,folder,unrelated,binding,
  limits:(count:number,bytes:number)=>{maxArtifacts=count;maxBytes=bytes;},hook:(next:typeof hook)=>{hook=next;},root:(next:string|null)=>{rootFolderId=next;},
  role:(next:typeof role)=>{role=next;},revoke:()=>{live=false;},noPublication:()=>{publishing=false;},
  rows:async()=>(await (await getDb()).query('SELECT id,user_id,token_id,creator_user_id,group_id,visibility,ancestor_ids FROM artifacts ORDER BY id')).rows};
}
async function published(f:Awaited<ReturnType<typeof fixture>>,body:object=f.payload,key=keyA){
 const r=await f.call('/api/artifacts','POST',body,key);
 expect(r.status,await r.clone().text()).toBe(201);return await r.json();
}
it('creates private group-owned output in the selected folder without creating a human credential',async()=>{
 const f=await fixture(),db=await getDb(),before=(await db.query('SELECT id FROM tokens ORDER BY id')).rows;
 const saved=await published(f);
 expect((await f.rows()).find(row=>row.id===saved.id)).toMatchObject({user_id:null,token_id:null,creator_user_id:null,group_id:f.group.id,visibility:'private',ancestor_ids:[f.folder]});
 expect((await db.query('SELECT id FROM tokens ORDER BY id')).rows).toEqual(before);
 expect((await f.call(`/api/artifacts/${saved.id}`)).status).toBe(200);
});
it('recovers the same output across a new journal and execution but refuses changed create intent',async()=>{
 const f=await fixture(),first=await published(f);
 f.binding.executionId='attempt_2';f.binding.environmentId='env_2';
 const retry=await f.call('/api/artifacts','POST',f.payload,keyB);
 expect([200,201]).toContain(retry.status);expect((await retry.json()).id).toBe(first.id);
 const changed=await f.call('/api/artifacts','POST',{...f.payload,html:nativeHtml('<p>Changed create</p>')},'fixture_publication_key_c');
 expect(changed.status).toBe(409);
 expect((await f.rows()).filter(row=>row.token_id===null).map(row=>row.id)).toEqual([first.id]);
});
it('admits one concurrent create and makes another accepted occurrence a distinct report',async()=>{
 const f=await fixture();
 const replies=await Promise.all([f.call('/api/artifacts','POST',f.payload,keyA),f.call('/api/artifacts','POST',f.payload,keyB)]);
 for(const r of replies)expect([200,201]).toContain(r.status);
 const ids=await Promise.all(replies.map(async r=>(await r.json()).id));expect(new Set(ids).size).toBe(1);
 f.binding.grantId='next_accepted_occurrence';
 const next=await published(f);expect(next.id).not.toBe(ids[0]);
});
it('keeps viewer, revoked and read-only grants from claiming or writing a slot',async()=>{
 const f=await fixture(),before=await f.rows();
 f.role('viewer');expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect(await f.rows()).toEqual(before);
 f.role('editor');const saved=await published(f);expect(saved.id).toBeTruthy();
 f.revoke();expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await f.call(`/api/artifacts/${saved.id}`)).status).toBe(403);
});
it('requires an explicit publication grant and refuses scope changes before effects',async()=>{
 const f=await fixture(),before=await f.rows();
 for(const change of [{destination:{type:'personal'}},{destination:{type:'group',id:f.other.id}},{parent_id:null},{visibility:'public'},{shares:[{email:'someone@example.test',role:'viewer'}]}]){
  const r=await f.call('/api/artifacts','POST',{...f.payload,...change},keyA);expect([400,403,404]).toContain(r.status);
 }
 expect(await f.rows()).toEqual(before);
 f.noPublication();expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
});
it('conditionally edits its output but cannot edit unrelated group content or change sharing',async()=>{
 const f=await fixture(),saved=await published(f);
 const head=await (await f.call(`/api/artifacts/${saved.id}`)).json();
 const body={html:nativeHtml('<p>Count: 8</p>'),expectedVersion:head.version,expectedState:head.state};
 const updated=await f.call(`/api/artifacts/${saved.id}`,'PUT',body);
 expect(updated.status,await updated.clone().text()).toBe(200);
 expect((await f.call(`/api/artifacts/${saved.id}`,'PUT',body)).status).toBe(409);
 expect([403,404]).toContain((await f.call(`/api/artifacts/${f.unrelated}`,'PUT',body)).status);
 for(const [method,attempt] of [['DELETE',undefined],['PUT',{...body,visibility:'public'}],['PUT',{...body,parent_id:null}]] as const)
  expect([400,403,404]).toContain((await f.call(`/api/artifacts/${saved.id}`,method,attempt)).status);
});
it('publishes bundled files under the same group folder and recovers the whole graph with a new key',async()=>{
 const f=await fixture();
 const payload={...f.payload,html:nativeHtml('<img src="./mark.svg" alt="Fixture"/>'),publicationBundle:{entryPath:'index.html',files:[{path:'mark.svg',contentType:'image/svg+xml',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>').toString('base64')}]}};
 const saved=await published(f,payload),before=await f.rows();
 expect(saved.dependencyReceipts).toHaveLength(1);
 for(const id of [saved.id,saved.dependencyReceipts[0].id])expect(before.find(row=>row.id===id)).toMatchObject({group_id:f.group.id,user_id:null,token_id:null,visibility:'private',ancestor_ids:[f.folder]});
 f.binding.executionId='attempt_2';
 const retry=await f.call('/api/artifacts','POST',payload,keyB);expect([200,201]).toContain(retry.status);
 expect((await retry.json()).id).toBe(saved.id);expect(await f.rows()).toEqual(before);
});
it('allows an ordinary direct human group Editor to create within its group folder',async()=>{
 const f=await fixture();
 const r=await f.host.request(f.request('/api/artifacts','POST',f.payload),f.editorActor);
 expect(r.status,await r.clone().text()).toBe(201);
});

it('creates a durable auxiliary folder then a report within it, without a second primary',async()=>{
 const f=await fixture();
 const folderBody={format:'folder',title:'Daily',parent_id:f.folder};
 const folder=await published(f,folderBody);
 const retry=await published(f,folderBody,keyB);expect(retry.id).toBe(folder.id);
 const report=await published(f,{...f.payload,parent_id:folder.id},'fixture_nested_report');
 expect((await f.rows()).find(row=>row.id===report.id)?.ancestor_ids).toEqual([f.folder,folder.id]);
 expect((await f.call('/api/artifacts','POST',{...f.payload,parent_id:f.folder},'fixture_changed_parent')).status).toBe(409);
});
it('refuses nonfolders and unrelated parents without storing any output',async()=>{
 const f=await fixture(),before=await f.rows();
 for(const parent_id of [f.unrelated,'missing_parent',null]){
  const response=await f.call('/api/artifacts','POST',{...f.payload,parent_id},keyA);expect([400,403]).toContain(response.status);
 }
 expect(await f.rows()).toEqual(before);
});
it('does not resurrect a tombstoned output and recovers an expired response receipt',async()=>{
 const f=await fixture(),saved=await published(f),db=await getDb();
 await db.query("UPDATE artifact_creation_operations SET response_until=now()-interval '2 days'");
 const recovered=await f.call('/api/artifacts','POST',f.payload,keyB);expect(recovered.status).toBe(200);expect((await recovered.json()).id).toBe(saved.id);
 const removed=await f.host.request(f.request(`/api/artifacts/${saved.id}`,'DELETE'),f.human);expect(removed.status).toBe(200);
 const retry=await f.call('/api/artifacts','POST',f.payload,keyB);expect(retry.status).toBe(410);
});
it('uses live final admission outside the database transaction',async()=>{
 const f=await fixture(),before=await f.rows();let creates=0;
 f.hook(async op=>{await (await getDb()).query('SELECT 1');if(op.kind==='artifact-create'&&++creates===3)f.revoke();});
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect(await f.rows()).toEqual(before);
});
it('charges retries once and enforces cumulative slot and group count limits',async()=>{
 const f=await fixture(),db=await getDb();f.limits(1,1024*1024);
 const saved=await published(f);await published(f,f.payload,keyB);
 expect((await db.query('SELECT artifact_id FROM workload_publication_audit')).rows).toEqual([{artifact_id:saved.id}]);
 expect((await f.call('/api/artifacts','POST',{format:'folder',title:'Extra'},'fixture_extra_folder')).status).toBe(403);
});
it('refuses a byte overflow before recording an artifact or a charge',async()=>{
 const f=await fixture(),db=await getDb();f.limits(10,1);
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await db.query('SELECT * FROM workload_publication_audit')).rows).toEqual([]);
});
it('retains output identity with a fresh host and admits the existing member audience',async()=>{
 const f=await fixture(),saved=await published(f);f.binding.executionId='new_worker';
 const host=await f.makeHost();
 const response=await host.request(f.request('/api/artifacts','POST',f.payload,keyB),{credential:'workload',workload:f.binding});expect(response.status).toBe(201);expect((await response.json()).id).toBe(saved.id);
 expect((await host.request(f.request(`/api/artifacts/${saved.id}`),f.editorActor)).status).toBe(200);
});
it('refuses caller supplied bundle mappings, remote imports, connections and arbitrary doors before effects',async()=>{
 const f=await fixture(),before=await f.rows();
 for(const patch of [{csvUrl:'https://example.test/data.csv'},{connection:{}},{publicationBundle:{entryPath:'index.html',files:[],mappings:{'x.svg':{id:f.unrelated,revision:'1',kind:'asset'}}}}])expect((await f.call('/api/artifacts','POST',{...f.payload,...patch},keyA)).status).toBe(403);
 for(const path of ['/api/tokens','/api/groups','/api/artifacts/reserve'])expect((await f.call(path,'POST',{})).status).toBe(403);
 expect(await f.rows()).toEqual(before);
});

it('charges group storage across distinct accepted occurrences',async()=>{
 const f=await fixture();setArtifactQuotaForTests(1);
 try{
  await published(f);f.binding.grantId='another_occurrence';
  expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 }finally{setArtifactQuotaForTests(null);}
});
it('keeps JS and SQL exact graph editor scope equal, without ownership',async()=>{
 const f=await fixture(),saved=await published(f),db=await getDb();
 const scope={allowed:true as const,principal:f.binding,role:'editor' as const,readArtifactIds:[saved.id],writeArtifactIds:[saved.id],rootFolderId:f.folder,visibility:'private' as const,publication:{slot:'report',maxArtifacts:100,maxBytes:16*1024*1024}};
 const actor={userId:null,tokenId:null,email:null,documentEditor:false,workload:scope};
 expect(publicationNamespace(actor)).toMatch(/^workload:/);
 for(const id of [saved.id,f.unrelated]){
  const row=(await getArtifactById(id))!;
  const role=await effectiveRole(row,actor);expect(role).toBe(id===saved.id?'editor':'none');
  expect(await db.transaction(tx=>effectiveRole(row,actor,transactionAccessFacts(actor,tx)))).toBe(role);
  for(const [scope,expected] of [[reactionScope(actor),id===saved.id],[editorScope(actor),id===saved.id],[annotationScope(actor),id===saved.id],[ownerScope(actor),false]] as const)expect(!!(await db.query(`SELECT 1 FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[id,scope.val])).rows.length).toBe(expected);
 }
});
it('resumes an SVG and CSV graph after a committed dependency loses its reply',async()=>{
 const f=await fixture(),db=await getDb(),transaction=db.transaction.bind(db);let lost=false;
 const payload={...f.payload,html:nativeHtml('<img src="./mark.svg" alt="Fixture"/><link rel="af-dataset" data-af-name="rows" href="./rows.csv">'),publicationBundle:{entryPath:'index.html',files:[
  {path:'mark.svg',contentType:'image/svg+xml',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')},
  {path:'rows.csv',contentType:'text/csv',base64:Buffer.from('name,count\nSample,7\n').toString('base64')},
 ]}};
 const spy=vi.spyOn(db,'transaction').mockImplementation(async callback=>{
  const result=await transaction(callback);
  if(!lost&&result&&typeof result==='object'&&'format' in result&&result.format==='file'){lost=true;throw new Error('Fixture committed reply loss');}
  return result;
 });
 try{const first=await f.call('/api/artifacts','POST',payload,keyA);expect(first.status,await first.clone().text()).toBe(409);expect((await first.json()).dependencyReceipts).toEqual([]);}finally{spy.mockRestore();}
 expect(lost).toBe(true);
 const saved=await published(f,payload,keyB);expect(saved.dependencyReceipts).toHaveLength(2);
 const rows=await f.rows();for(const receipt of saved.dependencyReceipts)expect(rows.find(row=>row.id===receipt.id)).toMatchObject({group_id:f.group.id,ancestor_ids:[f.folder],token_id:null,user_id:null});
 expect((await db.query('SELECT * FROM workload_publication_outputs')).rows).toHaveLength(3);
});
it('stops between dependency admissions and preserves truthful partial receipts',async()=>{
 const f=await fixture();let effects=0;
 f.hook(op=>{if(op.kind==='artifact-create'&&op.resource.startsWith('dependency:')&&++effects===2)f.revoke();});
 const payload={...f.payload,html:nativeHtml('<img src="./one.svg" alt="One"/><img src="./two.svg" alt="Two"/>'),publicationBundle:{entryPath:'index.html',files:['one.svg','two.svg'].map(path=>({path,contentType:'image/svg+xml',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}))}};
 const response=await f.call('/api/artifacts','POST',payload,keyA);expect(response.status).toBe(409);expect((await response.json()).dependencyReceipts).toHaveLength(1);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_outputs')).rows).toHaveLength(1);
});
it('denies a trashed root without claiming a slot or storing output',async()=>{
 const f=await fixture(),db=await getDb();await trashRow(f.folder);
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await db.query('SELECT * FROM workload_publication_outputs')).rows).toEqual([]);
 expect((await db.query('SELECT * FROM workload_publication_intents')).rows).toEqual([]);
});
it('denies an adapter exception without claiming a slot',async()=>{
 const f=await fixture();f.hook(()=>{throw new Error('Fixture authority failure');});
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_intents')).rows).toEqual([]);
});

it('reconciles a lost primary commit reply across a fresh host and journal',async()=>{
 const f=await fixture(),db=await getDb(),transaction=db.transaction.bind(db);let lost=false;
 const spy=vi.spyOn(db,'transaction').mockImplementation(async callback=>{const result=await transaction(callback);if(!lost&&result&&typeof result==='object'&&'format' in result&&result.format==='html'){lost=true;throw new Error('Fixture committed page reply loss');}return result;});
 try{expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(500);}finally{spy.mockRestore();}
 const committed=(await db.query<{artifact_id:string}>('SELECT artifact_id FROM workload_publication_outputs')).rows[0]!.artifact_id;
 const host=await f.makeHost();f.binding.executionId='restarted_worker';
 const response=await host.request(f.request('/api/artifacts','POST',f.payload,keyB),{credential:'workload',workload:f.binding});expect(response.status).toBe(201);expect((await response.json()).id).toBe(committed);
 expect((await db.query('SELECT * FROM workload_publication_audit')).rows).toHaveLength(1);
});
it('retains dependency tombstones and refuses to resurrect their graph',async()=>{
 const f=await fixture();const payload={...f.payload,html:nativeHtml('<img src="./mark.svg" alt="Fixture"/>'),publicationBundle:{entryPath:'index.html',files:[{path:'mark.svg',contentType:'image/svg+xml',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}]}};
 const saved=await published(f,payload),dependency=saved.dependencyReceipts[0].id;
 const head=await (await f.call(`/api/artifacts/${dependency}`)).json();expect((await f.call(`/api/artifacts/${dependency}`,'PUT',{html:nativeHtml('<p>Extra primary</p>'),expectedVersion:head.version,expectedState:head.state})).status).toBe(403);
 expect((await f.host.request(f.request(`/api/artifacts/${dependency}?force=true`,'DELETE'),f.human)).status).toBe(200);
 expect((await f.call('/api/artifacts','POST',payload,keyB)).status).toBe(409);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_outputs')).rows).toHaveLength(2);
});
it('keeps workload update receipts separate and charges successful replacement bytes cumulatively',async()=>{
 const f=await fixture(),saved=await published(f),head=await (await f.call(`/api/artifacts/${saved.id}`)).json(),db=await getDb();
 const body={html:nativeHtml('<p>Replacement</p>'),expectedVersion:head.version,expectedState:head.state},key='fixture_update_receipt';
 expect((await f.call(`/api/artifacts/${saved.id}`,'PUT',body,key)).status).toBe(200);
 expect((await f.call(`/api/artifacts/${saved.id}`,'PUT',body,key)).status).toBe(200);
 expect((await f.call(`/api/artifacts/${saved.id}`,'PUT',{...body,html:nativeHtml('<p>Changed</p>')},key)).status).toBe(409);
 const charges=(await db.query<{bytes:string}>('SELECT bytes FROM workload_publication_audit')).rows;expect(charges).toHaveLength(2);expect(charges.every(row=>Number(row.bytes)>0)).toBe(true);
});
it('concurrently recovers one primary and one dependency per path',async()=>{
 const f=await fixture(),payload={...f.payload,html:nativeHtml('<img src="./one.svg" alt="One"/><img src="./two.svg" alt="Two"/>'),publicationBundle:{entryPath:'index.html',files:['one.svg','two.svg'].map(path=>({path,contentType:'image/svg+xml',base64:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}))}};
 const responses=await Promise.all([f.call('/api/artifacts','POST',payload,keyA),f.call('/api/artifacts','POST',payload,keyB)]);
 const results=[];for(const response of responses){expect(response.status,await response.clone().text()).toBe(201);results.push(await response.json());}
 expect(results[0].id).toBe(results[1].id);expect(results[0].dependencyReceipts).toEqual(results[1].dependencyReceipts);
 expect(new Set(results[0].dependencyReceipts.map((receipt:{id:string})=>receipt.id)).size).toBe(2);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_audit')).rows).toHaveLength(3);
});
it('denies malformed trusted publication limits without claiming anything',async()=>{
 const f=await fixture();f.limits(Number.POSITIVE_INFINITY,1000);
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_intents')).rows).toEqual([]);
});

it('defaults publication destination, visibility and parent from the trusted grant',async()=>{
 const f=await fixture(),saved=await published(f,{html:f.payload.html});
 expect((await f.rows()).find(row=>row.id===saved.id)).toMatchObject({group_id:f.group.id,visibility:'private',ancestor_ids:[f.folder]});
 const replay=await published(f,f.payload,keyB);expect(replay.id).toBe(saved.id);
});
it('denies a role downgrade at the last effect admission',async()=>{
 const f=await fixture();let calls=0;f.hook(()=>{if(++calls===3)f.role('viewer');});
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_audit')).rows).toEqual([]);
});
it('refuses a cross-group moved root and a nonfolder root before claiming intent',async()=>{
 const f=await fixture(),db=await getDb();
 await db.query('UPDATE artifacts SET group_id=$2 WHERE id=$1',[f.folder,f.other.id]);
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 await db.query("UPDATE artifacts SET group_id=$2,format='file' WHERE id=$1",[f.folder,f.group.id]);
 expect((await f.call('/api/artifacts','POST',f.payload,keyA)).status).toBe(403);
 expect((await db.query('SELECT * FROM workload_publication_intents')).rows).toEqual([]);
});
it('enforces the canonical depth bound for a trusted root deep in the group tree',async()=>{
 const f=await fixture();let parent=f.folder;
 for(let i=0;i<5;i++)parent=await f.humanCreate({format:'folder',title:'Level '+i,parent_id:parent});
 f.root(parent);const response=await f.call('/api/artifacts','POST',{...f.payload,parent_id:parent},keyA);expect(response.status).toBe(400);
 expect((await (await getDb()).query('SELECT * FROM workload_publication_outputs')).rows).toEqual([]);
});
