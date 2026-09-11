/** Explicit release update. Ordinary commands never import release metadata from the network. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isSea} from 'node:sea';
import {lstat,realpath,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CLI_VERSION} from './version';
import {CliError} from './commands';
import {normalizeServer} from './config';
import {atomicWrite,digest,privateDirectory,readOptional} from './files';
import {withProcessLock} from './process-lock';
import {installSkills,planSkills,skillHarnesses,safeSkillPath,type SkillInstallation,type SkillPlan,type SkillHarness} from './skill-install';
const run=promisify(execFile);
/** The selected server names the release it speaks; its bytes come from the project's own releases. */
const releasePointer='/chat/release.json';
const downloads='https://github.com/minusxai/artifactbin/releases/download';
export type Installation={kind:'standalone';path:string};
interface ReleasePointer {version:string;protocol:number}
interface ReleaseManifest {version:string;protocol:number;platform:string;arch:string;binary:{file:string;sha256:string};skills:{file:string;sha256:string}}
interface SkillBundle {version:string;protocol:number;files:Record<string,string>}
interface PendingUpdate {schema:1;installation:Installation;manifest:ReleaseManifest;skills:string;selected:SkillHarness[];before?:string;mode?:number;backup?:string}
interface UpdateOptions {home:string;server:string;env?:NodeJS.ProcessEnv;installation?:Installation;platform?:string;arch?:string;version?:string;harnesses:SkillHarness[];dryRun?:boolean;fetch?:typeof fetch;verifyExecutable?:(path:string,version:string,protocol:number)=>Promise<void>;afterReplace?:()=>void}
export interface UpdatePreview {dry_run:true;server:string;release:ReleasePointer;binary:{installation:'standalone'|'unmanaged';path?:string;current:string;available:string;change:'update'|'current'|'unavailable';reason?:string;asset?:string};skills:SkillPlan[]}
export interface UpdateResult {version:string;protocol:number;recovered:boolean;backup?:string;installations:SkillInstallation[];harnesses:SkillHarness[]}
const semver=(value:unknown):value is string=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
function compare(a:string,b:string):number{const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
/** The pointer names a version and the protocol that server speaks; any other field is ignored. */
function verifyPointer(value:any):asserts value is ReleasePointer{
 if(!value||!semver(value.version)||!Number.isSafeInteger(value.protocol)||value.protocol<1)throw new CliError('unsupported_server','The selected server did not name a compatible CLI release.','Check the server origin, or update from the server that serves your installer.');
}
function verifyManifest(value:any,platform:string,arch:string):asserts value is ReleaseManifest{
 if(!value||!semver(value.version)||!Number.isSafeInteger(value.protocol)||value.protocol<1||value.platform!==platform||value.arch!==arch||value.binary?.file!==`afbin-${platform}-${arch}`||value.skills?.file!=='afbin-skills.json'||![value.binary?.sha256,value.skills?.sha256].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x)))throw new CliError('invalid_release','Release manifest is invalid.');
}
function verifySkills(bytes:Buffer,manifest:ReleaseManifest):SkillBundle{
 if(digest(bytes)!==manifest.skills.sha256)throw new CliError('checksum_mismatch','Skill bundle checksum mismatch; nothing was installed.');
 let bundle:SkillBundle;try{bundle=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_release','The skill bundle is not valid JSON.');}
 if(bundle.version!==manifest.version||bundle.protocol!==manifest.protocol||!bundle.files||typeof bundle.files!=='object'||!bundle.files['SKILL.md']||Object.entries(bundle.files).some(([path,value])=>!safeSkillPath(path)||typeof value!=='string'))throw new CliError('invalid_release','Skill bundle does not match the release.');
 return bundle;
}
async function download(url:string,fetcher:typeof fetch,maxBytes:number):Promise<Buffer>{
 const response=await fetcher(url,{redirect:'follow',signal:AbortSignal.timeout(180000),headers:{Accept:'application/json','User-Agent':'afbin-update'}});
 if(!response.ok)throw new CliError('release_unavailable',`Release download returned HTTP ${response.status}.`,'Retry afbin update after checking connectivity.');
 if(url.startsWith('https:')&&response.url&&new URL(response.url).protocol!=='https:')throw new CliError('invalid_release','Release download redirected outside HTTPS.');
 if(Number(response.headers.get('content-length'))>maxBytes)throw new CliError('invalid_release','Release download exceeds its size limit.');
 if(!response.body)throw new CliError('invalid_release','Release download is empty.');
 const reader=response.body.getReader(),chunks:Buffer[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new CliError('invalid_release','Release download exceeds its size limit.');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
/** Only the verified standalone executable is self-updating; nothing else is replaced in place. */
export async function detectInstallation(executable=process.execPath,standalone=isSea()):Promise<Installation>{
 if(standalone)return{kind:'standalone',path:await realpath(executable)};
 throw new CliError('unmanaged_installation','This afbin was not installed as a verified standalone executable.','Install it with https://artifactbin.dev/chat/install.sh, then rerun afbin update.');
}
async function executableVersion(path:string,version:string,protocol:number):Promise<void>{
 const result=await run(path,['--version','--json'],{env:{},timeout:15000,maxBuffer:65536});
 let value:any;try{value=JSON.parse(result.stdout);}catch{throw new CliError('invalid_release','Downloaded executable did not report its version.');}
 if(value.version!==version||value.protocol!==protocol)throw new CliError('invalid_release','Downloaded executable version/protocol differs from its manifest.');
}
async function releasePointerOf(options:UpdateOptions,fetcher:typeof fetch):Promise<ReleasePointer>{
 const value=JSON.parse((await download(`${normalizeServer(options.server)}${releasePointer}`,fetcher,65536)).toString());
 verifyPointer(value);return {version:value.version,protocol:value.protocol};
}
/** Resolve the release and report what would change. Nothing is downloaded, locked or written. */
async function previewUpdate(options:UpdateOptions,platform:string,arch:string):Promise<UpdatePreview>{
 const current=options.version??CLI_VERSION;
 let installation:Installation|undefined;let reason:string|undefined;
 try{installation=options.installation??await detectInstallation();}
 catch(error){if(!(error instanceof CliError))throw error;reason=error.fix?`${error.message} ${error.fix}`:error.message;}
 const release=await releasePointerOf(options,options.fetch??fetch);
 const change=!installation?'unavailable':compare(release.version,current)>0?'update':'current';
 return {
  dry_run:true,server:normalizeServer(options.server),release,
  binary:{installation:installation?'standalone':'unmanaged',...(installation?{path:installation.path}:{}),current,available:release.version,change,...(reason?{reason}:{}),
   ...(installation&&change==='update'?{asset:`afbin-${platform}-${arch}`}:{})},
  skills:await planSkills(options.harnesses,{home:options.home,env:options.env,version:release.version}),
 };
}
export async function updateCli(options:UpdateOptions&{dryRun:true}):Promise<UpdatePreview>;
export async function updateCli(options:UpdateOptions):Promise<UpdatePreview|UpdateResult>;
export async function updateCli(options:UpdateOptions){
 const platform=options.platform??process.platform,arch=options.arch??process.arch;
 if(!['darwin','linux'].includes(platform)||!['arm64','x64'].includes(arch))throw new CliError('unsupported_platform','Standalone releases support macOS and Linux on arm64 or x64.');
 if(options.dryRun)return previewUpdate(options,platform,arch);
 const installation=options.installation??await detectInstallation();
 const state=join(options.home,'.artifactbin'),pendingPath=join(state,'pending-update.json'),binaryPath=join(state,'update-download');
 // Recover before making a release or server request. The release remains frozen across interruptions.
 const saved=await readOptional(pendingPath);
 let pending:PendingUpdate|undefined;
 if(saved){try{pending=JSON.parse(saved.toString());}catch{throw new CliError('invalid_update_journal','Invalid pending update journal.');}
  if(pending?.schema!==1||JSON.stringify(pending.installation)!==JSON.stringify(installation)||!Array.isArray(pending.selected)||pending.selected.some(x=>!skillHarnesses.includes(x)))throw new CliError('invalid_update_journal','Pending update does not match this installation.');
  verifyManifest(pending.manifest,platform,arch);verifySkills(Buffer.from(pending.skills),pending.manifest);
 }
 let bytes:Buffer|undefined;
 if(!pending){
  const fetcher=options.fetch??fetch;
  const release=await releasePointerOf(options,fetcher);
  if(compare(release.version,options.version??CLI_VERSION)<0)throw new CliError('compatible_release_unavailable','The selected server names an older release than the installed CLI.','Retry after a compatible CLI release is published.');
  const base=`${downloads}/afbin-v${release.version}`;
  const manifest=JSON.parse((await download(`${base}/afbin-${platform}-${arch}.manifest.json`,fetcher,65536)).toString());verifyManifest(manifest,platform,arch);
  if(manifest.version!==release.version||manifest.protocol!==release.protocol)throw new CliError('compatible_release_unavailable','The published release does not match the protocol the selected server named.','Retry after a compatible CLI release is published.');
  const skillBytes=await download(`${base}/${manifest.skills.file}`,fetcher,4194304);verifySkills(skillBytes,manifest);
  if(manifest.version!==(options.version??CLI_VERSION)){
   bytes=await download(`${base}/${manifest.binary.file}`,fetcher,268435456);
   if(digest(bytes)!==manifest.binary.sha256)throw new CliError('checksum_mismatch','Executable checksum mismatch; nothing was installed.');
  }
  pending={schema:1,installation,manifest,skills:skillBytes.toString(),selected:options.harnesses};
 }
 const operation=pending;
 return withProcessLock(options.home,async()=>{
  const current=await readOptional(pendingPath);
  if(current&&!saved)throw new CliError('pending_recovery','Another update was staged. Rerun afbin update to recover it.');
  if(saved&&current?.toString()!==saved.toString())throw new CliError('pending_recovery','Pending update changed. Rerun afbin update.');
  const bundle=verifySkills(Buffer.from(operation.skills),operation.manifest);
  if(!saved){
   if(bytes){
    const original=await readOptional(installation.path);if(!original)throw new CliError('missing_executable','The installed executable is missing.');
    operation.before=digest(original);operation.mode=(await lstat(installation.path)).mode&0o777;
    operation.backup=join(state,'binary-backups',randomUUID());await privateDirectory(dirname(operation.backup));
    await atomicWrite(binaryPath,bytes,{mode:0o700});
    await (options.verifyExecutable??executableVersion)(binaryPath,operation.manifest.version,operation.manifest.protocol);
    await atomicWrite(operation.backup,original,{mode:operation.mode});
   }
   await atomicWrite(pendingPath,JSON.stringify(operation));
  }
  if(operation.before){
   if(!/^[a-f0-9]{64}$/.test(operation.before)||!Number.isInteger(operation.mode)||operation.mode!>0o777||operation.mode!<0)throw new CliError('invalid_update_journal','Invalid executable recovery conditions.');
   const currentBytes=await readOptional(installation.path);const actual=currentBytes?digest(currentBytes):null;
   if(actual!==operation.manifest.binary.sha256){
    if(actual!==operation.before)throw new CliError('local_changed','Installed executable changed during update. It was not overwritten.');
    const staged=await readOptional(binaryPath);if(!staged||digest(staged)!==operation.manifest.binary.sha256)throw new CliError('checksum_mismatch','Staged update checksum mismatch.');
    await atomicWrite(installation.path,staged,{mode:operation.mode});
   }
   options.afterReplace?.();
  }
  const installed=await installSkills(operation.selected,{home:options.home,env:options.env,version:bundle.version,files:bundle.files,alreadyLocked:true});
  await rm(pendingPath);await rm(binaryPath,{force:true});
  return{version:operation.manifest.version,protocol:operation.manifest.protocol,recovered:!!saved,...(operation.backup?{backup:operation.backup}:{}),...installed};
 });
}
