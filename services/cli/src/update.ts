import {CLI_VERSION} from './version';
import {normalizeServer} from './config';
import type {SkillHarness,SkillInstallation} from './skill-install';
/** Kept for callers rendering old progress; npm execution does not download or replace afbin itself. */
export type UpdateProgress={stage:'release';current:string;available:string}|{stage:'download';received:number;total?:number}|{stage:'downloaded';bytes:number}|{stage:'install';version:string;recovered:boolean};
interface UpdateOptions {
 home:string;server:string;env?:NodeJS.ProcessEnv;harnesses:SkillHarness[];dryRun?:boolean;fetch?:typeof fetch;
 chooseHarnesses?:()=>Promise<SkillHarness[]>;report?:(event:UpdateProgress)=>void;platform?:string;
}
/** npm owns installation and version selection. This command only explains the explicit next launch. */
export async function updateCli(options:UpdateOptions){
 return {version:CLI_VERSION,server:normalizeServer(options.server),...(options.dryRun?{dry_run:true}:{}),
  update_required:false,installations:[] as SkillInstallation[],harnesses:[] as SkillHarness[],command:`${(options.platform??process.platform)==='win32'?'npx.cmd':'npx'} --yes @afbin/cli@latest <command>`,
  message:'Run the command above with your desired afbin command to use the latest published package. No running process or installed executable was changed.'};
}
