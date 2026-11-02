import {createHash} from 'node:crypto';
import type {HtmlPageLink, Queryable} from '@artifactbin/contracts';
/** Names are page-local; revisions are authoritative committed store/dataset identities. */
export interface HtmlSharedRevision {name:string; revision:string}
export function htmlLiveLinks(meta:Record<string,unknown>):HtmlPageLink[]{
 return ((meta.htmlLinks??[]) as HtmlPageLink[]).filter(link=>link.kind==='backend'||link.kind==='dataset'&&link.mode==='live');
}
interface HtmlSharedAccess { mayReadDataset(id:string):Promise<boolean> }
/**
 * An api 1 backend's revision is its store version. An api 2 resolver has no store: it reads the page's datasets
 * through caps.query, so its revision is a hash of every live dataset the page links (head version, edit and
 * whether it still exists). That covers the readers caps.query serves through the page without sharing of their
 * own on the dataset, so it does not depend on `mayReadDataset`; the hash names no dataset.
 */
export async function htmlSharedRevisions(db:Queryable,links:readonly HtmlPageLink[],access:HtmlSharedAccess):Promise<HtmlSharedRevision[]>{
 const backends=links.filter(link=>link.kind==='backend');
 const datasets=links.filter(link=>link.kind==='dataset'&&link.mode==='live');
 const stores=backends.length?(await db.query<{backend_id:string;version:number}>('SELECT backend_id,version FROM html_backend_stores WHERE backend_id=ANY($1::text[])',[backends.map(link=>link.backendId)])).rows:[];
 const apis=backends.length?(await db.query<{backend_id:string;version:string;api:number|null}>('SELECT backend_id,version,api FROM html_backend_versions WHERE backend_id=ANY($1::text[])',[backends.map(link=>link.backendId)])).rows:[];
 const resolvers=backends.some(link=>apis.find(row=>row.backend_id===link.backendId&&row.version===link.version)?.api===2);
 const allowed=new Set((await Promise.all(datasets.map(async link=>await access.mayReadDataset(link.datasetId)?link.datasetId:null))).filter((id):id is string=>id!==null));
 const wanted=resolvers?new Set(datasets.map(link=>link.datasetId)):allowed;
 const rows=wanted.size?(await db.query<{id:string;version:number;edit_id:string;live:boolean}>('SELECT id,version,edit_id,deleted_at IS NULL AS live FROM artifacts WHERE id=ANY($1::text[])',[[...wanted]])).rows:[];
 const linked=createHash('sha256').update(JSON.stringify([...new Set(datasets.map(link=>link.datasetId))].sort().map(id=>{const row=rows.find(row=>row.id===id);return [id,row?row.version:null,row?.edit_id??null,row?.live??false];}))).digest('base64url');
 return links.flatMap(link=>{
  if(link.kind==='backend'){
   if(apis.find(row=>row.backend_id===link.backendId&&row.version===link.version)?.api===2)return [{name:link.name,revision:`resolver:${link.backendId}:${linked}`}];
   const row=stores.find(row=>row.backend_id===link.backendId);return [{name:link.name,revision:row?`backend:${link.backendId}:${row.version}`:'missing'}];
  }
  if(link.mode!=='live')return [];
  if(!allowed.has(link.datasetId))return [{name:link.name,revision:'unavailable'}];
  const row=rows.find(row=>row.id===link.datasetId);return [{name:link.name,revision:row?.live?`dataset:${link.datasetId}:${row.version}:${row.edit_id}:true`:'unavailable'}];
 });
}
/** First connection and reconnect deliberately invalidate all names, never replay mutations. */
export function changedHtmlSharedRevisions(previous:ReadonlyMap<string,string>,current:readonly HtmlSharedRevision[]):HtmlSharedRevision[]{
 return current.filter(mark=>previous.get(mark.name)!==mark.revision);
}
