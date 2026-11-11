import type {HtmlDatasetLink, HtmlPageLink, Queryable} from '@artifactbin/contracts';
/** Names are page-local; revisions are authoritative committed dataset identities. */
export interface HtmlSharedRevision {name:string; revision:string}
const liveDataset=(link:HtmlPageLink):link is HtmlDatasetLink=>link.kind==='dataset'&&link.mode==='live';
/**
 * The page's live dataset links: a pinned link reads its recorded revision, the default connection has no revision to
 * watch, and a stored link of a removed kind is none of them, so none is a live subscription.
 */
export function htmlLiveLinks(meta:Record<string,unknown>):HtmlDatasetLink[]{
 return ((meta.htmlLinks??[]) as HtmlPageLink[]).filter(liveDataset);
}
interface HtmlSharedAccess { mayReadDataset(id:string):Promise<boolean> }
/** Each live dataset link's committed revision, for a reader who may read it; `unavailable` otherwise. */
export async function htmlSharedRevisions(db:Queryable,links:readonly HtmlPageLink[],access:HtmlSharedAccess):Promise<HtmlSharedRevision[]>{
 const datasets=links.filter(liveDataset);
 const allowed=new Set((await Promise.all(datasets.map(async link=>await access.mayReadDataset(link.datasetId)?link.datasetId:null))).filter((id):id is string=>id!==null));
 const rows=allowed.size?(await db.query<{id:string;version:number;edit_id:string;live:boolean}>('SELECT id,version,edit_id,deleted_at IS NULL AS live FROM artifacts WHERE id=ANY($1::text[])',[[...allowed]])).rows:[];
 return datasets.map(link=>{
  if(!allowed.has(link.datasetId))return {name:link.name,revision:'unavailable'};
  const row=rows.find(row=>row.id===link.datasetId);return {name:link.name,revision:row?.live?`dataset:${link.datasetId}:${row.version}:${row.edit_id}:true`:'unavailable'};
 });
}
/** First connection and reconnect deliberately invalidate all names, never replay mutations. */
export function changedHtmlSharedRevisions(previous:ReadonlyMap<string,string>,current:readonly HtmlSharedRevision[]):HtmlSharedRevision[]{
 return current.filter(mark=>previous.get(mark.name)!==mark.revision);
}
