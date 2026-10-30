/** Immutable releases: the install and credentials are never removed or overwritten. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const limit=32*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const member=/^(?:SKILL\.md|release\.json|references\/[a-z0-9-]+\.md|scripts\/[a-z0-9-]+\.mjs|examples\/[a-z0-9-]+\.(?:html|csv|ts|mjs)|design-systems\/[a-z0-9-]+\.css|components\/[a-z0-9-]+\.ts)$/;
export function decodeRelease(bytes,manifest){
 if(bytes.length>limit||!hex(manifest.sha256)||hash(bytes)!==manifest.sha256)throw Error('Invalid archive checksum or size');
 const files=Object.create(null);let offset=0;const entries=[];
 while(offset+30<=bytes.length&&bytes.readUInt32LE(offset)===0x04034b50){
  const flags=bytes.readUInt16LE(offset+6),method=bytes.readUInt16LE(offset+8),size=bytes.readUInt32LE(offset+18),plain=bytes.readUInt32LE(offset+22),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
  const start=offset+30+n+extra,end=start+size;
  if(flags!==0x800||method!==0||size!==plain||extra||end>bytes.length)throw Error('Unsupported archive');
  const full=bytes.subarray(offset+30,offset+30+n).toString('utf8'),name=full.slice(12);
  if(!full.startsWith('artifactbin/')||!member.test(name)||name in files)throw Error('Unsafe archive member');
  const data=bytes.subarray(start,end);let crc=0xffffffff;
  for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  if(((crc^0xffffffff)>>>0)!==bytes.readUInt32LE(offset+14))throw Error('Corrupt archive member');
  entries.push({offset,full,size,crc:(crc^0xffffffff)>>>0});files[name]=data.toString('utf8');offset=end;
 }
 const central=offset;
 for(const entry of entries){
  if(offset+46>bytes.length||bytes.readUInt32LE(offset)!==0x02014b50)throw Error('Invalid directory');
  const n=bytes.readUInt16LE(offset+28);
  if(bytes.readUInt16LE(offset+30)||bytes.readUInt16LE(offset+32)||bytes.readUInt32LE(offset+38)||bytes.readUInt32LE(offset+42)!==entry.offset||bytes.readUInt32LE(offset+16)!==entry.crc||bytes.readUInt32LE(offset+20)!==entry.size||bytes.subarray(offset+46,offset+46+n).toString()!==entry.full)throw Error('Invalid directory entry');
  offset+=46+n;
 }
 if(offset+22!==bytes.length||bytes.readUInt32LE(offset)!==0x06054b50||bytes.readUInt32LE(offset+16)!==central||bytes.readUInt32LE(offset+12)!==offset-central||bytes.readUInt16LE(offset+10)!==entries.length)throw Error('Invalid archive end');
 const release=JSON.parse(files['release.json']);delete files['release.json'];
 if(!hex(manifest.version)||release.schemaVersion!==1||release.origin!==manifest.origin||release.version!==manifest.version||hash(JSON.stringify([manifest.origin,Object.entries(files).sort(([a],[b])=>a.localeCompare(b))]))!==manifest.version||!files['SKILL.md'])throw Error('Invalid release identity');
 files['release.json']=JSON.stringify(release)+'\n';return files;
}
async function json(file){return JSON.parse(await readFile(file,'utf8'));}
async function atomic(file,value){const temporary=file+'.'+randomUUID();await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,file);}
async function context(root){root=await realpath(root);const release=await json(path.join(root,'release.json'));if(release.schemaVersion!==1||!hex(release.version)||new URL(release.origin).origin!==release.origin)throw Error('Invalid installed release');return {root,release,state:path.join(root,'.artifactbin-updates',hash(release.origin))};}
async function fetchBytes(url,max){const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Update HTTP '+response.status);let size=0;const parts=[];for await(const part of response.body){size+=part.length;if(size>max)throw Error('Update exceeds size limit');parts.push(Buffer.from(part));}return Buffer.concat(parts);}
export async function update(root){
 const c=await context(root);await mkdir(c.state,{recursive:true,mode:0o700});
 const manifest=JSON.parse((await fetchBytes(c.release.origin+'/skills/artifactbin/latest.json',16384)).toString());
 if(manifest.schemaVersion!==1||manifest.origin!==c.release.origin||manifest.url!==c.release.origin+'/skills/artifactbin.zip'||!hex(manifest.version))throw Error('Invalid update manifest');
 let pending;try{pending=await json(path.join(c.state,'pending.json'));}catch{}
 if(manifest.version===c.release.version||manifest.version===pending?.version)return {status:'current'};
 const files=decodeRelease(await fetchBytes(manifest.url,limit),manifest);
 const stage=path.join(c.state,'release-'+randomUUID());await mkdir(stage,{mode:0o700});
 for(const [name,content] of Object.entries(files)){const target=path.join(stage,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx',mode:0o600});}
 await atomic(path.join(c.state,'pending.json'),{directory:path.basename(stage),version:manifest.version});
 return {status:'staged',version:manifest.version};
}
export const disabled=args=>args.includes('--no-update')||!!process.env.ARTIFACTBIN__NO_UPDATE;
/** No network work is awaited by the foreground. Children execute once from immutable releases. */
export async function beforeCommand(url,args){
 if(disabled(args)||args.includes('--help'))return false;
 try{
  const c=await context(fileURLToPath(new URL('../',url)));await mkdir(c.state,{recursive:true,mode:0o700});
  let active;try{active=await json(path.join(c.state,'pending.json'));}catch{}
  let checked=0;try{checked=(await json(path.join(c.state,'checked.json'))).time;}catch{}
  if(Date.now()-checked>3600000){const claimed=await writeFile(path.join(c.state,'check-'+Math.floor(Date.now()/3600000)), '', {flag:'wx',mode:0o600}).then(()=>true,error=>{if(error.code==='EEXIST')return false;throw error;});if(claimed){await atomic(path.join(c.state,'checked.json'),{time:Date.now()});const child=spawn(process.execPath,[fileURLToPath(new URL('./update.mjs',url)),'--background'],{stdio:'ignore',detached:true});child.unref();}}
  if(!active||!/^release-[a-f0-9-]+$/.test(active.directory)||!hex(active.version))return false;
  const directory=path.join(c.state,active.directory),release=await json(path.join(directory,'release.json'));
  if(release.origin!==c.release.origin||release.version!==active.version)return false;
  const script=path.join(directory,'scripts',path.basename(fileURLToPath(url)));
  process.stderr.write('Skill updated. Reread '+path.join(directory,'SKILL.md')+' before continuing.\n');
  const child=spawn(process.execPath,[script,...args,'--no-update'],{stdio:'inherit'});
  process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',(code)=>resolve(code??1));});return true;
 }catch{return false;}
}
