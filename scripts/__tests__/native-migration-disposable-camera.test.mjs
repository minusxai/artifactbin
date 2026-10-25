import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createNativeDisposableCamera} from '../lib/native-migration-disposable-camera';
import {preparedPilotStoreDigest} from '../lib/native-prepared-pilot-store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(reused=false){
 const files=new Map(),reads=[],calls=[],key={sourceNamespace:'unit-orchestration',sourceId:'UnrelatedKey',version:2},htmlSha='a'.repeat(64),assemblySha='b'.repeat(64),candidateRevision='c'.repeat(40),originalRevision='d'.repeat(40);
 const storeBody={format:'native-prepared-store-v1',directory:'prepared-store',directories:['database','objects'],files:[],reader:{pageId:'TargetKey'}},store={...storeBody,sha256:preparedPilotStoreDigest(storeBody)};
 const candidate={format:'native-migration-camera-recipe-v1',paths:{input:'/out/new/pilot-input.json',canonical:'/out/new/canonical.json',recovery:'/out/new/recovery.json',bundle:'/out/new/bundle',output:'/out/new/capture'}},baseline={format:'native-migration-camera-recipe-v1',paths:{input:'/source/old-input.json',canonical:'/source/canonical.json',recovery:'/source/recovery.json',bundle:'/source/bundle',output:'/source/captures'}};
 const input={implementation:'html',candidateRevision,key,preparedStore:store,bundleFiles:[{path:'index.html',sha256:htmlSha}],canonicalSha256:sha('canonical'),recoverySha256:sha('recovery')};
 const put=(file,value)=>files.set(file,Buffer.from(typeof value==='string'?value:JSON.stringify(value)));
 const reuse={baselineInputPath:baseline.paths.input,baselineInputSha256:'1'.repeat(64),baselineProofSha256:'2'.repeat(64),baselineCapturesSha256:'3'.repeat(64),additionalCandidateAssertions:{probeSha256:'4'.repeat(64),ids:['actual-extra-check']}};
 if(reused)candidate.sourceReuse=reuse;
 put('/out/new/generated-camera.json',candidate);put('/source/camera.json',baseline);put(candidate.paths.input,input);put('/out/new/store.json',store);put(candidate.paths.canonical,'canonical');put(candidate.paths.recovery,'recovery');put(baseline.paths.input,{implementation:'jsx',originalRevision,key,bundleFiles:[{path:'index.html',sha256:reused?'old-proposal':htmlSha}]});put('/out/new/comparison/migration-pilot-comparison.json',{unitOrchestrationOnly:true,passed:false});
 const context={revision:{key},assembly:{key,sha256:assemblySha,result:{htmlSha256:htmlSha}},outputDirectory:'/out/new',baselineRecipePath:'/source/camera.json',candidateRecipePath:'/out/new/pre-import-template.json',imported:{key,assemblySha256:assemblySha,stage:'imported',cameraRecipePath:'/out/new/generated-camera.json',pilotInputPath:candidate.paths.input,canonicalPath:candidate.paths.canonical,recoveryPath:candidate.paths.recovery,bundleDirectory:candidate.paths.bundle,preparedStore:store,preparedStorePath:'/out/new/store.json'}};
 const ports={read:async file=>{reads.push(file);if(!files.has(file))throw Error('Unexpected stale/template read '+file);return files.get(file);},resolve:async file=>file,output:async()=>{},run:async input=>{calls.push(['gate',input]);},preflightReuse:async input=>{calls.push(['preflight',input]);},compare:async input=>{calls.push(['compare',input]);return {passed:false};},compareReuse:async input=>{calls.push(['compareReuse',input]);return {passed:false};}};
 return {files,reads,calls,context,ports,candidate,baseline,input,put,options:{targetRoot:'/target',targetRevision:candidateRevision,original:{root:'/original',revision:originalRevision}}};
}
it('captures the actual imported snapshot rather than the pre-import template and calls the real comparison port',async()=>{
 const x=fixture(),result=await createNativeDisposableCamera(x.options,x.ports)(x.context);
 expect(x.reads).not.toContain(x.context.candidateRecipePath);expect(x.calls.map(call=>call[0])).toEqual(['gate','gate','compare']);expect(x.calls[1][1].paths).toEqual(x.candidate.paths);expect(result.status).toBe('difference');expect(result.candidateEvidencePath).toBe('/out/new/capture/migration-pilot.json');
});
it('preflights immutable original evidence, executes only the candidate and passes actual new proposal input plus extra assertions to reuse comparison',async()=>{
 const x=fixture(true);await createNativeDisposableCamera(x.options,x.ports)(x.context);
 expect(x.calls.map(call=>call[0])).toEqual(['preflight','gate','compareReuse']);expect(x.calls[1][1].root).toBe('/target');
 const reuse=x.calls[0][1].reuse;expect(reuse.candidateInputPath).toBe(x.context.imported.pilotInputPath);expect(reuse.candidateInputSha256).toBe(sha(x.files.get(reuse.candidateInputPath)));expect(reuse.additionalCandidateAssertions).toEqual(x.candidate.sourceReuse.additionalCandidateAssertions);expect(x.calls[2][1].reuse).toEqual(reuse);
});
it.each(['path','store','key','canonical','explicit-candidate'])('refuses counterfeit imported %s evidence before any gate',async field=>{
 const x=fixture(field==='explicit-candidate');
 if(field==='path'){x.candidate.paths.input='/out/new/pre-import-template.json';x.put('/out/new/generated-camera.json',x.candidate);}
 if(field==='store'){x.input.preparedStore={sha256:'forged'};x.put(x.candidate.paths.input,x.input);}
 if(field==='key'){x.input.key={...x.input.key,sourceId:'DifferentKey'};x.put(x.candidate.paths.input,x.input);}
 if(field==='canonical')x.put(x.candidate.paths.canonical,'changed source');
 if(field==='explicit-candidate'){x.candidate.sourceReuse.candidateInputPath=x.candidate.paths.input;x.candidate.sourceReuse.candidateInputSha256='0'.repeat(64);x.put('/out/new/generated-camera.json',x.candidate);}
 await expect(createNativeDisposableCamera(x.options,x.ports)(x.context)).rejects.toThrow();expect(x.calls).toEqual([]);
});
it('refuses failed original proof validation before spending a candidate lane',async()=>{
 const x=fixture(true);x.ports.preflightReuse=async()=>{throw Error('pilot-reuse-digest');};await expect(createNativeDisposableCamera(x.options,x.ports)(x.context)).rejects.toThrow('pilot-reuse-digest');expect(x.calls).toEqual([]);
});
