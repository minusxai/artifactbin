import type {RunnerJson} from '@artifactbin/contracts';
import type {Queryable} from '../platform/db';

interface ContextRow {id:string;body:string;author_kind:string;author_label:string|null;created_at:string;quote:string|null;snippet:string;anchor_key:string|null;anchor_version:number|null;range:RunnerJson}
const LIMIT=65536;
/** Bounds serialized JSON, including escapes, rather than assuming character count is byte count. */
function boundedText(value:string,bytes:number):string {
 if(Buffer.byteLength(JSON.stringify(value))<=bytes)return value;
 let low=0,high=value.length;
 while(low<high){const mid=Math.ceil((low+high)/2);if(Buffer.byteLength(JSON.stringify(value.slice(0,mid)))<=bytes)low=mid;else high=mid-1;}
 const result=value.slice(0,low);return /[\uD800-\uDBFF]$/.test(result)?result.slice(0,-1):result;
}
/** Caller MUST have checked actor read access to this artifact. Snapshot only through this request. */
export async function readCommentContext(db:Queryable,artifact:{id:string;title?:string|null;meta?:{title?:unknown}},threadId:string,commentId:string):Promise<RunnerJson>{
 const rows=(await db.query<ContextRow>(`SELECT id,body,author_kind,author_label,created_at,quote,snippet,anchor_key,anchor_version,range FROM annotations
 WHERE artifact_id=$1 AND (id=$2 OR root_id=$2) AND deleted_at IS NULL
 AND seq<=(SELECT seq FROM annotations WHERE id=$3 AND artifact_id=$1 AND (id=$2 OR root_id=$2)) ORDER BY seq`,[artifact.id,threadId,commentId])).rows;
 const root=rows.find(row=>row.id===threadId),quote=root?.quote??root?.snippet??'';
 const context:{[key:string]:RunnerJson}={artifactId:artifact.id,title:boundedText(artifact.title??String(artifact.meta?.title??''),2048),threadId,commentId,quote:boundedText(quote,32768),anchor:root?.anchor_key?{key:root.anchor_key,nodeId:root.anchor_key,version:root.anchor_version,range:root.range??null}:null,thread:[],truncated: false};
 const thread:RunnerJson[]=[];context.thread=thread;
 // Keep the triggering message first in priority; serialize accepted messages in original order.
 for(const row of [...rows].reverse()){
  const message:RunnerJson={id:row.id,body:row.body,author:{kind:row.author_kind,label:row.author_label},created_at:String(row.created_at)};
  thread.unshift(message);
  if(Buffer.byteLength(JSON.stringify(context))>LIMIT){thread.shift();context.truncated=true;}
 }
 if(context.quote!==quote)context.truncated=true;
 return context;
}
