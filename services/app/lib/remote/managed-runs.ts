import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {RunnerService,RunnerCapabilities} from '@artifactbin/contracts';
import type {RemoteSessionInfo} from '../../../contracts/src/remote';
import {sessionActor,isCookieCredential} from '../accounts/viewer';
import {json,readJson,isCrossSiteRequest} from '../http';
import {RUNNER_SERVICE_URL} from '../platform/config';
import {services} from '../platform/services';
import {getDb,type Db} from '../platform/db';
const spec=z.object({requestId:z.string().min(1).max(128),name:z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),command:z.array(z.string().min(1).max(4096)).min(1).max(32).default(['bash']),sshPublicKey:z.string().max(8192).optional(),compute:z.object({vcpu:z.number().min(.5).max(8).default(1),memoryMiB:z.number().int().min(512).max(16384).default(2048),ttlSeconds:z.number().int().min(60).max(86400).default(3600),idleSeconds:z.number().int().min(30).max(3600).optional()}).default({vcpu:1,memoryMiB:2048,ttlSeconds:3600})});
const disabled:RunnerCapabilities={version:1,managedProcesses:false,persistence:false,ssh:false,defaults:{vcpu:1,memoryMiB:2048}};
/** The app only forwards authenticated requests; managed allocation requires a configured external service. */
export async function managedRunRoute(request:Request,action:'capabilities'|'create',dependencies?:{enabled:boolean;runner:RunnerService;db:Db}){
 const actor=await sessionActor(request),owner=actor.viewer?.userId;
 if(!owner)return json({error:'unauthorized'},401);
 if(action==='create'&&isCookieCredential(actor)&&isCrossSiteRequest(request))return json({error:'forbidden'},403);
 const enabled=dependencies?.enabled??!!RUNNER_SERVICE_URL,runner=dependencies?.runner??services().runner;
 if(!enabled)return action==='capabilities'?json(disabled):json({error:'managed_runs_unavailable'},503);
 try{
  const capabilities=await runner.capabilities?.();
  if(!capabilities?.managedProcesses||capabilities.version!==1)return action==='capabilities'?json(disabled):json({error:'managed_runs_unavailable'},503);
  if(action==='capabilities')return json(capabilities);
  if(!runner.terminal||!runner.write)return json({error:'managed_terminal_unavailable'},503);
  const body=spec.safeParse(await readJson(request));
  if(!body.success)return json({error:'invalid_run',details:body.error.issues},400);
  const input=body.data;
  if(input.sshPublicKey&&!capabilities.ssh)return json({error:'ssh_unavailable'},400);
  const db=dependencies?.db??await getDb();
  const id=createHash('sha256').update(`managed-run:${owner}:${input.name}`).digest('hex');
  const configHash=createHash('sha256').update(JSON.stringify({command:input.command,compute:input.compute,sshPublicKey:input.sshPublicKey??null})).digest('hex');
  let admitted:string|undefined;
  try{
   const result=await db.transaction(async tx=>{
    // Reserve the owner/name before admission. Locking this metadata row serializes
    // app replicas; only the configured external runner is called inside the lock.
    const initial:RemoteSessionInfo={id,name:input.name,harness:input.command[0]!,cwd:'/home/runner',machine:'Hosted',cols:100,rows:30,online:false,exitCode:null,controller:'web',createdAt:new Date().toISOString(),managed:true,activity:'starting',managedConfigHash:configHash};
    await tx.query('INSERT INTO remote_agents(id,owner,name,proof_hash,info) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,owner,input.name,createHash('sha256').update(randomUUID()).digest('hex'),JSON.stringify(initial)]);
    const existing=(await tx.query<{owner:string;active:boolean;info:RemoteSessionInfo}>('SELECT owner,active,info FROM remote_agents WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!existing||existing.owner!==owner)throw Error('session_conflict');
    if(existing.info.runId){
     const run=await runner.getRun({userId:owner,runId:existing.info.runId});
     if(['queued','running'].includes(run.status)){
      if(existing.info.managedConfigHash!==configHash)throw Error('box_configuration_conflict');
      if(!existing.active)throw Error('box_ending_conflict');
      return {runId:existing.info.runId,session:existing.info,attached:true};
     }
    }
    const {runId}=await runner.start({userId:owner,requestId:`box:${input.name}:${input.requestId}`,name:`box:${input.name}`,command:input.command,compute:input.compute,...(input.sshPublicKey?{sshPublicKey:input.sshPublicKey}:{}),program:{source:'',language:'javascript'},input:null});
    admitted=runId;
    const info={...initial,runId};
    await tx.query('UPDATE remote_agents SET info=$3,active=true,seen_at=now() WHERE id=$1 AND owner=$2',[id,owner,JSON.stringify(info)]);
    return {runId,session:info,attached:false};
   });
   return json(result,result.attached?200:202);
  }catch(error){if(admitted)await runner.cancel({userId:owner,runId:admitted});throw error;}

 }catch(error){const reason=error instanceof Error?error.message:'managed_runs_unavailable';return json({error:reason},reason==='not_found'?404:reason.includes('conflict')?409:503);}
}
