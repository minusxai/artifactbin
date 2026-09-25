import {stampNodeIds,hasAmbiguousLegacyAliases} from './story/node-ids';
/** The artifact persistence boundary. SQL remains explicit at its owning write path;
 * only stored JSONB↔public JSX conversion and lazy migration live here. Never issue
 * an out-of-transaction query: callers always supply their own Queryable.
 */
import {createDocumentGraph} from './story/document-graph';
import {currentStoryCss,storyCssCompileVersion} from './data/story/story-css.server';
import {finalizeArtifactMetadata} from './story/parsed-artifact-metadata';
import type {Queryable} from '@artifactbin/contracts';
import {encodeDocument,decodeDocument,type StoredDocument} from './story/document-codec';
interface SourceRow {source?:string|null;document?:StoredDocument|null}
export function sourceStorage(format:string,source:string|null,certified=false,version=1):{source:string|null;document:string|null} {
 if(format!=='markup'||source===null)return {source,document:null};
 const document=encodeDocument(source);
 return {source:null,document:JSON.stringify(certified&&document.kind==='jsx'?createDocumentGraph(source,version):document)};
}
export function decodeArtifactDocument<T>(value:T):T {
 const row=value as T&SourceRow;
 const {document,...rest}=row;
 if(document==null)return rest as T;
 const source=decodeDocument(document),meta=(rest as {meta?:Record<string,unknown>}).meta;
 return {...rest,document,source,...(('prose' in document||document.kind==='graph')&&meta&&!meta.parsedArtifact?{meta:finalizeArtifactMetadata('markup',source,meta)}:{})} as T;
}
/** Derived rendering data is computed from the committed graph, never a stale
 * admission snapshot. Compilation has no database write or transaction callback. */
export async function hydrateArtifactDocument<T>(value:T):Promise<T> {
 const graph=(value as T&SourceRow).document?.kind==='graph',decoded=decodeArtifactDocument(value);
 const row=decoded as T&{source?:string|null;meta?:Record<string,unknown>};
 if(!graph||!row.meta)return decoded;
 const compiledCss=await currentStoryCss(row.meta,row.source);
 return {...row,meta:{...row.meta,compiledCss,cssCompileVersion:storyCssCompileVersion()}} as T;
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
 if(row.format!=='markup'||row.document==null&&row.source==null)return decodeArtifactDocument(row);
 const source=row.document?decodeDocument(row.document):row.source!;
 const history=row.artifact_id!==undefined;
 if(row.document?.kind==='graph'&&(!history||!source.includes('data-annotation-anchor')))return decodeArtifactDocument(row);
 let authoringSource=source;
 if(history&&source.includes('data-annotation-anchor')&&!hasAmbiguousLegacyAliases(source)){
  const aliases=await db.query<{legacy_key:string;source_id:string}>('SELECT legacy_key,source_id FROM artifact_node_aliases WHERE artifact_id=$1',[row.artifact_id]);
  if(aliases.rows.length)authoringSource=stampNodeIds(source,{legacyAliases:new Map(aliases.rows.map(a=>[a.legacy_key,a.source_id])),retireLegacyAliases:true}).source;
 }
 if(row.document?.kind==='graph'&&authoringSource===source)return decodeArtifactDocument(row);
 const document=createDocumentGraph(authoringSource,row.version);
 const result=await db.query(`UPDATE ${history?'artifact_versions':'artifacts'} SET document=$1::jsonb,source=NULL
 WHERE ${history?'artifact_id':'id'}=$2 AND version=$3 AND NULLIF(document,'null'::jsonb) IS NOT DISTINCT FROM $4::jsonb AND source IS NOT DISTINCT FROM $5::text
 ${history?'':'AND edit_id=$6'} RETURNING document`,history?[JSON.stringify(document),row.artifact_id,row.version,row.document?JSON.stringify(row.document):null,row.source??null]:[JSON.stringify(document),row.id,row.version,row.document?JSON.stringify(row.document):null,row.source??null,row.edit_id]);
 if(result.rows.length)return decodeArtifactDocument({...row,document,source:null});
 return (await artifactQuery<T>(db,sql,params)).rows[0]??null;
}
