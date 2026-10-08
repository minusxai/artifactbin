import {services} from '../platform/services';
import {managedTerminalView,managedTerminalInput,stopManagedTerminal} from './managed-terminal';
import {managedRunRosterStatus} from './managed-status';
import {externalHostedProofHash} from './hosted-comments';
import {hostedRemoteAgent} from './hosted-interface';
import {isTerminalFeedback} from './terminal-input';
import { getArtifactById } from '../artifacts/store';
import { canReadArtifact } from '../artifacts/access';
import {createHash,randomUUID} from 'node:crypto';
import {getDb,type Queryable} from '../platform/db';
import {sessionMentions} from '../annotations/session-mentions';
import {channelForAnnotations} from '../story/realtime/live';
import {RemoteRegistry,RemoteError,remoteSessions,type Registration} from './registry';
import {REMOTE_WORK_LIMIT,REMOTE_WORK_BYTES,remoteColor} from '../../../contracts/src/remote';
import type {RemoteSessionInfo,RemoteExchange,RemoteWork,RemoteWorkPhase} from '../../../contracts/src/remote';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
interface AgentRow {id:string;owner:string;active:boolean;proof_hash:string;info:RemoteSessionInfo & {removed?:boolean}}
interface WorkRow {agent_info?:RemoteSessionInfo;connected?:boolean;active?:boolean;id:string;session_id:string;artifact_id:string;thread_id:string;comment_id:string;phase:RemoteWorkPhase;data:{name:string;color:RemoteWork['color'];reason?:RemoteWork['reason'];payload:Record<string,unknown>};updated_at:string}
export interface ReviewReceipt {id:string;sessionId:string;proof:string;phase:'acknowledged'|'completed'|'blocked'|'failed'}
/** Durable names and work receipts; terminal bytes and interactive input remain in the relay. */
export class RemoteAgents {
 constructor(readonly relay:RemoteRegistry=remoteSessions){}
 private async row(tx:Queryable,owner:string,id:string,lock=false){return (await tx.query<AgentRow>(`SELECT * FROM remote_agents WHERE owner=$1 AND id=$2${lock?' FOR UPDATE':''}`,[owner,id])).rows[0];}
 async create(owner:string,input:Registration){
  if(input.hostedSessionId)return this.connectHosted(owner,input);
  if(!input.managed)return this.relay.create(owner,input);
  // Validate all registration fields before taking a durable name reservation.
  const previous=new Set(this.relay.list(owner).map(s=>s.id));
  const info=this.relay.create(owner,input);const {runnerKey,...publicInfo}=info;
  const db=await getDb();
  try{
   const saved=await db.transaction(async tx=>{
    const old=await this.row(tx,owner,info.id,true);
    if(old){if(!old.active)throw new RemoteError('Session stopped',410);if(old.proof_hash!==hash(runnerKey))throw new RemoteError('Invalid runner credential',403);return old.info;}
    await tx.query('INSERT INTO remote_agents (id,owner,name,proof_hash,info) VALUES ($1,$2,$3,$4,$5)',[info.id,owner,info.name,hash(runnerKey),JSON.stringify(publicInfo)]);
    return publicInfo;
   });
   this.relay.restore(owner,info.id,saved);
   // A recreated relay cannot prove whether a previously delivered prompt ran.
   if(!previous.has(info.id))await db.query("UPDATE remote_work SET phase='uncertain',updated_at=now() WHERE session_id=$1 AND phase IN ('dispatching','delivered','acknowledged')",[info.id]);
   return {...saved,online:true,runnerKey};
  }catch(error){
   this.relay.discard(owner,info.id);
   if(error && typeof error==='object' && 'code' in error && error.code==='23505')throw new RemoteError(`${info.name} already running. Use --name ${info.name}2 to create another agent.`,409);
   throw error;
  }
 }
 /** Bind a compute generation to the app-reserved identity. Authentication owns the admission;
  * the ephemeral proof subsequently protects ready/exchange/receipts. Never persist plaintext proof. */
 private async connectHosted(owner:string,input:Registration){
  const db=await getDb();return db.transaction(async tx=>{
   const row=await this.row(tx,owner,input.hostedSessionId!,true);
   if(!row?.info.runId||!row.info.hostedGeneration)throw new RemoteError('Hosted agent not found',404);
   if(!row.active||row.info.activity==='stopping')throw new RemoteError('Session stopped',410);
   if(input.hostedGeneration!==row.info.hostedGeneration)throw new RemoteError('Stale hosted generation',409);
   if(!input.managed||input.name!==row.info.name||input.harness!==row.info.harness)throw new RemoteError('Hosted configuration conflict',409);
   if(!input.recoveryKey||!/^[a-f0-9]{64}$/.test(input.recoveryKey))throw new RemoteError('Invalid recovery credential');
   const proofHash=hash(createHash('sha256').update(JSON.stringify(['runner',owner,input.recoveryKey])).digest('hex'));
   const existing=this.relay.list(owner).find(s=>s.id===row.id);
   const same=row.proof_hash===proofHash;
   if(!same){
    if(existing)this.relay.discard(owner,row.id);
    row.info={...row.info,cwd:input.cwd,online:true,exitCode:null,activity:'starting'};
    await this.interrupted(tx,row.id);
   }
   if(same&&!existing){await tx.query("UPDATE remote_work SET phase='uncertain',updated_at=now() WHERE session_id=$1 AND phase='dispatching'",[row.id]);await this.notifyAgent(tx,row.id);}
   const registered=this.relay.create(owner,input,row.id);
   row.proof_hash=hash(registered.runnerKey);
   await tx.query('UPDATE remote_agents SET proof_hash=$2 WHERE id=$1',[row.id,row.proof_hash]);
   await this.save(tx,row);this.relay.restore(owner,row.id,row.info);
   return {...row.info,online:true,runnerKey:registered.runnerKey};
  });
 }
 /** One lifecycle projection serves roster, detail and terminal reads. Runner I/O
  * happens after durable reads, never while holding a database transaction. */
 private async managedSession(owner:string,row:AgentRow):Promise<RemoteSessionInfo>{
  const info={...row.info};
  try{
   const run=await services().runner.getRun({userId:owner,runId:info.runId!});
   if(!info.hostedGeneration||run.status!=='running'||!row.active||info.activity==='stopping')return {...info,...managedRunRosterStatus(run.status,row.active,info.activity)};
   return {...info,online:this.relay.list(owner).some(s=>s.id===row.id&&s.online&&s.hostedGeneration===info.hostedGeneration)};
  }catch{return {...info,online:false,activity:row.active?'unknown':info.activity==='stopped'?'stopped':'stopping'};}
 }
 async list(owner:string){
  const hosted=hostedRemoteAgent();const defaultAgent=hosted?{...await hosted.ensure(owner),included:true}:undefined;
  const db=await getDb();
  if(defaultAgent){
   // External services do not share app storage. Keep only routing/mention metadata here;
   // The proof stays app-internal; it is never returned as a local-agent credential.
   await db.query('INSERT INTO remote_agents(id,owner,name,proof_hash,info) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[defaultAgent.id,owner,defaultAgent.name,externalHostedProofHash(owner,defaultAgent.id)??hash(randomUUID()),JSON.stringify(defaultAgent)]);
   const registered=await this.row(db,owner,defaultAgent.id);
   if(registered&&externalHostedProofHash(owner,defaultAgent.id))await db.query('UPDATE remote_agents SET proof_hash=$3,seen_at=now() WHERE id=$1 AND owner=$2',[defaultAgent.id,owner,externalHostedProofHash(owner,defaultAgent.id)]);
   if(!registered)throw new RemoteError('Managed session conflicts with an existing agent',409);
  }
  const saved=(await db.query<AgentRow>("SELECT * FROM remote_agents WHERE owner=$1 AND COALESCE(info->>'removed','false')<>'true' ORDER BY seen_at DESC LIMIT 100",[owner])).rows;
  await Promise.all(saved.filter(r=>r.info.runId).map(async row=>{row.info=await this.managedSession(owner,row);}));
  const live=this.relay.list(owner);return [...live.filter(s=>!s.managed),...saved.map(r=>({...r.info,...(defaultAgent?.id===r.id?{included:true,activity:defaultAgent.activity}:{}),online:r.info.runId?r.info.online:defaultAgent?.id===r.id?defaultAgent.online:live.some(s=>s.id===r.id&&s.online)})),...(defaultAgent&&!saved.some(r=>r.id===defaultAgent.id)?[defaultAgent]:[])];
 }
 async read(owner:string,id:string){const hosted=hostedRemoteAgent();if(hosted?.owns(owner,id))return {...await hosted.ensure(owner),included:true};const saved=await this.row(await getDb(),owner,id);if(saved){if(saved.info.removed)throw new RemoteError('Session removed',410);if(saved.info.runId)return this.managedSession(owner,saved);let online=false;try{const live=this.relay.read(owner,id);online=saved.active&&live.online&&(!saved.info.hostedGeneration||live.hostedGeneration===saved.info.hostedGeneration);}catch{/* absent relay */}return {...saved.info,online};}return this.relay.read(owner,id);}
 async view(owner:string,id:string,since:number){const hosted=hostedRemoteAgent();if(hosted?.owns(owner,id)){const view=await hosted.view(owner,id,since);return {...view,session:{...view.session,included:true}};}const session=await this.read(owner,id);if(session.runId&&(!session.hostedGeneration||!session.online))return managedTerminalView(owner,session);try{return {...await this.relay.view(owner,id,since),session};}catch(error){if(!(error instanceof RemoteError)||error.status!==404)throw error;return {session,seq:0,frames:[],snapshot:'',generation:`offline-${id}`};}}
 async owns(owner:string,id:string){return !!hostedRemoteAgent()?.owns(owner,id)||this.relay.owns(owner,id)||!!await this.row(await getDb(),owner,id);}
 async ready(owner:string,id:string,proof:string){
  const db=await getDb();await db.transaction(async tx=>{
   const r=await this.row(tx,owner,id,true);if(!r){this.relay.ready(owner,id,proof);return;}
   this.check(r,proof);if(!r.active)throw new RemoteError('Session stopped',410);
   if(r.info.activity==='queued'||r.info.activity==='starting'||r.info.activity==='unknown'){r.info.activity='listening';await this.save(tx,r);await this.notifyAgent(tx,id);}
   try{this.relay.restore(owner,id,r.info);}catch(error){if(!(error instanceof RemoteError))throw error;}
  });
 }
 async input(owner:string,id:string,data:string){
  const hosted=hostedRemoteAgent();if(hosted?.owns(owner,id))return hosted.input(owner,id,data);
  const native=await this.row(await getDb(),owner,id);if(native?.info.runId&&!native.info.hostedGeneration){if(!native.active)throw new RemoteError('Session stopped',410);return managedTerminalInput(owner,native.info,data);}
  const db=await getDb();await db.transaction(async tx=>{
   const r=await this.row(tx,owner,id,true);
   if(r&&(!r.active||r.info.activity==='stopping'))throw new RemoteError('Session stopped',410);
   this.relay.input(owner,id,data);
   // Keyboard control may open an unobservable harness modal. Never infer idle
   // from terminal bytes; a new readiness receipt is required after manual work.
   if(r&&data&&!isTerminalFeedback(data)&&(r.info.activity==='listening'||r.info.activity==='blocked')){r.info.activity='unknown';await this.save(tx,r);this.relay.restore(owner,id,r.info);await this.notifyAgent(tx,id);}
  });
 }
 async stop(owner:string,id:string){
  const hosted=hostedRemoteAgent();if(hosted?.owns(owner,id)){await hosted.stop(owner,id);if(externalHostedProofHash(owner,id)){const db=await getDb();await db.transaction(tx=>this.unavailable(tx,id));}return;}
  const native=(await this.row(await getDb(),owner,id))?.info;if(native?.runId){
   const db=await getDb();const stopping=await db.transaction(async tx=>{const row=await this.row(tx,owner,id,true);if(!row)throw new RemoteError('Session not found',404);row.active=false;row.info={...row.info,online:false,activity:'stopping'};await this.save(tx,row);await this.unavailable(tx,id);return row.info;});
   await stopManagedTerminal(owner,stopping);return;
  }
  const db=await getDb();await db.transaction(async tx=>{const r=await this.row(tx,owner,id,true);if(!r){this.relay.stop(owner,id);return;}if(r.active){r.info.activity='stopping';await this.save(tx,r);}});
 }
 async stopped(owner:string,id:string,exitCode:number){
  if(!Number.isInteger(exitCode))throw new RemoteError('Invalid exit code');
  const db=await getDb();await db.transaction(async tx=>{const r=await this.row(tx,owner,id,true);if(!r)throw new RemoteError('Session not found',404);r.active=false;r.info.activity='stopped';r.info.exitCode=exitCode;r.info.online=false;await this.save(tx,r);await this.unavailable(tx,id);});
 }
 async remove(owner:string,id:string){
  const hosted=hostedRemoteAgent();if(hosted?.owns(owner,id))return hosted.stop(owner,id);
  if(!await this.owns(owner,id))throw new RemoteError('Session not found',404);
  const native=(await this.row(await getDb(),owner,id))?.info;if(native?.runId)await this.stop(owner,id);
  const db=await getDb();const managed=await db.transaction(async tx=>{const r=await this.row(tx,owner,id,true);if(r){r.active=false;r.info.removed=true;r.info.activity='stopped';r.info.online=false;await this.save(tx,r);await this.unavailable(tx,id);}return !!r;});
  // Durable agents can outlive their relay; legacy sessions retain its 410 on repeated removal.
  try{this.relay.remove(owner,id);}catch(error){if(!managed||!(error instanceof RemoteError)||![404,410].includes(error.status))throw error;}
 }
 private check(row:AgentRow,proof:string){if(typeof proof!=='string'||row.proof_hash!==hash(proof))throw new RemoteError('Invalid runner credential',403);}
 private async save(tx:Queryable,r:AgentRow){await tx.query('UPDATE remote_agents SET info=$2,active=$3,seen_at=now() WHERE id=$1',[r.id,JSON.stringify(r.info),r.active]);}
 private async notifyAgent(tx:Queryable,id:string){const threads=await tx.query<{artifact_id:string;thread_id:string}>('SELECT DISTINCT artifact_id,thread_id FROM remote_work WHERE session_id=$1',[id]);for(const t of threads.rows)await this.notify(tx,t.artifact_id,t.thread_id);}
 private async interrupted(tx:Queryable,id:string){await tx.query("UPDATE remote_work SET phase='failed',data=jsonb_set(data,'{reason}',to_jsonb('interrupted'::text)),updated_at=now() WHERE session_id=$1 AND phase IN ('dispatching','delivered','acknowledged','uncertain')",[id]);await this.notifyAgent(tx,id);}
 private async unavailable(tx:Queryable,id:string){await tx.query("UPDATE remote_work SET phase=CASE WHEN phase='queued' THEN 'unavailable' ELSE 'uncertain' END,updated_at=now() WHERE session_id=$1 AND phase IN ('queued','dispatching','delivered','acknowledged')",[id]);await this.notifyAgent(tx,id);}
 async exchange(owner:string,id:string,body:RemoteExchange){
  const db=await getDb();
  // Re-check artifact access before handing a queued comment to a process. Do not
  // call a second database owner inside the serialized relay transaction.
  const queued=(await db.query<WorkRow>("SELECT * FROM remote_work WHERE owner=$1 AND session_id=$2 AND phase='queued' ORDER BY seq LIMIT 1",[owner,id])).rows[0];
  let permitted=true;
  if(queued){const artifact=await getArtifactById(queued.artifact_id);permitted=!!artifact&&!artifact.deleted_at&&await canReadArtifact(artifact,{userId:owner,email:null});}
  return db.transaction(async tx=>{
   const r=await this.row(tx,owner,id,true);if(!r)return this.relay.exchange(owner,id,body);
   this.check(r,body.runnerKey);if(!r.active)throw new RemoteError('Session stopped',410);
   this.relay.restore(owner,id,r.info);
   const delivered=this.relay.acknowledgedRequests(owner,id,body.ack);
   const result=await this.relay.exchange(owner,id,body);
   for(const requestId of delivered){const changed=await tx.query<WorkRow>("UPDATE remote_work SET phase='delivered',updated_at=now() WHERE id=$1 AND phase='dispatching' RETURNING *",[requestId]);for(const work of changed.rows)await this.notify(tx,work.artifact_id,work.thread_id);}
   r.info=this.relay.read(owner,id);
   if(body.exitCode!==undefined){if(r.info.hostedGeneration&&r.info.activity!=='stopping'){r.info.online=false;r.info.activity='stopped';await this.interrupted(tx,id);}else{r.active=false;await this.unavailable(tx,id);}}
   await this.save(tx,r);
   if(r.active&&(r.info.activity==='listening'||r.info.activity==='blocked')){
    const busy=(await tx.query("SELECT id FROM remote_work WHERE session_id=$1 AND phase IN ('dispatching','delivered','acknowledged','uncertain') LIMIT 1",[id])).rows.length;
    if(!busy){
     const next=(await tx.query<WorkRow>("SELECT * FROM remote_work WHERE session_id=$1 AND phase='queued' ORDER BY seq LIMIT 1 FOR UPDATE",[id])).rows[0];
     if(next){
      if(next.id!==queued?.id)return result; // a newer queue head needs its own access check
      if(!permitted){await tx.query("UPDATE remote_work SET phase='unavailable',updated_at=now() WHERE id=$1",[next.id]);await this.notify(tx,next.artifact_id,next.thread_id);return result;}
      await tx.query("UPDATE remote_work SET phase='dispatching',updated_at=now() WHERE id=$1",[next.id]);
      this.relay.input(owner,id,JSON.stringify({...next.data.payload,request_id:next.id})+'\r','comment',next.id,next.id);
      result.inputs=(await this.relay.exchange(owner,id,body)).inputs;
      await this.notify(tx,next.artifact_id,next.thread_id);
     }
    }
   }
   return result;
  });
 }
 /** Called in the annotation transaction: a saved mention and its receipt commit together. */
 async enqueue(tx:Queryable,owner:string|null|undefined,artifactId:string,threadId:string,comment:{id:string;body:string;author:{kind:string;label:string|null}}){
  if(!owner||comment.author.kind!=='human')return;
  for(const [id,label] of new Map([...sessionMentions(comment.body)].map(m=>[m[2]!,m[1]!.slice(1)]))){
   const r=await this.row(tx,owner,id,true);
   if(r?.info.runId&&!r.info.hostedGeneration)continue; // Arbitrary shells have no comment protocol.
   if(!r&&this.relay.owns(owner,id))continue; // legacy delivery remains in mentions.ts
   if(r?.active){
    const superseded=await tx.query("UPDATE remote_work SET phase='superseded',updated_at=now() WHERE session_id=$1 AND thread_id=$2 AND phase IN ('blocked','uncertain') RETURNING id",[id,threadId]);
    if(superseded.rows.length){const busy=await tx.query("SELECT id FROM remote_work WHERE session_id=$1 AND phase IN ('dispatching','delivered','acknowledged','uncertain') LIMIT 1",[id]);if(!busy.rows.length&&r.info.activity!=='unknown'){r.info.activity='listening';await this.save(tx,r);}}
   }
   const payload={type:'artifactbin.comment',artifact_id:artifactId,annotation_id:threadId,comment_id:comment.id,author:comment.author.label,body:comment.body.slice(0,16000),body_truncated:comment.body.length>16000,instruction:'Read the artifact and thread with afbin comment. Reply with --thread, --request request_id and --phase acknowledged BEFORE work; then --phase completed or blocked. Resolve only if addressed and no later human request exists.'};
   const data={name:r?.info.name??label,color:r?.info.color??remoteColor(id),payload};
   const pending=r?.active?(await tx.query<{count:number;bytes:number}>("SELECT count(*)::int AS count,coalesce(sum(octet_length(data::text)),0)::int AS bytes FROM remote_work WHERE session_id=$1 AND phase IN ('queued','dispatching','delivered','acknowledged','uncertain')",[id])).rows[0]:undefined;
   const full=!!pending&&(pending.count>=REMOTE_WORK_LIMIT||pending.bytes+Buffer.byteLength(JSON.stringify(data))>REMOTE_WORK_BYTES);
   const reason:RemoteWork['reason']=!r?'unauthorized':full?'queue_full':undefined;
   await tx.query('INSERT INTO remote_work (id,owner,session_id,artifact_id,thread_id,comment_id,phase,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (session_id,comment_id) DO NOTHING',[randomUUID(),owner,id,artifactId,threadId,comment.id,r?.active&&!reason?'queued':'unavailable',JSON.stringify({...data,...(reason?{reason}:{})})]);
  }
 }
 async work(tx:Queryable,artifactId:string,threadId:string):Promise<RemoteWork[]>{
  const rows=(await tx.query<WorkRow>("SELECT w.*,a.info AS agent_info,a.active,(a.seen_at>now()-interval '30 seconds') AS connected FROM remote_work w LEFT JOIN remote_agents a ON a.id=w.session_id AND a.owner=w.owner WHERE artifact_id=$1 AND thread_id=$2 ORDER BY seq",[artifactId,threadId])).rows;
  return rows.map(r=>({id:r.id,sessionId:r.session_id,artifactId:r.artifact_id,threadId:r.thread_id,commentId:r.comment_id,name:r.data.name,color:r.data.color,phase:r.phase,updatedAt:r.updated_at,...(r.data.reason?{reason:r.data.reason}:{}),activity:r.agent_info?.activity,connection:r.active?(r.connected?'online':'offline'):'stopped'}));
 }
 async receipt(tx:Queryable,owner:string|null|undefined,artifactId:string,threadId:string,receipt:ReviewReceipt,resolve:boolean){
  if(!owner)throw new RemoteError('Account required',403);
  const agent=await this.row(tx,owner,receipt.sessionId,true);if(!agent)throw new RemoteError('Session not found',404);this.check(agent,receipt.proof);
  if(!agent.active||agent.info.activity==='stopping')throw new RemoteError('Session stopped',410);
  const row=(await tx.query<WorkRow>('SELECT * FROM remote_work WHERE id=$1 AND session_id=$2 AND artifact_id=$3 AND thread_id=$4 FOR UPDATE',[receipt.id,agent.id,artifactId,threadId])).rows[0];
  if(!row)throw new RemoteError('Request does not belong to this agent and thread',403);
  const allowed=receipt.phase==='failed'?['queued','dispatching','delivered','acknowledged','blocked','uncertain']:receipt.phase==='acknowledged'?['dispatching','delivered','uncertain']:['acknowledged','blocked','uncertain'];
  if(!allowed.includes(row.phase))throw new RemoteError('Acknowledge this request before completing it',409);
  if(resolve){
   if(receipt.phase!=='completed')throw new RemoteError('Only completed work can resolve a thread',409);
   const later=(await tx.query("SELECT id FROM annotations WHERE artifact_id=$1 AND (id=$2 OR root_id=$2) AND author_kind IN ('human','owner') AND deleted_at IS NULL AND seq>(SELECT seq FROM annotations WHERE id=$3) LIMIT 1",[artifactId,threadId,row.comment_id])).rows.length;
   const pending=(await tx.query("SELECT id FROM remote_work WHERE thread_id=$1 AND id<>$2 AND phase NOT IN ('completed','failed','unavailable','superseded') LIMIT 1",[threadId,row.id])).rows.length;
   if(later||pending)throw new RemoteError('A newer comment or pending request still needs attention',409);
  }
  await tx.query('UPDATE remote_work SET phase=$2,updated_at=now() WHERE id=$1',[row.id,receipt.phase]);
  const busy=(await tx.query("SELECT id FROM remote_work WHERE session_id=$1 AND phase IN ('dispatching','delivered','acknowledged','uncertain') LIMIT 1",[agent.id])).rows.length;
  agent.info.hostedWakeAttempts=0;
  agent.info.activity=busy?'working':receipt.phase==='blocked'?'blocked':'listening';await this.save(tx,agent);
  return {label:agent.info.name,sessionId:agent.id,color:agent.info.color,harness:agent.info.harness};
 }
 private async notify(tx:Queryable,artifactId:string,threadId:string){await tx.query('SELECT pg_notify($1,$2)',[channelForAnnotations(artifactId),threadId]);}
}
export const remoteAgents=new RemoteAgents();
