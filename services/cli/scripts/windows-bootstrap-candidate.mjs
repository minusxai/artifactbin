/** Reuse the exact npm-owned install produced by the first candidate npx query.
 * Inspect slot metadata only; never search dependencies for executable candidates. */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const unavailable=()=>Error('bootstrap_candidate_unavailable');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
async function ordinary(path,directory=false){try{const item=await lstat(path);return directory?item.isDirectory()&&!item.isSymbolicLink():item.isFile()&&!item.isSymbolicLink();}catch{return false;}}
async function metadata(path){if(!await ordinary(path))return undefined;try{if((await lstat(path)).size>1024*1024)return undefined;return JSON.parse(await readFile(path,'utf8'));}catch{return undefined;}}
export async function resolveBootstrapCandidate(cache,tarball,version){
 if(typeof cache!=='string'||typeof tarball!=='string'||typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))throw unavailable();
 cache=resolve(cache);tarball=resolve(tarball);
 const slots=join(cache,'_npx');
 if(!await ordinary(cache,true)||!await ordinary(slots,true)||!await ordinary(tarball))throw unavailable();
 const digest=createHash('sha512');try{for await(const bytes of createReadStream(tarball))digest.update(bytes);}catch{throw unavailable();}
 const integrity='sha512-'+digest.digest('base64'),matches=[];
 let entries;try{entries=await readdir(slots,{withFileTypes:true});}catch{throw unavailable();}
 for(const slot of entries){
  if(!slot.isDirectory()||slot.isSymbolicLink())continue;
  const base=join(slots,slot.name),modules=join(base,'node_modules'),scope=join(modules,'@afbin'),pkg=join(scope,'cli'),dist=join(pkg,'dist');
  if(!(await Promise.all([base,modules,scope,pkg,dist].map(path=>ordinary(path,true)))).every(Boolean))continue;
  const [manifest,lock]=await Promise.all([metadata(join(pkg,'package.json')),metadata(join(base,'package-lock.json'))]);
  const locked=object(lock?.packages)?lock.packages['node_modules/@afbin/cli']:undefined;
  if(!object(manifest)||manifest.name!=='@afbin/cli'||manifest.version!==version||!object(manifest.bin)||manifest.bin.afbin!=='dist/afbin.mjs'||!object(locked)||locked.version!==version||locked.integrity!==integrity)continue;
  const entry=join(dist,'afbin.mjs');if(await ordinary(entry))matches.push(entry);
 }
 if(matches.length!==1)throw Error(matches.length?'bootstrap_candidate_ambiguous':'bootstrap_candidate_unavailable');
 return matches[0];
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{if(process.argv.length!==5)throw unavailable();process.stdout.write(await resolveBootstrapCandidate(...process.argv.slice(2))+'\n');}
 catch{process.stderr.write('bootstrap_candidate_unavailable\n');process.exitCode=1;}
}
