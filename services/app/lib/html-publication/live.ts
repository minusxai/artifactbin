import type {HtmlDatasetLink, HtmlPageLink} from '@artifactbin/contracts/html-page';
import type {Queryable} from '@artifactbin/contracts/db';
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
/**
 * The live link's data and authorization change marker. Policy and sharing can change without publishing a row
 * version. The stream must re-run a viewer's reads and edit hints in that case, without including policy data.
 */
export async function htmlSharedRevisions(db:Queryable,links:readonly HtmlPageLink[],access:HtmlSharedAccess):Promise<HtmlSharedRevision[]>{
 const datasets=links.filter(liveDataset);
 const allowed=new Set((await Promise.all(datasets.map(async link=>await access.mayReadDataset(link.datasetId)?link.datasetId:null))).filter((id):id is string=>id!==null));
 const rows=allowed.size?(await db.query<{id:string;version:number;edit_id:string;live:boolean;authority:string}>(
  `SELECT id,version,edit_id,deleted_at IS NULL AS live,
    md5(json_build_array(access,policy_revision,sharing_revision)::text) AS authority
    FROM artifacts WHERE id=ANY($1::text[])`,[[...allowed]])).rows:[];
 return datasets.map(link=>{
  if(!allowed.has(link.datasetId))return {name:link.name,revision:'unavailable'};
  const row=rows.find(row=>row.id===link.datasetId);return {name:link.name,revision:row?.live?`dataset:${link.datasetId}:${row.version}:${row.edit_id}:true:${row.authority}`:'unavailable'};
 });
}
/** First connection and reconnect deliberately invalidate all names, never replay mutations. */
export function changedHtmlSharedRevisions(previous:ReadonlyMap<string,string>,current:readonly HtmlSharedRevision[]):HtmlSharedRevision[]{
 return current.filter(mark=>previous.get(mark.name)!==mark.revision);
}
