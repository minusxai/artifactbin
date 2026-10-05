import {autoUpdatePolicy,readClientDefaults,normalizeServer} from './config';
import {CLI_VERSION} from './version';
import {validVersion,compareVersions} from './version-order';
import {HOME_SCOPE,State,withLock} from './state';

export const UPDATE_NOTICE_INTERVAL_MS=60*60*1000;
export interface UpdateNoticeOptions {
 home:string;server:string;env?:NodeJS.ProcessEnv;fetch?:typeof fetch;stderr:(value:string)=>void;
 localOnly?:boolean;now?:()=>number;currentVersion?:string;release?:{version:string;protocol:number};
}
/** Connected boundaries alone opt in. Local commands never discover a server to check releases. */
export async function checkUpdateNotice(options:UpdateNoticeOptions):Promise<void>{
 const data=options.release,current=options.currentVersion??CLI_VERSION;
 if(options.localOnly||!autoUpdatePolicy(options.env).enabled||!data||!validVersion(data.version)||!validVersion(current)||!Number.isSafeInteger(data.protocol)||data.protocol<1||compareVersions(data.version,current)<=0)return;
 try{
  if((await readClientDefaults(options.home,options.env)).updates===false)return;
  const server=normalizeServer(options.server),now=options.now??Date.now;
  const claimed=await withLock(options.home,'@update-notice',async()=>{
   const state=await State.open(options.home,options.env,{waitMs:0});
   try{
    const time=now(),previous=state.get<{attemptedAt:number;nextAt:number}>(HOME_SCOPE,'background-update',server)?.value;
    if(previous&&Number.isFinite(previous.attemptedAt)&&Number.isFinite(previous.nextAt)&&previous.attemptedAt<=time&&previous.nextAt>time&&previous.nextAt-previous.attemptedAt<=UPDATE_NOTICE_INTERVAL_MS)return false;
    state.put(HOME_SCOPE,'background-update',server,{attemptedAt:time,nextAt:time+UPDATE_NOTICE_INTERVAL_MS});return true;
   }finally{state.close();}
  },{waitMs:0,reentrant:false},options.env);
  if(!claimed)return;
  options.stderr(`A newer afbin version is available (${data.version}). Run npx --yes @afbin/cli@${data.version} <command> to use it.\n`);
 }catch{/* Response notices and busy/unavailable local state never change command success. */}
}
