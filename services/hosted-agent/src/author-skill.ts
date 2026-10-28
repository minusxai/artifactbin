/**
 * THE AUTHOR SKILL A HOSTED AGENT USES. A compute job downloads `<server>/skills/artifactbin.zip` from the run's own
 * server, checks it (a size limit, `artifactbin/SKILL.md` at the root naming the skill, no unsafe or linked paths,
 * every entry's CRC) and swaps it into each harness's skills folder atomically: unpack beside the folder, rename the old
 * folder away, move the new one in, delete the old one only after that succeeded. A folder already holding the same zip
 * (its `.artifactbin-skill` marker names the zip's SHA-256) is left alone, so repeated allocations cost one download.
 */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,rmdir,stat,writeFile} from 'node:fs/promises';
import {dirname,isAbsolute,join} from 'node:path';
import {crc32,inflateRawSync} from 'node:zlib';
import {normalizeServer} from './config';
import {isLocalDevelopmentHost} from '@artifactbin/contracts';

const SKILL_ROOT='artifactbin/';
const MIB=1024*1024;
const MAX_ZIP_BYTES=64*MIB,MAX_UNPACKED_BYTES=256*MIB,MAX_ENTRIES=5000;
const MARKER='.artifactbin-skill';
export type SkillHarness='claude'|'codex'|'pi'|'opencode';
class InvalidSkill extends Error {}

/** Where each harness reads its skills, under one home (the same folders `afbin setup` used). */
export function authorSkillTargets(home:string,harnesses:readonly SkillHarness[]=['claude','codex','pi','opencode'],env:NodeJS.ProcessEnv={}):string[]{
 const all:Record<SkillHarness,string>={
  claude:join(env.CLAUDE_CONFIG_DIR??join(home,'.claude'),'skills','artifactbin'),
  codex:join(env.CODEX_HOME??join(home,'.codex'),'skills','artifactbin'),
  pi:join(env.PI_CODING_AGENT_DIR??join(home,'.pi','agent'),'skills','artifactbin'),
  opencode:join(env.OPENCODE_CONFIG_DIR??join(env.XDG_CONFIG_HOME??join(home,'.config'),'opencode'),'skills','artifactbin'),
 };
 return harnesses.map(harness=>all[harness]);
}
const safeSkillPath=(path:string)=>!!path&&!isAbsolute(path)&&!path.includes('\\')&&path.split('/').every(x=>!!x&&x!=='.'&&x!=='..')&&path!==MARKER;

/** A minimal zip reader for the author skill: stored or deflated entries, all under artifactbin/. */
export function readSkillZip(zip:Buffer):Map<string,Buffer>{
 const fail=(message:string):never=>{throw new InvalidSkill(message);};
 let eocd=-1;
 for(let i=zip.length-22;i>=Math.max(0,zip.length-22-0xffff);i--)if(zip.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)fail('The download is not a zip file.');
 const count=zip.readUInt16LE(eocd+10),size=zip.readUInt32LE(eocd+12),offset=zip.readUInt32LE(eocd+16);
 if(count===0xffff||size===0xffffffff||offset===0xffffffff)fail('The zip uses an unsupported (zip64) layout.');
 if(count>MAX_ENTRIES||offset+size>eocd)fail('The zip directory is malformed.');
 const files=new Map<string,Buffer>();let total=0,at=offset;
 for(let n=0;n<count;n++){
  if(at+46>eocd||zip.readUInt32LE(at)!==0x02014b50)fail('The zip directory is malformed.');
  const flags=zip.readUInt16LE(at+8),method=zip.readUInt16LE(at+10),crc=zip.readUInt32LE(at+16),packed=zip.readUInt32LE(at+20),unpacked=zip.readUInt32LE(at+24);
  const nameLength=zip.readUInt16LE(at+28),extraLength=zip.readUInt16LE(at+30),commentLength=zip.readUInt16LE(at+32),external=zip.readUInt32LE(at+38),local=zip.readUInt32LE(at+42);
  const name=zip.toString('utf8',at+46,at+46+nameLength);at+=46+nameLength+extraLength+commentLength;
  if(flags&1)fail('The zip is encrypted.');
  if(!name.startsWith(SKILL_ROOT))fail(`The zip holds ${name} outside ${SKILL_ROOT}.`);
  if(name.endsWith('/')){if(name!==SKILL_ROOT&&!safeSkillPath(name.slice(SKILL_ROOT.length,-1)))fail(`Unsafe path in zip: ${name}`);continue;}
  const relative=name.slice(SKILL_ROOT.length);
  if(!safeSkillPath(relative))fail(`Unsafe path in zip: ${name}`);
  if(((external>>>16)&0o170000)===0o120000)fail(`The zip holds a symbolic link: ${name}`);
  if(files.has(relative))fail(`The zip repeats ${name}.`);
  total+=unpacked;if(total>MAX_UNPACKED_BYTES)fail('The zip unpacks too large.');
  if(local+30>zip.length||zip.readUInt32LE(local)!==0x04034b50)fail('The zip entry headers are malformed.');
  const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
  if(start+packed>zip.length)fail('The zip is truncated.');
  const raw=zip.subarray(start,start+packed);let data:Buffer;
  if(method===0)data=raw;
  else if(method===8){try{data=inflateRawSync(raw,{maxOutputLength:Math.max(1,unpacked)});}catch{return fail(`Cannot inflate ${name}.`);}}
  else return fail(`The zip uses an unsupported compression method for ${name}.`);
  if(data.length!==unpacked||crc32(data)!==crc)fail(`The zip entry ${name} is corrupt.`);
  files.set(relative,Buffer.from(data));
 }
 if(!files.has('SKILL.md'))fail(`The zip has no ${SKILL_ROOT}SKILL.md.`);
 return files;
}

async function download(server:string,fetcher:typeof fetch,timeoutMs:number):Promise<Buffer>{
 const origin=normalizeServer(server),url=new URL('/skills/artifactbin.zip',origin);
 // HTTPS, except a local development origin (a developer's or CI's own composition).
 if(url.protocol!=='https:'&&!isLocalDevelopmentHost(url.hostname))throw new InvalidSkill('Refusing a skill URL that is not HTTPS.');
 const response=await fetcher(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
 if(!response.ok)throw new InvalidSkill(`The skill download answered HTTP ${response.status}.`);
 if(Number(response.headers.get('content-length')??0)>MAX_ZIP_BYTES)throw new InvalidSkill('The skill download is too large.');
 const chunks:Uint8Array[]=[];let size=0;
 if(response.body){
  const reader=response.body.getReader();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_ZIP_BYTES){await reader.cancel().catch(()=>{});throw new InvalidSkill('The skill download is too large.');}chunks.push(value);}
 }
 return Buffer.concat(chunks);
}

/** One installer per folder at a time: an exclusive lock directory, taken over when its holder is gone for a minute. */
async function locked<T>(target:string,work:()=>Promise<T>):Promise<T>{
 const lock=`${target}.lock`,deadline=Date.now()+60_000;
 await mkdir(dirname(target),{recursive:true,mode:0o755});
 for(;;){
  try{await mkdir(lock);break;}
  catch(error){
   if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const held=await stat(lock).then(info=>Date.now()-info.mtimeMs,()=>0);
   if(held>60_000){await rmdir(lock).catch(()=>{});continue;}
   if(Date.now()>deadline)throw new InvalidSkill(`Another installer holds ${lock}.`);
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
 try{return await work();}finally{await rmdir(lock).catch(()=>{});}
}

async function swapIn(target:string,files:Map<string,Buffer>,digest:string):Promise<'installed'|'current'>{
 return locked(target,async()=>{
  if((await readFile(join(target,MARKER),'utf8').catch(()=>''))===digest)return 'current';
  const id=randomUUID(),staged=join(dirname(target),`.artifactbin-new-${id}`),backup=join(dirname(target),`.artifactbin-old-${id}`);
  try{
   for(const [file,bytes] of files){const path=join(staged,file);await mkdir(dirname(path),{recursive:true,mode:0o755});await writeFile(path,bytes,{mode:0o644,flag:'wx'});}
   await writeFile(join(staged,MARKER),digest,{mode:0o644});
   const present=await stat(target).then(()=>true,()=>false);
   if(present)await rename(target,backup);
   try{await rename(staged,target);}catch(error){if(present)await rename(backup,target).catch(()=>{});throw error;}
  }catch(error){await rm(staged,{recursive:true,force:true}).catch(()=>{});throw error;}
  await rm(backup,{recursive:true,force:true}).catch(()=>{});
  return 'installed';
 });
}

/** Download the run server's author skill once and install it into every target folder; throws when the zip fails a check. */
export async function installAuthorSkill(options:{server:string;targets:string[];fetch?:typeof fetch;timeoutMs?:number}):Promise<{sha256:string;targets:Array<{path:string;status:'installed'|'current'}>}>{
 const zip=await download(options.server,options.fetch??fetch,options.timeoutMs??120_000);
 const files=readSkillZip(zip);
 if(!/^---\r?\n[\s\S]*?^name:\s*artifactbin\s*$/m.test(files.get('SKILL.md')!.toString('utf8')))throw new InvalidSkill('The downloaded SKILL.md does not declare name: artifactbin.');
 const sha256=createHash('sha256').update(zip).digest('hex');
 const targets=[];
 for(const path of options.targets)targets.push({path,status:await swapIn(path,files,sha256)});
 return {sha256,targets};
}
