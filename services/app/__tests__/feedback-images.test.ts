/**
 * Dataset-bound uploads (lib/document-data/dataset-files/feedback-images) through the real page and bearer doors: the flow,
 * replay protection, the ACL rechecked on every read and before the receipt commits. Merged from
 * lib/artifacts/__tests__/feedback-images.test.ts, which asserted the service's edge cases over doubles.
 * The image, file and picture headers are media-headers.test.ts's rows.
 */
import { claimToken, createUser } from '@/lib/accounts';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import { updateSharingFor, changeMembership } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/document-data/dataset-policy';
import { POST as createArtifact } from '@/app/api/artifacts/route';
import { POST as uploadImage } from '@/app/a/[id]/datasets/[datasetId]/images/route';
import { GET as readImage } from '@/app/a/[id]/datasets/[datasetId]/images/[imageId]/route';
import { POST as uploadFile } from '@/app/api/artifacts/[id]/datasets/[datasetId]/files/route';
import { GET as readFile } from '@/app/a/[id]/datasets/[datasetId]/files/[fileId]/route';
import { getDb } from '@/lib/platform';
import { objectStore } from '@/lib/object-store';
import sharp from 'sharp';
import { expect,it,vi } from 'vitest';
import { request,useAppHarness } from './harness';

useAppHarness();
type Session={credential:'session';userId:string;email:string;emailVerified:boolean};
const imageParams=(id:string,datasetId:string,imageId:string)=>({params:Promise.resolve({id,datasetId,imageId})});
const imageCount=async(datasetId:string)=>(await (await getDb()).query<{count:number}>('SELECT count(*)::int AS count FROM dataset_images WHERE dataset_id=$1',[datasetId])).rows[0]?.count;

/** An owner's private dataset, a public document that imports it with an insert grant, and an approved reporter. */
async function world(){
  const owner=await createUser({email:'mxmx_test_image_owner@example.test'}),reporter=await createUser({email:'mxmx_test_image_reporter@example.test'});
  const token=await mintToken('feedback-images-owner', owner.id);await claimToken(owner.id,token.token);
  const ownerActor={userId:owner.id,tokenId:token.id};
  const make=async(body:object)=>{const response=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:body}));expect(response.status,await response.clone().text()).toBe(201);return response.json();};
  const dataset=await make({dataset:[{message:'initial',image_ref:''}],visibility:'private',access:'readwrite'});
  const document=await make({visibility:'public',markup:`<Helmet><Import name="feedback" src="ref:${dataset.id}" /><Value name="message" type="string" default="" /><Value name="image_ref" type="string" default="" /><Mutation name="submit">{\`insert into feedback.rows (message,image_ref) values ($message,$image_ref)\`}</Mutation></Helmet>`});
  await updateSharingFor(ownerActor,dataset.id,{shares:[{email:reporter.email!,role:'viewer'}]});
  await setDatasetPolicy(ownerActor,dataset.id,{version:2,allow:[{actions:['read'],from:{user:'*'}},{actions:['insert'],from:{artifact:document.id}}]},0);
  await changeMembership({userId:reporter.id,tokenId:null},document.id,{action:'join'});
  await changeMembership(ownerActor,document.id,{action:'approve',userId:reporter.id});
  const pageActor:Session={credential:'session',userId:reporter.id,email:reporter.email!,emailVerified:true};
  const ownerSession:Session={credential:'session',userId:owner.id,email:owner.email!,emailVerified:true};
  const reporterToken=await mintToken('dataset-file-reporter',reporter.id);await claimToken(reporter.id,reporterToken.token);
  const post=(body:Buffer,key='upload-operation-123')=>uploadImage(request(`/a/${document.id}/datasets/${dataset.id}/images`,{method:'POST',actor:pageActor,headers:{'Content-Type':'image/png','X-Edit-Id':document.edit_id,'Idempotency-Key':key},body:new Uint8Array(body)}),{params:Promise.resolve({id:document.id,datasetId:dataset.id})});
  const filePost=(filename='note.txt',body:BodyInit='hello',key='generic-upload-123',editId=document.edit_id,datasetId=dataset.id)=>uploadFile(request(`/api/artifacts/${document.id}/datasets/${datasetId}/files`,{method:'POST',token:reporterToken.token,headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(filename),'X-Edit-Id':editId,'Idempotency-Key':key},body}),{params:Promise.resolve({id:document.id,datasetId})});
  return {owner,ownerActor,make,dataset,document,pageActor,ownerSession,reporterToken,post,filePost};
}

it('uploads through a real pages actor, replays safely, and rechecks the current dataset read grant',async()=>{
  const {ownerActor,make,dataset,document,pageActor,ownerSession,reporterToken,post,filePost}=await world();
  const bytes=await sharp({create:{width:40,height:24,channels:3,background:'#c0392b'}}).png().toBuffer();
  const created=await post(bytes);expect(created.status,await created.clone().text()).toBe(201);const uploaded=await created.json() as {ref:string;url:string};
  expect(uploaded.ref).toMatch(/^dimg:/);expect(uploaded.url).toContain(`/a/${document.id}/datasets/${dataset.id}/images/`);
  const repeated=await post(bytes);expect(repeated.status).toBe(201);expect((await repeated.json()).ref).toBe(uploaded.ref);
  const conflict=await post(Buffer.from('different'),'upload-operation-123');expect(conflict.status).toBe(409);
  const imageId=uploaded.ref.slice('dimg:'.length),read=(who:Session)=>readImage(request(uploaded.url,{actor:who}),imageParams(document.id,dataset.id,imageId));
  const visible=await read(pageActor);expect(visible.status).toBe(200);
  expect((await read(ownerSession)).status).toBe(200);
  expect((await uploadFile(request(`/api/artifacts/${document.id}/datasets/${dataset.id}/files`,{method:'POST',body:'hello'}),{params:Promise.resolve({id:document.id,datasetId:dataset.id})})).status).toBe(403);
  const simultaneous=await Promise.all([filePost(),filePost()]);
  for(const response of simultaneous)expect(response.status,await response.clone().text()).toBe(201);
  const files=await Promise.all(simultaneous.map(response=>response.json()));
  expect(files[0]).toMatchObject({name:'note.txt',contentType:'text/plain',size:5});
  expect(files[0].ref).toMatch(/^dfile:/);expect(files[1].ref).toBe(files[0].ref);
  expect(files[0].url).toBe(`/a/${document.id}/datasets/${dataset.id}/files/${files[0].ref.slice(6)}`);
  expect(files.filter(file=>file.replayed)).toHaveLength(1);
  // Refusals store no bytes: active extensions, paths, empty bodies, an undeclared dataset, a reused key.
  const other=await make({dataset:[{message:'other'}],visibility:'private'});
  const put=vi.spyOn(objectStore(),'put');
  try {
    expect((await filePost('evil.html','<script/>','evil-operation-123')).status).toBe(400);
    expect((await filePost('../note.txt','hello','path-operation-123')).status).toBe(400);
    expect((await filePost('note.txt','','empty-operation-123')).status).toBe(400);
    expect((await filePost('note.txt','hello','undeclared-operation-123',document.edit_id,other.id)).status).toBe(404);
    expect((await filePost('note.txt','changed')).status).toBe(409);
    expect((await filePost('renamed.txt','hello')).status).toBe(409);
    // A generic file's key cannot be replayed through the image door.
    expect((await post(Buffer.from('hello'),'generic-upload-123')).status).toBe(409);
    expect(put).not.toHaveBeenCalled();
  } finally { put.mockRestore(); }
  expect((await filePost('note.txt','hello','stale-operation-123','old-edit')).status).toBe(404);
  const oversized=await uploadFile(request(`/api/artifacts/${document.id}/datasets/${dataset.id}/files`,{method:'POST',token:reporterToken.token,headers:{'Content-Length':'1000000000000','X-Filename':'note.txt','X-Edit-Id':document.edit_id,'Idempotency-Key':'oversized-operation-123'},body:'hello'}),{params:Promise.resolve({id:document.id,datasetId:dataset.id})});
  expect(oversized.status).toBe(413);
  const fileRead=(who=pageActor)=>readFile(request(files[0].url,{actor:who}),{params:Promise.resolve({id:document.id,datasetId:dataset.id,fileId:files[0].ref.slice(6)})});
  expect((await readFile(request(files[0].url),{params:Promise.resolve({id:document.id,datasetId:dataset.id,fileId:files[0].ref.slice(6)})})).status).toBe(404);
  const download=await fileRead();expect(download.status).toBe(200);expect(await download.text()).toBe('hello');
  const db=await getDb(),metaOf=async(ref:string)=>(await db.query<{meta:{filename:string;format:string}}>('SELECT meta FROM dataset_images WHERE id=$1',[ref.slice(6)])).rows[0]?.meta;
  for(const [filename,contentType] of [['report.pdf','application/pdf'],['data.csv','text/csv'],['archive.zip','application/zip']]){
    const stored=await filePost(filename,'file',`inert-${filename.replace('.','-')}-123`);
    expect(stored.status,await stored.clone().text()).toBe(201);
    const receipt=await stored.json();
    expect(receipt,filename).toMatchObject({name:filename,contentType,size:4});
    expect((await metaOf(receipt.ref))?.format,filename).toBe('file');
  }
  const imageUpload=await filePost('proof.png',new Uint8Array(bytes),'generic-image-123');
  expect(imageUpload.status,await imageUpload.clone().text()).toBe(201);
  const imageFile=await imageUpload.json();
  expect(imageFile.contentType).toBe('image/webp');
  expect(imageFile.name).toBe('proof.webp');
  const imageDownload=await readFile(request(imageFile.url,{actor:pageActor}),{params:Promise.resolve({id:document.id,datasetId:dataset.id,fileId:imageFile.ref.slice(6)})});
  expect((await sharp(Buffer.from(await imageDownload.arrayBuffer())).metadata()).format).toBe('webp');
  const replayedImage=await filePost('proof.png',new Uint8Array(bytes),'generic-image-123');
  expect(await replayedImage.json()).toMatchObject({...imageFile,replayed:true});
  expect(await metaOf(imageFile.ref)).toMatchObject({filename:'proof.png',format:'image'});
  await setDatasetPolicy(ownerActor,dataset.id,{version:2,allow:[{actions:['read'],from:{user:ownerActor.userId}},{actions:['insert'],from:{artifact:document.id}}]},1);
  // The read grant is checked on every request, before any bytes are loaded.
  const get=vi.spyOn(objectStore(),'get');
  try {
    expect((await read(pageActor)).status).toBe(404);
    expect((await fileRead()).status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  } finally { get.mockRestore(); }
  expect((await read(ownerSession)).status).toBe(200);
  await setDatasetPolicy(ownerActor,dataset.id,{version:2,allow:[{actions:['read'],from:{user:ownerActor.userId}}]},2);
  expect((await filePost()).status).toBe(403);
  await db.query('UPDATE artifacts SET deleted_at=now() WHERE id=$1',[dataset.id]);
  expect((await read(ownerSession)).status).toBe(404);
  expect(await imageCount(dataset.id)).toBe(6);
});

it('rechecks the insert grant after storing the object and before committing the receipt',async()=>{
  const {ownerActor,dataset,filePost}=await world();
  const put=vi.spyOn(objectStore(),'put').mockImplementationOnce(async()=>{
    await setDatasetPolicy(ownerActor,dataset.id,{version:2,allow:[{actions:['read'],from:{user:'*'}}]},1);
  });
  try {
    const revoked=await filePost('note.txt','hello','revoked-operation-123');
    expect(revoked.status,await revoked.clone().text()).toBe(403);
    expect((await revoked.json()).detail).toMatch(/insert grant/);
    expect(put).toHaveBeenCalledTimes(1);
  } finally { put.mockRestore(); }
  expect(await imageCount(dataset.id)).toBe(0);
});
