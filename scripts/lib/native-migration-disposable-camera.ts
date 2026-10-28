/** Source-bound orchestration only. Actual capture remains the existing isolated gate; comparison remains the existing reader. */
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify,isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {compareNativeMigrationPilot} from './native-migration-pilot.mjs';
import {readNativeSourceCaptureReuse,compareReusedNativeMigrationPilot} from './native-migration-reuse.mjs';
import {preparedPilotStoreDigest} from './native-prepared-pilot-store.mjs';
import type {NativeDisposableLifecycle,NativeDisposableCameraPorts,NativeDisposableSourceReuse} from './native-migration-disposable-provider-contract';
import type {NativeSourceCaptureReuse} from './native-migration-reuse-contract';
const execute=promisify(execFile),sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function defaultPorts():NativeDisposableCameraPorts{return {
 read:readFile,resolve:realpath,output:async directory=>{await mkdir(directory,{recursive:true,mode:0o700});},
 preflightReuse:readNativeSourceCaptureReuse,compare:compareNativeMigrationPilot,compareReuse:compareReusedNativeMigrationPilot,
 async run(input){
  if((await execute('git',['rev-parse','HEAD'],{cwd:input.root})).stdout.trim()!==input.revision)throw Error('native_disposable_revision');
  const env={...process.env,NATIVE_MIGRATION_PILOT__INPUT:input.paths.input,NATIVE_MIGRATION_PILOT__CANONICAL:input.paths.canonical,NATIVE_MIGRATION_PILOT__RECOVERY:input.paths.recovery,NATIVE_MIGRATION_PILOT__BUNDLE:input.paths.bundle,NATIVE_MIGRATION_PILOT__OUTPUT:input.paths.output};
  let log='';try{const result=await execute(process.execPath,['scripts/gate-container.mjs','--cpus','4','--memory','8g','--servers','1','component-baseline'],{cwd:input.root,env,maxBuffer:32*1024*1024});log=result.stdout+'\n'+result.stderr;}catch(error){const failure=error as {stdout?:string;stderr?:string};log=(failure.stdout??'')+'\n'+(failure.stderr??'');throw Error('native_disposable_camera_failed');}finally{await writeFile(input.logPath,log,{mode:0o600});}
 },
};}
interface CameraRecipe {format:string;paths:{input:string;canonical:string;recovery:string;bundle:string;output:string};sourceReuse?:NativeDisposableSourceReuse}
/** Ports exist for orchestration tests; serialized configuration never accepts executable overrides. */
export function createNativeDisposableCamera(options:{targetRoot:string;targetRevision:string;original:{root:string;revision:string}},ports:NativeDisposableCameraPorts=defaultPorts()):NativeDisposableLifecycle['captureAndCompare']{
 return async context=>{
  const imported=context.imported as typeof context.imported&{cameraRecipePath?:string};
  if(!imported.cameraRecipePath||!isDeepStrictEqual(imported.key,context.revision.key)||!isDeepStrictEqual(imported.key,context.assembly.key)||imported.assemblySha256!==context.assembly.sha256)throw Error('native_disposable_camera_binding');
  const root=await ports.resolve(context.outputDirectory),inside=async(file:string)=>{const resolved=await ports.resolve(file);if(!resolved.startsWith(root+path.sep))throw Error('native_disposable_camera_snapshot_path');return resolved;};
  await inside(imported.cameraRecipePath);
  const parse=async(file:string)=>JSON.parse(Buffer.from(await ports.read(file)).toString()),candidate=await parse(imported.cameraRecipePath) as CameraRecipe,baseline=await parse(context.baselineRecipePath) as CameraRecipe;
  if(candidate.format!=='native-migration-camera-recipe-v1'||baseline.format!=='native-migration-camera-recipe-v1')throw Error('native_disposable_camera_recipe');
  for(const [actual,expected] of [[candidate.paths.input,imported.pilotInputPath],[candidate.paths.canonical,imported.canonicalPath],[candidate.paths.recovery,imported.recoveryPath],[candidate.paths.bundle,imported.bundleDirectory]])if(await inside(actual!)!==await inside(expected!))throw Error('native_disposable_camera_snapshot_binding');
  const store=await parse(await inside(imported.preparedStorePath)),inputBytes=await ports.read(candidate.paths.input),input=JSON.parse(Buffer.from(inputBytes).toString()),{sha256,...payload}=store;
  if(preparedPilotStoreDigest(payload)!==sha256||!isDeepStrictEqual(input.preparedStore,store)||input.implementation!=='html'||input.candidateRevision!==options.targetRevision||!isDeepStrictEqual(input.key,context.revision.key)||input.bundleFiles?.find((file:{path:string})=>file.path==='index.html')?.sha256!==context.assembly.result.htmlSha256)throw Error('native_disposable_camera_snapshot_binding');
  if(sha(await ports.read(candidate.paths.canonical))!==input.canonicalSha256||sha(await ports.read(candidate.paths.recovery))!==input.recoverySha256)throw Error('native_disposable_camera_source_binding');
  if(!path.resolve(candidate.paths.output).startsWith(root+path.sep))throw Error('native_disposable_camera_output_path');
  await ports.output(candidate.paths.output);await inside(candidate.paths.output);
  let reuse:NativeSourceCaptureReuse|undefined;
  if(candidate.sourceReuse){
   const selected=structuredClone(candidate.sourceReuse),candidateSha=sha(inputBytes);
   if(selected.candidateInputPath!==undefined||selected.candidateInputSha256!==undefined){if(!selected.candidateInputPath||await ports.resolve(selected.candidateInputPath)!==await ports.resolve(candidate.paths.input)||selected.candidateInputSha256!==candidateSha)throw Error('native_disposable_camera_reuse_candidate');}
   if(await ports.resolve(selected.baselineInputPath)!==await ports.resolve(baseline.paths.input))throw Error('native_disposable_camera_reuse_baseline');
   reuse={...selected,candidateInputPath:candidate.paths.input,candidateInputSha256:candidateSha};
   // This checks immutable original input/proof/capture/image hashes and source/extra-assertion bindings before any browser.
   await ports.preflightReuse({baselineDirectory:baseline.paths.output,reuse});
  }else{
   const original=await parse(baseline.paths.input);
   if(original.implementation!=='jsx'||original.originalRevision!==options.original.revision||!isDeepStrictEqual(original.key,context.revision.key)||original.bundleFiles?.find((file:{path:string})=>file.path==='index.html')?.sha256!==context.assembly.result.htmlSha256)throw Error('native_disposable_camera_binding');
   await ports.output(baseline.paths.output);await ports.run({root:options.original.root,revision:options.original.revision,paths:baseline.paths,logPath:path.join(context.outputDirectory,'baseline-gate.log')});
  }
  await ports.run({root:options.targetRoot,revision:options.targetRevision,paths:candidate.paths,logPath:path.join(context.outputDirectory,'candidate-gate.log')});
  const output=path.join(context.outputDirectory,'comparison');await ports.output(output);
  const comparison={baselineDirectory:baseline.paths.output,candidateDirectory:candidate.paths.output,output},report=reuse?await ports.compareReuse({...comparison,reuse}):await ports.compare(comparison),comparisonPath=path.join(output,'migration-pilot-comparison.json');
  return {key:context.revision.key,assemblySha256:context.assembly.sha256,status:report.passed?'verified':'difference',comparisonPath,comparisonSha256:sha(await ports.read(comparisonPath)),baselineEvidencePath:path.join(baseline.paths.output,'migration-pilot.json'),candidateEvidencePath:path.join(candidate.paths.output,'migration-pilot.json')};
 };
}
