import { getDb } from '@/lib/platform/db';
import { generateInternalId, ID_RE } from '@/lib/platform';
import { getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import type { RoleActor } from '@/lib/accounts/actors';
import { artifactQuery } from '@/lib/artifacts/document';
import { dataflowForRow } from '@/lib/artifacts/dataflow';
import { catalogOf } from '@/lib/datasets/catalog';
import { grantsOf, grantContext, grantsPermitRead, readThrough, type GrantDocument } from '@/lib/artifacts/dataset-policy/grants';
import { DatasetError } from '@/lib/datasets/errors';
import { imageInsertAllowed } from '@/lib/datasets/image-upload-policy';
import { storeImageContent } from '@/lib/datasets/data-tiers';
import { objectStore } from '@/lib/object-store';
import { IMAGE_CONTENT_TYPES } from '@/lib/object-store/image-store';
import type { DatasetUploadResult } from '@artifactbin/contracts';
import { assetFormatOf, fileContentType } from '@/lib/document/file-types';
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES } from '@/lib/platform/config';
import { uploadedSha256, storeFileContent } from '@/lib/datasets/file-store';

const MAX_DATASET_FILES = 1000;
const MAX_DATASET_FILE_BYTES = 500_000_000;
const KEY_RE = /^[\w.-]{8,120}$/;
const refFor = (id: string) => `dimg:${id}`;
type DatasetImageRow = { id:string; dataset_id:string; document_id:string; actor_id:string; operation_key:string; sha256:string; meta:Record<string,unknown> };
export type DatasetImageUpload = { ref:string; url:string; replayed?:boolean };

function actorKey(actor:RoleActor):string {
  const key=actor.userId??actor.tokenId;
  if(!key)throw new DatasetError('Sign in to upload a file',403);
  return key;
}
function imageUrl(documentId:string,datasetId:string,imageId:string):string {
  return `/a/${documentId}/datasets/${datasetId}/images/${imageId}`;
}
const IMAGE_DOWNLOAD_EXTENSIONS:Readonly<Record<string,string>>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg'};
/** Keep the uploaded name in metadata for replay, but name downloads for the bytes actually stored. */
function downloadFilename(row:DatasetImageRow):string {
  const filename=String(row.meta.filename??row.id),contentType=String(row.meta.contentType??'');
  if(row.meta.format!=='image'||fileContentType(filename)===contentType)return filename;
  const extension=IMAGE_DOWNLOAD_EXTENSIONS[contentType];
  return extension?filename.replace(/\.[^.]+$/,`.${extension}`):filename;
}
function fileAnswer(row:DatasetImageRow,replayed=false):DatasetUploadResult {
  return {ref:`dfile:${row.id}`,url:`/a/${row.document_id}/datasets/${row.dataset_id}/files/${row.id}`,name:downloadFilename(row),contentType:String(row.meta.contentType??'application/octet-stream'),size:Number(row.meta.bytes??0),...(replayed?{replayed:true}:{})};
}
function answer(row:DatasetImageRow,replayed=false):DatasetImageUpload {
  return {ref:refFor(row.id),url:imageUrl(row.document_id,row.dataset_id,row.id),...(replayed?{replayed:true}:{})};
}
function liveRow(rows:ArtifactRow[],id:string,format?:string):ArtifactRow {
  const row=rows.find(candidate=>candidate.id===id&&candidate.deleted_at===null);
  if(!row||(format&&row.format!==format))throw new DatasetError('Dataset file is unavailable',404);
  return row;
}
async function declaredDataset(document:ArtifactRow,datasetId:string):Promise<boolean> {
  if(document.format!=='markup')return false;
  const dataflow=await dataflowForRow(document);
  return !!dataflow?.flow.imports.some(entry=>entry.ref===datasetId||entry.ref===`ref:${datasetId}`);
}
async function authorizeInsert(dataset:ArtifactRow,document:ArtifactRow,actor:RoleActor,tx?:import('@/lib/platform/db').Queryable):Promise<void> {
  const grants=grantsOf(dataset);
  if(!grants)throw new DatasetError('This dataset does not grant file uploads',403);
  const context=await grantContext(dataset,actor,{id:document.id,editId:document.edit_id} satisfies GrantDocument,tx);
  if(!imageInsertAllowed(grants,context))throw new DatasetError('No insert grant permits this upload',403);
}
async function datasetReadable(dataset:ArtifactRow,document:ArtifactRow,actor:RoleActor,tx:import('@/lib/platform/db').Queryable):Promise<boolean> {
  if(grantsOf(dataset))return grantsPermitRead(dataset,actor,document,tx);
  return await readThrough(tx,dataset,actor)&&await readThrough(tx,document,actor);
}

type UploadInput={actor:RoleActor;documentId:string;editId:string;datasetId:string;bytes:Buffer;contentType:string;operationKey:string};
export async function uploadDatasetImage(input:UploadInput):Promise<DatasetImageUpload>{return uploadContent(input);}
export async function uploadDatasetFile(input:UploadInput&{filename:string}):Promise<DatasetUploadResult>{return uploadContent(input,true) as Promise<DatasetUploadResult>;}
async function uploadContent(input:UploadInput&{filename?:string},generic=false):Promise<DatasetImageUpload|DatasetUploadResult>{
  const {actor,documentId,datasetId,editId,bytes,contentType,operationKey}=input;
  if(!ID_RE.test(documentId)||!ID_RE.test(datasetId))throw new DatasetError('Dataset file is unavailable',404);
  if(!KEY_RE.test(operationKey))throw new DatasetError('A valid Idempotency-Key is required',400);
  const filename=input.filename??'image.png';
  const format=generic?assetFormatOf(filename):'image';
  if(generic&&(!filename||filename.length>255||!filename.isWellFormed()||/[\x00-\x1f\x7f/\\]/.test(filename)))throw new DatasetError('Invalid filename',400);
  if(!format)throw new DatasetError('Unsupported file type',400);
  if(bytes.length>(format==='image'?MAX_IMAGE_BYTES:MAX_FILE_BYTES))throw new DatasetError('File is too large',413);
  if(bytes.length===0)throw new DatasetError('File is empty',400);
  if(!generic&&!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType))throw new DatasetError('Unsupported image type',400);
  const doc=await getArtifactById(documentId),dataset=await getArtifactById(datasetId);
  if(!doc||doc.edit_id!==editId||!(await readThrough(await getDb(),doc,actor))||!dataset||dataset.format!=='dataset'||dataset.deleted_at||catalogOf(dataset)?.kind!=='stored'||!await declaredDataset(doc,datasetId))throw new DatasetError('Dataset file is unavailable',404);
  await authorizeInsert(dataset,doc,actor);
  const actorId=actorKey(actor),sha256=uploadedSha256(bytes),db=await getDb();
  const replay=async(tx:import('@/lib/platform/db').Queryable):Promise<DatasetImageRow|null>=>{
    const found=(await tx.query<DatasetImageRow>('SELECT * FROM dataset_images WHERE dataset_id=$1 AND actor_id=$2 AND operation_key=$3',[datasetId,actorId,operationKey])).rows[0]??null;
    if(found&&(found.document_id!==documentId||found.sha256!==sha256||(!generic&&found.meta.format&&found.meta.format!=='image')||(generic&&found.meta.filename!==filename)))throw new DatasetError('Idempotency-Key was already used for another file',409);
    return found;
  };
  const authorizeCurrent=async(tx:import('@/lib/platform/db').Queryable,lock:'UPDATE'|'SHARE')=>{
    await tx.query(`SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR ${lock}`,[[datasetId,documentId]]);
    const rows=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[ [datasetId,documentId] ])).rows;
    const currentDataset=liveRow(rows,datasetId,'dataset'),currentDoc=liveRow(rows,documentId,'markup');
    if(currentDoc.edit_id!==editId||catalogOf(currentDataset)?.kind!=='stored')throw new DatasetError('Dataset file is unavailable',404);
    await authorizeInsert(currentDataset,currentDoc,actor,tx);
  };
  const cached=await db.transaction(async tx=>{
    await authorizeCurrent(tx,'UPDATE');
    return replay(tx);
  });
  const receipt=generic?fileAnswer:answer;
  if(cached)return receipt(cached,true);
  const media=await (format==='image'?storeImageContent(bytes,generic?fileContentType(filename)!:contentType):storeFileContent(bytes,contentType,filename));
  if(media instanceof Response)throw new DatasetError((await media.json().catch(()=>({error:'invalid_file'}))).error??'Invalid file',media.status);
  const currentImageId=generateInternalId(),meta={...media.meta,...(generic?{format:media.format,filename}:{})} as Record<string,unknown>;
  return db.transaction(async tx=>{
    await authorizeCurrent(tx,'UPDATE');
    const found=await replay(tx); if(found)return receipt(found,true);
    const usage=(await tx.query<{count:string;bytes:string}>("SELECT count(*)::text AS count,coalesce(sum((meta->>'bytes')::bigint),0)::text AS bytes FROM dataset_images WHERE dataset_id=$1",[datasetId])).rows[0];
    if(Number(usage?.count??0)>=MAX_DATASET_FILES||Number(usage?.bytes??0)+Number(meta.bytes??0)>MAX_DATASET_FILE_BYTES)throw new DatasetError('This dataset has reached its file storage limit',409);
    await tx.query('INSERT INTO dataset_images (id,dataset_id,document_id,actor_id,operation_key,sha256,meta) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',[currentImageId,datasetId,documentId,actorId,operationKey,sha256,JSON.stringify(meta)]);
    return receipt({id:currentImageId,dataset_id:datasetId,document_id:documentId,actor_id:actorId,operation_key:operationKey,sha256,meta});
  });
}

export async function readDatasetFile(input:{actor:RoleActor;documentId:string;datasetId:string;fileId:string}):Promise<{body:Buffer;contentType:string;filename:string;image:boolean}|null>{
  return readContent({...input,imageId:input.fileId});
}
export async function readDatasetImage(input:{actor:RoleActor;documentId:string;datasetId:string;imageId:string}):Promise<{body:Buffer;contentType:string}|null>{return readContent(input,true);}
async function readContent(input:{actor:RoleActor;documentId:string;datasetId:string;imageId:string},imageOnly=false):Promise<{body:Buffer;contentType:string;filename:string;image:boolean}|null>{
  const {actor,documentId,datasetId,imageId}=input;
  if(!ID_RE.test(documentId)||!ID_RE.test(datasetId)||!/^\w{10,30}$/.test(imageId))return null;
  const initialDoc=await getArtifactById(documentId);
  if(!initialDoc||initialDoc.format!=='markup'||!(await readThrough(await getDb(),initialDoc,actor))||!await declaredDataset(initialDoc,datasetId))return null;
  const db=await getDb();
  return db.transaction(async tx=>{
    await tx.query('SELECT id FROM artifacts WHERE id=ANY($1::text[]) ORDER BY id FOR SHARE',[[datasetId,documentId]]);
    const rows=(await artifactQuery<ArtifactRow>(tx,'SELECT * FROM artifacts WHERE id=ANY($1::text[]) AND deleted_at IS NULL',[ [datasetId,documentId] ])).rows;
    let dataset:ArtifactRow,doc:ArtifactRow;
    try { dataset=liveRow(rows,datasetId,'dataset');doc=liveRow(rows,documentId,'markup'); } catch { return null; }
    if(doc.edit_id!==initialDoc.edit_id||catalogOf(dataset)?.kind!=='stored'||!(await datasetReadable(dataset,doc,actor,tx)))return null;
    const row=(await tx.query<DatasetImageRow>('SELECT * FROM dataset_images WHERE id=$1 AND dataset_id=$2 AND document_id=$3',[imageId,datasetId,documentId])).rows[0];
    if(!row||(imageOnly&&row.meta.format&&row.meta.format!=='image'))return null;
    const objectKey=row.meta?.objectKey;
    if(typeof objectKey!=='string'||!objectKey)return null;
    return {filename:downloadFilename(row),image:!row.meta.format||row.meta.format==='image',body:await objectStore().get(objectKey),contentType:typeof row.meta.contentType==='string'?row.meta.contentType:'application/octet-stream'};
  });
}
