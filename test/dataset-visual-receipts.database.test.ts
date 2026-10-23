import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,binding,context} from './dataset-runtime-fixture.ts';
import {createSqlDatabase} from '../src/persistence/sql.ts';
import {createDatasetMutationRepository,registerDatasetMutationOperations} from '../src/persistence/dataset-mutations.ts';
import {createDatasetMutationObjectStore} from '../src/datasets/mutation/object-store.ts';
import {createDatasetAttachmentRepository,registerDatasetAttachments} from '../src/persistence/dataset-attachments.ts';
import {sealMutationReceiptIdentity,sealAttachmentReceiptIdentity} from '../src/persistence/dataset-receipt-identity.ts';
import type {DatasetMutationOperation} from '../src/datasets/mutation/contracts.ts';
import type {DatasetAttachmentRegistration,DatasetAttachmentStaged} from '../src/datasets/attachments/contracts.ts';

test('visual authority aliases preserve mutation leases and receipts and attachment retries while author revisions remain distinct',async()=>{
 const {env}=await fixture();const directory=await mkdtemp(join(tmpdir(),'visual-receipts-'));
 try{
 const db=createSqlDatabase({pool:env.pool,initialize:async()=>{},statementTimeoutMs:15000}),objects=createDatasetMutationObjectStore(directory),mutations=createDatasetMutationRepository({database:db,objects,now:()=>100});
 await env.pool.query("UPDATE dataset_resources SET writable=true,access=jsonb_set(access,'{shares}','{\"member\":\"editor\"}'),snapshot=jsonb_set(snapshot,'{policy}',$1::jsonb)",[JSON.stringify({version:2,allow:[{actions:['insert','read','update'],from:{user:'*',artifact:'*'}}]})]);
 await env.pool.query("INSERT INTO sessions(token_hash,actor,expires) VALUES('session','member',9999999999999)");
 const operation:DatasetMutationOperation={name:'rename',backendId:context.backendId,backendVersion:context.backendVersion,page:binding.page,datasetId:binding.dataset.id,target:{schema:'public',table:'rows'},sql:'UPDATE rows SET name=$name',paramTypes:{name:'string'},conflictMode:'refuse',analysis:{operation:'update',columns:['name']}};
 await db.transaction(async c=>{await registerDatasetMutationOperations(c,[{sourceNamespace:'legacy',bindingName:'sales',operation}]);await registerDatasetAttachments({client:c,registrations:[{backendNamespace:'bridge',sourceNamespace:'legacy',binding,acceptedTypes:['image/png']}]});});
 const request=(requestId:string)=>({operation:'rename',requestId,params:{name:'updated'}});
 async function stage(op:DatasetMutationOperation,id:string){const start=await mutations.begin(context,op,request(id));assert.equal(start.kind,'lease');if(start.kind!=='lease')throw Error('lease required');const head=await mutations.head(context,op);assert.ok(head);const rows=[{name:'updated'}],object=await objects.persist(rows);return {context,operation:op,lease:start.lease,head,object,outcome:{rows,columns:[...head.tables[0]!.columns],affected:1,analysis:{operation:'update' as const,columns:['name'],functions:[]}}};}
 const completed=await mutations.commit(await stage(operation,'completed'));assert.equal(completed.kind,'committed');
 const refused=await mutations.begin(context,operation,request('refused'));assert.equal(refused.kind,'lease');if(refused.kind!=='lease')throw Error('lease required');await mutations.refuse(refused.lease,'denied');
 const inflight=await stage(operation,'inflight');
 const attachments=createDatasetAttachmentRepository({database:db,now:()=>100}),ac={...context,credentialHash:'session',backendNamespace:'bridge',bindingName:'sales'};
 let promotions=0;const staged:DatasetAttachmentStaged={inputSha256:'c'.repeat(64),object:{sha256:'d'.repeat(64),storageKey:'d'.repeat(64),byteLength:8,contentType:'image/png',filename:'photo.png'},publish:async()=>{promotions++},discard:async()=>{}};
 const uploadRequest={requestId:'same_upload',filename:'photo.png',contentType:'image/png' as const};
 const initial=await attachments.authority(ac);assert.ok(initial);const uploaded=await attachments.commit({context:ac,initial,staged,request:uploadRequest});
 // Model the trusted offline publisher: immutable old descriptors are copied, never edited.
 async function publishVisualAlias(){await db.transaction(async c=>{
  await c.query("INSERT INTO dataset_pages SELECT page_id,2,source_namespace,snapshot FROM dataset_pages WHERE page_id=$1 AND page_version=1",[context.pageId]);
  const descriptor=(await c.query('SELECT descriptor FROM dataset_bindings WHERE page_id=$1',[context.pageId])).rows[0]!.descriptor as Omit<typeof binding,'tables'>;descriptor.page.version=2;
  await c.query("INSERT INTO dataset_bindings SELECT backend_id,backend_version,page_id,2,name,source_namespace,dataset_id,dataset_version,$2 FROM dataset_bindings WHERE page_id=$1 AND page_version=1",[context.pageId,descriptor]);
  await c.query("INSERT INTO af_page_backends SELECT page_id,2,position,name,file_id,version FROM af_page_backends WHERE page_id=$1 AND page_version=1",[context.pageId]);
  await c.query("INSERT INTO dataset_mutation_operations SELECT backend_id,backend_version,page_id,2,name,source_namespace,binding_name,dataset_id,$2 FROM dataset_mutation_operations WHERE page_id=$1 AND page_version=1",[context.pageId,sealMutationReceiptIdentity(operation,2)]);
  const reg=(await c.query('SELECT registration FROM dataset_attachment_bindings WHERE page_id=$1',[context.pageId])).rows[0]!.registration as DatasetAttachmentRegistration;
  await c.query("INSERT INTO dataset_attachment_bindings SELECT backend_id,backend_version,page_id,2,name,backend_namespace,source_namespace,$2 FROM dataset_attachment_bindings WHERE page_id=$1 AND page_version=1",[context.pageId,sealAttachmentReceiptIdentity(reg,2)]);
  await c.query("UPDATE files SET head='2' WHERE id=$1",[context.pageId]);
 });}
 await publishVisualAlias();const alias=await mutations.operation(context,'rename');assert.ok(alias);
 assert.deepEqual(await mutations.begin(context,alias,request('completed')),{kind:'replay',result:completed.kind==='committed'?completed.result:undefined});
 assert.deepEqual(await mutations.begin(context,alias,request('refused')),{kind:'refused',code:'denied'});
 assert.deepEqual(await mutations.begin(context,alias,request('inflight')),{kind:'busy'});
 assert.equal((await env.pool.query('SELECT count(*)::int n FROM dataset_mutation_receipts')).rows[0].n,3);
 // The lease and head captured before the visual append can still finish once.
 const finished=await mutations.commit(inflight);assert.equal(finished.kind,'committed');
 assert.deepEqual(await mutations.begin(context,alias,request('inflight')),{kind:'replay',result:finished.kind==='committed'?finished.result:undefined});
 const fresh=await mutations.commit(await stage(alias,'fresh'));assert.equal(fresh.kind,'committed');
 const nextInitial=await attachments.authority(ac);assert.ok(nextInitial);const replay=await attachments.commit({context:ac,initial:nextInitial,staged,request:uploadRequest});assert.equal(replay.replayed,true);assert.equal(replay.record.id,uploaded.record.id);assert.equal(promotions,1);
 // A genuine later author revision has its own receipt identity.
 const authored={...operation,page:{...operation.page,version:3}};
 await env.pool.query("INSERT INTO af_page_backends SELECT page_id,3,position,name,file_id,version FROM af_page_backends WHERE page_id=$1 AND page_version=1",[context.pageId]);
 await env.pool.query("INSERT INTO dataset_pages SELECT page_id,3,source_namespace,snapshot FROM dataset_pages WHERE page_id=$1 AND page_version=1",[context.pageId]);
 const descriptor=(await env.pool.query('SELECT descriptor FROM dataset_bindings WHERE page_id=$1 AND page_version=1',[context.pageId])).rows[0]!.descriptor as Omit<typeof binding,'tables'>;descriptor.page.version=3;
 await env.pool.query("INSERT INTO dataset_bindings SELECT backend_id,backend_version,page_id,3,name,source_namespace,dataset_id,dataset_version,$2 FROM dataset_bindings WHERE page_id=$1 AND page_version=1",[context.pageId,descriptor]);
 await env.pool.query("UPDATE files SET head='3' WHERE id=$1",[context.pageId]);
 await db.transaction(c=>registerDatasetMutationOperations(c,[{sourceNamespace:'legacy',bindingName:'sales',operation:authored}]));
 assert.equal((await mutations.begin(context,authored,request('completed'))).kind,'lease');
 }finally{await env.cleanup();await rm(directory,{recursive:true,force:true});}
});
