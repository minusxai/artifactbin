import type {HtmlPageLink, Queryable} from '@artifactbin/contracts';
/** Names are page-local; revisions are authoritative committed store/dataset identities. */
export interface HtmlSharedRevision {name:string; revision:string}
export function htmlLiveLinks(meta:Record<string,unknown>):HtmlPageLink[]{
 return ((meta.htmlLinks??[]) as HtmlPageLink[]).filter(link=>link.kind==='backend'||link.kind==='dataset'&&link.mode==='live');
}
export async function htmlSharedRevisions(db:Queryable,links:readonly HtmlPageLink[]):Promise<HtmlSharedRevision[]>{
 const backends=links.filter(link=>link.kind==='backend');
 const datasets=links.filter(link=>link.kind==='dataset'&&link.mode==='live');
 const stores=backends.length?(await db.query<{backend_id:string;version:number}>('SELECT backend_id,version FROM html_backend_stores WHERE backend_id=ANY($1::text[])',[backends.map(link=>link.backendId)])).rows:[];
 const rows=datasets.length?(await db.query<{id:string;version:number;edit_id:string;live:boolean}>('SELECT id,version,edit_id,deleted_at IS NULL AS live FROM artifacts WHERE id=ANY($1::text[])',[datasets.map(link=>link.datasetId)])).rows:[];
 return links.flatMap(link=>{
  if(link.kind==='backend'){const row=stores.find(row=>row.backend_id===link.backendId);return [{name:link.name,revision:row?`backend:${link.backendId}:${row.version}`:'missing'}];}
  if(link.mode!=='live')return [];
  const row=rows.find(row=>row.id===link.datasetId);return [{name:link.name,revision:row?`dataset:${link.datasetId}:${row.version}:${row.edit_id}:${row.live}`:'missing'}];
 });
}
/** First connection and reconnect deliberately invalidate all names, never replay mutations. */
export function changedHtmlSharedRevisions(previous:ReadonlyMap<string,string>,current:readonly HtmlSharedRevision[]):HtmlSharedRevision[]{
 return current.filter(mark=>previous.get(mark.name)!==mark.revision);
}
