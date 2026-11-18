/** Parent acceptance: page source access is not dataset authority; evidence uses viewer policy and fresh fences. */
import {it,expect,vi} from 'vitest';
import { storePolicy, trashRow } from '@/__tests__/artifact-fixtures';
import {createAppHost} from '@/server/host';
import {createGroup,deleteGroup} from '@/lib/groups';
import {SQL_READ_WALL_TIMEOUT_MS,getDb} from '@/lib/platform';
import {APP_ARTIFACT_WORKLOAD_PATH} from '@artifactbin/contracts';
import {mintAccountToken,useAppHarness} from '../../__tests__/harness';
import { setArtifact } from '@/__tests__/rows';
// The evidence budget is the service payload limit; this file holds it at 200 KiB so a wide table passes it without
// building megabytes of metadata.
vi.mock('@artifactbin/contracts',async original=>({...await original<object>(),SERVICE_PAYLOAD_LIMIT:200*1024}));
useAppHarness();
it('reads only explicitly approved pinned page evidence under current viewer policy and final admission',async()=>{
 const owner=await mintAccountToken('mxmx_test_evidence_seed'),group=await createGroup(owner.userId!,{handle:'evidence_seed',name:'Evidence'});
 const host=await createAppHost(),human={credential:'bearer' as const,userId:owner.userId!,tokenId:owner.id};
 const req=(path:string,body:unknown)=>new Request('http://127.0.0.1'+path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
 const create=async(body:unknown)=>{const r=await host.request(req('/api/artifacts',body),human);const b=await r.json();expect(r.status,JSON.stringify(b)).toBe(201);return b;};
 const dataset=await create({title:'Metrics',dataset:[{label:'visible',team:'red',amount:10,secret:'hidden'},{label:'other',team:'blue',amount:90,secret:'also-hidden'}],visibility:'private',destination:{type:'group',id:group.id}});
 const db=await getDb();
 await storePolicy(dataset.id, {version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:['label','team','amount'],filter:{team:{_eq:'red'}},allow_aggregations:true}}]}]});
 const unapproved=await create({title:'Unapproved',dataset:[{private_note:'unapproved-value'}],visibility:'private',destination:{type:'group',id:group.id}});
 const page=await create({title:'Saved metrics',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="metrics" href="ref:${dataset.id}" data-af-mode="pinned" data-af-revision="1"><link rel="af-dataset" data-af-name="unapproved" href="ref:${unapproved.id}" data-af-mode="pinned" data-af-revision="1"></head><body><h1>Saved metrics</h1></body></html>`,visibility:'private',destination:{type:'group',id:group.id}});
 const principal={issuerId:'worker',subjectId:'subject',grantId:'grant',groupId:group.id,executionId:'execution',environmentId:'environment',intentHash:'intent',epoch:1};
 const approved={pageId:page.id,revision:'1',links:[{name:'metrics',datasetId:dataset.id,revision:'1'}],role:'viewer'};
 let readIds=[page.id],badEcho=false;
 let grant:unknown=approved,denyFinal=false,change:(()=>Promise<unknown>)|null=null;const phases:string[]=[];
 vi.spyOn(await import('@/lib/platform'),'serviceAudiences').mockReturnValue([{id:'worker',origin:'https://worker.example',introspectionSecretSha256:'0'.repeat(64),artifactWorkloads:{authorizationUrl:'http://127.0.0.1/authorize',authorizationSecret:'callback-secret-test'}}]);
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  expect(String(input)).toBe('http://127.0.0.1/authorize');const b=JSON.parse(String(init?.body));phases.push(b.phase);
  if(b.phase==='final'&&change)await change();
  return Response.json({digest:badEcho?'wrong':b.digest,nonce:b.nonce,scope:denyFinal&&b.phase==='final'?{allowed:false}:{allowed:true,principal,role:'viewer',readArtifactIds:readIds,rootFolderId:null,visibility:'private',...(grant?{pageDatasetSelect:grant}:{})}});
 });
 const operation={kind:'page-evidence-sql',pageId:page.id,revision:'1',sql:'select label,amount from metrics order by label',params:{}};
 const call=(op:unknown=operation)=>host.request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation:op}),{credential:'workload',workload:principal});
 try{
  const r=await call(),body=await r.json();expect(r.status,JSON.stringify(body)).toBe(200);
  expect(body).toMatchObject({pageId:page.id,revision:'1',bindings:approved.links,rows:[{label:'visible',amount:10}]});expect(JSON.stringify(body)).not.toContain('hidden');expect(phases).toEqual(['admission','final']);
  const schema=await call({kind:'page-evidence-schema',pageId:page.id,revision:'1'});expect(schema.status).toBe(200);const shape=await schema.json();expect(shape.tables[0].columns.map((c:{name:string})=>c.name)).toContain('amount');expect(JSON.stringify(shape)).not.toContain('secret');
  grant={...approved,links:[...approved.links,{name:'unapproved',datasetId:unapproved.id,revision:'1'}]};
  expect((await (await call()).json()).bindings).toEqual(approved.links);grant=approved;
  grant=undefined;expect((await call()).status).toBe(403);grant=approved;
  badEcho=true;expect((await call()).status).toBe(403);badEcho=false;
  readIds=[];expect((await call()).status).toBe(403);readIds=[page.id];
  for(const links of [[],[approved.links[0],approved.links[0]],[approved.links[0],{...approved.links[0],name:'duplicate'}]]){grant={...approved,links};expect((await call()).status).toBe(403);}grant=approved;
  const observed=await (await host.request(new Request('http://127.0.0.1/api/artifacts/'+dataset.id),human)).json();
  const changed=await host.request(new Request('http://127.0.0.1/api/artifacts/'+dataset.id,{method:'PUT',body:JSON.stringify({dataset:[{label:'head-only',team:'red',amount:700,secret:'head-secret'}],expectedVersion:observed.version,expectedState:observed.state}),headers:{'content-type':'application/json'}}),human);
  expect(changed.status,await changed.clone().text()).toBe(200);
  const head=await (await host.request(new Request('http://127.0.0.1/api/artifacts/'+dataset.id),human)).json();
  expect(JSON.stringify(head)).toContain('head-only');
  expect((await (await call()).json()).rows).toEqual([{label:'visible',amount:10}]);
  expect(JSON.stringify(await (await call({kind:'page-evidence-schema',pageId:page.id,revision:'1'})).json())).not.toContain('private_note');
  expect((await call({...operation,sql:'select * from unapproved'})).status).toBeGreaterThanOrEqual(400);
  const direct=await host.request(new Request('http://127.0.0.1/api/artifacts/'+dataset.id),{credential:'workload',workload:principal});expect(direct.status).toBeGreaterThanOrEqual(400);
  expect((await call({...operation,revision:'2'})).status).toBeGreaterThanOrEqual(400);
  for(const sql of ['drop table metrics','select 1; select 2','with d as (delete from metrics returning *) select * from d','select * from sqlite_master',"select readfile('/tmp/private')",'select * from default.rows'])expect((await call({...operation,sql})).status).toBeGreaterThanOrEqual(400);
  expect((await call({...operation,sql:'select '+"'x' || ".repeat(12000)+"'x'"})).status).toBe(413);
  expect((await call({...operation,sql:'select $big as value from metrics',params:{big:'x'.repeat(110000)}})).status).toBe(200);
  expect((await call({...operation,sql:'select $big as a,$big as b from metrics',params:{big:'x'.repeat(110000)}})).status).toBe(413);
  expect((await call({...operation,sql:'with recursive seq(n) as (select 1 union all select n+1 from seq where n<10001) select n from seq'})).status).toBe(413);
  const original=(await db.query('SELECT * FROM artifacts WHERE id=$1',[dataset.id])).rows[0];
  const restore=()=>setArtifact(db,dataset.id,{group_id:original.group_id,deleted_at:null,dataset_policy:JSON.stringify(original.dataset_policy),policy_revision:original.policy_revision});
  const foreign=await createGroup(owner.userId!,{handle:'evidence_foreign',name:'Foreign'});
  for(const mutate of [()=>setArtifact(db,dataset.id,{group_id:foreign.id}),()=>trashRow(dataset.id)]){
   change=mutate;const refused=await call();expect(refused.status).toBeGreaterThanOrEqual(400);expect(await refused.text()).not.toContain('visible');change=null;await restore();
  }
  change=async()=>{grant={...approved,links:[]};};expect((await call()).status).toBe(403);change=null;grant=approved;
  const pageRow=(await db.query('SELECT * FROM artifacts WHERE id=$1',[page.id])).rows[0];
  change=()=>setArtifact(db,page.id,{version:{sql:'version+1'}});expect((await call()).status).toBeGreaterThanOrEqual(400);change=null;await setArtifact(db, page.id, { version: pageRow.version });
  const archived=(await db.query('SELECT * FROM artifact_versions WHERE artifact_id=$1 AND version=1',[dataset.id])).rows[0];expect(archived).toBeTruthy();
  // Archive deletion is injected after execution: the exact saved data must still be available at delivery.
  change=()=>db.query('DELETE FROM artifact_versions WHERE artifact_id=$1 AND version=1',[dataset.id]);expect((await call()).status).toBeGreaterThanOrEqual(400);change=null;
  // Reinsert the real archive, preserving every column for the remaining policy-fence assertions.
  const keys=Object.keys(archived);await db.query('INSERT INTO artifact_versions ('+keys.join(',')+') VALUES ('+keys.map((_,i)=>'$'+(i+1)).join(',')+')',keys.map(k=>archived[k]));
  const controller=new AbortController();controller.abort();expect((await host.request(new Request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation}),{signal:controller.signal}),{credential:'workload',workload:principal})).status).toBeGreaterThanOrEqual(400);

  denyFinal=true;expect((await call()).status).toBe(403);denyFinal=false;
  for(const wrong of [{...approved,revision:'2'},{...approved,role:'editor'},{...approved,links:[{...approved.links[0],datasetId:'unrelated'}]}]){grant=wrong;expect((await call()).status).toBeGreaterThanOrEqual(400);}grant=approved;
  for(const sql of ['select secret from metrics','delete from metrics','select * from unrelated'])expect((await call({...operation,sql})).status).toBeGreaterThanOrEqual(400);

  // Missing human-dependent session variables cannot become an anonymous or editor bypass.
  const priorPolicy=(await db.query('SELECT dataset_policy FROM artifacts WHERE id=$1',[dataset.id])).rows[0].dataset_policy;
  await storePolicy(dataset.id, {version:3,tables:[{table:{schema:'public',name:'rows'},select_permissions:[{role:'viewer',permission:{columns:['label'],filter:{label:{_eq:'X-Hasura-User-Id'}}}}]}]});
  expect((await call()).status).toBeGreaterThanOrEqual(400);
  await storePolicy(dataset.id, priorPolicy);
  const abortFinal=new AbortController();change=async()=>{abortFinal.abort();await new Promise(()=>{});};
  const cancelled=await host.request(new Request(req(APP_ARTIFACT_WORKLOAD_PATH,{operation}),{signal:abortFinal.signal}),{credential:'workload',workload:principal});expect(cancelled.status).toBeGreaterThanOrEqual(400);expect(await cancelled.text()).not.toContain('visible');change=null;
  const nativeTimeout=AbortSignal.timeout.bind(AbortSignal),timeout=vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>nativeTimeout(ms>20000&&ms<=SQL_READ_WALL_TIMEOUT_MS?25:ms));
  vi.mocked(globalThis.fetch).mockImplementationOnce(async()=>new Promise(()=>{}));
  const timed=await call();expect(timed.status).toBeGreaterThanOrEqual(400);expect(await timed.text()).not.toContain('visible');expect(timeout.mock.calls.some(([ms])=>ms>20000&&ms<=SQL_READ_WALL_TIMEOUT_MS)).toBe(true);expect(timeout.mock.calls.map(([ms])=>ms)).toContain(10000);timeout.mockRestore();
  // Schema discovery cannot open row objects, and the full metadata JSON has the same SERVICE_PAYLOAD_LIMIT budget (held at 200 KiB above).
  const datasets=await import('@/lib/datasets'),loadRows=vi.spyOn(datasets,'loadDatasetRows').mockRejectedValue(Error('schema opened rows'));
  expect((await call({kind:'page-evidence-schema',pageId:page.id,revision:'1'})).status).toBe(200);expect(loadRows).not.toHaveBeenCalled();loadRows.mockRestore();
  const wide=await create({title:'Wide metadata',dataset:[Object.fromEntries(Array.from({length:2800},(_,i)=>['column_'+i+'_'+'x'.repeat(64),i]))],visibility:'private',destination:{type:'group',id:group.id}});
  const widePage=await create({title:'Wide page',html:`<html><head><link rel="af-dataset" data-af-name="wide" href="ref:${wide.id}" data-af-mode="pinned" data-af-revision="1"></head><body>Metadata</body></html>`,visibility:'private',destination:{type:'group',id:group.id}});
  grant={pageId:widePage.id,revision:'1',role:'viewer',links:[{name:'wide',datasetId:wide.id,revision:'1'}]};readIds=[widePage.id];
  const wideResult=await call({kind:'page-evidence-schema',pageId:widePage.id,revision:'1'});expect(wideResult.status,await wideResult.clone().text()).toBe(413);expect(await wideResult.text()).not.toContain('column_');grant=approved;readIds=[page.id];
  change=()=>storePolicy(dataset.id, {version:3,tables:[]});
  const revoked=await call();expect(revoked.status).toBeGreaterThanOrEqual(400);expect(await revoked.text()).not.toContain('visible');
  change=null;await storePolicy(dataset.id, priorPolicy);
  change=()=>deleteGroup(owner.userId!,group.id,'evidence_seed');
  const deletedGroup=await call();expect(deletedGroup.status).toBeGreaterThanOrEqual(400);expect(await deletedGroup.text()).not.toContain('visible');
 }finally{vi.restoreAllMocks();}
});
