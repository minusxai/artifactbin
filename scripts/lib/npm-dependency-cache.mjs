/** CI-only cache of npm's integrity-verified download blobs. No installed package,
 * native build, HOME, Chromium or _npx tree crosses consumer workspaces. */
import {createHash} from 'node:crypto';
import {cp,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {execFile,execFileSync} from 'node:child_process';
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
const publicUrl=value=>{try{const url=new URL(value);return url.origin==='https://registry.npmjs.org'&&!url.username&&!url.password&&!url.search&&!url.hash;}catch{return false;}};
const seedPlatforms=[['Linux','X64','linux','x64'],['Linux','ARM64','linux','arm64'],['macOS','X64','darwin','x64'],['macOS','ARM64','darwin','arm64'],['Windows','X64','win32','x64']];
const supports=(values,target)=>!values||!target||(!values.includes('!'+target)&&(values.includes(target)||values.includes('any')||values.every(value=>value.startsWith('!'))));
export function npmSeedDependencies(lockText,{os,cpu}={}){
 const lock=JSON.parse(lockText),dependencies=new Map();
 for(const [path,dependency] of Object.entries(lock.packages??{})){
  if(!path||!supports(dependency.os,os)||!supports(dependency.cpu,cpu))continue;
  if(!publicUrl(dependency.resolved)||!dependency.integrity)throw Error('Expected pinned public registry dependency');
  dependencies.set(dependency.resolved,{resolved:dependency.resolved,integrity:dependency.integrity});
 }
 if(!dependencies.size)throw Error('Empty npm seed dependency graph refused');
 return [...dependencies.values()];
}
export function npmSupportedSeedDependencies(lockText){
 return [...new Map(seedPlatforms.flatMap(([, ,os,cpu])=>npmSeedDependencies(lockText,{os,cpu})).map(dependency=>[dependency.resolved,dependency])).values()];
}
export async function populateNpmSeed(dependencies,directory,run){
 await mkdir(directory,{recursive:true});
 const userconfig=join(directory,'user.npmrc'),globalconfig=join(directory,'global.npmrc');
 await writeFile(userconfig,'');await writeFile(globalconfig,'');
 const invoke=run??(args=>new Promise((resolve,reject)=>execFile('npm',args,{cwd:directory,env:{PATH:process.env.PATH,HOME:directory}},error=>error?reject(error):resolve())));
 // npm cache add downloads its arguments concurrently. Bound each batch to eight,
 // including optional native dependencies for every target platform; never install.
 for(let offset=0;offset<dependencies.length;offset+=8){
  await invoke(['cache','add',...dependencies.slice(offset,offset+8).map(d=>d.resolved),'--cache',directory,'--userconfig',userconfig,'--globalconfig',globalconfig,'--ignore-scripts','--no-audit','--no-fund']);
 }
}
export async function assertPublicNpmCache(directory,dependencies){
 const expected=dependencies&&new Map(dependencies.map(d=>[d.resolved,d.integrity])),seen=new Set();
 const check=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
   if(/^(authorization|proxy-authorization|cookie|set-cookie|_auth|_authToken|password|token|credentials)$/i.test(key))throw Error('Credential-bearing npm seed metadata refused');
   if(key==='url'&&!publicUrl(item))throw Error('Non-public registry npm seed metadata refused');
   check(item);
  }
 };
 const latest=new Map();
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
    check(record.metadata);
    latest.set(record.key,{url,integrity:record.integrity});
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
 // npm appends tombstones when removing entries; validate all historical metadata,
 // but only the current live entry describes content that consumers can retrieve.
 for(const {url,integrity} of latest.values()){
  if(!integrity)continue;
  if(expected){
   if(expected.get(url)!==integrity)throw Error('Npm seed integrity differs from consumer shrinkwrap');
   seen.add(url);
  }
  records++;
 }
 if(!records)throw Error('Empty public npm seed refused');
 if(expected&&seen.size!==expected.size)throw Error('Incomplete npm seed');
 return records;
}
export async function packPlatformNpmSeeds(source,output,lockText){
 await assertPublicNpmCache(source);
 await mkdir(output,{recursive:true});
 const records=[];
 const visit=async path=>{for(const entry of await readdir(path,{withFileTypes:true})){
  const file=join(path,entry.name);if(entry.isDirectory())await visit(file);
  else for(const line of (await readFile(file,'utf8')).split('\n').filter(Boolean))records.push(JSON.parse(line.slice(line.indexOf('\t')+1)));
 }};
 await visit(join(source,'_cacache','index-v5'));
 for(const [runnerOs,runnerArch,os,cpu] of seedPlatforms){
  const dependencies=npmSeedDependencies(lockText,{os,cpu}),urls=new Set(dependencies.map(d=>d.resolved));
  const stage=join(output,`${runnerOs}-${runnerArch}`);await mergeNpmDependencyCache(source,stage);
  const excluded=records.filter(record=>!urls.has(record.key.match(/https:\/\/.*$/)?.[0])).map(record=>record.key);
  // npm removes its own index entries; verify then collects unreferenced blobs.
  // We never synthesize npm metadata or mutate shared content objects.
  for(let offset=0;offset<excluded.length;offset+=100)execFileSync('npm',['cache','clean',...excluded.slice(offset,offset+100),'--cache',stage,'--force'],{stdio:'pipe'});
  execFileSync('npm',['cache','verify','--cache',stage],{stdio:'pipe'});
  const count=await assertPublicNpmCache(stage,dependencies);
  const archive=join(output,`npm-dependency-seed-${runnerOs}-${runnerArch}.tar`);
  execFileSync('tar',['-cf',archive,'-C',stage,'_cacache']);
  console.log(`Public npm seed ${runnerOs}/${runnerArch}: ${count} verified records; ${readFileSync(archive).length} bytes`);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [first,second,third,fourth]=process.argv.slice(2);
 if(first==='prepare-seed'){
  const dependencies=npmSupportedSeedDependencies(readFileSync(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8'));
  const start=Date.now();await populateNpmSeed(dependencies,second);
  // Check every actual cached tarball against the consumer shrinkwrap, including
  // npm's multiple index records for the same URL; npm owns blob verification.
  await assertPublicNpmCache(second,dependencies);
  execFileSync('npm',['cache','verify','--cache',second],{stdio:'inherit'});
  console.log(`Prepared ${dependencies.length} pinned public tarballs in ${Date.now()-start}ms`);
 }else if(first==='pack-seeds'){
  await packPlatformNpmSeeds(second,third,readFileSync(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8'));
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
