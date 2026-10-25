/** Exact human-reviewed admission. Strict comparison policy remains unchanged. */
import {readFile,realpath} from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
const sha=x=>createHash('sha256').update(x).digest('hex'),hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),fail=()=>{throw Error('native_reviewed_comparison_refused')};
/** @param {{root:string,ref:import('./native-migration-host-contract').NativeHostFile,approvedSha256:readonly string[],context:import('./native-migration-host-contract').NativeHostContext & {imported?:import('./native-migration-host-contract').NativeHostPrepared},recipe:import('./native-migration-host-contract').NativeHostRecipe,result:import('./native-migration-host-contract').NativeHostComparison}} input */
export async function verifyReviewedComparison({root,ref,approvedSha256,context,recipe,result}){
 if(!ref||!hash(ref.sha256)||!approvedSha256?.includes(ref.sha256))fail();
 const base=await realpath(root),bound=async ref=>{if(!ref||!hash(ref.sha256)||typeof ref.path!=='string'||path.isAbsolute(ref.path))fail();const file=await realpath(path.resolve(base,ref.path));if(!file.startsWith(base+path.sep))fail();const bytes=await readFile(file);if(sha(bytes)!==ref.sha256)fail();return bytes;};
 /** @type {import('./native-reviewed-comparison-contract').NativeReviewedComparisonDecision} */
 const d=JSON.parse((await bound(ref)).toString());
 if(d.format!=='native-reviewed-comparison-decision-v1'||d.accepted!==true||d.revisionScope!=='latest'||d.strictPassed!==false||d.behaviorComplete!==true||d.sourceTargetComplete!==true||!isDeepStrictEqual(d.key,recipe.key)||d.assemblySha256!==recipe.assemblySha256||d.sourceRevision!==recipe.sourceRevision||d.targetRevision!==recipe.targetRevision)fail();
 for(const [field,name] of [['sourceHeadSha256','sourceHead'],['compiledHtmlSha256','compiledHtml'],['membershipSha256','membership'],['commentsSha256','comments']])if(!hash(d[field])||d[field]!==recipe.inputs[name]?.sha256)fail();
 if(result.status!=='difference'||!isDeepStrictEqual(result.key,recipe.key)||result.assemblySha256!==recipe.assemblySha256||result.comparisonSha256!==d.strictReport?.sha256)fail();
 const strictBytes=await bound(d.strictReport);if(sha(await readFile(result.comparisonPath))!==sha(strictBytes))fail();const strict=JSON.parse(strictBytes.toString());if(!['passed','strictEqual'].includes(d.strictFalseField)||strict[d.strictFalseField]!==false||strict.passed===true||strict.strictEqual===true)fail();

 const inputs=await Promise.all([d.sourceCameraInput,d.targetCameraInput].map(async ref=>JSON.parse((await bound(ref)).toString())));
 for(const [i,ref] of [d.sourceEvidence,d.targetEvidence].entries()){
  const evidence=JSON.parse((await bound(ref)).toString()),evidencePath=i?result.candidateEvidencePath:result.baselineEvidencePath;
  if(typeof evidencePath!=='string'||sha(await readFile(evidencePath))!==ref.sha256)fail();
  const cameraPath=i?(context.imported?.cameraRecipePath??context.candidateRecipePath):context.baselineRecipePath;
  if(typeof cameraPath!=='string')fail();const camera=JSON.parse(await readFile(cameraPath,'utf8'));
  if(camera.format!=='native-migration-camera-recipe-v1'||typeof camera.paths?.input!=='string'||sha(await readFile(camera.paths.input))!==[d.sourceCameraInput,d.targetCameraInput][i].sha256)fail();
  const input=inputs[i],implementation=i?'html':'jsx',revision=i?recipe.targetRevision:recipe.sourceRevision;
  if(input.implementation!==implementation||!isDeepStrictEqual(input.key,recipe.key)||input[i?'candidateRevision':'originalRevision']!==revision||input.canonicalSha256!==recipe.inputs.sourceHead.sha256||!hash(d.sourceCameraHtmlSha256)||input.bundleFiles?.find(f=>f.path==='index.html')?.sha256!==(i?recipe.inputs.compiledHtml.sha256:d.sourceCameraHtmlSha256))fail();
  for(const field of ['sourceSha256','documentSha256','canonicalSha256'])if(!hash(input[field])||inputs[0][field]!==inputs[1][field])fail();
  const protocol=d.captureProtocols;if(!protocol||typeof protocol.description!=='string'||!protocol.description.trim()||!hash(input.harnessSha256)||input.harnessSha256!==protocol[i?'targetHarnessSha256':'sourceHarnessSha256'])fail();
  const issues=d.captureIssues?.[i?'target':'source'];if(!Array.isArray(issues)||issues.some(e=>typeof e!=='string'))fail();
  if(Array.isArray(evidence)){
   // A reviewed successful initial subset does not assert that a failed full pilot passed.
   if(issues.length||!evidence.length||evidence.some(e=>e.implementation!==implementation||e.sourceRevision!==revision||e.errors?.length||e.assertionErrors?.length||!input.states?.some(s=>s.id===e.state)||!input.viewports?.some(v=>isDeepStrictEqual(v,e.viewport))))fail();
  }else{
   if(evidence.format!=='native-migration-pilot-capture-v1'||evidence.implementation!==implementation||evidence.sourceRevision!==revision||!isDeepStrictEqual(evidence.issues,issues))fail();
   for(const field of ['sourceSha256','documentSha256','harnessSha256','canonicalSha256'])if(evidence[field]!==input[field])fail();
  }
 }
 const required=['source','target','assembly','relations','behavior','classification'];
 if(!Array.isArray(d.evidence)||required.some(kind=>!d.evidence.some(e=>e.kind===kind))||d.evidence.some(e=>!required.includes(e.kind)))fail();
 if(!Array.isArray(d.differences)||!d.differences.length||new Set(d.differences.map(e=>e.id)).size!==d.differences.length||d.differences.some(e=>typeof e.id!=='string'||!e.id.trim()||typeof e.description!=='string'||!e.description.trim()))fail();
 for(const e of d.evidence)await bound(e.file);for(const e of d.differences)await bound(e.evidence);
 return {decisionSha256:ref.sha256,strictPassed:false};
}
