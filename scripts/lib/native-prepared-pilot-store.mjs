/** Digest-bound actual import stores enter only a disposable gate scratch copy. */
import {createHash} from 'node:crypto';
import {readFile,lstat,readdir,mkdir,writeFile,realpath} from 'node:fs/promises';
import path from 'node:path';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const preparedPilotStoreDigest=value=>sha(JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v));
const fail=()=>Error('native-prepared-pilot-store-invalid');
const safe=name=>typeof name==='string'&&/^(?:database|objects)\/[A-Za-z0-9_.\/-]+$/.test(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..');
/** @returns {Promise<undefined|{databaseUrl:string,objects:string,reader:import('./native-migration-pilot-contract').NativePreparedPilotStore['reader'],sha256:string,authSecret?:string}>} */
export async function prepareImportedPilotStore({inputPath,bundle,scratch}){
 const input=JSON.parse(await readFile(inputPath,'utf8')),store=input.preparedStore;
 if(store===undefined)return;
 const {sha256,...payload}=store,reader=store.reader;
 if(store.format!=='native-prepared-store-v1'||store.directory!=='prepared-store'||preparedPilotStoreDigest(payload)!==sha256||!Array.isArray(store.files)||!store.files.length||!Array.isArray(store.directories)||!reader||!/^[A-Za-z0-9]{6,128}$/.test(reader.pageId)||!Number.isSafeInteger(reader.version)||reader.version<1||typeof reader.accountEmail!=='string'||!reader.accountEmail.includes('@')||!Array.isArray(reader.datasetIds)||reader.datasetIds.some(id=>!/^[A-Za-z0-9]{6,128}$/.test(id))||!/^[a-f0-9]{64}$/.test(reader.identityPlanSha256))throw fail();
 const directories=new Set();for(const name of store.directories){if(!safe(name+'/entry')||directories.has(name))throw fail();directories.add(name);}
 if(!directories.has('database')||!directories.has('objects'))throw fail();
 const names=new Set();for(const file of store.files){if(!safe(file.path)||names.has(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.bytes)||file.bytes<0)throw fail();names.add(file.path);}
 const key=store.fixtureAuthSecret;if(key){if(key.path!=='fixture-auth-secret'||key.provenance!=='disposable-target-test-key'||!/^[a-f0-9]{64}$/.test(key.sha256)||!Number.isSafeInteger(key.bytes)||key.bytes<16)throw fail();names.add(key.path);}
 if(!names.has('database/PG_VERSION'))throw fail();
 const base=path.resolve(bundle,store.directory);if((await lstat(base)).isSymbolicLink()||!((await lstat(base)).isDirectory()))throw fail();
 const actual=[],actualDirectories=[];const walk=async(dir,prefix='')=>{for(const name of await readdir(dir)){const relative=prefix+name,full=path.join(dir,name),stat=await lstat(full);if(stat.isSymbolicLink())throw fail();if(stat.isDirectory()){actualDirectories.push(relative);await walk(full,relative+'/');}else if(stat.isFile())actual.push(relative);else throw fail();}};await walk(base);
 if(actualDirectories.length!==directories.size||actualDirectories.some(name=>!directories.has(name)))throw fail();
 if(actual.length!==names.size||actual.some(name=>!names.has(name)))throw fail();
 const sourceRoot=await realpath(base);const check=async file=>{const full=await realpath(path.join(base,file.path));if(!full.startsWith(sourceRoot+path.sep))throw fail();const bytes=await readFile(full);if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw fail();return bytes;};
 // Check the final receipt before writing any prefix or booting a server.
 for(const file of store.files)await check(file);
 const authSecret=key?(await check(key)).toString('utf8'):undefined;
 const destination=path.resolve(scratch);if(destination===sourceRoot||destination.startsWith(sourceRoot+path.sep)||sourceRoot.startsWith(destination+path.sep))throw fail();
 await mkdir(destination,{recursive:true,mode:0o700});
 for(const directory of directories)await mkdir(path.join(destination,directory),{recursive:true,mode:0o700});
 for(const file of store.files){const target=path.join(destination,file.path);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,await check(file),{flag:'wx',mode:0o600});}
 return {databaseUrl:'pglite://'+path.join(destination,'database'),objects:path.join(destination,'objects'),reader,sha256,...(authSecret?{authSecret}: {})};
}
