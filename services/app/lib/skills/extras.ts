/**
 * DEPLOYMENT EXTRAS (`SKILLS__EXTRA_DIR`, off by default): files an operator adds to the author skill this origin
 * serves, for a deployment whose co-hosted services need their own guide and script beside the product's.
 *
 * They ship under `extras/` and nowhere else in the archive, so they never shadow or replace a product file, and the release
 * version covers them (package.ts `skillRelease` hashes every member), so installed skills update when they change.
 * The directory is flat and holds only lowercase kebab-case `.md` guides, `.mjs` scripts and `.json` data: no
 * hidden files, subdirectories or symlinks, UTF-8 text, at most EXTRAS_MAX_FILES files, EXTRA_FILE_MAX_BYTES each
 * and EXTRAS_MAX_BYTES together (a cap of their own: the product archive's budget is unchanged). Nothing here is
 * templated or executed by the server; a script runs only when an agent runs it.
 *
 * TRUST: extras are operator-supplied instructions and code delivered to agents, and public (anyone may download
 * the archive): no secrets. An origin may enable them only once its installs run an updater that accepts
 * `extras/` (scripts/toolbox-update-archive.mjs); an older one refuses the release and keeps its current skill.
 *
 * INTRODUCTION: an optional guide named `intro.md` says what this server is beyond the product, for an agent
 * arriving with nothing installed: `/llms.txt` opens with it, verbatim, before the product guide (so it should end by
 * pointing below for publishing pages), and it ships as an extra like any other guide. Keep it short and general.
 *
 * FOLLOWING THE DIRECTORY: the boot reads it once (an invalid directory refuses the boot), and every later use looks
 * again, without a restart: one stat of the directory, its listing and one lstat per entry (nanosecond times, sizes,
 * inodes). Only when that signature changes is the directory read and validated anew, the same way the boot reads it;
 * the result replaces the extras only when their files differ, so an unchanged directory keeps the same object, and
 * with it the same archive bytes and ETag. A read is taken only when the signature is the same before and after it,
 * so files changing mid-read never mix into one set. An invalid state keeps the last valid extras and logs one line
 * per distinct problem, then one when it is valid again. Entries written within RECENT_NS of a read are read again
 * on the next use, since a same-length rewrite within one timestamp tick leaves the signature unchanged.
 * Editors' swap and backup files (`.x.swp`, `x.md~`) make the directory invalid while present; write elsewhere and
 * rename in for a single, whole step.
 *
 * Discovery: the generated `extras/README.md` lists each guide by its first `# ` heading (required) and its
 * `Read when …` line (optional, the first line starting so), and SKILL.md points at it only when extras exist.
 * A script may import the skill's own modules by relative path (`../scripts/…`), relying only on
 * EXTRA_ENTRY_POINTS.
 */
import {closeSync,constants,fstatSync,lstatSync,openSync,readdirSync,readSync,statSync} from 'node:fs';
import path from 'node:path';
import {skillExtrasDir} from '@/lib/platform';

export const EXTRA_FILE_MAX_BYTES=64*1024;
export const EXTRAS_MAX_BYTES=256*1024;
export const EXTRAS_MAX_FILES=32;
/** The skill modules an extra's script may import, and the exported names it may rely on (pinned by a test). */
export const EXTRA_ENTRY_POINTS={
 'scripts/toolbox-client.mjs':['makeClient','selectedServer','credentialRoot','runTool','ToolError'],
 'scripts/toolbox-service-token.mjs':['serviceToken'],
 'scripts/toolbox-config.mjs':['default'],
} as const;
const SOURCE_NAME=/^[a-z0-9-]+\.(?:md|mjs|json)$/;
/** An archive member the extras may occupy: an operator file, or the generated index. */
export const skillExtraName=(name:string):boolean=>/^extras\/(?:(?!readme\.)[a-z0-9-]+\.(?:md|mjs|json)|README\.md)$/.test(name);
/** `files` are the archive members; `intro` is the optional `intro.md`, which /llms.txt opens with. */
export interface SkillExtras {readonly dir:string;readonly files:Readonly<Record<string,string>>;readonly intro:string|null}

/** What the directory holds that would not ship; `problem` names the setting and the file, for a log line. */
class ExtrasProblem extends Error{
 constructor(readonly problem:string){super(`[boot] ${problem}. Fix it or unset the setting.`);}
}
/** Read and validate the directory now; throws naming SKILLS__EXTRA_DIR on anything it would not ship. */
export function readSkillExtras(dir:string):SkillExtras{
 const fail=(problem:string):never=>{throw new ExtrasProblem(`SKILLS__EXTRA_DIR ${JSON.stringify(dir)}: ${problem}`);};
 let names:string[]=[];
 try{if(!statSync(dir).isDirectory())fail('is not a directory');names=readdirSync(dir).sort();}
 catch(error){if(error instanceof ExtrasProblem)throw error;fail(`cannot be read (${(error as NodeJS.ErrnoException).code??'error'})`);}
 if(!names.length)fail('is empty');
 if(names.length>EXTRAS_MAX_FILES)fail(`holds ${names.length} files, more than ${EXTRAS_MAX_FILES}`);
 const files:Record<string,string>={},guides:string[]=[],others:string[]=[];let total=0;
 for(const name of names){
  if(name.startsWith('.'))fail(`${name}: hidden files are not shipped`);
  const stat=lstatSync(path.join(dir,name));
  if(stat.isSymbolicLink())fail(`${name}: symlinks are not shipped`);
  if(!stat.isFile())fail(`${name}: only files are shipped, no subdirectories`);
  if(!SOURCE_NAME.test(name)||name.startsWith('readme.'))fail(`${name}: names are lowercase [a-z0-9-] ending .md, .mjs or .json (readme is the generated index)`);
  if(stat.size>EXTRA_FILE_MAX_BYTES)fail(`${name}: ${stat.size} bytes, more than ${EXTRA_FILE_MAX_BYTES}`);
  // The caps hold for the bytes actually read, from the very file the lstat saw (never a symlink swapped in since).
  const bytes=readRegularFile(path.join(dir,name),stat.ino)??fail(`${name}: cannot be read, or changed while it was read`);
  if(bytes.length>EXTRA_FILE_MAX_BYTES)fail(`${name}: ${bytes.length} bytes, more than ${EXTRA_FILE_MAX_BYTES}`);
  if((total+=bytes.length)>EXTRAS_MAX_BYTES)fail(`more than ${EXTRAS_MAX_BYTES} bytes together`);
  let text='';
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail(`${name}: not UTF-8 text`);}
  if(text.includes('\0'))fail(`${name}: not text`);
  if(name.endsWith('.json'))try{JSON.parse(text);}catch{fail(`${name}: not valid JSON`);}
  if(name.endsWith('.md')){
   const title=/^# +(\S.*)$/m.exec(text)?.[1]?.trim();if(!title)fail(`${name}: a guide needs a "# " heading`);
   const when=/^Read when\b.*$/m.exec(text)?.[0]?.trim();
   guides.push(`- [${title}](${name})${when?`: ${when}`:''}`);
  }else others.push(`\`${name}\``);
  files[`extras/${name}`]=text;
 }
 files['extras/README.md']=['# Extras from this server','',
  'Guides and scripts this server\'s operator added to the skill; they are not Artifactbin\'s own. A script runs',
  'only when you run it (`node extras/<name>.mjs`).','',...guides,...(others.length?['',`Scripts and data: ${others.join(', ')}.`]:[]),''].join('\n');
 return {dir,files,intro:files['extras/intro.md']??null};
}

/** At most EXTRA_FILE_MAX_BYTES+1 bytes of a regular file, opened without following a symlink; null when the path
 * no longer names the file with inode `ino` or cannot be read. */
function readRegularFile(file:string,ino:number):Buffer|null{
 let fd:number|undefined;
 try{
  fd=openSync(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  const opened=fstatSync(fd);if(!opened.isFile()||opened.ino!==ino)return null;
  const buffer=Buffer.alloc(EXTRA_FILE_MAX_BYTES+1);let length=0,read=0;
  while(length<buffer.length&&(read=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=read;
  return buffer.subarray(0,length);
 }catch{return null;}
 finally{if(fd!==undefined)closeSync(fd);}
}

/** Entries changed within this long of a read are read again on the next use: the coarsest common timestamp tick
 * (2 s on FAT; one second on HFS+; a kernel tick on ext4) can hide a same-length rewrite from the signature. */
const RECENT_NS=2_000_000_000n;
const nowNs=()=>BigInt(Date.now())*1_000_000n;
/** What the directory looks like, cheaply: its own stat, its listing and each entry's lstat (type, inode, size,
 * modification and change times in nanoseconds), never the contents; `newest` is its latest time. */
function signature(dir:string):{key:string;newest:bigint}{
 try{
  const own=statSync(dir,{bigint:true});
  const parts=[`${own.dev}:${own.ino}:${own.mode}:${own.mtimeNs}:${own.ctimeNs}`];let newest=own.mtimeNs>own.ctimeNs?own.mtimeNs:own.ctimeNs;
  if(own.isDirectory()){
   const names=readdirSync(dir).sort();parts.push(`${names.length}`);
   // Past the file cap the read refuses on the count alone, so the first entries over it are enough to look at.
   for(const name of names.slice(0,EXTRAS_MAX_FILES+1)){
    try{
     const entry=lstatSync(path.join(dir,name),{bigint:true});
     parts.push(`${name}/${entry.mode}:${entry.ino}:${entry.size}:${entry.mtimeNs}:${entry.ctimeNs}`);
     for(const time of [entry.mtimeNs,entry.ctimeNs])if(time>newest)newest=time;
    }catch(error){parts.push(`${name}/${(error as NodeJS.ErrnoException).code??'error'}`);}
   }
  }
  return {key:parts.join('\n'),newest};
 }catch(error){return {key:`unreadable:${(error as NodeJS.ErrnoException).code??'error'}`,newest:0n};}
}
const sameFiles=(a:SkillExtras,b:SkillExtras)=>{
 const names=Object.keys(a.files);
 return names.length===Object.keys(b.files).length&&names.every(name=>b.files[name]===a.files[name]);
};
/** One read the signature vouches for: the same before and after it (up to three tries), or `stable` false. */
function readSteadily(dir:string){
 for(let attempt=1;;attempt++){
  const started=nowNs(),before=signature(dir);
  let extras:SkillExtras|null=null,error:unknown=null;
  try{extras=readSkillExtras(dir);}catch(thrown){error=thrown;}
  const stable=signature(dir).key===before.key;
  if(stable||attempt===3)return {extras,error,stable,seen:{key:before.key,again:!stable||before.newest+RECENT_NS>=started}};
 }
}

let state:{dir:string;extras:SkillExtras;seen:{key:string;again:boolean};problem:string|null}|null=null;
/**
 * This origin's extras as the directory holds them now, or null when the setting is off. The first read of a setting
 * value throws on anything it would not ship (the boot reads first, so an invalid directory refuses the boot); later
 * reads keep the last valid extras through an invalid state (header: FOLLOWING THE DIRECTORY).
 */
export function skillExtras():SkillExtras|null{
 const dir=skillExtrasDir();
 if(!dir)return null;
 if(state?.dir!==dir){
  const read=readSteadily(dir);
  if(!read.extras)throw read.error;
  state={dir,extras:read.extras,seen:read.seen,problem:null};
  return read.extras;
 }
 const current=state;
 if(!current.seen.again&&signature(dir).key===current.seen.key)return current.extras;
 const read=readSteadily(dir);
 current.seen=read.seen;
 // Files that changed while they were read are no consistent set: keep the last one and look again next time.
 if(!read.stable)return current.extras;
 if(read.extras){
  if(current.problem!==null)console.warn(`[skills] SKILLS__EXTRA_DIR ${JSON.stringify(dir)} is valid again: serving its files.`);
  current.problem=null;
  if(!sameFiles(read.extras,current.extras))current.extras=read.extras;
 }else{
  // After the boot nothing here fails a request: whatever went wrong is the directory's problem, logged once.
  const problem=read.error instanceof ExtrasProblem?read.error.problem:`SKILLS__EXTRA_DIR ${JSON.stringify(dir)}: ${(read.error as Error)?.message??String(read.error)}`;
  if(problem!==current.problem){
   current.problem=problem;
   console.warn(`[skills] ${problem}; still serving the extras last read, until it is valid again.`);
  }
 }
 return current.extras;
}
