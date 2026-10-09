import {compareVersions,validVersion} from './version-order';
import {configDir} from './config';
/** Local integration boundary: selection never writes; installation owns managed files only. */
import {cp,lstat,mkdir,readdir,realpath,rename,rm,symlink} from 'node:fs/promises';
import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {emitKeypressEvents,type Key} from 'node:readline';
import {atomicWrite,digest,isMissing,privateDirectory,readOptional} from './files';
import {HOME_SCOPE,withLock} from './state';
import {installedHarnesses} from './launcher';
import {localSkillFiles} from './teaching';
import {teachingFilesFor} from './teaching-origin';
import {DEFAULT_SERVER} from './config';
import {CLI_VERSION} from './version';
import {CliError} from './commands';
import {homedir} from 'node:os';
import {colorSupport,createStyle} from './style';
const skillHarnesses=['claude','codex','pi','opencode'] as const;
export type SkillHarness=typeof skillHarnesses[number];
export const harnessLabels:Record<SkillHarness,string>={claude:'Claude Code',codex:'Codex',pi:'pi',opencode:'OpenCode'};
export interface SkillChoice {name:SkillHarness;path:string;selected:boolean}
/**
 * ARTIFACTBIN_SKILLS=off — install no skill into any harness, for anyone.
 *
 * Eager init runs before EVERY command, so a branch build run by hand rewrites the
 * operator's real `~/.claude/skills/artifactbin` from unreleased teaching files. A
 * development loop (`npm run afbin`) sets this; it is checked at BOTH boundaries —
 * selection and installation — because selection has an early return for an
 * explicitly requested harness, and a caller may reach installation directly.
 */
export function skillsDisabled(env:NodeJS.ProcessEnv=process.env):boolean{return env.ARTIFACTBIN_SKILLS==='off';}
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
 catch{throw new CliError('invalid_settings','Cannot read the saved harness selection.','Repair ~/.artifactbin/settings.json or move it aside, then run afbin update.');}
}
export async function selectSkills(options:{home:string;env?:NodeJS.ProcessEnv;interactive:boolean;yes?:boolean;requested?:string[];detected?:string[];choose?:(choices:SkillChoice[])=>Promise<SkillHarness[]>}):Promise<SkillHarness[]>{
 // Ahead of the requested branch: `--harness claude` must not slip past the switch.
 if(skillsDisabled(options.env))return [];
 if(options.requested){if(options.requested.some(x=>!([...skillHarnesses,'none'] as string[]).includes(x))||options.requested.includes('none')&&options.requested.length>1)throw new CliError('invalid_harness','Choose harness names or none.');return options.requested.filter(x=>x!=='none') as SkillHarness[];}
 const env=options.env??process.env;const targets=skillTargets(options.home,env);
 const saved=await settings(options.home,options.env);
 const detected=options.detected??(await installedHarnesses(env.PATH??'')).map(x=>x.command);
 const selected=saved?.harnesses??skillHarnesses.filter(name=>detected.includes(name));
 if(!options.interactive||options.yes)return [...selected];
 return (options.choose??chooseSkills)(skillHarnesses.map(name=>({name,path:targets[name],selected:selected.includes(name)})));
}
/** Terminal-only checklist; noninteractive callers never enter this boundary. */
async function chooseSkills(choices:SkillChoice[]):Promise<SkillHarness[]>{
 const input=process.stdin,output=process.stderr;
 if(!input.isTTY)throw new CliError('interactive_required','A terminal is required for the checklist.','Use --harness <name> or --yes.');
 let cursor=0;const checked=choices.map(x=>x.selected);const wasRaw=input.isRaw;
 const s=createStyle(colorSupport(process.env,!!output.isTTY));const home=homedir();
 const pretty=(path:string)=>path.startsWith(home+'/')?'~'+path.slice(home.length):path;
 // Two fixed lines per choice keep redraws stable even with long custom paths.
 const pathWidth=Math.max(10,(output.columns??80)-8);
 const shortPath=(path:string)=>{const p=pretty(path);return p.length>pathWidth?'…'+p.slice(-(pathWidth-1)):p;};
 const draw=()=>output.write(choices.map((x,i)=>`    ${cursor===i?s.accent('›'):' '} ${checked[i]?s.green('[✓]'):s.dim('[ ]')} ${cursor===i?s.bold(harnessLabels[x.name]):harnessLabels[x.name]}\n        ${s.dim(shortPath(x.path))}`).join('\n')+'\n');
 emitKeypressEvents(input);input.setRawMode(true);input.resume();
 try{return await new Promise((resolveSelection,reject)=>{
  const cleanup=()=>{input.off('keypress',key);input.off('end',cancel);};
  const cancel=()=>{cleanup();reject(new CliError('cancelled','Skill installation cancelled.'));};
  const key=(_text:string,event:Key)=>{
   if(event.name==='escape'||event.ctrl&&['c','d'].includes(event.name??''))return cancel();
   if(['return','enter'].includes(event.name??'')){cleanup();output.write(`\x1b[${choices.length*2+3}A\r\x1b[J`);resolveSelection(choices.filter((_,i)=>checked[i]).map(x=>x.name));return;}
   if(event.name==='up')cursor=(cursor+choices.length-1)%choices.length;
   else if(event.name==='down')cursor=(cursor+1)%choices.length;
   else if(event.name==='space')checked[cursor]=!checked[cursor];else return;
   output.write(`\x1b[${choices.length*2}A\r\x1b[J`);draw();
  };
  output.write(`\n  ${s.bold('Choose your agent skills')}\n  ${s.dim('↑/↓ move · Space toggle · Enter install · Esc cancel')}\n`);
  draw();input.on('keypress',key);input.once('end',cancel);
 });}finally{input.setRawMode(wasRaw??false);input.pause();}
}
async function physicalPath(path:string):Promise<string>{
 try{return await realpath(path);}catch(error){if(!isMissing(error))throw error;const parent=dirname(path);if(parent===path)throw error;return join(await physicalPath(parent),relative(parent,path));}
}
function safeSkillPath(path:string):boolean{return !!path&&!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(x=>!!x&&x!=='.'&&x!=='..')&&path!=='.afbin-skill.json';}
interface Manifest {version:string;source?:string;server?:string;files:Record<string,string>}
/** Managed copies record their provenance so status, update and the harness agree on who owns them. */
const SKILL_SOURCE='afbin-cli';
export interface SkillInstallation {path:string;harnesses:SkillHarness[];status:'installed'|'updated'|'unchanged'|'reused'|'modified'|'conflict';source:string;version:string;backup?:string;links?:{path:string;target:string}[];duplicates?:string[];recovery?:string;restart_required?:true}
/** These harnesses read their skills folder once, at startup; pi and OpenCode read it per run. */
const restartHarnesses:Partial<Record<SkillHarness,string>>={claude:'Claude Code',codex:'Codex'};
/** One line per harness that will not see a freshly written skill until it restarts. */
export function restartHints(installations:readonly SkillInstallation[]):string[]{
 return installations.filter(item=>item.restart_required).flatMap(item=>item.harnesses.flatMap(harness=>{
  const name=restartHarnesses[harness];return name?[`Restart ${name} to load the installed skill at ${item.path}.`]:[];
 }));
}
export interface SkillPlan {harness:SkillHarness;path:string;status:'install'|'update'|'unchanged'|'reused'|'modified'|'conflict';source:string;installed?:string;version:string;link_required?:true}
/** A backup says which harness it belongs to and which version of the skill it holds. */
const backupName=(harness:string,replaced:string|undefined):string=>`${harness}-${(replaced&&validVersion(replaced)?replaced:'unmanaged').replace(/[^\w.+-]/g,'_')}`;
async function readManifest(path:string):Promise<Manifest|undefined>{
 const bytes=await readOptional(join(path,'.afbin-skill.json'));if(!bytes)return;
 try{const value=JSON.parse(bytes.toString());if(!value||!value.files||typeof value.files!=='object'||Array.isArray(value.files)||typeof value.version!=='string'||value.source!==undefined&&typeof value.source!=='string'||value.server!==undefined&&typeof value.server!=='string'||Object.entries(value.files).some(([key,value])=>!safeSkillPath(key)||typeof value!=='string'))throw new Error();return value;}catch{return undefined;}
}
interface SkillStatus {harness:SkillHarness;path:string;installed:boolean;current:boolean;version?:string;source?:string;duplicates?:string[]}
/** Read-only view for `afbin status`: where each harness' skill lives and whether it matches this CLI. */
export async function skillStatus(home:string,env?:NodeJS.ProcessEnv,cwd?:string):Promise<SkillStatus[]>{
 const targets=skillTargets(home,env);const result:SkillStatus[]=[];
 for(const harness of skillHarnesses){
  const found=await discoverSkills(harness,{home,env,cwd});const path=found[0]??targets[harness];const manifest=await readManifest(path);
  const installed=(await discoverSkills(harness,{home,env,cwd},false)).includes(path);
  result.push({harness,path,installed,current:installed&&manifest?.version===CLI_VERSION,
   ...(manifest?.version?{version:manifest.version}:{}),...(found.length?{source:manifest?.source??'external'}:{}),...(found.length>1?{duplicates:found.slice(1)}:{})});
 }
 return result;
}
interface SkillOptions {home:string;env?:NodeJS.ProcessEnv;cwd?:string;version?:string;origin?:string;files?:Readonly<Record<string,string>>;takeover?:boolean;link?:(target:string,path:string)=>Promise<void>}
/** Discover existing skills in harness, shared and ancestor project locations without writing. */
async function discoverSkills(harness:SkillHarness,options:SkillOptions,shared=true):Promise<string[]>{
 const target=skillTargets(options.home,options.env)[harness];
 const paths=[target,...(shared?[join(options.home,'.agents','skills','artifactbin')]:[])];
 if(options.cwd){
  let directory=resolve(options.cwd);
  for(;;){
   const project=skillTargets(directory,{});
   paths.push(project[harness],join(directory,harness==='opencode'?'.opencode':harness==='pi'?'.pi':`.${harness}`,'skills','artifactbin'),...(shared?[join(directory,'.agents','skills','artifactbin')]:[]));
   const parent=dirname(directory);if(parent===directory)break;directory=parent;
  }
 }
 const found:string[]=[];
 for(const path of [...new Set(paths)]){
  if(await readOptional(join(path,'SKILL.md'))!==null){const physical=await realpath(path);if(!found.includes(physical))found.push(physical);}
 }
 return found;
}
/** A directory link must expose a skill the harness can load under the artifactbin name. */
async function usableSkillRoot(path:string):Promise<boolean>{
 const bytes=await readOptional(join(path,'SKILL.md'));if(!bytes)return false;
 const header=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(bytes.toString());
 return !!header&&/^name:[ \t]*(?:artifactbin|'artifactbin'|"artifactbin")[ \t]*$/m.test(header[1]!);
}
/** Never read through nested symlinks in a managed copy. */
async function safeManagedFile(path:string,file:string):Promise<boolean>{
 let part=path;
 for(const segment of file.split('/')){part=join(part,segment);try{if((await lstat(part)).isSymbolicLink())return false;}catch(error){if(!isMissing(error))throw error;}}
 return true;
}
async function inspectSkill(path:string,files:Readonly<Record<string,string>>):Promise<{manifest?:Manifest;owned:boolean;modified:boolean;exists:boolean}>{
 const manifest=await readManifest(path);let exists=false;
 try{const info=await lstat(path);if(!info.isDirectory())throw new CliError('invalid_skill_destination',`Skill destination is not a directory: ${path}`);exists=(await readdir(path)).length>0;}catch(error){if(!isMissing(error))throw error;}
 // A valid pre-provenance manifest is the former CLI format; hashes still prove its files.
 const owned=!!manifest&&validVersion(manifest.version)&&Object.keys(manifest.files).length>0&&(manifest.source===SKILL_SOURCE||manifest.source===undefined);
 let modified=false;
 if(owned){for(const file of new Set([...Object.keys(manifest.files),...Object.keys(files)])){
  if(!await safeManagedFile(path,file)){modified=true;continue;}
  const current=await readOptional(join(path,file));
  if(file in manifest.files?current===null||digest(current)!==manifest.files[file]:current!==null)modified=true;
 }}
 return {manifest,owned,modified,exists};
}
/** Read-only projection uses the same discovery and ownership rules as application. */
export async function planSkills(selected:readonly SkillHarness[],options:SkillOptions):Promise<SkillPlan[]>{
 const targets=skillTargets(options.home,options.env),version=options.version??CLI_VERSION,origin=options.origin??DEFAULT_SERVER;
 const files=teachingFilesFor(options.files??localSkillFiles,origin);const plans:SkillPlan[]=[];
 for(const harness of [...new Set(selected)]){
  const found=await discoverSkills(harness,options);const path=found[0]??await physicalPath(targets[harness]);
  const {manifest,owned,modified,exists}=await inspectSkill(path,files);
  const linkRequired=found.length>0&&await physicalPath(resolve(targets[harness]))!==path;
  plans.push({harness,path,version,...(linkRequired?{link_required:true as const}:{}),status:!exists?'install':options.takeover&&(!owned||modified)?owned&&manifest&&validVersion(version)&&compareVersions(manifest.version,version)>0?'unchanged':'update':!owned?await usableSkillRoot(path)?'reused':'conflict':modified?'modified':manifest?.version===version&&manifest.server===origin?'unchanged':'update',source:manifest?.source??(owned||!exists?SKILL_SOURCE:'external'),...(manifest?.version?{installed:manifest.version}:{})});
 }
 return plans;
}
export async function installSkills(selected:SkillHarness[],options:SkillOptions&{files?:Readonly<Record<string,string>>;origin?:string;version?:string;alreadyLocked?:boolean;preserveSelection?:boolean}):Promise<{installations:SkillInstallation[];harnesses:SkillHarness[]}>{
 // Whichever bundle this is — the compiled one or a downloaded release — it
 // ships addressed to nobody; the skill an agent reads must name the server
 // THIS afbin uses, or the agent is taught to publish somewhere else.
 if(skillsDisabled(options.env))return {installations:[],harnesses:[]};
 const origin=options.origin??DEFAULT_SERVER;
 const files=teachingFilesFor(options.files??localSkillFiles,origin),version=options.version??CLI_VERSION;
 if(!files['SKILL.md']||Object.keys(files).some(path=>!safeSkillPath(path)))throw new CliError('invalid_skill_bundle','Invalid skill bundle path or missing SKILL.md.');
 if(selected.some(x=>!skillHarnesses.includes(x)))throw new CliError('invalid_harness','Unknown harness selection.');
 const targets=skillTargets(options.home,options.env);const groups=new Map<string,SkillHarness[]>();const duplicates=new Map<string,string[]>();
 for(const name of selected){const found=await discoverSkills(name,options);const path=found[0]??await physicalPath(resolve(targets[name]));groups.set(path,[...new Set([...(groups.get(path)??[]),name])]);duplicates.set(path,[...new Set([...(duplicates.get(path)??[]),...found.slice(1)])]);}
 const install=async()=>{
  const saved=await settings(options.home,options.env)??{};
  const installations:SkillInstallation[]=[];
  for(const [path,requestedHarnesses] of groups){
   const links:{path:string;target:string}[]=[];const harnesses:SkillHarness[]=[];let linkedStartup=false;
   for(const harness of requestedHarnesses){
    const target=resolve(targets[harness]);
    if(await physicalPath(target)===path){harnesses.push(harness);try{if((await lstat(target)).isSymbolicLink())links.push({path:target,target:path});}catch(error){if(!isMissing(error))throw error;}continue;}
    try{
     if(!options.takeover&&!await usableSkillRoot(path))throw new CliError('invalid_skill_root',`Existing SKILL.md must name artifactbin: ${path}`);
     // The link is the harness's discovery entry; content remains owned by its original installer.
     try{await lstat(target);throw new CliError('skill_link_conflict',`Existing destination must be preserved: ${target}`);}catch(error){if(!isMissing(error))throw error;}
     await mkdir(dirname(target),{recursive:true});
     await (options.link??((source,destination)=>symlink(source,destination,process.platform==='win32'?'junction':'dir')))(path,target);
     harnesses.push(harness);links.push({path:target,target:path});if(harness in restartHarnesses)linkedStartup=true;
    }catch(error){
     installations.push({path:target,harnesses:[harness],status:'conflict',source:'external',version:'unknown',recovery:(error as NodeJS.ErrnoException).code==='invalid_skill_root'?`Existing SKILL.md at ${path} must declare name: artifactbin. Preserve it and provide a valid Artifactbin skill, or run afbin setup --takeover to back it up and replace it.`:`Could not link ${target} to the existing skill at ${path} (${(error as NodeJS.ErrnoException).code??'link failed'}). Preserve the existing folder and create a directory symlink (Windows: junction) at that harness path, then rerun afbin setup.`});
    }
   }
   if(!harnesses.length)continue;
   const linked={...(links.length?{links}:{}),...(linkedStartup?{restart_required:true as const}:{})};
   const inspection=await inspectSkill(path,files);const previous=inspection.manifest;
   const duplicatePaths=duplicates.get(path)??[];
   if(inspection.exists&&(!inspection.owned||inspection.modified)&&!options.takeover){
    installations.push({path,harnesses,status:inspection.owned?'modified':await usableSkillRoot(path)?'reused':'conflict',...linked,source:previous?.source??(inspection.owned?SKILL_SOURCE:'external'),version:previous?.version??'unknown',...(duplicatePaths.length?{duplicates:duplicatePaths}:{}),recovery:'Existing skill preserved. To replace it with a backed-up CLI-managed copy, run afbin setup --takeover.'});continue;
   }
   // Recheck under the install lock: an older running process must not undo a newer install.
   if(inspection.owned && previous && validVersion(previous.version) && validVersion(version) && compareVersions(previous.version,version)>0){
    installations.push({path,harnesses,status:'unchanged',...linked,source:previous.source??SKILL_SOURCE,version:previous.version});continue;
   }
   const allPaths=new Set([...Object.keys(previous?.files??{}),...Object.keys(files)]);let modified=inspection.modified,changed=!inspection.owned||previous?.version!==version;const existed=inspection.exists;
   for(const file of allPaths){
    const target=join(path,file);let current:Buffer|null=null;
    // Do not follow a file or nested-directory symlink while reading or replacing managed content.
    let part=path;for(const segment of file.split('/')){part=join(part,segment);try{if((await lstat(part)).isSymbolicLink())throw new CliError('invalid_skill_destination',`Managed skill path is a symlink: ${part}`);}catch(error){if(!isMissing(error))throw error;}}
    current=await readOptional(target);
    if(current&&digest(current)!==previous?.files[file])modified=true;
    if(file in files?current?.toString()!==files[file]:current!==null)changed=true;
   }
   if(previous&&previous.server!==origin)changed=true;
   if(!changed){installations.push({path,harnesses,status:'unchanged',...linked,source:previous?.source??SKILL_SOURCE,version:previous?.version??version});continue;}
   let backup:string|undefined;
   if(existed&&(!inspection.owned||modified)){
    const backupRoot=join(configDir(options.home,options.env),'skill-backups');await privateDirectory(backupRoot);
    const label=[...harnesses].sort()[0]!;
    backup=join(backupRoot,`${backupName(label,previous?.version)}-${randomUUID()}`);
    // Copy beside the name first: a copy of the same version survives until its replacement is whole.
    const staged=`${backup}.${randomUUID()}.tmp`;
    await cp(path,staged,{recursive:true,dereference:false,errorOnExist:true,force:false});
    await rename(staged,backup);
   }
   await mkdir(path,{recursive:true});
   for(const [file,content] of Object.entries(files)){await mkdir(dirname(join(path,file)),{recursive:true});await atomicWrite(join(path,file),content);}
   if(inspection.owned)for(const file of Object.keys(previous?.files??{}))if(!(file in files)){const current=await readOptional(join(path,file));if(current&&digest(current)===previous!.files[file])await rm(join(path,file),{force:true});}
   await atomicWrite(join(path,'.afbin-skill.json'),JSON.stringify({version,source:SKILL_SOURCE,server:origin,files:Object.fromEntries(Object.entries(files).map(([file,content])=>[file,digest(content)]))}));

   installations.push({path,harnesses,status:existed?'updated':'installed',...linked,source:SKILL_SOURCE,version,...(backup?{backup}:{}),...(duplicatePaths.length?{duplicates:duplicatePaths}:{}),...(harnesses.some(name=>name in restartHarnesses)?{restart_required:true as const}:{})});
  }
  // Preserve other settings when adding the selected integrations.
  if(!options.preserveSelection)await atomicWrite(join(configDir(options.home,options.env),'settings.json'),JSON.stringify({...saved,harnesses:[...new Set(selected)]},null,2)+'\n');
  return {installations,harnesses:[...new Set(selected)]};
 };
 return options.alreadyLocked?install():withLock(options.home,HOME_SCOPE,install,{},options.env);
}
