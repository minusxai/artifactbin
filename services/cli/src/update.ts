import {CLI_VERSION} from './version';
import {normalizeServer} from './config';
import {CliError} from './errors';
import {validVersion} from './version-order';
import {globalInstall,type GlobalInstallResult,type NpmRunner} from './global-install';
import {installSkills,type SkillHarness,type SkillInstallation} from './skill-install';
/** Foreground progress events; npm does the download, so only the release and install stages are drawn. */
export type UpdateProgress={stage:'release';current:string;available:string}|{stage:'install';version:string;recovered:boolean};
interface UpdateOptions {
 home:string;server:string;env?:NodeJS.ProcessEnv;harnesses:SkillHarness[];dryRun?:boolean;fetch?:typeof fetch;npm?:NpmRunner;
 chooseHarnesses?:()=>Promise<SkillHarness[]>;report?:(event:UpdateProgress)=>void;platform?:string;
}
export type UpdateResult=
 |{dry_run:true;current:string;target:string;command:string}
 |{version:string;current:string;installed:GlobalInstallResult;installations:SkillInstallation[];harnesses:SkillHarness[]};
const POINTER_TIMEOUT_MS=10_000;
/** The version the selected server names in its release pointer; anything unusable means npm's latest. */
export async function releaseTarget(server:string,fetcher:typeof fetch=fetch):Promise<string>{
 try{
  const response=await fetcher(`${normalizeServer(server)}/chat/release.json`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(POINTER_TIMEOUT_MS)});
  if(!response.ok)return 'latest';
  const body=await response.json() as {version?:unknown}|null;
  return body&&typeof body==='object'&&validVersion(body.version)?body.version:'latest';
 }catch{return 'latest';}
}
/** An explicit request: install the server's version through npm globally, then refresh the selected skills. */
export async function updateCli(options:UpdateOptions):Promise<UpdateResult>{
 const target=await releaseTarget(options.server,options.fetch);
 if(options.dryRun)return {dry_run:true,current:CLI_VERSION,target,command:`npm install -g @afbin/cli@${target}`};
 options.report?.({stage:'release',current:CLI_VERSION,available:target});
 options.report?.({stage:'install',version:target,recovered:false});
 const installed=await globalInstall({version:target,home:options.home,env:options.env??process.env,...(options.platform?{platform:options.platform}:{}),...(options.npm?{npm:options.npm}:{})});
 if(installed.status==='failed')throw new CliError('update_failed',`npm could not install @afbin/cli@${target}: ${installed.reason??'unknown failure'}`,'npx --yes @afbin/cli@latest setup',undefined,1);
 const harnesses=options.chooseHarnesses?await options.chooseHarnesses():options.harnesses;
 const skills=await installSkills(harnesses,{home:options.home,...(options.env?{env:options.env}:{}),origin:options.server});
 return {version:target,current:CLI_VERSION,installed,installations:skills.installations,harnesses:skills.harnesses};
}
