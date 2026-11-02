import type {Actor} from '@artifactbin/contracts';
import {expect,it,vi} from 'vitest';
import { createUser, identityForUser } from '@/lib/accounts';
import {changeMembership,membershipState} from '@/lib/artifacts';
import {mintAccountToken,request,useAppHarness} from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as uploadFile} from '@/app/a/[id]/datasets/[datasetId]/files/route';
import {GET as readFile} from '@/app/a/[id]/datasets/[datasetId]/files/[fileId]/route';
import {createFileUploader,fileUploadResult} from '../upload';
/** The native upload HTTP contract; relay admission is covered by html-reader's bridge tests. */
function uploadRequest(documentId:string,editId:string,payload:{datasetId:string;contentType:string;filename:string;requestId:string;bytes:Uint8Array}){
 return {path:`/a/${documentId}/datasets/${payload.datasetId}/files`,init:{headers:{'Content-Type':payload.contentType,'X-Filename':encodeURIComponent(payload.filename),'X-Edit-Id':editId,'Idempotency-Key':payload.requestId},body:new Uint8Array(payload.bytes)}};
}
import {getDb,generateInternalId} from '@/lib/platform';
import {objectStore} from '@/lib/object-store';
useAppHarness();
it.each(['legacy','grants','direct'])('the native upload port composes with real storage, durable replay and current dataset authority (%s)',async mode=>{
 const owner=await createUser({email:'mxmx_test_native_upload@example.test'}),other=await createUser({email:'mxmx_test_native_upload_other@example.test'}),token=await mintAccountToken('native-upload',owner.id);
 const make=async(body:object)=>{const response=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return response.json();};
 const dataset=await make({dataset:[{fixture:'native-upload'}],visibility:'private',...(mode==='legacy'?{access:'readwrite'}:{})});
 const document=await make({visibility:'unlisted',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="attachments" href="ref:${dataset.id}" data-af-mode="live"></head><body>Upload</body></html>`});
 expect((await membershipState(identityForUser(owner.id),document.id)).self?.status).toBe('accepted');
 if(mode==='direct'){
  await changeMembership(identityForUser(owner.id),document.id,{action:'leave'});
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1',[dataset.id,JSON.stringify({version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{user:owner.id}}]})]);
 }
 let actor:Actor={credential:'session',userId:owner.id,email:owner.email??undefined,emailVerified:true},loseResponse=true;
 const uploader=createFileUploader({readOnly:()=>false,datasetId:name=>name==='attachments'?dataset.id:undefined,async send(payload){
  const admitted=uploadRequest(document.id,document.edit_id,payload);
  const response=await uploadFile(request(admitted.path,{method:'POST',actor,headers:Object.fromEntries(new Headers(admitted.init.headers)),body:admitted.init.body??undefined}),{params:Promise.resolve({id:document.id,datasetId:dataset.id})});const body=await response.json();
  if(!response.ok)throw Error(`Upload ${response.status}: ${body.detail??body.error}`);
  if(loseResponse){loseResponse=false;throw Error('successful response lost');}return fileUploadResult(body);
 }});
 const file=new File(['hello'],'sample.txt',{type:'text/plain'});
 await expect(uploader.upload(file,{dataset:'attachments'})).rejects.toThrow('response lost');
 const result=await uploader.upload(file,{dataset:'attachments'});expect(result).toMatchObject({replayed:true,name:'sample.txt',size:5,contentType:'text/plain'});
 const stored=await readFile(request(result.url,{actor}),{params:Promise.resolve({id:document.id,datasetId:dataset.id,fileId:result.ref.slice(6)})});expect(stored.status).toBe(200);expect(await stored.text()).toBe('hello');
 expect((await (await getDb()).query<{count:number}>('SELECT count(*)::int AS count FROM dataset_images WHERE dataset_id=$1',[dataset.id])).rows[0]?.count).toBe(1);
 await expect(uploader.upload(new File(['<html/>'],'active.html',{type:'text/plain'}),{dataset:'attachments'})).rejects.toThrow('400');
 actor={credential:'session',userId:other.id,email:other.email??undefined,emailVerified:true};await expect(uploader.upload(file,{dataset:'attachments'})).rejects.toThrow(/403|404/);
 expect((await (await getDb()).query<{count:number}>('SELECT count(*)::int AS count FROM dataset_images WHERE dataset_id=$1',[dataset.id])).rows[0]?.count).toBe(1);
});

// The uploader is a page member, not the dataset owner: owner and editors are admin-equivalent and upload regardless.
it.each(['source','policy','membership'])('rechecks saved HTML upload authority after real object storage (%s revoked)',async revoke=>{
 const owner=await createUser({email:'mxmx_test_upload_fence@example.test'}),token=await mintAccountToken('upload-fence',owner.id),member=await createUser({email:'mxmx_test_upload_fence_member@example.test'});
 const make=async(body:object)=>{const result=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:body}));expect(result.status).toBe(201);return result.json();};
 const dataset=await make({dataset:[{fixture:'upload-fence'}],visibility:'private'});
 // New datasets are read-only (v3 template) since the stored migration: open trusted owner programs' inserts, as the old v2 default did.
 const programs={version:3,tables:[{table:{schema:'public',name:'rows'},insert_permissions:['viewer','signed_in'].map(role=>({role,permission:{columns:'*',check:{},backend_only:true}}))}]};
 await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1',[dataset.id,JSON.stringify(programs)]);
 const document=await make({visibility:'unlisted',html:`<!doctype html><html><head><link rel="af-dataset" data-af-name="attachments" href="ref:${dataset.id}" data-af-mode="live"></head><body>Upload</body></html>`});
 await changeMembership(identityForUser(member.id),document.id,{action:'join'});await changeMembership(identityForUser(owner.id),document.id,{action:'approve',userId:member.id});
 const actor:Actor={credential:'session',userId:member.id,email:member.email??undefined,emailVerified:true},db=await getDb(),objects=objectStore(),put=objects.put.bind(objects);
 const hook=vi.spyOn(objects,'put').mockImplementationOnce(async(...args)=>{
  await put(...args);
  if(revoke==='source')await db.query('UPDATE artifacts SET edit_id=$2,version=version+1,meta=meta-\'htmlLinks\' WHERE id=$1',[document.id,generateInternalId()]);
  else if(revoke==='membership')await changeMembership(identityForUser(member.id),document.id,{action:'leave'});
  else await db.query(`UPDATE artifacts SET dataset_policy='{"version":2,"allow":[]}'::jsonb,policy_revision=policy_revision+1 WHERE id=$1`,[dataset.id]);
 });
 try{
  const payload={datasetId:dataset.id,filename:'fence.txt',contentType:'text/plain',requestId:'upload-fence-request',bytes:new TextEncoder().encode('fenced')},admitted=uploadRequest(document.id,document.edit_id,payload);
  const response=await uploadFile(request(admitted.path,{method:'POST',actor,headers:Object.fromEntries(new Headers(admitted.init.headers)),body:admitted.init.body??undefined}),{params:Promise.resolve({id:document.id,datasetId:dataset.id})});
  expect(hook).toHaveBeenCalledOnce();expect(response.status).toBe(revoke==='source'?404:403);
  expect((await db.query<{count:number}>('SELECT count(*)::int AS count FROM dataset_images WHERE dataset_id=$1',[dataset.id])).rows[0]?.count).toBe(0);
 }finally{hook.mockRestore();}
});
