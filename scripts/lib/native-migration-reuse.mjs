/** Compare a new target proposal against byte-bound, unchanged original captures. */
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pilotFixture,pilotComparisonIssues} from './native-migration-pilot.mjs';
import {compareBrowserBaselines} from './component-browser-baseline.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v));
const artifacts=input=>input.bundleFiles.filter(file=>file.path!==input.probe?.path);
/** @param {{baselineDirectory:string,candidateDirectory:string,output:string,reuse:import('./native-migration-reuse-contract').NativeSourceCaptureReuse}} options */
export async function compareReusedNativeMigrationPilot({baselineDirectory,candidateDirectory,output,reuse}){
 const bound=async(file,expected)=>{const bytes=await readFile(file);if(!/^[a-f0-9]{64}$/.test(expected)||sha(bytes)!==expected)throw Error('pilot-reuse-digest');return JSON.parse(bytes);};
 const [oldInput,newInput,oldProof,baseline,candidateProof,candidate]=await Promise.all([bound(reuse.baselineInputPath,reuse.baselineInputSha256),bound(reuse.candidateInputPath,reuse.candidateInputSha256),bound(path.join(baselineDirectory,'migration-pilot.json'),reuse.baselineProofSha256),bound(path.join(baselineDirectory,'jsx-captures.json'),reuse.baselineCapturesSha256),readFile(path.join(candidateDirectory,'migration-pilot.json'),'utf8').then(JSON.parse),readFile(path.join(candidateDirectory,'html-captures.json'),'utf8').then(JSON.parse)]);
 const validate=(input,proof,captures,implementation)=>{
  if(input.implementation!==implementation||proof.implementation!==implementation||proof.format!=='native-migration-pilot-capture-v1'||proof.sourceRevision!==input[implementation==='jsx'?'originalRevision':'candidateRevision']||proof.bundleManifestSha256!==digest(artifacts(input))||proof.preparedStoreSha256!==input.preparedStore?.sha256||proof.probeSha256!==input.probe?.sha256)throw Error('pilot-reuse-own-binding');
  for(const key of ['harnessSha256','gateManifestSha256','sourceSha256','documentSha256','canonicalSha256','theme','viewports'])if(digest(proof[key])!==digest(input[key]))throw Error('pilot-reuse-own-binding');
  if(digest(proof.states)!==digest(input.states.map(state=>state.id)))throw Error('pilot-reuse-own-binding');
  const fixtureHash=sha(JSON.stringify(pilotFixture(input))),keys=new Set(input.viewports.flatMap(viewport=>input.states.map(state=>JSON.stringify([input.theme,viewport,state.id]))));
  for(const capture of captures){const key=JSON.stringify([capture.theme,capture.viewport,capture.state]);if(capture.fixture!=='native-migration-head'||capture.fixtureHash!==fixtureHash||capture.implementation!==implementation||capture.sourceRevision!==proof.sourceRevision||!keys.delete(key))throw Error('pilot-reuse-capture-binding');}if(keys.size)throw Error('pilot-reuse-missing-captures');
  return fixtureHash;
 };
 validate(oldInput,oldProof,baseline,'jsx');const nextHash=validate(newInput,candidateProof,candidate,'html');
 for(const key of ['key','rowSha256','sourceSha256','documentSha256','canonicalSha256','recoverySha256','harnessSha256','originalRevision','theme','viewports','states'])if(digest(oldInput[key])!==digest(newInput[key]))throw Error('pilot-reuse-source-changed');
 // Only the derived target-proposal fixture binding changes, in memory. Original bytes stay untouched.
 const results=await compareBrowserBaselines({baseline:baseline.map(capture=>({...capture,fixtureHash:nextHash})),candidate,baselineDirectory,candidateDirectory,output});
 const issues=[...oldProof.issues,...candidateProof.issues,...pilotComparisonIssues(results,candidateProof.control)];
 const report={format:'native-migration-pilot-reused-source-comparison-v1',passed:issues.length===0,sourceCaptureReused:true,sourceCaptureRerun:false,reuse,baselineRevision:oldProof.sourceRevision,candidateRevision:candidateProof.sourceRevision,previousProposalSha256:oldProof.bundleManifestSha256,newProposalSha256:candidateProof.bundleManifestSha256,pairedStates:results.length,control:candidateProof.control,issues,results};
 await writeFile(path.join(output,'migration-pilot-comparison.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
}
