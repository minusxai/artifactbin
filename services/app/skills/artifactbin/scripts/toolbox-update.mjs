/** Immutable releases: the install and credentials are never removed or overwritten. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,realpath,symlink,lstat,rm,readdir,readlink} from 'node:fs/promises';
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
async function atomic(file,value){const temporary=file+'.tmp';await rm(temporary,{force:true});await writeFile(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});await rename(temporary,file);}
async function context(root){
 root=await realpath(root);
 const state=path.dirname(path.dirname(root)),canonical=path.join(path.dirname(state),'artifactbin');
 if(path.basename(root)!=='artifactbin'||path.basename(state)!=='.artifactbin-releases'||!(await lstat(canonical)).isSymbolicLink())throw Error('Unmanaged installation. Reinstall using the installer to enable updates.');
 const release=await json(path.join(root,'release.json'));
 const active=await realpath(canonical);
 if(path.dirname(path.dirname(active))!==state||path.basename(active)!=='artifactbin')throw Error('Invalid canonical release pointer');
 for(const directory of [state,root,active])if((await lstat(directory)).uid!==process.getuid?.())throw Error('Release ownership mismatch');
 const current=await json(path.join(active,'release.json'));
 if(release.schemaVersion!==1||!hex(release.version)||new URL(release.origin).origin!==release.origin||current.origin!==release.origin)throw Error('Invalid installed release');
 return {root:active,release:current,state,canonical};
}
async function locked(c,action){
 const lock=path.join(c.state,'lock');
 for(let attempt=0;;attempt++){
  try{await symlink(String(process.pid),lock);break;}catch(error){
   if(error.code!=='EEXIST')throw error;
   let pid;try{pid=Number(await readlink(lock));}catch(e){if(e.code==='ENOENT')continue;throw e;}let alive=true;
   if(!Number.isSafeInteger(pid)||pid<=0)throw Error('Invalid updater lock; remove it after checking no updater is running');
   if(pid>0)try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
   if(!alive){await rm(lock,{force:true});continue;}
   if(attempt>=200)throw Error('Update busy; retry later');await new Promise(resolve=>setTimeout(resolve,50));
  }
 }
 try{return await action();}finally{await rm(lock,{force:true});}
}
async function verified(c,directory){
 if(typeof directory!=='string'||!directory||directory==='.'||directory==='..'||path.basename(directory)!==directory)throw Error('Invalid release pointer');
 const root=path.join(c.state,directory,'artifactbin'),files=[];
 if(await realpath(root)!==root||(await lstat(root)).uid!==process.getuid?.())throw Error('Invalid release ownership or path');
 async function walk(folder,prefix=''){
  for(const entry of await readdir(folder,{withFileTypes:true})){
   const name=prefix+entry.name,target=path.join(folder,entry.name);
   if(entry.isDirectory())await walk(target,name+'/');
   else if(entry.isFile()&&member.test(name)){if(name!=='release.json')files.push([name,await readFile(target,'utf8')]);}
   else throw Error('Unsafe installed release member');
  }
 }
 await walk(root);const release=await json(path.join(root,'release.json'));
 if(release.schemaVersion!==1||release.origin!==c.release.origin||hash(JSON.stringify([release.origin,files.sort(([a],[b])=>a.localeCompare(b))]))!==release.version)throw Error('Release identity mismatch');
 return root;
}
async function activate(c,directory){
 const root=await verified(c,directory),previous=await realpath(c.canonical);
 if(root===previous)return;
 await atomic(path.join(c.state,'previous.json'),{directory:path.basename(path.dirname(previous))});
 const temporary=path.join(c.state,'activate');await rm(temporary,{force:true});await symlink(root,temporary);await rename(temporary,c.canonical);
 process.stderr.write('Skill updated. Reread '+path.join(c.canonical,'SKILL.md')+' and reload your harness.\n');
}
async function fetchBytes(url,max){const response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('Update HTTP '+response.status);let size=0;const parts=[];for await(const part of response.body){size+=part.length;if(size>max)throw Error('Update exceeds size limit');parts.push(Buffer.from(part));}return Buffer.concat(parts);}
export async function update(root,{background=false,rollback=false}={}){
 const c=await context(root);
 return locked(c,async()=>{
  Object.assign(c,await context(root));
  for(const name of await readdir(c.state))if(/^stage-[a-f0-9-]+$/.test(name))await rm(path.join(c.state,name),{recursive:true,force:true});
  if(rollback){const previous=await json(path.join(c.state,'previous.json'));await activate(c,previous.directory);await rm(path.join(c.state,'pending.json'),{force:true});return {status:'rolled-back'};}
  const manifest=JSON.parse((await fetchBytes(c.release.origin+'/skills/artifactbin/latest.json',16384)).toString());
  if(manifest.schemaVersion!==1||manifest.origin!==c.release.origin||manifest.url!==c.release.origin+'/skills/artifactbin.zip'||!hex(manifest.version))throw Error('Invalid update manifest');
  if(manifest.version===c.release.version)return {status:'current'};
  let pending;try{pending=await json(path.join(c.state,'pending.json'));const pendingRoot=await verified(c,pending.directory);if((await json(path.join(pendingRoot,'release.json'))).version!==manifest.version)pending=null;}catch{pending=null;}
  if(pending){if(!background){await activate(c,pending.directory);await rm(path.join(c.state,'pending.json'),{force:true});}return {status:background?'staged':'activated',version:manifest.version};}
  if((await readdir(c.state)).filter(name=>name.startsWith('release-')).length>=32)throw Error('Release cache full. Close running harnesses and remove unused releases before retrying.');
  const bytes=await fetchBytes(manifest.url,limit),files=decodeRelease(bytes,manifest);
  const directory='release-'+randomUUID(),stage=path.join(c.state,directory.replace('release-','stage-')),releaseRoot=path.join(stage,'artifactbin');await mkdir(releaseRoot,{recursive:true,mode:0o700});
  for(const [name,content] of Object.entries(files)){const target=path.join(releaseRoot,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx',mode:0o600});}

  await rename(stage,path.join(c.state,directory));
  if(background)await atomic(path.join(c.state,'pending.json'),{directory});else {await activate(c,directory);await rm(path.join(c.state,'pending.json'),{force:true});}
  return {status:background?'staged':'activated',version:manifest.version};
 });
}
export const disabled=args=>args.includes('--no-update')||/^(1|true|yes)$/i.test(process.env.ARTIFACTBIN__NO_UPDATE||'');
export async function beforeCommand(url,args){
 if(args.includes('--help')||process.env.ARTIFACTBIN__UPDATE_DISPATCHED===fileURLToPath(url))return false;
 let c;
 try{c=await context(fileURLToPath(new URL('../',url)));}catch{return false;}
 const server=args.find(a=>a.startsWith('--server='))?.slice(9)??args[args.indexOf('--server')+1];
 const allowed=!disabled(args)&&(!args.some(a=>a==='--server'||a.startsWith('--server='))||server===c.release.origin);
 if(allowed)try{
  await locked(c,async()=>{
   try{const pending=await json(path.join(c.state,'pending.json'));await activate(c,pending.directory);}catch{}finally{await rm(path.join(c.state,'pending.json'),{force:true});}
   let checked=0;try{checked=(await json(path.join(c.state,'checked.json'))).time;}catch{}
   if(Date.now()-checked>3600000){await atomic(path.join(c.state,'checked.json'),{time:Date.now()});const child=spawn(process.execPath,[path.join(await realpath(c.canonical),'scripts/update.mjs'),'--background'],{stdio:'ignore',detached:true});child.on('error',()=>{});child.unref();}
  });
 }catch{}
 const active=await realpath(c.canonical),original=fileURLToPath(new URL('../',url));
 if(active===await realpath(original))return false;
 const script=path.join(active,'scripts',path.basename(fileURLToPath(url)));
 const child=spawn(process.execPath,[script,...args,'--no-update'],{stdio:'inherit',env:{...process.env,ARTIFACTBIN__UPDATE_DISPATCHED:script}});
 const forward=signal=>child.kill(signal),handlers=new Map(['SIGINT','SIGTERM','SIGHUP'].map(signal=>[signal,()=>forward(signal)]));
 for(const [signal,handler] of handlers)process.on(signal,handler);
 try{const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  for(const [signal,handler] of handlers)process.off(signal,handler);
  if(result.signal)process.kill(process.pid,result.signal);else process.exitCode=result.code;return true;
 }finally{for(const [signal,handler] of handlers)process.off(signal,handler);}
}
