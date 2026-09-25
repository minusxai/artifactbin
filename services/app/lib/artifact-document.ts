/** The artifact persistence boundary. SQL remains explicit at its owning write path;
 * only stored JSONB↔public JSX conversion and lazy migration live here. Never issue
 * an out-of-transaction query: callers always supply their own Queryable.
 */
import {createSemanticDocument} from './story/document-semantic';
import {finalizeArtifactMetadata} from './story/parsed-artifact-metadata';
import type {Queryable} from '@artifactbin/contracts';
import {encodeDocument,decodeDocument,type StoredDocument} from './story/document-codec';
interface SourceRow {source?:string|null;document?:StoredDocument|null}
export function sourceStorage(format:string,source:string|null,certified=false,version=1):{source:string|null;document:string|null} {
 if(format!=='markup'||source===null)return {source,document:null};
 const document=encodeDocument(source);
 return {source:null,document:JSON.stringify(certified&&document.kind==='jsx'?createSemanticDocument(source,version):document)};
}
export function decodeArtifactDocument<T>(value:T):T {
 const row=value as T&SourceRow;
 const {document,...rest}=row;
 if(document==null)return rest as T;
 const source=decodeDocument(document),meta=(rest as {meta?:Record<string,unknown>}).meta;
 return {...rest,source,...('prose' in document&&meta&&!meta.parsedArtifact?{meta:finalizeArtifactMetadata('markup',source,meta)}:{})} as T;
}
export async function artifactQuery<T=Record<string,unknown>>(db:Queryable,sql:string,params:unknown[]=[]):Promise<{rows:T[]}> {
 const result=await db.query<T>(sql,params);
 return {...result,rows:result.rows.map(decodeArtifactDocument)};
}
interface MigratableRow extends SourceRow {id?:string;artifact_id?:string;format:string;version:number;edit_id?:string}
/** The reload uses exactly the caller's original ACL/projection after a lost migration CAS.
 * Representation-only writes do not mint edit IDs, timestamps, history or notifications.
 */
export async function loadArtifactDocument<T extends MigratableRow>(db:Queryable,sql:string,params:unknown[]):Promise<T|null> {
 const row=(await db.query<T>(sql,params)).rows[0];
 if(!row)return null;
 if(row.document!=null||row.format!=='markup'||row.source==null)return decodeArtifactDocument(row);
 const storage=sourceStorage(row.format,row.source),history=row.artifact_id!==undefined;
 const result=await db.query(`UPDATE ${history?'artifact_versions':'artifacts'} SET document=$1::jsonb,source=NULL
 WHERE ${history?'artifact_id':'id'}=$2 AND version=$3 AND format='markup' AND document IS NULL AND source=$4
 ${history?'':'AND edit_id=$5'} RETURNING document`,history?[storage.document,row.artifact_id,row.version,row.source]:[storage.document,row.id,row.version,row.source,row.edit_id]);
 if(result.rows.length)return decodeArtifactDocument({...row,document:JSON.parse(storage.document!),source:null});
 return (await artifactQuery<T>(db,sql,params)).rows[0]??null;
}
