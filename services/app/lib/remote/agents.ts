import {getArtifactById,canReadArtifact} from '../artifacts';
import {createHash,randomUUID} from 'node:crypto';
import {getDb,type Queryable} from '../db';
import {sessionMentions} from '../session-mentions';
import {channelForAnnotations} from '../story/live';
import {RemoteRegistry,RemoteError,remoteSessions,type Registration} from './registry';
import type {RemoteSessionInfo,RemoteExchange,RemoteWork,RemoteWorkPhase} from '../../../contracts/src/remote';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
interface AgentRow {id:string;owner:string;active:boolean;proof_hash:string;info:RemoteSessionInfo}
interface WorkRow {agent_info?:RemoteSessionInfo;connected?:boolean;active?:boolean;id:string;session_id:string;artifact_id:string;thread_id:string;comment_id:string;phase:RemoteWorkPhase;data:{name:string;color:RemoteWork['color'];payload:Record<string,unknown>};updated_at:string}
export interface ReviewReceipt {id:string;sessionId:string;proof:string;phase:'acknowledged'|'completed'|'blocked'}
/** Durable names and work receipts; terminal bytes and interactive input remain in the relay. */
export class RemoteAgents {
 constructor(readonly relay:RemoteRegistry=remoteSessions){}
 private async row(tx:Queryable,owner:string,id:string,lock=false){return (await tx.query<AgentRow>(`SELECT * FROM remote_agents WHERE owner=$1 AND id=$2${lock?' FOR UPDATE':''}`,[owner,id])).rows[0];}
 async create(owner:string,input:Registration){
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
 async list(owner:string){
  const db=await getDb();const saved=(await db.query<AgentRow>('SELECT * FROM remote_agents WHERE owner=$1 ORDER BY seen_at DESC LIMIT 100',[owner])).rows;
  const live=this.relay.list(owner);return [...live.filter(s=>!s.managed),...saved.map(r=>({...r.info,online:live.some(s=>s.id===r.id&&s.online)}))];
 }
 async read(owner:string,id:string){const r=(await this.list(owner)).find(s=>s.id===id);if(!r)throw new RemoteError('Session not found',404);return r;}
 async owns(owner:string,id:string){return this.relay.owns(owner,id)||!!await this.row(await getDb(),owner,id);}
 async ready(owner:string,id:string,proof:string){
  const db=await getDb();await db.transaction(async tx=>{
   const r=await this.row(tx,owner,id,true);if(!r){this.relay.ready(owner,id,proof);return;}
   this.check(r,proof);if(!r.active)throw new RemoteError('Session stopped',410);
   if(r.info.activity==='starting'||r.info.activity==='unknown'){r.info.activity='listening';await this.save(tx,r);await this.notifyAgent(tx,id);}
   try{this.relay.restore(owner,id,r.info);}catch(error){if(!(error instanceof RemoteError))throw error;}
  });
 }
 async stop(owner:string,id:string){
  const db=await getDb();await db.transaction(async tx=>{const r=await this.row(tx,owner,id,true);if(!r){this.relay.stop(owner,id);return;}if(r.active){r.info.activity='stopping';await this.save(tx,r);}});
 }
 async stopped(owner:string,id:string,exitCode:number){
  if(!Number.isInteger(exitCode))throw new RemoteError('Invalid exit code');
  const db=await getDb();await db.transaction(async tx=>{const r=await this.row(tx,owner,id,true);if(!r)throw new RemoteError('Session not found',404);r.active=false;r.info.activity='stopped';r.info.exitCode=exitCode;r.info.online=false;await this.save(tx,r);await this.unavailable(tx,id);});
 }
 async remove(owner:string,id:string){
  if(!await this.owns(owner,id))throw new RemoteError('Session not found',404);
  const db=await getDb();await db.transaction(async tx=>{const r=await this.row(tx,owner,id,true);if(r){r.active=false;r.info.activity='stopped';r.info.online=false;await this.save(tx,r);await this.unavailable(tx,id);}});
  if(this.relay.owns(owner,id))this.relay.remove(owner,id);
 }
 private check(row:AgentRow,proof:string){if(typeof proof!=='string'||row.proof_hash!==hash(proof))throw new RemoteError('Invalid runner credential',403);}
 private async save(tx:Queryable,r:AgentRow){await tx.query('UPDATE remote_agents SET info=$2,active=$3,seen_at=now() WHERE id=$1',[r.id,JSON.stringify(r.info),r.active]);}
 private async notifyAgent(tx:Queryable,id:string){const threads=await tx.query<{artifact_id:string;thread_id:string}>('SELECT DISTINCT artifact_id,thread_id FROM remote_work WHERE session_id=$1',[id]);for(const t of threads.rows)await this.notify(tx,t.artifact_id,t.thread_id);}
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
   if(body.exitCode!==undefined){r.active=false;await this.unavailable(tx,id);}
   await this.save(tx,r);
   if(r.active&&r.info.activity==='listening'){
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
  for(const id of new Set([...sessionMentions(comment.body)].map(m=>m[2]!))){
   const r=await this.row(tx,owner,id);if(!r)continue;
   if(r.active){
    const superseded=await tx.query("UPDATE remote_work SET phase='superseded',updated_at=now() WHERE session_id=$1 AND thread_id=$2 AND phase IN ('blocked','uncertain') RETURNING id",[id,threadId]);
    if(superseded.rows.length){const busy=await tx.query("SELECT id FROM remote_work WHERE session_id=$1 AND phase IN ('dispatching','delivered','acknowledged','uncertain') LIMIT 1",[id]);if(!busy.rows.length){r.info.activity='listening';await this.save(tx,r);}}
   }
   const payload={type:'artifactbin.comment',artifact_id:artifactId,annotation_id:threadId,comment_id:comment.id,author:comment.author.label,body:comment.body.slice(0,16000),body_truncated:comment.body.length>16000,instruction:'Read the artifact and thread with afbin comment. Reply with --thread, --request request_id and --phase acknowledged BEFORE work; then --phase completed or blocked. Resolve only if addressed and no later human request exists.'};
   await tx.query('INSERT INTO remote_work (id,owner,session_id,artifact_id,thread_id,comment_id,phase,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (session_id,comment_id) DO NOTHING',[randomUUID(),owner,id,artifactId,threadId,comment.id,r.active?'queued':'unavailable',JSON.stringify({name:r.info.name,color:r.info.color,payload})]);
  }
 }
 async work(tx:Queryable,artifactId:string,threadId:string):Promise<RemoteWork[]>{
  const rows=(await tx.query<WorkRow>("SELECT w.*,a.info AS agent_info,a.active,(a.seen_at>now()-interval '30 seconds') AS connected FROM remote_work w JOIN remote_agents a ON a.id=w.session_id WHERE artifact_id=$1 AND thread_id=$2 ORDER BY seq",[artifactId,threadId])).rows;
  return rows.map(r=>({id:r.id,sessionId:r.session_id,artifactId:r.artifact_id,threadId:r.thread_id,commentId:r.comment_id,name:r.data.name,color:r.data.color,phase:r.phase,updatedAt:r.updated_at,activity:r.agent_info?.activity,connection:r.active?(r.connected?'online':'offline'):'stopped'}));
 }
 async receipt(tx:Queryable,owner:string|null|undefined,artifactId:string,threadId:string,receipt:ReviewReceipt,resolve:boolean){
  if(!owner)throw new RemoteError('Account required',403);
  const agent=await this.row(tx,owner,receipt.sessionId,true);if(!agent)throw new RemoteError('Session not found',404);this.check(agent,receipt.proof);
  if(!agent.active||agent.info.activity==='stopping')throw new RemoteError('Session stopped',410);
  const row=(await tx.query<WorkRow>('SELECT * FROM remote_work WHERE id=$1 AND session_id=$2 AND artifact_id=$3 AND thread_id=$4 FOR UPDATE',[receipt.id,agent.id,artifactId,threadId])).rows[0];
  if(!row)throw new RemoteError('Request does not belong to this agent and thread',403);
  const allowed=receipt.phase==='acknowledged'?['dispatching','delivered','uncertain']:['acknowledged','blocked','uncertain'];
  if(!allowed.includes(row.phase))throw new RemoteError('Acknowledge this request before completing it',409);
  if(resolve){
   if(receipt.phase!=='completed')throw new RemoteError('Only completed work can resolve a thread',409);
   const later=(await tx.query("SELECT id FROM annotations WHERE artifact_id=$1 AND (id=$2 OR root_id=$2) AND author_kind IN ('human','owner') AND deleted_at IS NULL AND seq>(SELECT seq FROM annotations WHERE id=$3) LIMIT 1",[artifactId,threadId,row.comment_id])).rows.length;
   const pending=(await tx.query("SELECT id FROM remote_work WHERE thread_id=$1 AND id<>$2 AND phase NOT IN ('completed','unavailable','superseded') LIMIT 1",[threadId,row.id])).rows.length;
   if(later||pending)throw new RemoteError('A newer comment or pending request still needs attention',409);
  }
  await tx.query('UPDATE remote_work SET phase=$2,updated_at=now() WHERE id=$1',[row.id,receipt.phase]);
  agent.info.activity=receipt.phase==='acknowledged'?'working':receipt.phase==='blocked'?'blocked':'listening';await this.save(tx,agent);
  return {label:agent.info.name,sessionId:agent.id,color:agent.info.color};
 }
 private async notify(tx:Queryable,artifactId:string,threadId:string){await tx.query('SELECT pg_notify($1,$2)',[channelForAnnotations(artifactId),threadId]);}
}
export const remoteAgents=new RemoteAgents();
