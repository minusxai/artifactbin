import {chromiumExecutable} from './chromium';
import './sqlite-wasm';
import {createSqliteSql} from '@artifactbin/sql/sqlite';
import {isQueryFailure} from '@artifactbin/contracts';
import {CliError} from './commands';
import {installSkills,selectSkills,harnessLabels,type SkillChoice,type SkillHarness,type SkillInstallation} from './skill-install';
import {type Style} from './style';
import {CLI_VERSION} from './version';
import {findAfbinOnPath,globalInstall,installKind,retireAfbin,type GlobalInstallResult,type InstallKind,type NpmRunner,type RetiredAfbin} from './global-install';

/** Offline setup owns selection before any writes, including an explicitly empty selection. */
interface SetupOptions {
 home:string;env?:NodeJS.ProcessEnv;interactive:boolean;yes?:boolean;requested?:string[];origin?:string;
 choose?:(choices:SkillChoice[])=>Promise<SkillHarness[]>;
}
export async function setupSkills(options:SetupOptions){
 const selected=await selectSkills(options);
 return installSkills(selected,options);
}
export type SetupGlobal=GlobalInstallResult|{status:'skipped';reason:string};
export const manualInstallHint=(version:string)=>`Run npm install -g @afbin/cli@${version} yourself, or npx --yes @afbin/cli@latest setup once.`;
/**
 * From a package (npx, a global install), setup makes `afbin` npm's global command and retires an old
 * standalone `afbin` on PATH. A checkout never installs globally, so `npm run afbin -- setup` stays harmless.
 */
export async function setupGlobal(options:{home:string;env:NodeJS.ProcessEnv;noGlobal:boolean;kind?:InstallKind;npm?:NpmRunner;platform?:string}):Promise<{global:SetupGlobal;retired:RetiredAfbin[]}>{
 const skipped=(reason:string)=>({global:{status:'skipped' as const,reason},retired:[]});
 if(options.noGlobal)return skipped('--no-global');
 if(options.env.ARTIFACTBIN_GLOBAL==='off')return skipped('ARTIFACTBIN_GLOBAL=off');
 if((options.kind??installKind())!=='package')return skipped('dev checkout');
 const platform=options.platform??process.platform;
 const global=await globalInstall({version:CLI_VERSION,home:options.home,env:options.env,platform,...(options.npm?{npm:options.npm}:{})});
 if(global.status!=='installed')return {global,retired:[]};
 return {global,retired:await retireAfbin(await findAfbinOnPath(options.env,platform),global,options.home,{env:options.env,platform})};
}
export function globalSummary(result:{global:SetupGlobal;retired:readonly RetiredAfbin[]},s:Style):string{
 const {global}=result;if(global.status==='skipped')return '';
 const rows=['',`  ${s.bold('afbin command')}`];
 if(global.status==='failed')rows.push(`    ${s.yellow('!')} afbin command  not installed: ${global.reason??'npm failed'}`,`      ${s.dim(manualInstallHint(global.version))}`);
 else rows.push(global.on_path?`    ${s.green('✓')} afbin command  ${s.dim(global.bin)}`:`    ${s.yellow('!')} afbin command  ${global.bin} — not on PATH: ${global.path_line}`);
 for(const item of result.retired){
  if(item.status==='kept')rows.push(`    ${s.yellow('!')} Old afbin kept  ${item.path} — ${item.reason}`);
  else rows.push(`    ${s.green('✓')} Retired old afbin  ${item.path}${item.backup?` (backup ${item.backup}${item.status==='forwarded'?'; it now runs the npm command':''})`:item.status==='forwarded'?' (it now runs the npm command)':''}`);
 }
 return rows.join('\n')+'\n';
}
/** Absolute paths, never `~`: an agent reading this expanded `~` to /root and looked in the wrong home. */
export function setupSummary(installations:readonly SkillInstallation[],s:Style):string{
 const rows=['',`  ${s.bold('Agent skills')}`];
 if(!installations.length)rows.push(`    ${s.dim('No skills selected. Run afbin setup whenever you’re ready.')}`);
 for(const item of installations){
  for(const harness of item.harnesses)rows.push(`    ${s.green('✓')} ${harnessLabels[harness].padEnd(12)} ${s.dim(item.path)} ${s.dim(`(${item.status==='unchanged'?'up to date':item.status})`)}`);
  if(item.backup)rows.push(`      ${s.dim(`Previous skill backed up at ${item.backup}`)}`);
 }
 const restart=[...new Set(installations.filter(i=>i.restart_required).flatMap(i=>i.harnesses).filter(h=>h==='claude'||h==='codex'))].map(h=>harnessLabels[h]);
 if(restart.length)rows.push('',`  ${s.yellow(`Restart ${restart.join(' and ')} to load your new skills.`)}`);
 return rows.join('\n')+'\n';
}

/** Explicit check that the SQL engine (carried by the CLI itself) runs here; it never authenticates or sends local data. */
export async function setupService(name:string){
 if(name==='chromium'){await chromiumExecutable();return {services:[{name:'chromium',status:'ready',execution:'local'}]};}
 if(name!=='sql')throw new CliError('unknown_service','Supported services: sql, chromium.','Run afbin setup --service sql or afbin setup --service chromium.');
 const result=(await createSqliteSql().run({tables:{},params:{},queries:[{name:'ready',sql:'select 1 as ready'}]})).ready;
 if(!result||isQueryFailure(result))throw new CliError('service_unavailable',result?.error??'SQL service did not start.','Connect once and run afbin setup --service sql before using local queries offline.');
 return {services:[{name:'sql',status:'ready',execution:'local'}]};
}
