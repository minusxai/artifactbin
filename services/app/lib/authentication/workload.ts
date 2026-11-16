/**
 * Host-only admission. A grant is checked anew at admission and before delivery; no global
 * adapter or network credential exists. Writes use final admission, never a promise
 * that cancellation retracts committed effects.
 */
import type {Actor,WorkloadAuthority,WorkloadBinding,WorkloadAuthorization,WorkloadOperation,WorkloadReadOperation} from '@artifactbin/contracts';
import type {RequestIdentity} from '@/lib/accounts';
import {publicationNamespace} from '@/lib/artifacts';
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
  &&(row.rootFolderId===null||typeof row.rootFolderId==='string'&&row.rootFolderId.length>0)
  &&(row.publication===undefined||(typeof row.publication.slot==='string'&&row.publication.slot.length>0&&row.publication.slot.length<=128&&Number.isSafeInteger(row.publication.maxArtifacts)&&row.publication.maxArtifacts>0&&Number.isSafeInteger(row.publication.maxBytes)&&row.publication.maxBytes>0))
  &&[row.readArtifactIds,row.writeArtifactIds].every(ids=>Array.isArray(ids)&&ids.every(id=>typeof id==='string'&&id.length>0));
}
async function operation(request:Request):Promise<WorkloadOperation|null> {
 const path=new URL(request.url).pathname;
 if(request.method==='POST'&&path==='/api/artifacts'){
  try{const b=await request.clone().json();return {kind:'artifact-create',format:typeof b.html==='string'?'html':String(b.format??(b.dataset?'dataset':b.file?'file':'')),parentId:typeof b.parent_id==='string'?b.parent_id:null,resource:'primary'};}catch{return null;}
 }
 const update=path.match(/^\/api\/artifacts\/([^/]+)$/);
 if(request.method==='PUT'&&update){
  try{const body=await request.clone().json();
   if(['visibility','parent_id','destination','shares','linkRole','access','connection','publicationBundle','policy','format'].some(key=>Object.hasOwn(body,key))||typeof body.html!=='string'||body.expectedVersion===undefined||body.expectedState===undefined)return null;
   return {kind:'artifact-update',artifactId:update[1],format:'html'};
  }catch{return null;}
 }
 if(!['GET','HEAD'].includes(request.method))return null;
 const api=path.match(/^\/api\/artifacts\/([^/]+)(?:\/(versions)(?:\/(\d+))?)?$/);
 if(api){const read:WorkloadReadOperation={kind:'artifact-read',artifactId:api[1],source:api[3]?'version':api[2]?'versions':'canonical'};return read;}
 const raw=path.match(/^\/a\/([^/]+)\/raw$/);
 return raw?{kind:'artifact-read',artifactId:raw[1],source:'raw'}:null;
}
export async function workloadRequest(request:Request,actor:Actor,authority:WorkloadAuthority|undefined,dispatch:()=>Promise<Response>):Promise<Response> {
 const denied=()=>json({error:'forbidden'},403),op=await operation(request);
 if(!authority||!op||!binding(actor.workload)||actor.userId||actor.tokenId||actor.sessionId)return denied();
 Object.freeze(op);
 const principal=Object.freeze({...actor.workload});
 const authorize=async(effect:WorkloadOperation=op)=>{
  try {
   const answer=await authority.authorize(principal,effect,request.signal);
   if(!grant(answer,principal))return null;
   if(effect.kind!=='artifact-read'&&(!answer.publication||answer.role!=='editor'))return null;
   const db=await getDb();
   if(!(await db.query('SELECT 1 FROM groups WHERE id=$1 AND deleted_at IS NULL',[principal.groupId])).rows.length)return null;
   let outputs:string[]=[];
   if(answer.publication){
    const namespace=publicationNamespace({workload:answer,userId:null,tokenId:null,email:null,documentEditor:false});
    outputs=(await db.query<{artifact_id:string}>('SELECT artifact_id FROM workload_publication_outputs WHERE namespace=$1',[namespace])).rows.map(row=>row.artifact_id);
   }
   const ids=[...new Set([...answer.readArtifactIds,...outputs])];
   if(effect.kind==='artifact-read'){
    if(!ids.includes(effect.artifactId)||!(await db.query('SELECT 1 FROM artifacts WHERE id=$1 AND group_id=$2 AND deleted_at IS NULL',[effect.artifactId,principal.groupId])).rows.length)return null;
   }
   if(effect.kind==='artifact-update'&&(!outputs.includes(effect.artifactId)||!(await db.query("SELECT 1 FROM artifacts WHERE id=$1 AND group_id=$2 AND format='html' AND deleted_at IS NULL",[effect.artifactId,principal.groupId])).rows.length))return null;
   return Object.freeze({...answer,principal,publication:answer.publication?Object.freeze({...answer.publication}):undefined,readArtifactIds:Object.freeze(ids),writeArtifactIds:Object.freeze(outputs)});
  }catch{return null;}
 };
 const scope=await authorize();if(!scope)return denied();
 admitted.set(request,{credential:'workload',workload:scope,userId:null,tokenId:null,email:null,emailVerified:null,documentEditor:false,finalWorkloadAdmission:async effect=>{
  const final=await authorize(effect);
  return !!final&&final.role==='editor'&&JSON.stringify(final.publication)===JSON.stringify(scope.publication)&&final.rootFolderId===scope.rootFolderId;
 }});
 try {
  const response=await dispatch();
  // Buffer before the final fence so no protected stream escapes before revalidation.
  const body=await response.arrayBuffer();
  if(op.kind!=='artifact-read')return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
  const final=await authorize();
  if(!final||!scope.readArtifactIds.every(id=>final.readArtifactIds.includes(id)))return denied();
  return new Response(body.byteLength?body:null,{status:response.status,statusText:response.statusText,headers:response.headers});
 }finally{admitted.delete(request);}
}
