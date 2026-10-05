/** Identify the sole genuinely cold npx install before reusing it without tarball reification. */
import {readFile,readdir,access,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
export async function findWarmedNpxConsumer(cache,expected){
 const entries=(await readdir(join(cache,'_npx'),{withFileTypes:true})).filter(entry=>entry.isDirectory());
 if(entries.length!==1)throw Error('Expected exactly one fresh npx consumer');
 const directory=join(cache,'_npx',entries[0].name);
 const manifest=JSON.parse(await readFile(join(directory,'node_modules/@afbin/cli/package.json'),'utf8'));
 if(manifest.name!=='@afbin/cli'||manifest.version!==expected.version)throw Error('Warmed candidate version does not match this release');
 const lock=JSON.parse(await readFile(join(directory,'node_modules/.package-lock.json'),'utf8'));
 const installed=await realpath(join(directory,'node_modules/@afbin/cli'));
 const receipts=[];
 for(const [path,candidate] of Object.entries(lock.packages??{})){
  if(!path.replaceAll('\\','/').endsWith('node_modules/@afbin/cli'))continue;
  if(await realpath(resolve(directory,path))===installed)receipts.push(candidate);
 }
 if(receipts.length!==1||receipts[0].version!==expected.version||receipts[0].integrity!==expected.integrity)throw Error('Warmed candidate integrity does not match the exact tarball');
 await access(join(directory,'node_modules/@afbin/cli/dist/afbin.mjs'));
 return {directory,version:manifest.version};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const expected=JSON.parse(await readFile(process.argv[4],'utf8'));
 const integrity='sha512-'+createHash('sha512').update(await readFile(process.argv[3])).digest('base64');
 console.log(JSON.stringify(await findWarmedNpxConsumer(process.argv[2],{version:expected.version,integrity})));
}
