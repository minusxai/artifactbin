/** Private staged raster attachments. Only annotation creation consumes a stage. */
import sharp from 'sharp';
import {COMMENT_IMAGE_LIMITS as LIMITS,type CommentImageMetadata,type CommentImageWire} from '../../contracts/src/comment-image';
import {annotationScope,type TokenActor} from './artifacts';
import {getDb,type Queryable} from './db';
import {objectStore} from './object-store';
import {generateInternalId} from './ids';
import {json} from './http';
import {readableArtifact} from './artifact-read';
import {assetByteQuotaLimit} from './asset-quota';

interface ImageRow {id:string;artifact_id:string;annotation_id:string|null;token_id:string;user_id:string|null;metadata:CommentImageMetadata;bytes:number;ready:boolean;expires_at:string}
const variants=['original','preview','thumbnail'] as const;
type Variant=typeof variants[number];
const key=(id:string,variant:Variant)=>`comment-images/${id}/${variant}.webp`;
const owned=(row:ImageRow,actor:TokenActor)=>actor.userId ? row.user_id===actor.userId : row.user_id===null && row.token_id===actor.tokenId;
export function validCommentImage(value:unknown):value is CommentImageMetadata {
 if(!value || typeof value!=='object')return false;
 const m=value as CommentImageMetadata;
 const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0;
 if(m.v!==1 || typeof m.capturedEditId!=='string' || !m.capturedEditId || m.capturedEditId.length>200 || typeof m.capturedAt!=='string' || !Number.isFinite(Date.parse(m.capturedAt)) || !['region','canvas','upload'].includes(m.method))return false;
 if(!Number.isInteger(m.width)||!Number.isInteger(m.height)||!positive(m.width)||!positive(m.height)||Math.max(m.width,m.height)>LIMITS.edge||m.width*m.height>LIMITS.pixels)return false;
 if(!m.rect||!m.viewport||![m.rect.width,m.rect.height,m.viewport.width,m.viewport.height].every(positive)||![m.rect.x,m.rect.y].every(v=>Number.isFinite(v)&&v>=0)||m.rect.x+m.rect.width>m.viewport.width+1||m.rect.y+m.rect.height>m.viewport.height+1)return false;
 if(!Array.isArray(m.strokes)||m.strokes.length>LIMITS.strokes)return false;
 let count=0;
 return m.strokes.every(s=>s&&/^#[0-9a-f]{6}$/i.test(s.color)&&positive(s.width)&&s.width<=128&&Array.isArray(s.points)&&s.points.length>0&&(count+=s.points.length)<=LIMITS.points&&s.points.every(p=>Array.isArray(p)&&p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=0&&p[0]<=m.width&&p[1]>=0&&p[1]<=m.height));
}
export const commentImageWire=(row:ImageRow):CommentImageWire=>{
 const url=`/api/my/artifacts/${row.artifact_id}/comment-images/${row.id}`;
 return {id:row.id,width:row.metadata.width,height:row.metadata.height,capturedEditId:row.metadata.capturedEditId,capturedAt:row.metadata.capturedAt,originalUrl:`${url}?variant=original`,previewUrl:`${url}?variant=preview`,thumbnailUrl:`${url}?variant=thumbnail`};
};
/** Opportunistic bounded sweep on upload. Rows remain charged until every object was removed. */
export async function sweepCommentImages():Promise<void>{
 const db=await getDb();
 const expired=await db.query<ImageRow>('SELECT * FROM comment_images WHERE annotation_id IS NULL AND expires_at < now() LIMIT 20');
 for(const row of expired.rows){
  try{for(const variant of variants)await objectStore().delete(key(row.id,variant));await db.query('DELETE FROM comment_images WHERE id=$1 AND annotation_id IS NULL AND expires_at < now()',[row.id]);}catch{/* Retry on a later upload; never forget charged objects. */}
 }
}
export async function stageCommentImage(actor:TokenActor,artifactId:string,original:Buffer,preview:Buffer,metadata:unknown):Promise<{id:string}|Response>{
 const db=await getDb(),scope=annotationScope(actor);
 const access=await db.query<{edit_id:string}>(`SELECT edit_id FROM artifacts WHERE id=$1 AND ${scope.where('$2')}`,[artifactId,scope.val]);
 if(!access.rows[0])return json({error:'not_found'},404);
 if(!validCommentImage(metadata))return json({error:'invalid_image_metadata'},400);
 if(access.rows[0].edit_id!==metadata.capturedEditId)return json({error:'stale'},409);
 if(original.length>LIMITS.bytes||preview.length>LIMITS.bytes)return json({error:'image_too_large'},413);
 let originals:Buffer,previews:Buffer,thumbnail:Buffer;
 try{
  const decode=async(buffer:Buffer)=>{
   const image=sharp(buffer,{limitInputPixels:LIMITS.pixels,failOn:'error'});const info=await image.metadata();
   if(!['png','jpeg','webp'].includes(info.format??'')||(info.pages??1)!==1||info.width!==metadata.width||info.height!==metadata.height)throw new Error('Invalid image');
   return image.webp({lossless:true}).toBuffer();
  };
  originals=await decode(original);previews=await decode(preview);
  thumbnail=await sharp(previews).resize({width:LIMITS.thumbnail,height:LIMITS.thumbnail,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
 }catch{return json({error:'invalid_image'},400);}
 await sweepCommentImages();
 const bytes=originals.length+previews.length+thumbnail.length,id='cim_'+generateInternalId();
 const reserved=await db.transaction(async tx=>{
  // Serialize reservations across every token owned by this uploader.
  if(actor.userId)await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor.userId]);
  else await tx.query('SELECT id FROM tokens WHERE id=$1 FOR UPDATE',[actor.tokenId]);
  const column=actor.userId?'user_id':'token_id',subject=actor.userId??actor.tokenId;
  const total=await tx.query<{n:string}>(`SELECT
   (SELECT COALESCE(SUM((meta->>'bytes')::bigint),0) FROM artifacts WHERE ${column}=$1 AND meta ? 'bytes')+
   (SELECT COALESCE(SUM(bytes),0) FROM web_assets WHERE fetched_by_${column}=$1)+
   (SELECT COALESCE(SUM(bytes),0) FROM comment_images WHERE ${column}=$1) AS n`,[subject]);
  const cap=assetByteQuotaLimit();if(cap&&Number(total.rows[0]?.n??0)+bytes>cap)return false;
  await tx.query("INSERT INTO comment_images (id,artifact_id,token_id,user_id,metadata,bytes,expires_at) VALUES ($1,$2,$3,$4,$5,$6,now()+interval '24 hours')",[id,artifactId,actor.tokenId,actor.userId,JSON.stringify(metadata),bytes]);return true;
 });
 if(!reserved)return json({error:'quota_exceeded'},413);
 try{
  for(const [variant,buffer] of [['original',originals],['preview',previews],['thumbnail',thumbnail]] as const)await objectStore().put(key(id,variant),buffer,'image/webp');
  await db.query('UPDATE comment_images SET ready=true WHERE id=$1',[id]);return {id};
 }catch{
  await db.query('UPDATE comment_images SET expires_at=now() WHERE id=$1',[id]);await sweepCommentImages();
  return json({error:'image_storage_unavailable'},503);
 }
}
/** Called inside the same transaction as the root comment; no external queries or object I/O. */
export async function consumeCommentImage(tx:Queryable,actor:TokenActor,artifactId:string,id:string,annotationId:string,editId:string):Promise<boolean>{
 const row=(await tx.query<ImageRow>('SELECT * FROM comment_images WHERE id=$1 AND artifact_id=$2 AND ready=true AND annotation_id IS NULL AND expires_at > now() FOR UPDATE',[id,artifactId])).rows[0];
 if(!row||!owned(row,actor)||row.metadata.capturedEditId!==editId)return false;
 await tx.query('UPDATE comment_images SET annotation_id=$2 WHERE id=$1',[id,annotationId]);return true;
}
export async function commentImagesFor(tx:Queryable,artifactId:string):Promise<Map<string,CommentImageWire>>{
 const rows=await tx.query<ImageRow>('SELECT * FROM comment_images WHERE artifact_id=$1 AND annotation_id IS NOT NULL',[artifactId]);
 return new Map(rows.rows.map(row=>[row.annotation_id!,commentImageWire(row)]));
}
export async function readCommentImage(actor:TokenActor,artifactId:string,id:string,variant:string):Promise<{buffer:Buffer}|null>{
 if(!variants.includes(variant as Variant)||!await readableArtifact(actor,artifactId))return null;
 const db=await getDb();
 const row=(await db.query<ImageRow>('SELECT i.* FROM comment_images i JOIN annotations a ON a.id=i.annotation_id WHERE i.id=$1 AND i.artifact_id=$2 AND a.deleted_at IS NULL AND i.ready=true',[id,artifactId])).rows[0];
 if(!row)return null;return {buffer:await objectStore().get(key(id,variant as Variant))};
}
