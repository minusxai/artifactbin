import { getDb } from '@/lib/platform/db';
import { generateInternalId, ID_RE } from '@/lib/platform';
import { getArtifactById, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import { artifactQuery } from '@/lib/artifacts/document';
import { dataflowForRow } from '@/lib/artifacts/dataflow';
import { canReadArtifact } from '@/lib/artifacts/access';
import { catalogOf } from '@/lib/datasets/catalog';
import { grantsOf, grantContext, grantsPermitRead, readThrough, type GrantDocument } from '@/lib/datasets/policy/grants';
import { DatasetError } from '@/lib/datasets/errors';
import { imageInsertAllowed } from './image-upload-policy';
import { storeImageContent } from '@/lib/story/data/data-tiers';
import { objectStore } from '@/lib/object-store';
import { IMAGE_CONTENT_TYPES } from '@/lib/story/assets/image-store';
import { uploadedSha256 } from '@/lib/story/assets/file-store';

const MAX_DATASET_IMAGES = 1000;
const MAX_DATASET_IMAGE_BYTES = 500_000_000;
const KEY_RE = /^[\w.-]{8,120}$/;
const refFor = (id: string) => `dimg:${id}`;
type DatasetImageRow = { id:string; dataset_id:string; document_id:string; actor_id:string; operation_key:string; sha256:string; meta:Record<string,unknown> };
export type DatasetImageUpload = { ref:string; url:string; replayed?:boolean };

function actorKey(actor:RoleActor):string {
  const key=actor.userId??actor.tokenId;
  if(!key)throw new DatasetError('Sign in to upload an image',403);
  return key;
}
function actorViewer(actor:RoleActor) { return actor.userId?{userId:actor.userId,email:actor.email??null}:null; }
function imageUrl(documentId:string,datasetId:string,imageId:string):string {
  return `/a/${documentId}/datasets/${datasetId}/images/${imageId}`;
}
function answer(row:DatasetImageRow,replayed=false):DatasetImageUpload {
  return {ref:refFor(row.id),url:imageUrl(row.document_id,row.dataset_id,row.id),...(replayed?{replayed:true}:{})};
}
function liveRow(rows:ArtifactRow[],id:string,format?:string):ArtifactRow {
  const row=rows.find(candidate=>candidate.id===id&&candidate.deleted_at===null);
  if(!row||(format&&row.format!==format))throw new DatasetError('Dataset image is unavailable',404);
  return row;
}
async function declaredDataset(document:ArtifactRow,datasetId:string):Promise<boolean> {
  if(document.format!=='markup')return false;
  const dataflow=await dataflowForRow(document);
  return !!dataflow?.flow.imports.some(entry=>entry.ref===datasetId||entry.ref===`ref:${datasetId}`);
}
async function authorizeInsert(dataset:ArtifactRow,document:ArtifactRow,actor:RoleActor,tx?:import('@/lib/platform/db').Queryable):Promise<void> {
  const grants=grantsOf(dataset);
  if(!grants)throw new DatasetError('This dataset does not grant image uploads',403);
  const context=await grantContext(dataset,actor,{id:document.id,editId:document.edit_id} satisfies GrantDocument,tx);
  if(!imageInsertAllowed(grants,context))throw new DatasetError('No insert grant permits this upload',403);
}
async function datasetReadable(dataset:ArtifactRow,document:ArtifactRow,actor:RoleActor,tx:import('@/lib/platform/db').Queryable):Promise<boolean> {
  if(grantsOf(dataset))return grantsPermitRead(dataset,actor,document,tx);
  return await readThrough(tx,dataset,actor)&&await readThrough(tx,document,actor);
}

export async function uploadDatasetImage(input:{actor:RoleActor;documentId:string;editId:string;datasetId:string;bytes:Buffer;contentType:string;operationKey:string}):Promise<DatasetImageUpload>{
  const {actor,documentId,datasetId,editId,bytes,contentType,operationKey}=input;
  if(!ID_RE.test(documentId)||!ID_RE.test(datasetId))throw new DatasetError('Dataset image is unavailable',404);
  if(!KEY_RE.test(operationKey))throw new DatasetError('A valid Idempotency-Key is required',400);
  if(bytes.length===0)throw new DatasetError('Image is empty',400);
  if(!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType))throw new DatasetError('Unsupported image type',400);
  const doc=await getArtifactById(documentId),dataset=await getArtifactById(datasetId);
  if(!doc||doc.edit_id!==editId||!(await canReadArtifact(doc,actorViewer(actor)))||!dataset||dataset.format!=='dataset'||dataset.deleted_at||catalogOf(dataset)?.kind!=='stored'||!await declaredDataset(doc,datasetId))throw new DatasetError('Dataset image is unavailable',404);
  await authorizeInsert(dataset,doc,actor);
  const actorId=actorKey(actor),sha256=uploadedSha256(bytes),db=await getDb();
  const replay=async(tx:import('@/lib/platform/db').Queryable):Promise<DatasetImageRow|null>=>{
    const found=(await tx.query<DatasetImageRow>('SELECT * FROM dataset_images WHERE dataset_id=$1 AND actor_id=$2 AND operation_key=$3',[datasetId,actorId,operationKey])).rows[0]??null;
    if(found&&found.sha256!==sha256)throw new DatasetError('Idempotency-Key was already used for another image',409);
    return found;
  };
  const authorizeCurrent=async(tx:import('@/lib/platform/db').Queryable,lock:'UPDATE'|'SHARE')=>{
    await tx.query(`SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR ${lock}`,[[datasetId,documentId]]);
    const rows=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[ [datasetId,documentId] ])).rows;
    const currentDataset=liveRow(rows,datasetId,'dataset'),currentDoc=liveRow(rows,documentId,'markup');
    if(currentDoc.edit_id!==editId||catalogOf(currentDataset)?.kind!=='stored')throw new DatasetError('Dataset image is unavailable',404);
    await authorizeInsert(currentDataset,currentDoc,actor,tx);
  };
  const cached=await db.transaction(async tx=>{
    await authorizeCurrent(tx,'UPDATE');
    return replay(tx);
  });
  if(cached)return answer(cached,true);
  const media=await storeImageContent(bytes,contentType);
  if(media instanceof Response)throw new DatasetError((await media.json().catch(()=>({error:'invalid_image'}))).error??'Invalid image',media.status);
  const currentImageId=generateInternalId(),meta=media.meta as Record<string,unknown>;
  return db.transaction(async tx=>{
    await authorizeCurrent(tx,'UPDATE');
    const found=await replay(tx); if(found)return answer(found,true);
    const usage=(await tx.query<{count:string;bytes:string}>("SELECT count(*)::text AS count,coalesce(sum((meta->>'bytes')::bigint),0)::text AS bytes FROM dataset_images WHERE dataset_id=$1",[datasetId])).rows[0];
    if(Number(usage?.count??0)>=MAX_DATASET_IMAGES||Number(usage?.bytes??0)+Number(meta.bytes??0)>MAX_DATASET_IMAGE_BYTES)throw new DatasetError('This dataset has reached its image storage limit',409);
    await tx.query('INSERT INTO dataset_images (id,dataset_id,document_id,actor_id,operation_key,sha256,meta) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',[currentImageId,datasetId,documentId,actorId,operationKey,sha256,JSON.stringify(meta)]);
    return answer({id:currentImageId,dataset_id:datasetId,document_id:documentId,actor_id:actorId,operation_key:operationKey,sha256,meta});
  });
}

export async function readDatasetImage(input:{actor:RoleActor;documentId:string;datasetId:string;imageId:string}):Promise<{body:Buffer;contentType:string}|null>{
  const {actor,documentId,datasetId,imageId}=input;
  if(!ID_RE.test(documentId)||!ID_RE.test(datasetId)||!/^\w{10,30}$/.test(imageId))return null;
  const initialDoc=await getArtifactById(documentId);
  if(!initialDoc||initialDoc.format!=='markup'||!(await canReadArtifact(initialDoc,actorViewer(actor)))||!await declaredDataset(initialDoc,datasetId))return null;
  const db=await getDb();
  return db.transaction(async tx=>{
    await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE',[[datasetId,documentId]]);
    const rows=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[ [datasetId,documentId] ])).rows;
    let dataset:ArtifactRow,doc:ArtifactRow;
    try { dataset=liveRow(rows,datasetId,'dataset');doc=liveRow(rows,documentId,'markup'); } catch { return null; }
    if(doc.edit_id!==initialDoc.edit_id||catalogOf(dataset)?.kind!=='stored'||!(await datasetReadable(dataset,doc,actor,tx)))return null;
    const row=(await tx.query<DatasetImageRow>('SELECT * FROM dataset_images WHERE id=$1 AND dataset_id=$2 AND document_id=$3',[imageId,datasetId,documentId])).rows[0];
    if(!row)return null;
    const objectKey=row.meta?.objectKey;
    if(typeof objectKey!=='string'||!objectKey)return null;
    return {body:await objectStore().get(objectKey),contentType:typeof row.meta.contentType==='string'?row.meta.contentType:'application/octet-stream'};
  });
}

export function datasetImageRefId(ref:unknown):string|null { return typeof ref==='string'&&ref.startsWith('dimg:')?ref.slice(5):null; }
export function datasetImageRawUrl(documentId:string,datasetId:string,ref:unknown):string|null {
  const id=datasetImageRefId(ref);return id?imageUrl(documentId,datasetId,id):null;
}
