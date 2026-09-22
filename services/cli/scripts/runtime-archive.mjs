/** Checksum archive shared by the embedded host runtime and downloaded Chromium. */
import {readdir,readFile,readlink,lstat,writeFile,mkdir} from 'node:fs/promises';
import {join,posix} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function archiveDirectory(root,{prefix,out,url,cache}){
 const files=[],chunks=[];
 async function visit(relative){
  for(const entry of (await readdir(join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   const path=join(relative,entry.name),source=join(root,path);
   if(entry.isDirectory()){await visit(path);continue;}
   const link=entry.isSymbolicLink()?await readlink(source):undefined;
   const bytes=link===undefined?await readFile(source):Buffer.from(link);
   const mode=(((await lstat(source)).mode&0o111)||/\.exe$/i.test(path))?0o700:0o600;
   files.push({path:posix.join(prefix,path.split('\\').join('/')),size:bytes.length,sha256:hash(bytes),mode,...(link!==undefined?{link}:{})});chunks.push(bytes);
  }
 }
 await visit('');
 // Optional build-only cache: source content/modes/links determine identity. A stale
 // or corrupt entry is a miss; runtime download verification remains unchanged.
 const fingerprint=hash(JSON.stringify(files));
 let compressed;
 if(cache)try{
  const saved=JSON.parse(await readFile(join(cache,'archive.json'),'utf8'));
  if(saved.fingerprint===fingerprint){
   const bytes=await readFile(join(cache,'archive.gz'));
   if(hash(bytes)===saved.sha256)compressed=bytes;
  }
 }catch{/* A cache is never required to build. */}
 if(!compressed){
  compressed=gzipSync(Buffer.concat(chunks),{level:9});
  if(cache)try{
   await mkdir(cache,{recursive:true});
   await writeFile(join(cache,'archive.gz'),compressed);
   await writeFile(join(cache,'archive.json'),JSON.stringify({fingerprint,sha256:hash(compressed)}));
  }catch{/* Read-only/unavailable caches still produce the complete artifact. */}
 }
 await writeFile(out,compressed);
 return {url,sha256:hash(compressed),files};
}
