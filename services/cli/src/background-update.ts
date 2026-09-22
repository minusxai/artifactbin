import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {isSea} from 'node:sea';
import {autoUpdatePolicy,readClientDefaults} from './config';
import {releaseOrigin} from './release-origin';
import {State,HOME_SCOPE,withLock} from './state';
import {updateCli} from './update';
/** Detached update boundary: the command path only reads local scheduling state. */
import {BACKGROUND_UPDATE_ARG} from './entry-args';
export {BACKGROUND_UPDATE_ARG} from './entry-args';
export const UPDATE_CHECK_MS=24*60*60*1000;
export const UPDATE_RETRY_MS=60*60*1000;
export interface BackgroundOptions {
 platform?:string;
 home:string;
 server:string;
 launchId?:string;
 env?:NodeJS.ProcessEnv;
 standalone?:boolean;
 executable?:string;
 now?:()=>number;
 launch?:(executable:string,args:string[],env:NodeJS.ProcessEnv)=>void;
 update?:()=>Promise<unknown>;
}

interface CheckState {attemptedAt:number;nextAt:number;launchId?:string}
const WORKER_SCOPE='@background-update-worker';
function due(state:CheckState|undefined,now:number):boolean {
 return !state||!Number.isFinite(state.attemptedAt)||!Number.isFinite(state.nextAt)||state.attemptedAt>now||state.nextAt<=now||state.nextAt-state.attemptedAt>UPDATE_CHECK_MS;
}
function eligible(options:BackgroundOptions):boolean {
 return (options.platform??process.platform)!=='win32'&&(options.standalone??isSea())&&autoUpdatePolicy(options.env).enabled;
}
function launchDetached(executable:string,args:string[],env:NodeJS.ProcessEnv):void {
 const child=spawn(executable,args,{detached:true,stdio:'ignore',env});
 child.on('error',()=>{});
 child.unref();
}
export async function scheduleBackgroundUpdate(options:BackgroundOptions):Promise<void>{
 if(!eligible(options))return;
 let state:State|null=null;
 try {
  if((await readClientDefaults(options.home,options.env)).updates===false)return;
  const server=releaseOrigin(options.server);
  state=await State.openReadOnly(options.home,options.env);
  if(!due(state?.get<CheckState>(HOME_SCOPE,'background-update',server)?.value,(options.now??Date.now)()))return;
  state?.close();state=null;
  const launchId=await withLock(options.home,WORKER_SCOPE,async()=>{
   const writable=await State.open(options.home,options.env,{waitMs:0});
   try {
    const attemptedAt=(options.now??Date.now)();
    if(!due(writable.get<CheckState>(HOME_SCOPE,'background-update',server)?.value,attemptedAt))return;
    const launchId=randomUUID();
    writable.put(HOME_SCOPE,'background-update',server,{attemptedAt,nextAt:attemptedAt+UPDATE_RETRY_MS,launchId});
    return launchId;
   }finally{writable.close();}
  },{waitMs:0,reentrant:false},options.env);
  // Release before spawn so a fast worker cannot collide with its launcher's lock.
  if(launchId)(options.launch??launchDetached)(options.executable??process.execPath,[BACKGROUND_UPDATE_ARG,options.home,server,launchId],options.env??process.env);
 }catch{/* Updates never affect command output or success. */}
 finally{state?.close();}
}
export async function runBackgroundUpdate(options:BackgroundOptions):Promise<void>{
 if(!eligible(options))return;
 try {
  if((await readClientDefaults(options.home,options.env)).updates===false)return;
  const server=releaseOrigin(options.server),now=options.now??Date.now;
  await withLock(options.home,WORKER_SCOPE,async()=>{
   const state=await State.open(options.home,options.env);
   try {
    const attemptedAt=now();
    const previous=state.get<CheckState>(HOME_SCOPE,'background-update',server)?.value;
    if(options.launchId ? previous?.launchId!==options.launchId : !due(previous,attemptedAt))return;
    // Persist before network I/O; a killed worker leaves a finite retry time, never a stale lock.
    state.put(HOME_SCOPE,'background-update',server,{attemptedAt,nextAt:attemptedAt+UPDATE_RETRY_MS});
   }finally{state.close();}
   try {
    await (options.update??(()=>updateCli({home:options.home,server,env:options.env,harnesses:[],background:true,stallMs:30000})))();
    const finished=await State.open(options.home,options.env);
    try{const attemptedAt=now();finished.put(HOME_SCOPE,'background-update',server,{attemptedAt,nextAt:attemptedAt+UPDATE_CHECK_MS});}finally{finished.close();}
   }catch{/* Last attempt already records backoff. No foreground output or secrets in state. */}
  },{waitMs:0,reentrant:false},options.env);
 }catch{/* Busy, offline, disabled and broken local state are all best-effort skips. */}
}
/** The detached process has a hard lifetime bound, including slow-but-progressing downloads. */
export async function backgroundUpdateMain(args:string[],options:Pick<BackgroundOptions,'standalone'|'update'>&{deadlineMs?:number}={}):Promise<void>{
 if(args.length!==3||!(options.standalone??isSea()))return;
 const deadline=setTimeout(()=>process.exit(0),options.deadlineMs??5*60*1000);
 try{await runBackgroundUpdate({home:args[0],server:args[1],launchId:args[2],...options});}finally{clearTimeout(deadline);}
}
