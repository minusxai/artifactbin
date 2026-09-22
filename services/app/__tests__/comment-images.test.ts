import {GET as readImageRoute} from '@/app/api/my/artifacts/[id]/comment-images/[imageId]/route';
import {getDb} from '@/lib/db';
import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {useAppHarness,request,agentCookie} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as createComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {stageCommentImage,readCommentImage} from '@/lib/comment-images';
import {assetBytesForToken,setAssetByteQuotaForTests} from '@/lib/asset-quota';
import type {CommentImageMetadata} from '../../contracts/src/comment-image';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
async function setup(){
 const token=await mintToken('agent');
 const response=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p>Capture me</p>'}}));
 expect(response.status).toBe(201);const doc=await response.json();
 await (await getDb()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1',[doc.id,'private']);
 const image=await sharp({create:{width:100,height:50,channels:3,background:'red'}}).png().toBuffer();
 const metadata:CommentImageMetadata={v:1,capturedEditId:doc.edit_id,capturedAt:new Date().toISOString(),method:'region',width:100,height:50,rect:{x:0,y:0,width:100,height:50},viewport:{width:1000,height:800},strokes:[]};
 return {token,doc,image,metadata,actor:{tokenId:token.id,userId:null},cookie:await agentCookie([token.id])};
}
describe('comment image attachment ownership',()=>{
 it('stages privately, atomically attaches to a root and charges all variants',async()=>{
  const s=await setup();const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,s.metadata);
  expect(stage).not.toBeInstanceOf(Response);if(stage instanceof Response)return;
  expect(await assetBytesForToken(s.token.id)).toBeGreaterThan(0);
  expect(await readCommentImage(s.actor,s.doc.id,stage.id,'preview')).toBeNull();
  const response=await createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',cookie:s.cookie,json:{path:'0',edit_id:s.doc.edit_id,body:'Look here',attachment_id:stage.id}}),params(s.doc.id));
  expect(response.status,await response.clone().text()).toBe(201);
  const wire=await response.json();expect(wire.image).toMatchObject({id:stage.id,width:100,height:50,capturedEditId:s.doc.edit_id});
  expect(JSON.stringify(wire)).not.toContain('objectKey');
  expect(await readCommentImage(s.actor,s.doc.id,stage.id,'thumbnail')).not.toBeNull();
  const privateRead=await readImageRoute(request(`/api/my/artifacts/${s.doc.id}/comment-images/${stage.id}`),{params:Promise.resolve({id:s.doc.id,imageId:stage.id})});expect(privateRead.status).toBe(404);
  const ownerRead=await readImageRoute(request(`/api/my/artifacts/${s.doc.id}/comment-images/${stage.id}`,{cookie:s.cookie}),{params:Promise.resolve({id:s.doc.id,imageId:stage.id})});expect(ownerRead.status).toBe(200);expect(ownerRead.headers.get('cache-control')).toBe('private, no-store');
  const stranger=await mintToken('agent');expect(await readCommentImage({tokenId:stranger.id,userId:null},s.doc.id,stage.id,'original')).toBeNull();
 });
 it('refuses invalid raster and metadata before reserving bytes',async()=>{
  const s=await setup();const result=await stageCommentImage(s.actor,s.doc.id,Buffer.from('not an image'),s.image,s.metadata);
  expect(result).toBeInstanceOf(Response);expect((result as Response).status).toBe(400);
  expect(await assetBytesForToken(s.token.id)).toBe(0);
 });
 it('refuses over-quota reservations, including the incoming bytes',async()=>{
  const s=await setup();setAssetByteQuotaForTests(1);
  try {expect((await stageCommentImage(s.actor,s.doc.id,s.image,s.image,s.metadata) as Response).status).toBe(413);}
  finally{setAssetByteQuotaForTests(null);}
 });
 it('checks captured revision even when supplied with a stable node',async()=>{
  const s=await setup();
  const result=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,{...s.metadata,capturedEditId:'old'});
  expect((result as Response).status).toBe(409);
 });
});

it('keeps a stale stage unconsumed and retries a committed comment idempotently',async()=>{
 const s=await setup();const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,s.metadata);if(stage instanceof Response)throw new Error(await stage.text());
 const db=await getDb();await db.query("UPDATE artifacts SET edit_id='new-head' WHERE id=$1",[s.doc.id]);
 const make=(edit:string,key?:string)=>createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',cookie:s.cookie,headers:key?{'Idempotency-Key':key}:undefined,json:{path:'0',edit_id:edit,body:'Saved once',attachment_id:stage.id}}),params(s.doc.id));
 expect((await make(s.doc.edit_id)).status).toBe(409);
 expect((await db.query<{annotation_id:string|null}>('SELECT annotation_id FROM comment_images WHERE id=$1',[stage.id])).rows[0].annotation_id).toBeNull();
 await db.query('UPDATE artifacts SET edit_id=$2 WHERE id=$1',[s.doc.id,s.doc.edit_id]);
 const first=await make(s.doc.edit_id,'capture-retry-12345');expect(first.status).toBe(201);const wire=await first.json();
 const retry=await make(s.doc.edit_id,'capture-retry-12345');expect(retry.status).toBe(201);expect((await retry.json()).id).toBe(wire.id);
 expect((await make(s.doc.edit_id)).status).toBe(400);
 await db.query('UPDATE annotations SET deleted_at=now() WHERE id=$1',[wire.id]);expect(await readCommentImage(s.actor,s.doc.id,stage.id,'preview')).toBeNull();
});

it('rejects another actor consuming a private stage and malformed stroke coordinates',async()=>{
 const s=await setup();
 const invalid=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,{...s.metadata,strokes:[{color:'#ff0000',width:2,points:[[200,5]]}]});expect((invalid as Response).status).toBe(400);
 const stranger=await mintToken('agent');const result=await stageCommentImage({tokenId:stranger.id,userId:null},s.doc.id,s.image,s.image,s.metadata);expect((result as Response).status).toBe(404);
});
