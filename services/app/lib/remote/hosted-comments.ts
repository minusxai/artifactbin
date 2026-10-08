import {createHash,createHmac} from 'node:crypto';
import {type HostedRemoteAgent,type RunnerJson} from '@artifactbin/contracts';
import {attachActor,hostedAgentCallbackKey,verifyActor} from '@artifactbin/utils';
import {getDb,type Db} from '../platform/db';
import {PUBLIC_BASE_URL} from '../platform/config';
import {getArtifactById,canReadArtifact} from '../artifacts';
import {runnerOperation} from '../runner';
import {json} from '../http';
import {readCommentContext} from './comment-context';
import {channelForAnnotations} from '../story/realtime/live';

interface Work {id:string;owner:string;session_id:string;artifact_id:string;thread_id:string;comment_id:string;phase:string;data:{commentContext?:RunnerJson;payload:{body:string;author:string|null}}}
let external:{agent:HostedRemoteAgent;key:string}|undefined;
/** Only an explicitly configured URL service gets this callback capability. */
function externalHostedProof(owner:string,id:string):string|undefined {
 if(!external?.agent.owns(owner,id))return;
 return createHmac('sha256',external.key).update(JSON.stringify([owner,id])).digest('hex');
}
export function clearExternalHostedComments(){external=undefined;}
export function externalHostedComments(agent:HostedRemoteAgent,secret:string,options:{db?:Db;publicBaseUrl?:string}={}){
 external={agent,key:hostedAgentCallbackKey(secret)};
 const callbackUrl=new URL('/api/remote/hosted/operations',options.publicBaseUrl??PUBLIC_BASE_URL).href;
 let ticking=false;
 return async()=>{
  if(ticking)return;ticking=true;
  try{
   const db=options.db??await getDb();
   const rows=(await db.query<Work>("SELECT w.* FROM remote_work w JOIN remote_agents a ON a.id=w.session_id AND a.owner=w.owner WHERE a.active=true AND (w.phase='queued' OR (w.phase='dispatching' AND w.updated_at<now()-interval '60 seconds')) ORDER BY w.seq LIMIT 100")).rows;
   for(const work of rows){
    if(!agent.owns(work.owner,work.session_id)||!agent.deliverComment)continue;
    const artifact=await getArtifactById(work.artifact_id);
    if(!artifact||artifact.deleted_at||!await canReadArtifact(artifact,{userId:work.owner,email:null})){
     await db.transaction(async tx=>{await tx.query("UPDATE remote_work SET phase='unavailable',updated_at=now() WHERE id=$1 AND phase IN ('queued','dispatching')",[work.id]);await tx.query('SELECT pg_notify($1,$2)',[channelForAnnotations(work.artifact_id),work.thread_id]);});continue;
    }
    const context=work.data.commentContext??await readCommentContext(db,artifact,work.thread_id,work.comment_id);
    // Commit the lease before HTTP. Ambiguous acceptance must retry the SAME work ID.
    const claimed=await db.transaction(async tx=>{
     const changed=await tx.query("UPDATE remote_work w SET phase='dispatching',data=jsonb_set(w.data,'{commentContext}',COALESCE(w.data->'commentContext',$2::jsonb)),updated_at=now() WHERE w.id=$1 AND (w.phase='queued' OR (w.phase='dispatching' AND w.updated_at<now()-interval '60 seconds')) AND EXISTS(SELECT 1 FROM remote_agents a WHERE a.id=w.session_id AND a.owner=w.owner AND a.active=true) RETURNING w.data",[work.id,JSON.stringify(context)]);
     if(changed.rows.length)await tx.query('SELECT pg_notify($1,$2)',[channelForAnnotations(work.artifact_id),work.thread_id]);
     return changed.rows[0]?.data as Work['data']|undefined;
    });
    if(!claimed)continue;
    try{await agent.deliverComment(work.owner,{requestId:work.id,sessionId:work.session_id,artifactId:work.artifact_id,threadId:work.thread_id,commentId:work.comment_id,body:work.data.payload.body,author:work.data.payload.author,commentContext:claimed.commentContext,callbackUrl});}
    catch{
     // Leave it dispatching so late acknowledgements remain valid; release lease for retry.
     await db.query("UPDATE remote_work SET updated_at=now()-interval '61 seconds' WHERE id=$1 AND phase='dispatching'",[work.id]);
    }
   }
  }finally{ticking=false;}
 };
}
/** The ordinary proxy actor signature is deliberately insufficient for this route. */
export async function hostedCommentOperation(request:Request):Promise<Response>{
 const actor=external?verifyActor(request.headers.get('x-artifactbin-hosted-callback'),external.key):null;
 if(!actor?.userId||actor.credential!=='session')return json({error:'unauthorized'},401);
 let body:Record<string,unknown>|null=null;
 const reader=request.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
 try{if(reader)for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536){await reader.cancel();return json({error:'body_limit'},413);}chunks.push(part.value);}
  const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))body=parsed;
 }catch{return json({error:'invalid_operation_input'},400);}finally{reader?.releaseLock();}
 if(!body||typeof body.requestId!=='string'||typeof body.sessionId!=='string'||!['read','reply'].includes(String(body.operation))||!body.input||typeof body.input!=='object'||Array.isArray(body.input))return json({error:'invalid_operation_input'},400);
 const proof=externalHostedProof(actor.userId,body.sessionId);
 if(!proof)return json({error:'not_found'},404);
 const db=await getDb();
 const work=(await db.query<Work>('SELECT w.* FROM remote_work w JOIN remote_agents a ON a.id=w.session_id AND a.owner=w.owner WHERE w.id=$1 AND w.owner=$2 AND w.session_id=$3 AND a.active=true',[body.requestId,actor.userId,body.sessionId])).rows[0];
 if(!work||['unavailable','superseded'].includes(work.phase)||(work.phase==='queued'&&(body.operation!=='reply'||(body.input as Record<string,unknown>).phase!=='failed')))return json({error:'not_found'},404);
 const artifact=await getArtifactById(work.artifact_id);
 if(!artifact||artifact.deleted_at||!await canReadArtifact(artifact,{userId:actor.userId,email:null}))return json({error:'not_found'},404);
 const input=body.input as Record<string,unknown>;
 const headers=new Headers();
 if(body.operation==='reply'){
  if(typeof input.body!=='string'||!input.body||input.body.length>32000||!['acknowledged','completed','blocked','failed'].includes(String(input.phase))||(input.resolve!==undefined&&typeof input.resolve!=='boolean'))return json({error:'invalid_reply'},400);
  // The durable terminal receipt owns delivery identity, even if recovery reconstructs different prose.
  if(work.phase===input.phase&&['completed','failed'].includes(work.phase))return json({ok:true,alreadyDelivered:true});
  headers.set('X-Artifactbin-Remote-Session',work.session_id);
  headers.set('X-Artifactbin-Remote-Proof',proof);
  headers.set('Idempotency-Key',`${work.id}-${input.phase}`);
 }
 const trusted=attachActor(new Request(request.url,{method:'POST',headers}),{userId:actor.userId,credential:'session'});
 return runnerOperation(trusted,body.operation==='read'?'get_artifact':'annotate',body.operation==='read'?{id:work.artifact_id}:{id:work.artifact_id,annotation_id:work.thread_id,request_id:work.id,reply:input.body,phase:input.phase,...(input.resolve!==undefined?{resolve:input.resolve}:{})});
}
export const externalHostedProofHash=(owner:string,id:string)=>{const proof=externalHostedProof(owner,id);return proof?createHash('sha256').update(proof).digest('hex'):undefined;};
