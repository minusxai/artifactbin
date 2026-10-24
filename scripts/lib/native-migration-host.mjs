/** Host-only migration boundary. Product adapters retain transaction and camera ownership. */
import {createHash} from 'node:crypto';
import {readFile,realpath,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {pilotComparisonIssues} from './native-migration-pilot.mjs';
import {preparedPilotStoreDigest as digest} from './native-prepared-pilot-store.mjs';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const sha=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,file)=>file!==root&&!path.relative(root,file).startsWith('..')&&!path.isAbsolute(path.relative(root,file));
const names=['sourceHead','compiledHtml','datasetCatalog','identity','authSchemaCapability','membership','comments'];
const fail=code=>{throw Error('native-host-'+code);};
async function admitted(context){
 const root=await realpath(context.receiptRoot),recipePath=await realpath(context.authorityRecipePath);
 if(!inside(root,recipePath))fail('recipe-path');
 const recipe=JSON.parse(await readFile(recipePath,'utf8'));
 if(recipe.format!=='native-migration-host-v1'||recipe.revisionScope!=='latest'||!hash(recipe.assemblySha256)||![recipe.sourceRevision,recipe.targetRevision].every(v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v))||!recipe.key?.sourceNamespace||!recipe.key?.sourceId||!Number.isSafeInteger(recipe.key.version)||recipe.key.version<1)fail('recipe');
 if(!isDeepStrictEqual(recipe.key,context.revision?.key)||!isDeepStrictEqual(recipe.key,context.assembly?.key)||recipe.assemblySha256!==context.assembly?.sha256)fail('binding');
 const authority=recipe.authority;
 if(!authority||![authority.appSchema,authority.authSchema].every(v=>typeof v==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(v))||authority.appSchema===authority.authSchema||!Array.isArray(authority.capabilities)||!authority.capabilities.length||authority.capabilities.some(v=>typeof v!=='string'||!v))fail('authority');
 const files={};
 for(const name of names){const file=recipe.inputs?.[name];if(!file||!hash(file.sha256)||typeof file.path!=='string'||path.isAbsolute(file.path))fail('input');const target=await realpath(path.resolve(root,file.path));if(!inside(root,target))fail('input-path');const bytes=await readFile(target);if(sha(bytes)!==file.sha256)fail('input-digest');files[name]=bytes;}
 if(!hash(context.assembly.result?.htmlSha256)||sha(files.compiledHtml)!==context.assembly.result.htmlSha256)fail('compiled-html-binding');
 return {recipe,files,context};
}
/** @param {{ports:import('./native-migration-host-contract').NativeMigrationHostPorts<any,any>}} options */
export function createNativeMigrationHost({ports}){
 return {
  async importAndPrepare(context){
   const input=await admitted(context),staged=await ports.stage(input);
   const result=await ports.transaction(input.recipe.authority,async tx=>{const imported=await ports.importHistory(tx,staged);if(!hash(imported?.historyProjectionSha256))fail('import-proof');await ports.verify(tx,staged);return imported;});
   await mkdir(context.outputDirectory,{recursive:true,mode:0o700});
   const snapshot=await ports.snapshot(staged,context),output=await realpath(context.outputDirectory);
   for(const name of ['preparedStorePath','pilotInputPath','canonicalPath','recoveryPath','bundleDirectory']){if(typeof snapshot[name]!=='string'||!inside(output,await realpath(snapshot[name])))fail('snapshot-path');}
   return {...snapshot,key:input.recipe.key,assemblySha256:input.recipe.assemblySha256,stage:'imported',historyProjectionSha256:result.historyProjectionSha256,importResult:result};
  },
  async captureAndCompare(context){
   const {recipe}=await admitted(context),imported=context.imported;
   if(imported?.stage!=='imported'||!hash(imported.historyProjectionSha256)||!isDeepStrictEqual(imported.key,recipe.key)||imported.assemblySha256!==recipe.assemblySha256)fail('binding');
   if(!context.baselineRecipePath||!context.candidateRecipePath)fail('capture-recipes');
   const result=await ports.captureAndCompare(context);
   if(!isDeepStrictEqual(result?.key,recipe.key)||result.assemblySha256!==recipe.assemblySha256||!['verified','difference','environment-blocked'].includes(result.status)||!hash(result.comparisonSha256))fail('comparison');
   let report;try{const bytes=await readFile(result.comparisonPath);if(sha(bytes)!==result.comparisonSha256)fail('comparison-digest');report=JSON.parse(bytes);}catch{fail('comparison');}
   if(!result.baselineEvidencePath||!result.candidateEvidencePath)fail('comparison');
   const [baselineBytes,candidateBytes]=await Promise.all([readFile(result.baselineEvidencePath),readFile(result.candidateEvidencePath)]);
   if(result.status==='verified'){
    if(!['native-migration-pilot-comparison-v1','native-migration-pilot-reused-source-comparison-v1'].includes(report.format)||report.passed!==true||!(report.pairedStates>0)||report.issues?.length!==0||!Array.isArray(report.results)||report.results.length!==report.pairedStates||pilotComparisonIssues(report.results,report.control).length)fail('comparison');
    if(report.format==='native-migration-pilot-reused-source-comparison-v1'){
     const reuse=report.reuse,baseline=JSON.parse(baselineBytes),candidate=JSON.parse(candidateBytes);
     if(report.sourceCaptureReused!==true||report.sourceCaptureRerun!==false||!reuse||!['baselineInputSha256','candidateInputSha256','baselineProofSha256','baselineCapturesSha256'].every(key=>hash(reuse[key]))||![report.previousProposalSha256,report.newProposalSha256].every(hash)||sha(baselineBytes)!==reuse.baselineProofSha256||report.previousProposalSha256!==baseline.bundleManifestSha256||report.newProposalSha256!==candidate.bundleManifestSha256||baseline.implementation!=='jsx'||candidate.implementation!=='html')fail('reuse-proof');
     const bound=async(file,digest)=>{if(typeof file!=='string'||!file)fail('reuse-proof');const bytes=await readFile(file);if(sha(bytes)!==digest)fail('reuse-digest');return JSON.parse(bytes);};
     const [oldInput,newInput]=await Promise.all([bound(reuse.baselineInputPath,reuse.baselineInputSha256),bound(reuse.candidateInputPath,reuse.candidateInputSha256),bound(path.join(path.dirname(result.baselineEvidencePath),'jsx-captures.json'),reuse.baselineCapturesSha256)]);
     const shared=['key','rowSha256','sourceSha256','documentSha256','canonicalSha256','recoverySha256','harnessSha256','originalRevision','theme','viewports','states'];
     const artifacts=input=>input.bundleFiles?.filter(file=>file.path!==input.probe?.path);
     if(shared.some(key=>oldInput[key]===undefined||!isDeepStrictEqual(oldInput[key],newInput[key]))||['sourceSha256','documentSha256','canonicalSha256'].some(key=>!hash(newInput[key])||baseline[key]!==oldInput[key]||candidate[key]!==newInput[key])||newInput.canonicalSha256!==recipe.inputs.sourceHead.sha256||oldInput.originalRevision!==recipe.sourceRevision||newInput.candidateRevision!==recipe.targetRevision||digest(artifacts(oldInput))!==report.previousProposalSha256||digest(artifacts(newInput))!==report.newProposalSha256)fail('reuse-binding');
     const extra=reuse.additionalCandidateAssertions;
     if(extra!==undefined||report.originalProbeSha256!==undefined||report.candidateProbeSha256!==undefined||report.additionalCandidateAssertions!==undefined){
      if(!hash(report.originalProbeSha256)||!hash(report.candidateProbeSha256)||report.originalProbeSha256!==oldInput.probe?.sha256||report.candidateProbeSha256!==newInput.probe?.sha256||baseline.probeSha256!==report.originalProbeSha256||candidate.probeSha256!==report.candidateProbeSha256||!isDeepStrictEqual(report.additionalCandidateAssertions,extra?.ids??[])||extra&&(!hash(extra.probeSha256)||extra.probeSha256!==report.candidateProbeSha256||!Array.isArray(extra.ids)||!extra.ids.length||new Set(extra.ids).size!==extra.ids.length||extra.ids.some(id=>typeof id!=='string'||!id.trim())))fail('reuse-assertions');
     }
     if(!isDeepStrictEqual(oldInput.key,recipe.key)||!isDeepStrictEqual(newInput.key,recipe.key)||newInput.bundleFiles?.find(file=>file.path==='index.html')?.sha256!==context.assembly.result.htmlSha256||report.baselineRevision!==baseline.sourceRevision||report.candidateRevision!==candidate.sourceRevision)fail('reuse-binding');
    }
   }
   return result;
  },
 };
}
