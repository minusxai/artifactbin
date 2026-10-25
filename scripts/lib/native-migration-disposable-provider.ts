/** Actual reusable local lifecycle. Runtime product imports MUST follow the isolated environment setup below. */
import {readFile,writeFile,mkdir,lstat,realpath,rm} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {NativeIdentityImport} from '../../services/app/lib/native-identity-import/contracts';
import type {NativeDisposableLifecycleConfiguration,NativeDisposableAdapterConfiguration,NativeDisposableRequest,NativeDisposableContext,NativeDisposableFile,NativeDisposableLifecycle} from './native-migration-disposable-provider-contract';
const execute=promisify(execFile),sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const digest=(value:unknown)=>sha(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item));
let opened=false;
async function contained(root:string,relative:string){
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw Error('native_disposable_path');
 const base=await realpath(root);let current=base;
 for(const part of relative.split('/')){current=path.join(current,part);if((await lstat(current)).isSymbolicLink())throw Error('native_disposable_symlink');}
 const resolved=await realpath(current);if(!resolved.startsWith(base+path.sep))throw Error('native_disposable_path');return resolved;
}
async function checked(root:string,reference:NativeDisposableFile){const file=await contained(root,reference.path),bytes=await readFile(file);if(sha(bytes)!==reference.sha256)throw Error('native_disposable_file_digest');return {file,bytes};}
async function revision(root:string,expected:string){if(!/^[a-f0-9]{40}$/.test(expected)||(await execute('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim()!==expected)throw Error('native_disposable_revision');}
function localOrigin(raw:string){const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(url.hostname)&&!url.hostname.endsWith('.lvh.me')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('native_disposable_origin');return url.origin;}
/** One selected head per standard CLI process: configuration and the actual getDb cache are process-global. */
export async function openNativePipelineLifecycle(request:NativeDisposableRequest,context:NativeDisposableContext,rawConfiguration:NativeDisposableAdapterConfiguration):Promise<NativeDisposableLifecycle>{
 const configuration=structuredClone(rawConfiguration);
 if(opened)throw Error('native_disposable_process_occupied');
 if(request.stage==='assemble'||!configuration.lifecycleConfiguration||path.resolve(request.receiptRoot)!==path.resolve(context.receiptRoot)||path.resolve(request.output)!==path.resolve(context.outputDirectory))throw Error('native_disposable_configuration');
 const reference=await checked(request.receiptRoot,configuration.lifecycleConfiguration),settings=JSON.parse(reference.bytes.toString()) as NativeDisposableLifecycleConfiguration,{sha256,...body}=settings;
 if(settings.format!=='native-disposable-lifecycle-v1'||digest(body)!==sha256||!['reviewed-target-identities','prepared-store'].includes(settings.fixture?.kind)||!['disabled','gate-container'].includes(settings.camera?.kind))throw Error('native_disposable_configuration');
 if(settings.maxFileBytes!==undefined&&(!Number.isSafeInteger(settings.maxFileBytes)||settings.maxFileBytes<1))throw Error('native_disposable_configuration');
 if(settings.fixture.kind==='reviewed-target-identities'&&(settings.fixture.schemas.appSchema!=='public'||!/^[_a-z][_a-z0-9]*$/.test(settings.fixture.schemas.authSchema)))throw Error('native_disposable_schema_scope');
 const origin=localOrigin(settings.origin),targetRoot=await realpath(configuration.targetRoot);await revision(targetRoot,configuration.targetRevision);
 if(settings.camera.kind==='gate-container'){await revision(await realpath(settings.camera.original.root),settings.camera.original.revision);if(settings.camera.cpus!==4||settings.camera.memory!=='8g')throw Error('native_disposable_camera_resources');}
 const identity=settings.fixture.kind==='reviewed-target-identities'?JSON.parse((await checked(request.receiptRoot,settings.fixture.identity)).bytes.toString()) as NativeIdentityImport:undefined;
 const snapshotInput=settings.fixture.kind==='prepared-store'?await checked(request.receiptRoot,settings.fixture.input):undefined;
 const bundle=settings.fixture.kind==='prepared-store'?await contained(request.receiptRoot,settings.fixture.bundle):undefined;
 await mkdir(context.outputDirectory,{recursive:true,mode:0o700});const outputRoot=await realpath(context.outputDirectory),storage=path.join(outputRoot,'disposable-target'),objects=path.join(storage,'objects');
 // Exclusive creation owns exactly this tree; a busy or leftover lifecycle is never reused or erased.
 await mkdir(storage,{mode:0o700});let closed=false,reset:undefined|(()=>Promise<void>);
 const cleanup=async()=>{if(closed)return;closed=true;try{await reset?.();}finally{await rm(storage,{recursive:true,force:true});}};
 try{
  let databaseUrl='pglite://'+path.join(storage,'database'),secret=randomBytes(32).toString('hex');
  if(snapshotInput&&bundle){
   // This helper verifies immutable database/object manifests before copying anything.
   const {prepareImportedPilotStore}=await import('./native-prepared-pilot-store.mjs');
   const prepared=await prepareImportedPilotStore({inputPath:snapshotInput.file,bundle,scratch:storage});if(!prepared)throw Error('native_disposable_snapshot_required');
   databaseUrl=prepared.databaseUrl;secret=prepared.authSecret??secret;
  }else await mkdir(objects,{mode:0o700});
  if((globalThis as {__artifact_bin_db__?:unknown}).__artifact_bin_db__)throw Error('native_disposable_prior_database');
  opened=true;
  // Script-owned configuration boundary. Inherited service endpoints and credentials must never choose a target.
  for(const name of Object.keys(process.env))if(/^[A-Z][A-Z0-9_]*__/.test(name)||['DATABASE_URL','S3_URL'].includes(name))delete process.env[name];
  Object.assign(process.env,{NODE_ENV:'development',DATABASE_URL:databaseUrl,OBJECT_STORE__LOCAL_DIR:objects,AUTH__SECRET:secret,APP__PUBLIC_BASE_URL:origin,APP__PAGES_HOST:'lvh.me'});
  if(settings.maxFileBytes!==undefined)process.env.FILES__MAX_BYTES=String(settings.maxFileBytes);
  // Intentional runtime imports enforce configuration-before-module initialization, including the auth package.
  const config=await import(pathToFileURL(path.join(targetRoot,'services/app/lib/platform/config.ts')).href);
  if(config.IS_TEST||config.DATABASE_URL!==databaseUrl||path.resolve(config.LOCAL_OBJECT_DIR)!==objects||config.S3_URL||config.AUTH_SECRET!==secret)throw Error('native_disposable_prior_configuration');
  const database=await import(pathToFileURL(path.join(targetRoot,'services/app/lib/platform/db.ts')).href) as typeof import('../../services/app/lib/platform/db');reset=database.resetDb;
  const db=await database.getDb(),raw=db.raw();if(raw.kind!=='pglite')throw Error('native_disposable_pglite_required');
  const auth=await import('@artifactbin/auth');
  await auth.createHumanAuth({pglite:raw.instance,secret,schema:settings.fixture.kind==='reviewed-target-identities'?settings.fixture.schemas.authSchema:'auth',baseURL:origin,mail:{send:async message=>{await mkdir(path.join(storage,'outbox'),{recursive:true,mode:0o700});await writeFile(path.join(storage,'outbox',randomBytes(16).toString('hex')+'.json'),JSON.stringify(message),{flag:'wx',mode:0o600});}}});
  if(identity&&settings.fixture.kind==='reviewed-target-identities'){
   const model=await import(pathToFileURL(path.join(targetRoot,'services/app/lib/native-identity-import/model.ts')).href) as typeof import('../../services/app/lib/native-identity-import/model');
   const imports=await import(pathToFileURL(path.join(targetRoot,'services/app/lib/native-identity-import/index.ts')).href) as typeof import('../../services/app/lib/native-identity-import');
   const proof=model.verifyNativeIdentityInput(identity),schemas=structuredClone(settings.fixture.schemas);
   await db.transaction(async tx=>{
    const authority=await imports.authorizeNativeIdentityTransaction(tx,schemas);
    // Only already-existing reviewed target accounts are fixtures. The common factory imports source identities.
    for(const id of [...new Set(identity.plan.users.filter(mapping=>mapping.action==='reuse-verified-email').map(mapping=>mapping.targetId))].sort()){
     const target=proof.targets.get(id);if(!target)throw Error('native_disposable_target_fixture');const user=model.storedUser(target);
     const keys=Object.keys(user);await tx.query(`INSERT INTO users(${keys.join(',')}) VALUES(${keys.map((_,index)=>'$'+(index+1)).join(',')})`,Object.values(user));
     if(user.kind==='account'&&user.email)await imports.provisionNativeIdentityAuthCompanion(tx,{id:user.id,email:user.email,name:user.name,provisionedAt:identity.revokedAt},authority);
    }
   });
  }
  const captureAndCompare:NativeDisposableLifecycle['captureAndCompare']=async input=>{
   if(settings.camera.kind!=='gate-container')throw Error('native_disposable_camera_disabled');
   const roots=[await realpath(settings.camera.original.root),targetRoot],revisions=[settings.camera.original.revision,configuration.targetRevision],recipes=await Promise.all([input.baselineRecipePath,input.candidateRecipePath].map(async file=>JSON.parse(await readFile(file,'utf8'))));
   for(const [index,recipe] of recipes.entries()){
    if(recipe.format!=='native-migration-camera-recipe-v1')throw Error('native_disposable_camera_recipe');
    const pilot=JSON.parse(await readFile(recipe.paths.input,'utf8'));
    if(pilot.implementation!==(index?'html':'jsx')||!isDeepStrictEqual(pilot.key,input.revision.key)||!isDeepStrictEqual(pilot.key,input.assembly.key)||input.imported.assemblySha256!==input.assembly.sha256||pilot.bundleFiles?.find((file:{path:string})=>file.path==='index.html')?.sha256!==input.assembly.result.htmlSha256)throw Error('native_disposable_camera_binding');
    await revision(roots[index]!,revisions[index]!);await mkdir(recipe.paths.output,{recursive:true,mode:0o700});
    const env={...process.env,NATIVE_MIGRATION_PILOT__INPUT:recipe.paths.input,NATIVE_MIGRATION_PILOT__CANONICAL:recipe.paths.canonical,NATIVE_MIGRATION_PILOT__RECOVERY:recipe.paths.recovery,NATIVE_MIGRATION_PILOT__BUNDLE:recipe.paths.bundle,NATIVE_MIGRATION_PILOT__OUTPUT:recipe.paths.output};
    let log='';try{const result=await execute(process.execPath,['scripts/gate-container.mjs','--cpus','4','--memory','8g','--servers','1','component-baseline'],{cwd:roots[index],env,maxBuffer:32*1024*1024});log=result.stdout+'\n'+result.stderr;}catch(error){const failure=error as {stdout?:string;stderr?:string};log=(failure.stdout??'')+'\n'+(failure.stderr??'');throw Error('native_disposable_camera_failed');}finally{await writeFile(path.join(input.outputDirectory,index?'candidate-gate.log':'baseline-gate.log'),log,{mode:0o600});}
   }
   const {compareNativeMigrationPilot}=await import('./native-migration-pilot.mjs');
   const output=path.join(input.outputDirectory,'comparison');await mkdir(output,{recursive:true,mode:0o700});
   const report=await compareNativeMigrationPilot({baselineDirectory:recipes[0].paths.output,candidateDirectory:recipes[1].paths.output,output});const comparisonPath=path.join(output,'migration-pilot-comparison.json');
   return {key:input.revision.key,assemblySha256:input.assembly.sha256,status:report.passed?'verified':'difference',comparisonPath,comparisonSha256:sha(await readFile(comparisonPath)),baselineEvidencePath:path.join(recipes[0].paths.output,'migration-pilot.json'),candidateEvidencePath:path.join(recipes[1].paths.output,'migration-pilot.json')};
  };
  return {db,objectsDirectory:objects,fixtureAuthSecret:secret,captureAndCompare,dispose:cleanup};
 }catch(error){await cleanup();throw error;}
}
