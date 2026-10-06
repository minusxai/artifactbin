/** CI-only cache of npm's integrity-verified download blobs. No installed package,
 * native build, HOME, Chromium or _npx tree crosses consumer workspaces. */
import {createHash} from 'node:crypto';
import {cp,lstat,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import {execFile,execFileSync} from 'node:child_process';
import {readFileSync,appendFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {availableParallelism} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
/** Universal public seed archives depend on the pinned graph, not the candidate version or Node ABI. */
export function npmPlatformSeedCacheKey(lockText){
 const lock=JSON.parse(lockText);
 if(lock.name!=='@afbin/cli'||!lock.packages?.[''])throw Error('Expected the CLI consumer shrinkwrap');
 delete lock.version;delete lock.packages[''].version;
 return 'npm-platform-seeds-v1-'+createHash('sha256').update(JSON.stringify(lock)).digest('hex');
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
  const name=new URL(dependency.resolved).pathname.split('/-/')[0].slice(1);
  dependencies.set(dependency.resolved,{resolved:dependency.resolved,integrity:dependency.integrity,...(dependency.version?{spec:name+'@'+dependency.version}:{})});
 }
 if(!dependencies.size)throw Error('Empty npm seed dependency graph refused');
 return [...dependencies.values()];
}
export function npmSupportedSeedDependencies(lockText){
 return [...new Map(seedPlatforms.flatMap(([, ,os,cpu])=>npmSeedDependencies(lockText,{os,cpu})).map(dependency=>[dependency.resolved,dependency])).values()];
}
/** npm's hoister reads public packuments even when a nested shrinkwrap pins every tarball. */
function seedPackageName(resolved){
 const match=new URL(resolved).pathname.match(/^\/(.+)\/-\/[^/]+$/);
 return match?decodeURIComponent(match[1]):null;
}
export function npmSeedRequest({resolved}){
 const name=seedPackageName(resolved),file=decodeURIComponent(new URL(resolved).pathname.split('/').at(-1));
 const prefix=name?.split('/').at(-1)+'-';
 if(!name||!file.startsWith(prefix)||!file.endsWith('.tgz'))throw Error('Expected a standard public npm tarball');
 return name+'@'+file.slice(prefix.length,-4);
}
// npm cache add also stores a pacote alias for the same pinned public tarball.
function npmCacheUrl(key){
 const request=key?.match(/^make-fetch-happen:request-cache:(https:\/\/.*)$/)?.[1];
 if(request)return request;
 const alias=key?.match(/^pacote:tarball:((?:@[^/]+\/)?[^@/]+)@([^/]+)$/);
 if(!alias)return null;
 const [,name,version]=alias;
 return `https://registry.npmjs.org/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
}
function seedContainsUrl(url,dependencies){
 if(dependencies.some(dependency=>dependency.resolved===url))return true;
 const name=decodeURIComponent(new URL(url).pathname.slice(1));
 return dependencies.some(dependency=>seedPackageName(dependency.resolved)===name);
}
export async function populateNpmSeed(dependencies,directory,run){
 directory=resolve(directory);
 await mkdir(directory,{recursive:true});
 const userconfig=join(directory,'user.npmrc'),globalconfig=join(directory,'global.npmrc');
 await writeFile(userconfig,'');await writeFile(globalconfig,'');
 const invoke=run??(args=>new Promise((resolve,reject)=>execFile('npm',args,{cwd:directory,env:{PATH:process.env.PATH,HOME:directory}},error=>error?reject(error):resolve())));
 // Cache manifests with npm view and pinned bodies with cache add URL. Cache add
 // name@version creates pacote aliases without a public URL; those do not belong
 // in the strictly public seed. Both commands use npm's own cache writer.
 const options=['--cache',directory,'--userconfig',userconfig,'--globalconfig',globalconfig,'--ignore-scripts','--no-audit','--no-fund'];
 for(let offset=0;offset<dependencies.length;offset+=8){
  const batch=dependencies.slice(offset,offset+8);
  await Promise.all(batch.map(d=>invoke(['view',d.spec??npmSeedRequest(d),'--json',...options])));
  await invoke(['cache','add',...batch.map(d=>d.resolved),...options]);
 }
}
export async function assertPublicNpmCache(directory,dependencies){
 const expected=dependencies&&new Map(dependencies.map(d=>[d.resolved,d.integrity])),seen=new Set();
 const manifestNames=new Set((dependencies??[]).filter(d=>d.spec).map(d=>d.spec.slice(0,d.spec.lastIndexOf('@')))),seenManifests=new Set();
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
    const url=npmCacheUrl(record.key);
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
   if(expected.has(url)){
    if(expected.get(url)!==integrity)throw Error('Npm seed integrity differs from consumer shrinkwrap');
    seen.add(url);
   }else {
    if(!seedContainsUrl(url,dependencies))throw Error('Npm seed contains a dependency outside the consumer shrinkwrap');
    const name=decodeURIComponent(new URL(url).pathname.slice(1));
    if(manifestNames.has(name))seenManifests.add(name);
   }
  }
  records++;
 }
 if(!records)throw Error('Empty public npm seed refused');
 if(expected&&seen.size!==expected.size)throw Error('Incomplete npm seed');
 if(seenManifests.size!==manifestNames.size)throw Error('Incomplete npm seed manifests');
 return records;
}
/** Inspect archive paths and entry types before tar is allowed to write into a consumer cache. */
function inspectNpmSeedArchive(archive){
 const options={encoding:'utf8',maxBuffer:64*1024*1024};
 const names=execFileSync('tar',['-tf',archive],options).split(/\r?\n/).filter(Boolean);
 const details=execFileSync('tar',['-tvf',archive],options).split(/\r?\n/).filter(Boolean);
 if(!names.length||names.length!==details.length)throw Error('Invalid npm seed archive listing');
 const seen=new Set();let root=false;
 for(let index=0;index<names.length;index++){
  const name=names[index],detail=details[index],kind=detail[0];
  if(kind!=='d'&&kind!=='-')throw Error('Npm seed archive contains a link or unsupported entry');
  const normalized=name.endsWith('/')?name.slice(0,-1):name;
  const parts=normalized.split('/');
  if(name.includes('\\')||normalized.startsWith('/')||parts[0]!=='_cacache'||parts.some(part=>part===''||part==='.'||part==='..'||!/^[A-Za-z0-9._-]+$/.test(part)))
   throw Error('Npm seed archive path refused');
  if(parts.length===2&&parts[1]==='_lastverified'){
   if(kind!=='-'||name.endsWith('/'))throw Error('Npm seed cache marker must be a regular file');
  }else if(parts.length>1&&!['content-v2','index-v5','tmp'].includes(parts[1]))throw Error('Unexpected npm seed cache tree');
  if((kind==='d')!==name.endsWith('/'))throw Error('Npm seed archive entry type mismatch');
  if(seen.has(normalized))throw Error('Duplicate npm seed archive path refused');
  seen.add(normalized);if(normalized==='_cacache'&&kind==='d')root=true;
 }
 if(!root)throw Error('Npm seed archive has no cache root');
}
/** Extract a public seed once, directly into one fresh consumer-owned npm cache. */
export async function extractValidatedNpmSeed(archive,destination,lockText,{os,cpu}={}){
 const platform=seedPlatforms.find(([, ,supportedOs,supportedCpu])=>supportedOs===os&&supportedCpu===cpu);
 if(!platform)throw Error('Unsupported npm seed platform');
 const dependencies=npmSeedDependencies(lockText,{os,cpu});
 archive=resolve(archive);destination=resolve(destination);
 const inspectStart=performance.now();inspectNpmSeedArchive(archive);const inspectMs=Math.round(performance.now()-inspectStart);
 await mkdir(dirname(destination),{recursive:true});
 try{await lstat(destination);throw Error('Npm seed destination must be a fresh empty cache');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 await mkdir(destination);
 const extractStart=performance.now();
 try{
  execFileSync('tar',['-xf',archive,'-C',destination],{stdio:'ignore'});
  const extractMs=Math.round(performance.now()-extractStart);
  const validateStart=performance.now(),records=await assertPublicNpmCache(destination,dependencies),validateMs=Math.round(performance.now()-validateStart);
  return {records,phases:{inspectMs,extractMs,validateMs}};
 }catch(error){await rm(destination,{recursive:true,force:true});throw error;}
}
export async function packPlatformNpmSeeds(source,output,lockText,{concurrency=Math.min(3,availableParallelism()),run}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw Error('Expected one to three seed packing workers');
 const invoke=run??((command,args)=>new Promise((resolve,reject)=>execFile(command,args,error=>error?reject(error):resolve())));
 await assertPublicNpmCache(source);
 // Use the producing npm's own cache API. CLI cache clean deletes shared content
 // and stops at the first missing alias, so it cannot safely prune platform entries.
 const npmRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
 const cacache=createRequire(join(npmRoot,'npm','package.json'))('cacache');
 await mkdir(output,{recursive:true});
 const records=[];
 const visit=async path=>{for(const entry of await readdir(path,{withFileTypes:true})){
  const file=join(path,entry.name);if(entry.isDirectory())await visit(file);
  else for(const line of (await readFile(file,'utf8')).split('\n').filter(Boolean))records.push(JSON.parse(line.slice(line.indexOf('\t')+1)));
 }};
 await visit(join(source,'_cacache','index-v5'));
 const pack=async([runnerOs,runnerArch,os,cpu])=>{
  const dependencies=npmSeedDependencies(lockText,{os,cpu});
  const stage=join(output,`${runnerOs}-${runnerArch}`);await mergeNpmDependencyCache(source,stage);
  const excluded=records.filter(record=>!seedContainsUrl(npmCacheUrl(record.key),dependencies)).map(record=>record.key);
  // Remove only index entries; npm verify collects blobs after remaining references are known.
  await Promise.all([...new Set(excluded)].map(key=>cacache.rm.entry(join(stage,'_cacache'),key)));
  await invoke('npm',['cache','verify','--cache',stage]);
  const count=await assertPublicNpmCache(stage,dependencies);
  const archive=join(output,`npm-dependency-seed-${runnerOs}-${runnerArch}.tar`);
  await invoke('tar',['-cf',archive,'-C',stage,'_cacache']);
  console.log(`Public npm seed ${runnerOs}/${runnerArch}: ${count} verified records; ${readFileSync(archive).length} bytes`);
 };
 // Independent stages never share mutable npm content. Bound concurrent child
 // processes to the runner's CPU capacity instead of blocking five times in turn.
 for(let offset=0;offset<seedPlatforms.length;offset+=concurrency)await Promise.all(seedPlatforms.slice(offset,offset+concurrency).map(pack));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [first,second,third,fourth,fifth]=process.argv.slice(2);
 if(first==='seed-key'){
  appendFileSync(second,`key=${npmPlatformSeedCacheKey(readFileSync(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8'))}\n`);
 }else if(first==='prepare-seed'){
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
  const platform=seedPlatforms.find(([os,arch])=>os===fourth&&arch===fifth);
  if(!platform)throw Error('Pass supported runner OS and architecture for the npm seed');
  const lockText=readFileSync(new URL('../../services/cli/npm-shrinkwrap.json',import.meta.url),'utf8');
  const result=await extractValidatedNpmSeed(second,third,lockText,{os:platform[2],cpu:platform[3]});
  console.log(`Prepared verified npm seed: ${JSON.stringify(result.phases)} ms`);
}else{
  throw Error('Expected seed-key, prepare-seed, pack-seeds, pack-seed or merge-seed');
 }
}
