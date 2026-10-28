import {automaticInstallPrefix,defaultNpm,installKind,type NpmRunner} from './global-install';
import {autoUpdatePolicy,autoUpdateStateEnv,readClientDefaults} from './config';
import {CLI_VERSION} from './version';
import {compareVersions,validVersion} from './version-order';
import {HOME_SCOPE,State,withLock} from './state';
const AUTO_UPDATE_INTERVAL_MS=60*60*1000;
const NPM_TIMEOUT_MS=120_000;
interface AutoUpdateOptions {
 home:string;env?:NodeJS.ProcessEnv;entry?:string;platform?:string;npm?:NpmRunner;
 stderr:(value:string)=>void;now?:()=>number;currentVersion?:string;
}
/** Observe release metadata during a command; install only after its result has been committed. */
export function automaticUpdate(options:AutoUpdateOptions):{
 observe:(release:{version:string;protocol:number})=>Promise<void>;finish:()=>Promise<void>;
}{
 const env=options.env??process.env,stateEnv=autoUpdateStateEnv(options.home,env),entry=options.entry??process.argv[1]??'',current=options.currentVersion??CLI_VERSION;
 let candidate:string|undefined;
 const report=(message:string)=>{try{options.stderr(message);}catch{/* Update messages cannot change an already completed command. */}};
 return {
  observe:async release=>{
   if(validVersion(current)&&validVersion(release.version)&&Number.isSafeInteger(release.protocol)&&release.protocol>0&&compareVersions(release.version,current)>0&&(!candidate||compareVersions(release.version,candidate)>0))candidate=release.version;
  },
  finish:async()=>{
   if(!candidate||!autoUpdatePolicy(env).enabled||installKind(entry)!=='package')return;
   const version=candidate;candidate=undefined;
   try{
    if((await readClientDefaults(options.home,env)).updates===false)return;
    await withLock(options.home,'@automatic-update',async()=>{
     const time=(options.now??Date.now)(),state=await State.open(options.home,stateEnv,{waitMs:0});
     try{
      const previous=state.get<{attemptedAt:number}>(HOME_SCOPE,'background-update','npm')?.value.attemptedAt;
      if(previous!==undefined&&Number.isFinite(previous)&&previous<=time&&time-previous<AUTO_UPDATE_INTERVAL_MS)return;
     }finally{state.close();}
     const npm=options.npm??defaultNpm;
     const prefix=await automaticInstallPrefix({...options,entry,env,npm,timeoutMs:NPM_TIMEOUT_MS});
     if(!prefix)return;
     const saved=await State.open(options.home,stateEnv,{waitMs:0});
     try{saved.put(HOME_SCOPE,'background-update','npm',{attemptedAt:time});}finally{saved.close();}
     report(`Updating afbin ${current} → ${version}…\n`);
     const result=await npm(['install','-g','--prefix',prefix,'--no-fund','--no-audit',`@afbin/cli@${version}`],{env,timeoutMs:NPM_TIMEOUT_MS});
     report(result.code===0?`Updated afbin to ${version}. The next command uses it.\n`:'Automatic update failed. Your command completed; run afbin update to retry.\n');
    },{waitMs:0,reentrant:false},stateEnv);
   }catch(error){
    if(!(error instanceof Error&&error.message.startsWith('workspace_busy:')))report('Automatic update failed. Your command completed; run afbin update to retry.\n');
   }
  },
 };
}
