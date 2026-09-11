import {configDir} from './config';
/** Local integration boundary: selection never writes; installation owns managed files only. */
import {cp,lstat,mkdir,readdir,realpath,rm} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {emitKeypressEvents,type Key} from 'node:readline';
import {atomicWrite,digest,isMissing,privateDirectory,readOptional} from './files';
import {withProcessLock} from './process-lock';
import {installedHarnesses} from './launcher';
import {localSkillFiles} from './teaching';
import {CLI_VERSION} from './version';
import {PLUGIN_CHANNELS} from '../../app/lib/plugin-id';
import {CliError} from './commands';
export const skillHarnesses=['claude','codex','pi','opencode'] as const;
export type SkillHarness=typeof skillHarnesses[number];
export interface SkillChoice {name:SkillHarness;path:string;selected:boolean}
interface Settings {harnesses:SkillHarness[]}
export function skillTargets(home:string,env:NodeJS.ProcessEnv=process.env):Record<SkillHarness,string>{
 return {
  claude:join(env.CLAUDE_CONFIG_DIR??join(home,'.claude'),'skills','artifactbin'),
  codex:join(env.CODEX_HOME??join(home,'.codex'),'skills','artifactbin'),
  pi:join(env.PI_CODING_AGENT_DIR??join(home,'.pi','agent'),'skills','artifactbin'),
  opencode:join(env.OPENCODE_CONFIG_DIR??join(env.XDG_CONFIG_HOME??join(home,'.config'),'opencode'),'skills','artifactbin'),
 };
}
async function settings(home:string,env:NodeJS.ProcessEnv={}):Promise<Settings|undefined>{
 const bytes=await readOptional(join(configDir(home,env),'settings.json'));if(!bytes)return;
 try{const value=JSON.parse(bytes.toString());if(!Array.isArray(value.harnesses)||value.harnesses.some((x:unknown)=>!skillHarnesses.includes(x as SkillHarness)))throw new Error();return value;}
 catch{throw new CliError('invalid_settings','Cannot read the saved harness selection.','Repair ~/.artifactbin/settings.json or move it aside, then run afbin setup.');}
}
export async function selectSkills(options:{home:string;env?:NodeJS.ProcessEnv;interactive:boolean;yes?:boolean;requested?:string[];detected?:string[];choose?:(choices:SkillChoice[])=>Promise<SkillHarness[]>}):Promise<SkillHarness[]>{
 if(options.requested){if(options.requested.some(x=>!([...skillHarnesses,'none'] as string[]).includes(x))||options.requested.includes('none')&&options.requested.length>1)throw new CliError('invalid_harness','Choose harness names or none.');return options.requested.filter(x=>x!=='none') as SkillHarness[];}
 const env=options.env??process.env;const targets=skillTargets(options.home,env);
 const saved=await settings(options.home,options.env);
 const detected=options.detected??(await installedHarnesses(env.PATH??'')).map(x=>x.command);
 const selected=saved?.harnesses??skillHarnesses.filter(name=>detected.includes(name));
 if(!options.interactive||options.yes)return [...selected];
 return (options.choose??chooseSkills)(skillHarnesses.map(name=>({name,path:targets[name],selected:selected.includes(name)})));
}
/** Terminal-only checklist; noninteractive callers never enter this boundary. */
export async function chooseSkills(choices:SkillChoice[]):Promise<SkillHarness[]>{
 const input=process.stdin,output=process.stderr;
 if(!input.isTTY)throw new CliError('interactive_required','A terminal is required for the checklist.','Use --harness <name> or --yes.');
 let cursor=0;const checked=choices.map(x=>x.selected);const wasRaw=input.isRaw;
 const draw=()=>output.write(choices.map((x,i)=>`${cursor===i?'>':' '} [${checked[i]?'x':' '}] ${x.name}: ${x.path}`).join('\n')+'\n');
 emitKeypressEvents(input);input.setRawMode(true);input.resume();
 try{return await new Promise((resolveSelection,reject)=>{
  const cleanup=()=>{input.off('keypress',key);input.off('end',cancel);};
  const cancel=()=>{cleanup();reject(new CliError('cancelled','Skill installation cancelled.'));};
  const key=(_text:string,event:Key)=>{
   if(event.name==='escape'||event.ctrl&&['c','d'].includes(event.name??''))return cancel();
   if(['return','enter'].includes(event.name??'')){cleanup();resolveSelection(choices.filter((_,i)=>checked[i]).map(x=>x.name));return;}
   if(event.name==='up')cursor=(cursor+choices.length-1)%choices.length;
   else if(event.name==='down')cursor=(cursor+1)%choices.length;
   else if(event.name==='space')checked[cursor]=!checked[cursor];else return;
   output.write(`\x1b[${choices.length}A\r\x1b[J`);draw();
  };
  output.write('Install/update local artifactbin skills (↑/↓ move, Space toggle, Enter confirm, Esc cancel).\nSelection controls writes; harnesses may also discover shared skill folders.\n');
  draw();input.on('keypress',key);input.once('end',cancel);
 });}finally{input.setRawMode(wasRaw??false);input.pause();}
}
async function physicalPath(path:string):Promise<string>{
 try{return await realpath(path);}catch(error){if(!isMissing(error))throw error;const parent=dirname(path);if(parent===path)throw error;return join(await physicalPath(parent),relative(parent,path));}
}
export function safeSkillPath(path:string):boolean{return !!path&&!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(x=>!!x&&x!=='.'&&x!=='..')&&path!=='.afbin-skill.json';}
interface Manifest {version:string;source?:string;files:Record<string,string>}
/** Managed copies record their provenance so status, update and the harness agree on who owns them. */
export const SKILL_SOURCE='afbin-cli';
export interface SkillInstallation {path:string;harnesses:SkillHarness[];status:'installed'|'updated'|'unchanged';source:string;version:string;backup?:string}
export interface SkillPlan {harness:SkillHarness;path:string;status:'install'|'update'|'unchanged';source:string;installed?:string;version:string}
export interface PluginSkillCopy {harness:SkillHarness;plugin:string;path:string;version?:string;refresh:string}
async function readManifest(path:string):Promise<Manifest|undefined>{
 const bytes=await readOptional(join(path,'.afbin-skill.json'));if(!bytes)return;
 try{const value=JSON.parse(bytes.toString());if(!value||typeof value.files!=='object')throw new Error();return value;}catch{return undefined;}
}
/** Read-only projection of installSkills: what each selected destination would become. */
export async function planSkills(selected:readonly SkillHarness[],options:{home:string;env?:NodeJS.ProcessEnv;version?:string}):Promise<SkillPlan[]>{
 const targets=skillTargets(options.home,options.env);const version=options.version??CLI_VERSION;const plans:SkillPlan[]=[];
 for(const harness of [...new Set(selected)]){
  const path=targets[harness];const manifest=await readManifest(path);
  const exists=manifest!==undefined||await readOptional(join(path,'SKILL.md'))!==null;
  plans.push({harness,path,version,
   status:!exists?'install':manifest?.version===version?'unchanged':'update',
   source:manifest?.source??(exists?'unmanaged':SKILL_SOURCE),
   ...(manifest?.version?{installed:manifest.version}:{})});
 }
 return plans;
}
/** Plugin caches belong to their harness. Report them and their refresh command; never write there. */
export async function pluginSkillCopies(home:string,env:NodeJS.ProcessEnv=process.env):Promise<PluginSkillCopy[]>{
 const names=new Map<string,typeof PLUGIN_CHANNELS[keyof typeof PLUGIN_CHANNELS]>(Object.values(PLUGIN_CHANNELS).map(channel=>[channel.name,channel]));
 const found:PluginSkillCopy[]=[];
 for(const harness of skillHarnesses){
  const root=join(dirname(dirname(skillTargets(home,env)[harness])),'plugins');
  const walk=async(directory:string,depth:number):Promise<void>=>{
   if(depth>6)return;
   let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(isMissing(error))return;throw error;}
   for(const entry of entries.slice(0,200)){
    if(!entry.isDirectory()||entry.isSymbolicLink())continue;
    const path=join(directory,entry.name);const channel=names.get(entry.name);
    if(channel){
     const manifest=await readOptional(join(path,'.claude-plugin','plugin.json'))??await readOptional(join(path,'.codex-plugin','plugin.json'));
     const skill=await readOptional(join(path,'SKILL.md'));
     if(manifest||skill){
      let version:unknown;try{version=manifest?JSON.parse(manifest.toString()).version:undefined;}catch{version=undefined;}
      found.push({harness,plugin:entry.name,path,...(typeof version==='string'?{version}:{}),
       refresh:harness==='claude'
        ?`Refresh it in Claude Code: /plugin marketplace update ${channel.marketplace} then /plugin install ${channel.name}@${channel.marketplace}.`
        :`Refresh it with ${harness}; afbin never edits a harness-owned plugin cache.`});
      continue;
     }
    }
    await walk(path,depth+1);
   }
  };
  await walk(root,0);
 }
 return found;
}
export async function installSkills(selected:SkillHarness[],options:{home:string;env?:NodeJS.ProcessEnv;files?:Readonly<Record<string,string>>;version?:string;alreadyLocked?:boolean}):Promise<{installations:SkillInstallation[];harnesses:SkillHarness[]}>{
 const files=options.files??localSkillFiles,version=options.version??CLI_VERSION;
 if(!files['SKILL.md']||Object.keys(files).some(path=>!safeSkillPath(path)))throw new CliError('invalid_skill_bundle','Invalid skill bundle path or missing SKILL.md.');
 if(selected.some(x=>!skillHarnesses.includes(x)))throw new CliError('invalid_harness','Unknown harness selection.');
 const targets=skillTargets(options.home,options.env);const groups=new Map<string,SkillHarness[]>();
 for(const name of selected){const path=await physicalPath(resolve(targets[name]));groups.set(path,[...(groups.get(path)??[]),name]);}
 const install=async()=>{
  const saved=await settings(options.home,options.env)??{};
  const installations:SkillInstallation[]=[];
  for(const [path,harnesses] of groups){
   const manifestBytes=await readOptional(join(path,'.afbin-skill.json'));let previous:Manifest|undefined;
   if(manifestBytes){try{previous=JSON.parse(manifestBytes.toString());if(!previous||typeof previous.files!=='object'||Object.entries(previous.files).some(([key,value])=>!safeSkillPath(key)||typeof value!=='string'))throw new Error();}catch{throw new CliError('invalid_skill_manifest',`Invalid managed skill manifest at ${path}.`,'Move the manifest aside and rerun setup; the existing skill will be backed up.');}}
   const allPaths=new Set([...Object.keys(previous?.files??{}),...Object.keys(files)]);let modified=false,changed=previous?.version!==version;let existed=false;
   try{const info=await lstat(path);if(!info.isDirectory())throw new CliError('invalid_skill_destination',`Skill destination is not a directory: ${path}`);existed=true;}catch(error){if(!isMissing(error))throw error;}
   for(const file of allPaths){
    const target=join(path,file);let current:Buffer|null=null;
    // Do not follow a file or nested-directory symlink while reading or replacing managed content.
    let part=path;for(const segment of file.split('/')){part=join(part,segment);try{if((await lstat(part)).isSymbolicLink())throw new CliError('invalid_skill_destination',`Managed skill path is a symlink: ${part}`);}catch(error){if(!isMissing(error))throw error;}}
    current=await readOptional(target);
    if(current&&digest(current)!==previous?.files[file])modified=true;
    if(file in files?current?.toString()!==files[file]:current!==null)changed=true;
   }
   if(!changed){installations.push({path,harnesses,status:'unchanged',source:previous?.source??SKILL_SOURCE,version:previous?.version??version});continue;}
   let backup:string|undefined;
   if(existed&&(!previous||modified)){
    const backupRoot=join(configDir(options.home,options.env),'skill-backups');await privateDirectory(backupRoot);
    backup=join(backupRoot,`${harnesses[0]}-${randomUUID()}`);await cp(path,backup,{recursive:true,dereference:false,errorOnExist:true,force:false});
   }
   await mkdir(path,{recursive:true});
   for(const [file,content] of Object.entries(files)){await mkdir(dirname(join(path,file)),{recursive:true});await atomicWrite(join(path,file),content);}
   for(const file of Object.keys(previous?.files??{}))if(!(file in files))await rm(join(path,file),{force:true});
   await atomicWrite(join(path,'.afbin-skill.json'),JSON.stringify({version,source:SKILL_SOURCE,files:Object.fromEntries(Object.entries(files).map(([file,content])=>[file,digest(content)]))}));
   installations.push({path,harnesses,status:existed?'updated':'installed',source:SKILL_SOURCE,version,...(backup?{backup}:{})});
  }
  // Preserve other settings when adding the selected integrations.
  await atomicWrite(join(configDir(options.home,options.env),'settings.json'),JSON.stringify({...saved,harnesses:[...new Set(selected)]},null,2)+'\n');
  return {installations,harnesses:[...new Set(selected)]};
 };
 return options.alreadyLocked?install():withProcessLock(options.home,install);
}
