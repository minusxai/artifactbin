/**
 * Host-only admission. A grant is checked anew at admission and before delivery; no global
 * adapter or network credential exists. Later writes require final admission, not a promise
 * that cancellation retracts committed effects.
 */
import type {Actor,WorkloadAuthority,WorkloadBinding,WorkloadAuthorization,WorkloadReadOperation} from '@artifactbin/contracts';
import type {RequestIdentity} from '@/lib/accounts';
import {getDb} from '@/lib/platform';
import {json} from '@/lib/http';
const admitted=new WeakMap<Request,RequestIdentity>();
export const workloadIdentity=(request:Request):RequestIdentity|undefined=>admitted.get(request);
const keys=['issuerId','subjectId','grantId','groupId','executionId','environmentId','intentHash'] as const;
function binding(value:unknown):value is WorkloadBinding {
 if(!value||typeof value!=='object')return false;
 const row=value as WorkloadBinding;
 return keys.every(key=>typeof row[key]==='string'&&row[key].length>0)&&Number.isSafeInteger(row.epoch)&&row.epoch>=0;
}
function grant(value:unknown,expected:WorkloadBinding):value is Extract<WorkloadAuthorization,{allowed:true}> {
 if(!value||typeof value!=='object')return false;
 const row=value as Extract<WorkloadAuthorization,{allowed:true}>;
 return row.allowed===true&&binding(row.principal)&&keys.every(key=>row.principal[key]===expected[key])&&row.principal.epoch===expected.epoch
  &&(row.role==='viewer'||row.role==='editor')&&row.visibility==='private'
  &&(row.rootFolderId===null||typeof row.rootFolderId==='string')
  &&[row.readArtifactIds,row.writeArtifactIds].every(ids=>Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.length>0));
}
function operation(request:Request):WorkloadReadOperation|null {
 if(!['GET','HEAD'].includes(request.method))return null;
 const path=new URL(request.url).pathname;
 const api=path.match(/^\/api\/artifacts\/([^/]+)(?:\/(versions)(?:\/(\d+))?)?$/);
 if(api)return {kind:'artifact-read',artifactId:api[1],source:api[3]?'version':api[2]?'versions':'canonical'};
 const raw=path.match(/^\/a\/([^/]+)\/raw$/);
 return raw?{kind:'artifact-read',artifactId:raw[1],source:'raw'}:null;
}
export async function workloadRequest(request:Request,actor:Actor,authority:WorkloadAuthority|undefined,dispatch:()=>Promise<Response>):Promise<Response> {
 const denied=()=>json({error:'forbidden'},403),op=operation(request);
 if(!authority||!op||!binding(actor.workload)||actor.userId||actor.tokenId||actor.sessionId)return denied();
 Object.freeze(op);
 const principal=Object.freeze({...actor.workload});
 const authorize=async()=>{
  try {
   const answer=await authority.authorize(principal,op,request.signal);
   if(!grant(answer,principal)||!answer.readArtifactIds.includes(op.artifactId))return null;
   if(!(await (await getDb()).query('SELECT 1 FROM groups g JOIN artifacts a ON a.group_id=g.id WHERE g.id=$1 AND g.deleted_at IS NULL AND a.id=$2 AND a.deleted_at IS NULL',[principal.groupId,op.artifactId])).rows.length)return null;
   return Object.freeze({...answer,principal,readArtifactIds:Object.freeze([...answer.readArtifactIds]),writeArtifactIds:Object.freeze([...answer.writeArtifactIds])});
  }catch{return null;}
 };
 const scope=await authorize();if(!scope)return denied();
 admitted.set(request,{credential:'workload',workload:scope,userId:null,tokenId:null,email:null,emailVerified:null,documentEditor:false});
 try {
  const response=await dispatch();
  // Buffer before the final fence so no protected stream escapes before revalidation.
  const body=await response.arrayBuffer();
  const final=await authorize();
  if(!final||!scope.readArtifactIds.every(id=>final.readArtifactIds.includes(id)))return denied();
  return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
 }finally{admitted.delete(request);}
}
