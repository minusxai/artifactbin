import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {preparedPilotStoreDigest as digest} from '../lib/native-prepared-pilot-store.mjs';
import {verifyNativeMigrationHostComparison} from '../lib/native-migration-host.mjs';
import {runNativeProductionMigration} from '../lib/native-migration-production';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(run){
 const root=await mkdtemp(path.join(tmpdir(),'production-driver-'));
 try{
  const put=async(name,value)=>{const bytes=Buffer.from(JSON.stringify(value));await writeFile(path.join(root,name),bytes);return {path:name,sha256:sha(bytes)};};
  const heads=Array.from({length:393},(_,i)=>({key:{sourceNamespace:'synthetic',sourceId:'source'+i,version:7},canonicalSha256:sha('canonical'+i)}));
  const plan={format:'native-production-plan-v1',revisionScope:'latest',sourceNamespace:'synthetic',selectionManifest:await put('selection.json',{receipts:heads.map(head=>({id:head.key.sourceId}))}),datasetCensus:await put('census.json',{datasets:Array.from({length:190},(_,i)=>({id:'dataset'+i}))}),identity:await put('identity.json',{plan:{sourceNamespace:'synthetic',sha256:sha('identity')}}),heads,batches:[{id:'ready',sourceIds:[heads[0].key.sourceId]},{id:'remaining',sourceIds:heads.slice(1).map(head=>head.key.sourceId)}],target:{appSchema:'isolated_app',authSchema:'isolated_auth',bucketSha256:sha('test-bucket'),objectPrefix:'migration/run',originSha256:sha('https://target.example.test'),protectedSchemas:['public','auth'],protectedObjects:[{bucketSha256:sha('test-bucket'),prefix:'live'}]}};plan.sha256=digest(plan);
  const batch={format:'native-production-batch-v1',id:'ready',planSha256:plan.sha256,batchSourceIds:[],heads:[]};batch.sha256=digest(batch);
  const planPath=path.join(root,'plan.json'),batchPath=path.join(root,'batch.json');await writeFile(planPath,JSON.stringify(plan));await writeFile(batchPath,JSON.stringify(batch));
  await run({root,put,plan,batch,planPath,batchPath,savePlan:async()=>{delete plan.sha256;plan.sha256=digest(plan);await writeFile(planPath,JSON.stringify(plan));},saveBatch:async()=>{delete batch.sha256;batch.sha256=digest(batch);await writeFile(batchPath,JSON.stringify(batch));}});
 }finally{await rm(root,{recursive:true,force:true});}
}
it('rejects an empty batch, history expansion, incorrect global census and overlapping deployment scope before opening a target',()=>fixture(async x=>{
 let opened=0;const options={planPath:x.planPath,batchPath:x.batchPath,receiptRoot:x.root,outputDirectory:path.join(x.root,'out'),openTarget:async()=>{opened++;throw Error('must not open');}};
 await expect(runNativeProductionMigration(options)).rejects.toThrow('batch');
 x.plan.revisionScope='all';await x.savePlan();await expect(runNativeProductionMigration(options)).rejects.toThrow('plan');
 x.plan.revisionScope='latest';x.plan.heads.pop();await x.savePlan();await expect(runNativeProductionMigration(options)).rejects.toThrow('scope');expect(opened).toBe(0);
}));

async function ready(x){
 const key=x.plan.heads[0].key,userId='reviewed-user',tokenId='reviewed-token',html='<html><head></head><body>Fixture</body></html>';
 const identity={plan:{sourceNamespace:'synthetic',sha256:sha('identity'),targets:{users:{sourceUser:{userId,email:'person@example.test'}}}}};x.plan.identity=await x.put('identity.json',identity);
 const canonical={heads:[{id:key.sourceId,version:key.version,user_id:'sourceUser'}],versions:[]};
 const contents={sourceHead:canonical,compiledHtml:html,identity,authSchemaCapability:{schemas:{appSchema:x.plan.target.appSchema,authSchema:x.plan.target.authSchema},runtime:{actor:{userId,tokenId},origin:'https://target.example.test'}},datasetCatalog:{},membership:{},comments:{}};
 const inputs={};for(const [name,value]of Object.entries(contents)){if(name==='compiledHtml'){await writeFile(path.join(x.root,name),html);inputs[name]={path:name,sha256:sha(html)};}else inputs[name]=await x.put(name,value);}
 x.plan.heads[0].canonicalSha256=inputs.sourceHead.sha256;await x.savePlan();
 const assembly={key,sha256:sha('assembly'),result:{status:'complete',html,htmlSha256:sha(html),files:[]}},recipe={format:'native-migration-host-v1',revisionScope:'latest',key,assemblySha256:assembly.sha256,sourceRevision:'a'.repeat(40),targetRevision:'b'.repeat(40),inputs,authority:{appSchema:x.plan.target.appSchema,authSchema:x.plan.target.authSchema,capabilities:['reviewed-production']}};
 await x.put('authority.json',recipe);
 const context={revision:{key},assembly,receiptRoot:x.root,outputDirectory:path.join(x.root,'prior-disposable'),authorityRecipePath:path.join(x.root,'authority.json')};
 const imported={key,assemblySha256:assembly.sha256,stage:'imported',historyProjectionSha256:sha('history')};
 const common={key,sourceSha256:sha('source'),documentSha256:sha('document'),canonicalSha256:inputs.sourceHead.sha256,harnessSha256:sha('harness'),gateManifestSha256:sha('gate'),theme:'light',viewports:[{width:390,height:844}],states:[{id:'initial',actions:[]}],bundleFiles:[{path:'index.html',sha256:sha(html)}]};
 const proofCommon={format:'native-migration-pilot-capture-v1',...common,bundleManifestSha256:digest(common.bundleFiles),states:['initial'],issues:[]};delete proofCommon.key;delete proofCommon.bundleFiles;
 const baseline={...proofCommon,implementation:'jsx',sourceRevision:recipe.sourceRevision},candidate={...proofCommon,implementation:'html',sourceRevision:recipe.targetRevision};
 const baselineInput=await x.put('baseline-input.json',{...common,implementation:'jsx',originalRevision:recipe.sourceRevision}),candidateInput=await x.put('candidate-input.json',{...common,implementation:'html',candidateRevision:recipe.targetRevision});
 for(const [name,input,proof] of [['baseline',baselineInput,baseline],['candidate',candidateInput,candidate]]){await x.put(name+'.json',proof);await x.put(name+'-camera.json',{format:'native-migration-camera-recipe-v1',paths:{input:path.join(x.root,input.path),output:x.root}});}
 context.baselineRecipePath=path.join(x.root,'baseline-camera.json');context.candidateRecipePath=path.join(x.root,'candidate-camera.json');
 const report={format:'native-migration-pilot-comparison-v1',baselineRevision:recipe.sourceRevision,candidateRevision:recipe.targetRevision,baselineGateManifestSha256:common.gateManifestSha256,candidateGateManifestSha256:common.gateManifestSha256,passed:true,pairedStates:1,control:{detected:true},issues:[],results:[{changedPixels:0,sizeEqual:true,behaviorEqual:true,fontBytesEqual:true,baselineErrors:[],candidateErrors:[],fontProofErrors:[]}]};
 const reportRef=await x.put('comparison-report.json',report);
 const comparison={key,assemblySha256:assembly.sha256,status:'verified',comparisonPath:path.join(x.root,reportRef.path),comparisonSha256:reportRef.sha256,baselineEvidencePath:path.join(x.root,'baseline.json'),candidateEvidencePath:path.join(x.root,'candidate.json')};
 x.batch.planSha256=x.plan.sha256;x.batch.batchSourceIds=[key.sourceId];x.batch.heads=[{sourceId:key.sourceId,context:await x.put('context.json',context),imported:await x.put('imported.json',imported),comparison:await x.put('comparison.json',comparison)}];await x.saveBatch();
 return {key,identity,context,userId,tokenId,report,comparison};
}
it('dry-run validates one completed batch while the remaining global heads lack gate files and never opens target or storage',()=>fixture(async x=>{
 await ready(x);let opened=false;
 const result=await runNativeProductionMigration({planPath:x.planPath,batchPath:x.batchPath,receiptRoot:x.root,outputDirectory:path.join(x.root,'out'),openTarget:async()=>{opened=true;throw Error('must not open');}});
 expect(result).toMatchObject({globalPages:393,globalDatasets:190,batchPages:1,targetOpened:false,targetWrites:0});expect(opened).toBe(false);
 await expect(runNativeProductionMigration({planPath:x.planPath,batchPath:x.batchPath,receiptRoot:x.root,outputDirectory:path.join(x.root,'out'),apply:true,openTarget:async()=>{opened=true;throw Error('must not open');}})).rejects.toThrow('approval_required');expect(opened).toBe(false);
}));
it('applies only approved batch heads, locks shared dataset writes, preserves conditional objects and resumes with verified immutable receipts',()=>fixture(async x=>{
 const data=await ready(x);let state={pages:{},prepared:false},opened=0,closed=0,puts=0,publications=0;const objects=new Map(),locks=[];
 const query=async(sql,values)=>{if(sql.includes('pg_advisory_xact_lock')){locks.push(values[0]);return {rows:[],rowCount:1};}if(sql.includes('has_schema_privilege'))return {rows:[{app_scope:true,permitted:true}],rowCount:1};if(sql.includes('FROM tokens'))return {rows:[{user_id:data.userId}],rowCount:1};throw Error('unexpected query');};
 const db={raw:()=>({kind:'pg'}),query,transaction:async work=>{const draft=structuredClone(state),tx={query,model:draft};const value=await work(tx);state=draft;return value;}};
 const sink={get:async key=>objects.get(key),putIfAbsent:async(key,bytes)=>{puts++;if(objects.has(key))return 'exists';objects.set(key,bytes);return 'created';}};
 const raw={revisionScope:'latest',history:{sourceNamespace:'synthetic',sourceId:data.key.sourceId,headVersion:7,pageId:'TargetPage',revisions:[{}]},identity:data.identity,schemas:{appSchema:x.plan.target.appSchema,authSchema:x.plan.target.authSchema},catalog:{projection:{datasets:[{sourceId:'dataset0',targetId:'SharedDataset'}]}}};
 const options={planPath:x.planPath,batchPath:x.batchPath,receiptRoot:x.root,outputDirectory:path.join(x.root,'out'),apply:true,approvedPlanSha256:x.plan.sha256,openTarget:async()=>{opened++;return {db,s3:{bucket:'test-bucket',prefix:'migration/run',region:'test',accessKeyId:'test-only',secretAccessKey:'test-only',forcePathStyle:true},runtimeStorage:{bucket:'test-bucket',prefix:'migration/run'},origin:'https://target.example.test',publication:async()=>{publications++;return raw;},close:async()=>{closed++;}};},runtimeBinding:{db,storage:{bucket:'test-bucket',prefix:'migration/run'},backend:'s3'},sinkFactory:()=>sink,preparePrerequisites:async tx=>{const replayed=tx.model.prepared;tx.model.prepared=true;return {replayed};},prepareImport:async(_raw,{catalogSink})=>{await catalogSink.putIfAbsent('fixture-object',Buffer.from('exact'));if((await catalogSink.get('fixture-object')).toString()!=='exact')throw Error('object collision');return {history:raw.history,relations:{verify:async tx=>{expect(tx.model.pages.TargetPage).toBe('exact');}},write:async tx=>{const disposition=tx.model.pages.TargetPage?'unchanged':'created';tx.model.pages.TargetPage='exact';return {disposition,historyProjectionSha256:sha('history')};}};}};
 await expect(runNativeProductionMigration({...options,runtimeBinding:{...options.runtimeBinding,storage:{bucket:'test-bucket',prefix:'live'}}})).rejects.toThrow('runtime_binding');expect(state.prepared).toBe(false);expect(puts).toBe(0);opened=0;closed=0;
 const first=await runNativeProductionMigration(options);const before=await readFile(first.receipts[0].path);
 expect(first.batchPages).toBe(1);expect(state.pages).toEqual({TargetPage:'exact'});expect(locks).toContain('native-dataset:isolated_app:SharedDataset');
 const second=await runNativeProductionMigration(options);expect(second.receipts[0].replayed).toBe(true);expect(await readFile(first.receipts[0].path)).toEqual(before);expect(objects.size).toBe(1);expect(puts).toBe(2);expect(opened).toBe(2);expect(closed).toBe(2);expect(publications).toBe(1);
 x.plan.runtimeAuthority={mode:'scoped-internal-tokens',ttlMs:3600000};await x.savePlan();x.batch.planSha256=x.plan.sha256;await x.saveBatch();options.outputDirectory=path.join(x.root,'tokens-out');options.approvedPlanSha256=x.plan.sha256;
 const minted=[],revoked=[];options.tokenAuthority={mint:async(_tx,userId)=>{expect(userId).toBe(data.userId);const id='internal'+minted.length;minted.push(id);return id;},revoke:async id=>{revoked.push(id);}};
 await runNativeProductionMigration(options);expect(revoked).toEqual(minted);expect(minted).toHaveLength(1);
 await runNativeProductionMigration(options);expect(revoked).toEqual(minted);expect(minted).toHaveLength(2);expect(publications).toBe(2);
 objects.set('fixture-object',Buffer.from('changed'));await expect(runNativeProductionMigration(options)).rejects.toThrow('operation_failed');expect(objects.get('fixture-object').toString()).toBe('changed');expect(closed).toBe(5);expect(revoked).toEqual(minted);expect(minted).toHaveLength(3);
 objects.set('fixture-object',Buffer.from('exact'));options.tokenAuthority.revoke=async id=>{revoked.push(id);throw Error('private provider failure');};await expect(runNativeProductionMigration(options)).rejects.toThrow('token_cleanup_failed');expect(closed).toBe(6);expect(revoked).toEqual(minted);expect(revoked).not.toContain(data.tokenId);
 options.tokenAuthority.revoke=async id=>{revoked.push(id);};await runNativeProductionMigration(options);expect(closed).toBe(7);expect(revoked).toEqual(minted);
}));

it('rejects changed gates and protected prefix overlap before opening, and requires batches to stay within the approved disjoint partition',()=>fixture(async x=>{
 const data=await ready(x);let opened=0;const options={planPath:x.planPath,batchPath:x.batchPath,receiptRoot:x.root,outputDirectory:path.join(x.root,'out'),apply:true,approvedPlanSha256:x.plan.sha256,openTarget:async()=>{opened++;throw Error('unexpected target open');}};
 data.report.passed=false;const report=await x.put('comparison-report.json',data.report);data.comparison.comparisonSha256=report.sha256;x.batch.heads[0].comparison=await x.put('comparison.json',data.comparison);await x.saveBatch();
 await expect(runNativeProductionMigration(options)).rejects.toThrow('comparison');expect(opened).toBe(0);
 x.plan.target.objectPrefix='live/nested';await x.savePlan();await expect(runNativeProductionMigration(options)).rejects.toThrow('target_scope');expect(opened).toBe(0);
 x.plan.target.objectPrefix='migration/run';await x.savePlan();x.batch.planSha256=x.plan.sha256;x.batch.batchSourceIds=['source1'];await x.saveBatch();await expect(runNativeProductionMigration(options)).rejects.toThrow('batch');expect(opened).toBe(0);
}));

it('normal paired proof admission binds the actual source, head, revisions and assembled HTML',()=>fixture(async x=>{
 const data=await ready(x),recipe=JSON.parse(await readFile(data.context.authorityRecipePath,'utf8'));
 const verify=()=>verifyNativeMigrationHostComparison({context:data.context,recipe,result:data.comparison});
 expect(await verify()).toMatchObject({status:'verified'});
 const cases=[['baseline.json',{}],['candidate.json',{}],['baseline.json',{sourceSha256:sha('other-source')}],['candidate.json',{canonicalSha256:sha('other-head')}],['candidate.json',{sourceRevision:'c'.repeat(40)}],['candidate.json',{bundleManifestSha256:sha('other-assembly')}],['candidate-input.json',{key:{...data.key,sourceId:'other'}}],['candidate-input.json',{bundleFiles:[{path:'index.html',sha256:sha('other-html')}]}],['candidate.json',{issues:['render failed']}],['candidate.json',{states:['unrelated']}]];
 for(const [name,change] of cases){const before=await readFile(path.join(x.root,name));const original=JSON.parse(before);await x.put(name,Object.keys(change).length?{...original,...change}:{});await expect(verify()).rejects.toThrow(/normal-proof/);await writeFile(path.join(x.root,name),before);}
 expect(await verify()).toMatchObject({status:'verified'});
}));

it('requires a separately pinned reviewed decision for an exact difference before target opening',()=>fixture(async x=>{
 const data=await ready(x),recipe=JSON.parse(await readFile(data.context.authorityRecipePath,'utf8'));
 const strictReport=await x.put('strict-difference.json',{passed:false,images:[{changedPixels:1}]}),evidence=await x.put('review-evidence.json',{complete:true});
 const comparison={...data.comparison,status:'difference',comparisonPath:path.join(x.root,strictReport.path),comparisonSha256:strictReport.sha256};x.batch.heads[0].comparison=await x.put('difference.json',comparison);
 const fileRef=async name=>({path:name,sha256:sha(await readFile(path.join(x.root,name)))});
 const decision={format:'native-reviewed-comparison-decision-v1',accepted:true,revisionScope:'latest',key:data.key,assemblySha256:recipe.assemblySha256,sourceRevision:recipe.sourceRevision,targetRevision:recipe.targetRevision,sourceHeadSha256:recipe.inputs.sourceHead.sha256,compiledHtmlSha256:recipe.inputs.compiledHtml.sha256,membershipSha256:recipe.inputs.membership.sha256,commentsSha256:recipe.inputs.comments.sha256,sourceCameraInput:await fileRef('baseline-input.json'),targetCameraInput:await fileRef('candidate-input.json'),sourceEvidence:await fileRef('baseline.json'),targetEvidence:await fileRef('candidate.json'),strictReport,strictPassed:false,strictFalseField:'passed',evidence:['source','target','assembly','relations','behavior','classification'].map(kind=>({kind,file:evidence})),differences:[{id:'exact-pair',description:'One explicitly reviewed pair',evidence}],behaviorComplete:true,sourceTargetComplete:true};
 const decisionRef=await x.put('review-decision.json',decision);x.batch.heads[0].reviewedDecision=decisionRef;await x.saveBatch();let opens=0;
 const options={planPath:x.planPath,batchPath:x.batchPath,receiptRoot:x.root,outputDirectory:path.join(x.root,'reviewed-out'),openTarget:async()=>{opens++;throw Error('not permitted')}};
 await expect(runNativeProductionMigration(options)).rejects.toThrow();expect(opens).toBe(0);
 expect(await runNativeProductionMigration({...options,approvedReviewedDecisionSha256:[decisionRef.sha256]})).toMatchObject({targetOpened:false,targetWrites:0,batchPages:1});expect(opens).toBe(0);
 expect(JSON.parse(await readFile(path.join(x.root,strictReport.path),'utf8')).passed).toBe(false);
}));
