/** Prepare a gate-compatible snapshot from a real disposable import, never fixture markup. */
import {PGlite} from '@electric-sql/pglite';
import {mkdir,readFile,writeFile,readdir,lstat,cp,chmod} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {preparedPilotStoreDigest} from './native-prepared-pilot-store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const safe=name=>typeof name==='string'&&!path.isAbsolute(name)&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
/** Caller supplies the real DB dump, selected reader, assembly bytes, object sink and optional disposable auth key. */
export async function prepareNativeMigrationSnapshot({databaseDump,reader,assembly,history,objectsDirectory,outputDirectory,fixtureAuthSecret}){
 const head=history?.revisions?.find(revision=>revision.page.version===history.headVersion);
 if(!head||history.revisions.length!==1||history.pageId!==reader.pageId||history.headVersion!==reader.version||history.sourceId!==assembly.key?.sourceId||history.sourceNamespace!==assembly.key?.sourceNamespace)throw Error('native-snapshot-history-binding');
 if(assembly.result?.status!=='complete'||assembly.key?.version!==reader.version||!reader.pageId||!reader.accountEmail||!/^[a-f0-9]{64}$/.test(reader.identityPlanSha256))throw Error('native-snapshot-input');
 const bundle=path.join(outputDirectory,'bundle'),store=path.join(bundle,'prepared-store');
 // Exclusive creation prevents cross-page state reuse and overwriting an earlier snapshot.
 await mkdir(outputDirectory,{recursive:true,mode:0o700});await mkdir(bundle,{mode:0o700});await mkdir(store,{mode:0o700});
 const database=new PGlite(path.join(store,'database'),{loadDataDir:new Blob([databaseDump])});
 try{await database.waitReady;const rows=(await database.query('SELECT version,source,user_id,token_id FROM artifacts WHERE id=$1',[reader.pageId])).rows;if(rows.length!==1||rows[0].version!==reader.version||rows[0].source!==head.page.html||rows[0].user_id!==history.owner.userId||rows[0].token_id!==history.owner.tokenId)throw Error('native-snapshot-readback');}finally{await database.close();}
 const assertTree=async directory=>{for(const name of await readdir(directory)){const full=path.join(directory,name),stat=await lstat(full);if(stat.isSymbolicLink()||!stat.isDirectory()&&!stat.isFile())throw Error('native-snapshot-object-type');if(stat.isDirectory())await assertTree(full);}};
 if((await lstat(objectsDirectory)).isSymbolicLink())throw Error('native-snapshot-object-type');await assertTree(objectsDirectory);await cp(objectsDirectory,path.join(store,'objects'),{recursive:true,errorOnExist:true,force:false});
 const files=[],directories=[];
 const walk=async(directory,prefix)=>{directories.push(prefix);for(const name of (await readdir(directory)).sort()){const full=path.join(directory,name),relative=prefix+'/'+name,stat=await lstat(full);if(stat.isSymbolicLink())throw Error('native-snapshot-symlink');if(stat.isDirectory())await walk(full,relative);else if(stat.isFile()){const bytes=await readFile(full);await chmod(full,0o600);files.push({path:relative,sha256:sha(bytes),bytes:bytes.length});}else throw Error('native-snapshot-file-type');}};
 await walk(path.join(store,'database'),'database');await walk(path.join(store,'objects'),'objects');
 const payload={format:'native-prepared-store-v1',directory:'prepared-store',directories,files,reader};
 if(fixtureAuthSecret!==undefined){const bytes=Buffer.from(fixtureAuthSecret);if(bytes.length<16)throw Error('native-snapshot-auth-key');await writeFile(path.join(store,'fixture-auth-secret'),bytes,{flag:'wx',mode:0o600});payload.fixtureAuthSecret={path:'fixture-auth-secret',sha256:sha(bytes),bytes:bytes.length,provenance:'disposable-target-test-key'};}
 const preparedStore={...payload,sha256:preparedPilotStoreDigest(payload)},bundleFiles=[];
 for(const file of [{path:'index.html',bytes:Buffer.from(assembly.result.html),sha256:assembly.result.htmlSha256},...assembly.result.files]){
  if(!safe(file.path)||file.path==='prepared-store'||file.path.startsWith('prepared-store/'))throw Error('native-snapshot-bundle-path');
  const bytes=Buffer.isBuffer(file.bytes)?file.bytes:Buffer.from(file.bytes?.data??file.bytes);if(sha(bytes)!==file.sha256)throw Error('native-snapshot-bundle-digest');
  const target=path.join(bundle,file.path);await mkdir(path.dirname(target),{recursive:true,mode:0o700});await writeFile(target,bytes,{flag:'wx',mode:0o600});bundleFiles.push({path:file.path,sha256:file.sha256});
 }
 const preparedStorePath=path.join(outputDirectory,'prepared-store.json');await writeFile(preparedStorePath,JSON.stringify(preparedStore),{flag:'wx',mode:0o600});
 return {preparedStorePath,bundleDirectory:bundle,preparedStore,bundleFiles};
}
