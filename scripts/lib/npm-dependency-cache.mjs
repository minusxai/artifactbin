/** CI-only cache of npm's integrity-verified download blobs. No installed package,
 * native build, HOME, Chromium or _npx tree crosses consumer workspaces. */
import {createHash} from 'node:crypto';
import {cp,mkdir,readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export function npmDependencyCacheKey(lockText,{os,arch,node}){
 const lock=JSON.parse(lockText);
 if(lock.name!=='@afbin/cli'||!lock.packages?.[''])throw Error('Expected the CLI consumer shrinkwrap');
 delete lock.version;delete lock.packages[''].version;
 const digest=createHash('sha256').update(JSON.stringify(lock)).digest('hex');
 return `npm-dependencies-v1-${os}-${arch}-node${node}-${digest}`;
}
export async function mergeNpmDependencyCache(source,destination,{overwrite=true}={}){
 try {
  await mkdir(destination,{recursive:true});
  await cp(join(source,'_cacache'),join(destination,'_cacache'),{recursive:true,force:overwrite});
  return true;
 }catch(error){if(error.code==='ENOENT')return false;throw error;}
}
export function selectNpmSeedCache(records){
 return records.filter(record=>record.ref==='refs/heads/main'&&record.key.startsWith('node-cache-Linux-x64-npm-')&&record.sizeInBytes>1024*1024).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]?.key??'';
}
export async function assertPublicNpmCache(directory){
 const publicUrl=value=>{try{const url=new URL(value);return url.origin==='https://registry.npmjs.org'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};
 const check=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
   if(/^(authorization|proxy-authorization|cookie|set-cookie|_auth|_authToken|password|token|credentials)$/i.test(key))throw Error('Credential-bearing npm seed metadata refused');
   if(key==='url'&&!publicUrl(item))throw Error('Non-public registry npm seed metadata refused');
   check(item);
  }
 };
 let records=0;
 const visit=async path=>{
  for(const entry of await readdir(path,{withFileTypes:true})){
   const file=join(path,entry.name);
   if(entry.isSymbolicLink())throw Error('Symlink npm seed metadata refused');
   if(entry.isDirectory())await visit(file);
   else for(const line of (await readFile(file,'utf8')).split('\n').filter(Boolean)){
    const record=JSON.parse(line.slice(line.indexOf('\t')+1));
    const url=record.key?.match(/https:\/\/.*$/)?.[0];
    if(!publicUrl(url))throw Error('Non-public registry npm seed key refused');
    check(record.metadata);records++;
   }
  }
 };
 const rejectLinks=async path=>{
  for(const entry of await readdir(path,{withFileTypes:true})){
   if(entry.isSymbolicLink())throw Error('Symlink npm seed refused');
   if(entry.isDirectory())await rejectLinks(join(path,entry.name));
  }
 };
 await rejectLinks(join(directory,'_cacache'));
 await visit(join(directory,'_cacache','index-v5'));
 if(!records)throw Error('Empty public npm seed refused');
 return records;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [first,second,third,fourth]=process.argv.slice(2);
 if(first==='seed-key'){
  const records=JSON.parse(execFileSync('gh',['cache','list','--repo',second,'--limit','1000','--json','key,ref,createdAt,sizeInBytes'],{encoding:'utf8'}));
  appendFileSync(third,`seed-key=${selectNpmSeedCache(records)}\n`);
 }else if(first==='pack-seed'){
  const records=await assertPublicNpmCache(second);
  execFileSync('tar',['-cf',third,'-C',second,'_cacache']);
  console.log(`Public npm download seed: ${records} registry records; ${readFileSync(third).length} bytes`);
 }else if(first==='merge-seed'){
  await mkdir(third,{recursive:true});
  const stage=third+'.seed';await mkdir(stage,{recursive:true});
  execFileSync('tar',['-xf',second,'-C',stage]);
  await assertPublicNpmCache(stage);
  await mergeNpmDependencyCache(stage,third,{overwrite:false});
 }else{
  const key=npmDependencyCacheKey(readFileSync(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8'),{os:first,arch:second,node:third});
  appendFileSync(fourth,`key=${key}\n`);
 }
}
