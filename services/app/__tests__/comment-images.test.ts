import {claimToken,createUser} from '@/lib/accounts';
import {GET as readImageRoute} from '@/app/api/my/artifacts/[id]/comment-images/[imageId]/route';
import {getDb} from '@/lib/platform';
import {describe,expect,it} from 'vitest';
import sharp from 'sharp';
import {useAppHarness,request} from './harness';
import { mintAccountToken as mintToken } from '@/__tests__/harness';
import {POST as createArtifact} from '@/app/api/artifacts/route';
import {POST as createComment} from '@/app/api/my/artifacts/[id]/annotations/route';
import {stageCommentImage,readCommentImage} from '@/lib/annotations';
import {assetBytesForToken,setAssetByteQuotaForTests} from '@/lib/artifacts/asset-quota';
import type {CommentImageMetadata} from '../../contracts/src/comment-image';
useAppHarness();
const params=(id:string)=>({params:Promise.resolve({id})});
async function setup(){
 const token=await mintToken('agent');
 const response=await createArtifact(request('/api/artifacts',{method:'POST',token:token.token,json:{markup:'<p id="capture">Capture me</p>'}}));
 expect(response.status).toBe(201);const doc=await response.json();
 await (await getDb()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1',[doc.id,'private']);
 const image=await sharp({create:{width:100,height:50,channels:3,background:'red'}}).png().toBuffer();
 const metadata:CommentImageMetadata={v:1,capturedEditId:doc.edit_id,capturedAt:new Date().toISOString(),method:'region',width:100,height:50,rect:{x:0,y:0,width:100,height:50},viewport:{width:1000,height:800},strokes:[]};
 return {token,doc,image,metadata,actor:{tokenId:token.id,userId:token.userId},browserActor:{credential:'session' as const,userId:token.userId!,email:token.email!,emailVerified:true}};
}
describe('comment image attachment ownership',()=>{
 it('accepts an individual 50 MB image and refuses one byte more',async()=>{
  const s=await setup();const bytes=Buffer.alloc(50_000_000);s.image.copy(bytes);
  const accepted=await stageCommentImage(s.actor,s.doc.id,bytes,s.image,s.metadata);
  expect(accepted).not.toBeInstanceOf(Response);
  const refused=await stageCommentImage(s.actor,s.doc.id,Buffer.alloc(50_000_001),s.image,s.metadata);
  expect(refused).toBeInstanceOf(Response);expect((refused as Response).status).toBe(413);
 });
 it('stages privately, atomically attaches to a root and charges all variants',async()=>{
  const s=await setup();const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,s.metadata);
  expect(stage).not.toBeInstanceOf(Response);if(stage instanceof Response)return;
  expect(await assetBytesForToken(s.token.id)).toBeGreaterThan(0);
  expect(await readCommentImage(s.actor,s.doc.id,stage.id,'preview')).toBeNull();
  const response=await createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',actor:s.browserActor,json:{node_id:'capture',edit_id:s.doc.edit_id,body:'Look here',attachment_id:stage.id}}),params(s.doc.id));
  expect(response.status,await response.clone().text()).toBe(201);
  const wire=await response.json();expect(wire.image).toMatchObject({id:stage.id,width:100,height:50,capturedEditId:s.doc.edit_id});
  expect(JSON.stringify(wire)).not.toContain('objectKey');
  expect(await readCommentImage(s.actor,s.doc.id,stage.id,'thumbnail')).not.toBeNull();
  const privateRead=await readImageRoute(request(`/api/my/artifacts/${s.doc.id}/comment-images/${stage.id}`),{params:Promise.resolve({id:s.doc.id,imageId:stage.id})});expect(privateRead.status).toBe(404);
  const ownerRead=await readImageRoute(request(`/api/my/artifacts/${s.doc.id}/comment-images/${stage.id}`,{actor:s.browserActor}),{params:Promise.resolve({id:s.doc.id,imageId:stage.id})});expect(ownerRead.status).toBe(200);expect(ownerRead.headers.get('cache-control')).toBe('private, no-store');
  const stranger=await mintToken('agent');expect(await readCommentImage({tokenId:stranger.id,userId:stranger.userId},s.doc.id,stage.id,'original')).toBeNull();
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
 const make=(edit:string,key?:string)=>createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',actor:s.browserActor,headers:key?{'Idempotency-Key':key}:undefined,json:{node_id:'capture',edit_id:edit,body:'Saved once',attachment_id:stage.id}}),params(s.doc.id));
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
 const stranger=await mintToken('agent');const result=await stageCommentImage({tokenId:stranger.id,userId:stranger.userId},s.doc.id,s.image,s.image,s.metadata);expect((result as Response).status).toBe(404);
});

it('carries a staged image and its quota into a claimed account',async()=>{
 const s=await setup();const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,s.metadata);if(stage instanceof Response)throw new Error(await stage.text());
 const user=await createUser({email:'mxmx_test_imageclaim@example.com',name:'Image claim'});
 // Recreate stored pre-email ownership; the legacy token is only an adoption proof.
 const db=await getDb();
 await db.query('UPDATE tokens SET user_id=NULL WHERE id=$1',[s.token.id]);
 await db.query('UPDATE artifacts SET user_id=NULL WHERE id=$1',[s.doc.id]);
 await db.query('UPDATE comment_images SET user_id=NULL WHERE id=$1',[stage.id]);
 await claimToken(user.id,s.token.token);
 s.browserActor={credential:'session',userId:user.id,email:user.email!,emailVerified:true};
 const row=(await (await getDb()).query<{user_id:string}>('SELECT user_id FROM comment_images WHERE id=$1',[stage.id])).rows[0];
 expect(row.user_id).toBe(user.id);
 const response=await createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',actor:s.browserActor,json:{node_id:'capture',edit_id:s.doc.edit_id,body:'Claimed screenshot',attachment_id:stage.id}}),params(s.doc.id));
 expect(response.status,await response.clone().text()).toBe(201);
});

import {GET as readAgentImage} from '@/app/api/artifacts/[id]/comment-images/[imageId]/route';
it('serves annotated pixels through bearer auth and preserves attachment access and deletion rules',async()=>{
 const s=await setup();const preview=await sharp({create:{width:100,height:50,channels:3,background:'blue'}}).png().toBuffer();
 const stage=await stageCommentImage(s.actor,s.doc.id,s.image,preview,s.metadata);if(stage instanceof Response)throw new Error(await stage.text());
 const read=(token:string|undefined,id=s.doc.id,variant='')=>readAgentImage(request(`/api/artifacts/${id}/comment-images/${stage.id}${variant?`?variant=${variant}`:''}`,{token}),{params:Promise.resolve({id,imageId:stage.id})});
 expect((await read(undefined)).status).toBe(401);
 expect((await read(s.token.token)).status).toBe(404); // Unconsumed stages stay private.
 const created=await createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',actor:s.browserActor,json:{node_id:'capture',edit_id:s.doc.edit_id,body:'Look at the blue marks',attachment_id:stage.id}}),params(s.doc.id));
 const annotation=await created.json();expect(created.status).toBe(201);
 const downloaded=await read(s.token.token);expect(downloaded.status).toBe(200);
 expect(downloaded.headers.get('Content-Type')).toBe('image/webp');expect(downloaded.headers.get('Cache-Control')).toBe('private, no-store');
 const pixels=await sharp(Buffer.from(await downloaded.arrayBuffer())).raw().toBuffer();expect([...pixels.subarray(0,3)]).toEqual([0,0,255]);
 const original=await read(s.token.token,s.doc.id,'original');expect(original.status).toBe(200);
 expect([...(await sharp(Buffer.from(await original.arrayBuffer())).raw().toBuffer()).subarray(0,3)]).toEqual([255,0,0]);
 const stranger=await mintToken('agent');expect((await read(stranger.token)).status).toBe(404);
 expect((await read(s.token.token,'zzzzzz')).status).toBe(404);
 expect((await read(s.token.token,s.doc.id,'invalid')).status).toBe(404);
 await (await getDb()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1',[s.doc.id,'unlisted']);
 expect((await read(stranger.token)).status).toBe(200);
 await (await getDb()).query('UPDATE annotations SET deleted_at=now() WHERE id=$1',[annotation.id]);
 expect((await read(s.token.token)).status).toBe(404);
});

import {POST as answerComment} from '@/app/api/my/artifacts/[id]/annotations/[annId]/route';
describe('a reply carries its own image',()=>{
 const reply=(s:Awaited<ReturnType<typeof setup>>,root:string,json:Record<string,unknown>,actor:typeof s.browserActor=s.browserActor)=>
  answerComment(request(`/api/my/artifacts/${s.doc.id}/annotations/${root}`,{method:'POST',actor,json}),{params:Promise.resolve({id:s.doc.id,annId:root})});
 const thread=async(s:Awaited<ReturnType<typeof setup>>)=>{
  const created=await createComment(request(`/api/my/artifacts/${s.doc.id}/annotations`,{method:'POST',actor:s.browserActor,json:{node_id:'capture',body:'Root without an image'}}),params(s.doc.id));
  expect(created.status,await created.clone().text()).toBe(201);return (await created.json()).id as string;
 };
 it('attaches a staged image to the reply alone, readable with the document and gone with the reply',async()=>{
  const s=await setup();const root=await thread(s);
  const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,{...s.metadata,method:'upload'});if(stage instanceof Response)throw new Error(await stage.text());
  const answered=await reply(s,root,{reply:'Here is what I see',attachment_id:stage.id,edit_id:s.doc.edit_id});
  expect(answered.status,await answered.clone().text()).toBe(200);
  const wire=await answered.json();
  expect(wire.image).toBeUndefined();
  expect(wire.thread[0].image).toBeUndefined();
  expect(wire.thread[1]).toMatchObject({body:'Here is what I see',image:{id:stage.id,width:100,height:50,thumbnailUrl:expect.stringContaining(stage.id)}});
  expect(await readCommentImage(s.actor,s.doc.id,stage.id,'thumbnail')).not.toBeNull();
  const stranger=await mintToken('agent');expect(await readCommentImage({tokenId:stranger.id,userId:stranger.userId},s.doc.id,stage.id,'preview')).toBeNull();
  // Single use: the same stage cannot ride a second reply, and the refused reply is not written.
  expect((await reply(s,root,{reply:'Again',attachment_id:stage.id,edit_id:s.doc.edit_id})).status).toBe(400);
  const replies=(await (await getDb()).query('SELECT id FROM annotations WHERE root_id=$1 AND deleted_at IS NULL',[root])).rows;
  expect(replies).toHaveLength(1);
  await (await getDb()).query('UPDATE annotations SET deleted_at=now() WHERE id=$1',[wire.thread[1].id]);
  expect(await readCommentImage(s.actor,s.doc.id,stage.id,'preview')).toBeNull();
 });
 it('refuses an image without a reply, without its revision, or staged by someone else',async()=>{
  const s=await setup();const root=await thread(s);
  const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,s.metadata);if(stage instanceof Response)throw new Error(await stage.text());
  expect((await reply(s,root,{resolve:true,attachment_id:stage.id,edit_id:s.doc.edit_id})).status).toBe(400);
  expect((await reply(s,root,{reply:'No revision',attachment_id:stage.id})).status).toBe(400);
  expect((await reply(s,root,{reply:'Wrong revision',attachment_id:stage.id,edit_id:'other-edit'})).status).toBe(409);
  const other=await createUser({email:'mxmx_test_replyimage@example.com',name:'Reply image'});
  await (await getDb()).query('UPDATE comment_images SET user_id=$2 WHERE id=$1',[stage.id,other.id]);
  expect((await reply(s,root,{reply:'Not mine',attachment_id:stage.id,edit_id:s.doc.edit_id})).status).toBe(400);
  expect((await (await getDb()).query<{annotation_id:string|null}>('SELECT annotation_id FROM comment_images WHERE id=$1',[stage.id])).rows[0].annotation_id).toBeNull();
  expect((await (await getDb()).query('SELECT id FROM annotations WHERE root_id=$1',[root])).rows).toHaveLength(0);
 });
 it('re-checks the image against the current document at save, as a root comment does',async()=>{
  const s=await setup();const root=await thread(s);
  const stage=await stageCommentImage(s.actor,s.doc.id,s.image,s.image,{...s.metadata,method:'upload'});if(stage instanceof Response)throw new Error(await stage.text());
  const db=await getDb();await db.query("UPDATE artifacts SET edit_id='moved-head' WHERE id=$1",[s.doc.id]);
  const refused=await reply(s,root,{reply:'Stale image',attachment_id:stage.id,edit_id:s.doc.edit_id});
  expect(refused.status).toBe(409);expect(await refused.json()).toMatchObject({error:'stale',message:expect.stringContaining('send again')});
  expect((await db.query<{annotation_id:string|null}>('SELECT annotation_id FROM comment_images WHERE id=$1',[stage.id])).rows[0].annotation_id).toBeNull();
  expect((await db.query('SELECT id FROM annotations WHERE root_id=$1',[root])).rows).toHaveLength(0);
  // Naming the moved head does not launder a stage made against the old one.
  expect((await reply(s,root,{reply:'Stale image',attachment_id:stage.id,edit_id:'moved-head'})).status).toBe(400);
 });
});
