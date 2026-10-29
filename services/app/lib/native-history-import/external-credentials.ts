import type {Queryable} from '@artifactbin/contracts';
import {datasetSecretTargetHash, openDatasetSecret, sealDatasetSecret, type DatasetCatalog} from '@/lib/datasets';
import type {NativeCatalogDataset,NativeCatalogProjection} from './catalog-contracts';
import type {NativeExternalConnectionReceipt,NativeExternalCredentialSource,NativeStagedExternalCredentials} from './external-credential-contracts';
import {nativeCatalogBytes} from './catalog-digest';
interface EncryptedRow {id:string;token_id:string;user_id:string|null;dataset_id:string;target_hash:string;ciphertext:string}
/** @public Read-only capture of the one source credential selected by canonical dataset metadata.
 * The returned bytes stay in a private migration receipt directory. */
export async function captureNativeExternalCredential(db:Queryable,dataset:NativeCatalogDataset):Promise<{receipt:NativeExternalConnectionReceipt;bytes:Buffer}> {
 const catalog=dataset.versions.find(v=>v.version===dataset.currentVersion)?.meta.catalog as DatasetCatalog|undefined;
 if(catalog?.kind!=='postgres'||!catalog.connection)throw Error('native_external_scope');
 const result=await db.query<EncryptedRow>('SELECT id,token_id,user_id,dataset_id,target_hash,ciphertext FROM dataset_secrets WHERE id=$1 AND dataset_id=$2',[catalog.connection.passwordSecretId,dataset.sourceId]);
 if(result.rows.length!==1)throw Error('native_external_credentials_required');
 const bytes=Buffer.from(JSON.stringify(result.rows[0]));
 return {receipt:{datasetSourceId:dataset.sourceId,sourceSecretSha256:nativeCatalogBytes(bytes)},bytes};
}
/** Source ciphertext is authenticated with its original deployment key, then sealed
 * under the target key. No password is retained in a receipt or public metadata. */
export async function stageNativeExternalCredentials(p:NativeCatalogProjection,source:NativeExternalCredentialSource|undefined,targetAuthSecret:string):Promise<NativeStagedExternalCredentials> {
 const rows:EncryptedRow[]=[];
 const receipts=p.externalConnections??[];
 const external=p.datasets.filter(d=>(d.versions.find(v=>v.version===d.currentVersion)!.meta.catalog as DatasetCatalog|undefined)?.kind==='postgres');
 if(receipts.length!==external.length||new Set(receipts.map(r=>r.datasetSourceId)).size!==receipts.length)throw Error('native_external_scope');
 for(const d of external){
  const receipt=receipts.find(r=>r.datasetSourceId===d.sourceId),catalog=d.versions.find(v=>v.version===d.currentVersion)!.meta.catalog as DatasetCatalog;
  if(!receipt||!source||!source.sourceAuthSecret||!targetAuthSecret||!catalog.connection)throw Error('native_external_credentials_required');
  const bytes=await source.read(d);
  if(nativeCatalogBytes(bytes)!==receipt.sourceSecretSha256)throw Error('native_external_source_digest');
  let row:EncryptedRow;
  try{row=JSON.parse(bytes.toString('utf8')) as EncryptedRow;}catch{throw Error('native_external_source_binding');}
  const token=Object.hasOwn(p.identities.tokens,row.token_id)?p.identities.tokens[row.token_id]:undefined,user=row.user_id===null?null:Object.hasOwn(p.identities.users,row.user_id)?p.identities.users[row.user_id]:undefined;
  if(row.id!==catalog.connection.passwordSecretId||row.dataset_id!==d.sourceId||row.target_hash!==datasetSecretTargetHash(catalog.connection)||!token||user===undefined||(d.authority.userId?user!==d.authority.userId:token!==d.authority.tokenId||user!==null))throw Error('native_external_source_binding');
  let ciphertext:string;
  try{const value=openDatasetSecret(row,source.sourceAuthSecret);if(!value||value.length>4096)throw Error();ciphertext=sealDatasetSecret(value,row.id,row.target_hash,targetAuthSecret);}catch{throw Error('native_external_source_unavailable');}
  rows.push({...row,token_id:token,user_id:user,dataset_id:d.targetId,ciphertext});
 }
 const verifyRow=async(tx:Queryable,row:EncryptedRow)=>{
  const actual=(await tx.query<EncryptedRow>('SELECT id,token_id,user_id,dataset_id,target_hash,ciphertext FROM dataset_secrets WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
  if(!actual||actual.token_id!==row.token_id||actual.user_id!==row.user_id||actual.dataset_id!==row.dataset_id||actual.target_hash!==row.target_hash)throw Error('native_external_collision');
  try{if(openDatasetSecret(actual,targetAuthSecret)!==openDatasetSecret(row,targetAuthSecret))throw Error();}catch{throw Error('native_external_collision');}
 };
 return {async apply(tx){for(const row of rows){await tx.query('INSERT INTO dataset_secrets(id,token_id,user_id,dataset_id,target_hash,ciphertext) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING',[row.id,row.token_id,row.user_id,row.dataset_id,row.target_hash,row.ciphertext]);await verifyRow(tx,row);}},async verify(tx){for(const row of rows)await verifyRow(tx,row);}};
}
