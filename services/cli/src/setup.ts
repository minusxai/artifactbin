import {chromiumExecutable} from './standalone-browser';
import {createSql} from '@artifactbin/sql/local';
import {isQueryFailure} from '@artifactbin/contracts';
import {CliError} from './commands';
import {installSkills,selectSkills,harnessLabels,type SkillChoice,type SkillHarness,type SkillInstallation} from './skill-install';
import {type Style} from './style';

/** Offline setup owns selection before any writes, including an explicitly empty selection. */
interface SetupOptions {
 home:string;env?:NodeJS.ProcessEnv;interactive:boolean;yes?:boolean;requested?:string[];origin?:string;
 choose?:(choices:SkillChoice[])=>Promise<SkillHarness[]>;
}
export async function setupSkills(options:SetupOptions){
 const selected=await selectSkills(options);
 return installSkills(selected,options);
}
/** Absolute paths, never `~`: an agent reading this expanded `~` to /root and looked in the wrong home (eval run 34714026643). */
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

/** Explicit prefetch prepares SQL for later offline queries; it never authenticates or sends local data. */
export async function setupService(name:string){
 if(name==='chromium'){await chromiumExecutable();return {services:[{name:'chromium',status:'ready',execution:'local'}]};}
 if(name!=='sql')throw new CliError('unknown_service','Supported services: sql, chromium.','Run afbin setup --service sql or afbin setup --service chromium.');
 const result=(await createSql().run({tables:{},params:{},queries:[{name:'ready',sql:'select 1 as ready'}]})).ready;
 if(!result||isQueryFailure(result))throw new CliError('service_unavailable',result?.error??'SQL service did not start.','Connect once and run afbin setup --service sql before using local queries offline.');
 return {services:[{name:'sql',status:'ready',execution:'local'}]};
}
