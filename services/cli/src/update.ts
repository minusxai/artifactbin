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
import {installSkills,skillHarnesses,safeSkillPath,type SkillHarness} from './skill-install';
const run=promisify(execFile);
const releases='https://api.github.com/repos/minusxai/artifactbin/releases?per_page=100';
const downloads='https://github.com/minusxai/artifactbin/releases/download';
export type Installation={kind:'standalone';path:string}|{kind:'npm';prefix:string;global:boolean};
interface ReleaseManifest {version:string;protocol:number;platform:string;arch:string;binary:{file:string;sha256:string};skills:{file:string;sha256:string}}
interface SkillBundle {version:string;protocol:number;files:Record<string,string>}
interface PendingUpdate {schema:1;installation:Installation;manifest:ReleaseManifest;skills:string;selected:SkillHarness[];before?:string;mode?:number;backup?:string}
interface UpdateOptions {home:string;server:string;env?:NodeJS.ProcessEnv;installation?:Installation;platform?:string;arch?:string;version?:string;harnesses:SkillHarness[];fetch?:typeof fetch;runPackageManager?:(args:string[])=>Promise<void>;verifyExecutable?:(path:string,version:string,protocol:number)=>Promise<void>;afterReplace?:()=>void}
const semver=(value:unknown):value is string=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
function compare(a:string,b:string):number{const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
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
/** Recognize the installation that owns this invocation; never overwrite npm's executable shim. */
export async function detectInstallation(entry=process.argv[1],executable=process.execPath,standalone=isSea()):Promise<Installation>{
 if(standalone)return{kind:'standalone',path:await realpath(executable)};
 let directory=dirname(await realpath(entry));
 for(;;){
  const bytes=await readOptional(join(directory,'package.json'));
  if(bytes){const pkg=JSON.parse(bytes.toString());if(pkg.name==='@artifactbin/cli'){
   const modules=dirname(dirname(directory));
   if(modules.endsWith('/node_modules')&&!directory.includes('/.pnpm/')){
    const parent=dirname(modules);const global=parent.endsWith('/lib');return{kind:'npm',prefix:global?dirname(parent):parent,global};
   }
   throw new CliError('package_manager_required','This checkout or package-manager layout must be updated by its owning package manager.','Update @artifactbin/cli with the package manager that installed it; then run afbin setup to refresh local skills.');
  }}
  const parent=dirname(directory);if(parent===directory)throw new CliError('package_manager_required','Cannot identify the installed CLI package.','Update using the original installer.');directory=parent;
 }
}
async function executableVersion(path:string,version:string,protocol:number):Promise<void>{
 const result=await run(path,['--version','--json'],{env:{},timeout:15000,maxBuffer:65536});
 let value:any;try{value=JSON.parse(result.stdout);}catch{throw new CliError('invalid_release','Downloaded executable did not report its version.');}
 if(value.version!==version||value.protocol!==protocol)throw new CliError('invalid_release','Downloaded executable version/protocol differs from its manifest.');
}
export async function updateCli(options:UpdateOptions){
 const installation=options.installation??await detectInstallation();const platform=options.platform??process.platform,arch=options.arch??process.arch;
 if(!['darwin','linux'].includes(platform)||!['arm64','x64'].includes(arch))throw new CliError('unsupported_platform','Standalone releases support macOS and Linux on arm64 or x64.');
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
  const capabilities=JSON.parse((await download(`${normalizeServer(options.server)}/api/capabilities`,fetcher,1048576)).toString());
  if(!Number.isSafeInteger(capabilities.protocol)||capabilities.protocol<1)throw new CliError('unsupported_server','Server did not advertise a CLI protocol.');
  const list=JSON.parse((await download(releases,fetcher,4194304)).toString());
  if(!Array.isArray(list))throw new CliError('invalid_release','Release index is invalid.');
  const versions=list.filter(x=>!x.draft&&!x.prerelease&&typeof x.tag_name==='string'&&x.tag_name.startsWith('afbin-v')&&semver(x.tag_name.slice(7))).map(x=>x.tag_name.slice(7) as string).sort((a,b)=>compare(b,a));
  let manifest:ReleaseManifest|undefined,base='';
  for(const version of versions){
   if(compare(version,options.version??CLI_VERSION)<0)continue;
   base=`${downloads}/afbin-v${version}`;
   const value=JSON.parse((await download(`${base}/afbin-${platform}-${arch}.manifest.json`,fetcher,65536)).toString());verifyManifest(value,platform,arch);
   if(value.version!==version)throw new CliError('invalid_release','Release tag and manifest version differ.');
   if(value.protocol===capabilities.protocol){manifest=value;break;}
  }
  if(!manifest)throw new CliError('compatible_release_unavailable','No compatible release is available without downgrading.','Retry after a compatible CLI release is published.');
  const skillBytes=await download(`${base}/${manifest.skills.file}`,fetcher,4194304);verifySkills(skillBytes,manifest);
  if(installation.kind==='standalone'&&manifest.version!==(options.version??CLI_VERSION)){
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
   if(installation.kind==='standalone'&&bytes){
    const original=await readOptional(installation.path);if(!original)throw new CliError('missing_executable','The installed executable is missing.');
    operation.before=digest(original);operation.mode=(await lstat(installation.path)).mode&0o777;
    operation.backup=join(state,'binary-backups',randomUUID());await privateDirectory(dirname(operation.backup));
    await atomicWrite(binaryPath,bytes,{mode:0o700});
    await (options.verifyExecutable??executableVersion)(binaryPath,operation.manifest.version,operation.manifest.protocol);
    await atomicWrite(operation.backup,original,{mode:operation.mode});
   }
   await atomicWrite(pendingPath,JSON.stringify(operation));
  }
  if(installation.kind==='standalone'&&operation.before){
   if(!/^[a-f0-9]{64}$/.test(operation.before)||!Number.isInteger(operation.mode)||operation.mode!>0o777||operation.mode!<0)throw new CliError('invalid_update_journal','Invalid executable recovery conditions.');
   const currentBytes=await readOptional(installation.path);const actual=currentBytes?digest(currentBytes):null;
   if(actual!==operation.manifest.binary.sha256){
    if(actual!==operation.before)throw new CliError('local_changed','Installed executable changed during update. It was not overwritten.');
    const staged=await readOptional(binaryPath);if(!staged||digest(staged)!==operation.manifest.binary.sha256)throw new CliError('checksum_mismatch','Staged update checksum mismatch.');
    await atomicWrite(installation.path,staged,{mode:operation.mode});
   }
   options.afterReplace?.();
  }else if(installation.kind==='npm'&&operation.manifest.version!==(options.version??CLI_VERSION)){
   const args=['install',...(installation.global?['--global','--prefix',installation.prefix]:['--prefix',installation.prefix]),`@artifactbin/cli@${operation.manifest.version}`];
   await (options.runPackageManager??(async arguments_=>{await run('npm',arguments_,{env:options.env??process.env,timeout:180000,maxBuffer:1048576});}))(args);
  }
  const installed=await installSkills(operation.selected,{home:options.home,env:options.env,version:bundle.version,files:bundle.files,alreadyLocked:true});
  await rm(pendingPath);await rm(binaryPath,{force:true});
  return{version:operation.manifest.version,protocol:operation.manifest.protocol,recovered:!!saved,...(operation.backup?{backup:operation.backup}:{}),...installed};
 });
}
