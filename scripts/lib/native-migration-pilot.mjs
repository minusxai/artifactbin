/** Actual private canonical JSX/native bundles, published through normal local APIs.
 * This mode never substitutes fixture markup or logs private page bytes/screenshots. */
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {installedFiles} from '../fixtures/component-baseline/publication.mjs';
import {captureBrowserBaseline,compareBrowserBaselines} from './component-browser-baseline.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v));
const PILOT_HARNESS_FILES=Object.freeze(['scripts/lib/native-migration-pilot.mjs','scripts/lib/component-browser-baseline.mjs','scripts/gates/gate-component-baseline.mjs','scripts/lib/gate-container.mjs','scripts/fixtures/component-baseline/publication.mjs']);
export async function pilotHarnessSha256(root){return digest(await Promise.all(PILOT_HARNESS_FILES.map(async file=>[file,sha(await readFile(path.join(root,file)))])));}
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** Pure admission boundary, independently testable without a browser or server.
 * @param {import('./native-migration-pilot-contract').NativeMigrationPilotInput} input */
export function validatePilotInputs(input,canonicalBytes,recoveryBytes){
 if(input.format!=='native-migration-pilot-v1'||!['jsx','html'].includes(input.implementation)||!['light','dark'].includes(input.theme)||!['originalRevision','candidateRevision'].every(k=>/^[a-f0-9]{40}$/.test(input[k])))throw Error('pilot-contract');
 if(!hash(input.harnessSha256))throw Error('pilot-harness-proof');
 if(sha(canonicalBytes)!==input.canonicalSha256)throw Error('pilot-canonical-digest');
 if(sha(recoveryBytes)!==input.recoverySha256)throw Error('pilot-recovery-digest');
 const canonical=JSON.parse(canonicalBytes.toString()),recovery=JSON.parse(recoveryBytes.toString());
 const revisions=[...canonical.heads,...canonical.versions].filter(row=>row.version===input.key.version);
 if(!revisions.length)throw Error('pilot-revision');
 const selected=revisions.filter(row=>digest(row)===input.rowSha256);
 if(selected.length!==1)throw Error(selected.length?'pilot-ambiguous-row':'pilot-row-digest');
 const row=selected[0];
 if(digest(row.document)!==input.documentSha256||recovery.documentSha256!==input.documentSha256||digest(recovery.key)!==digest(input.key)||recovery.sourceSha256!==input.sourceSha256||typeof recovery.source!=='string'||sha(recovery.source)!==input.sourceSha256)throw Error('pilot-source-proof');
 if(!input.bundleFiles?.length||input.bundleFiles.some(file=>!hash(file.sha256)||!file.path||file.path.startsWith('/')||file.path.split('/').some(p=>!p||p==='.'||p==='..'))||new Set(input.bundleFiles.map(file=>file.path)).size!==input.bundleFiles.length||input.bundleFiles.filter(file=>file.path==='index.html').length!==1)throw Error('pilot-bundle-manifest');
 if(!input.viewports?.length||input.viewports.some(v=>!Number.isSafeInteger(v.width)||!Number.isSafeInteger(v.height)||v.width<200||v.height<200)||!input.states?.length||new Set(input.states.map(s=>s.id)).size!==input.states.length||input.states.some(s=>!Array.isArray(s.actions)||!/^[a-z0-9-]+$/.test(s.id)||s.actions.some(a=>!['click','focus','press','scroll'].includes(a.action)||typeof a.role!=='string'||typeof a.name!=='string'||a.action==='press'&&typeof a.key!=='string')))throw Error('pilot-capture-plan');
 if(row.meta?.colorMode&&row.meta.colorMode!=='auto'&&row.meta.colorMode!==input.theme)throw Error('pilot-retained-theme');
 return {row,markup:recovery.source};
}
export function pilotFixture(input){return {id:'native-migration-head',family:'NativeMigrationPilot',oldJsx:'',newHtml:'',modules:[],setup:JSON.stringify({key:input.key,documentSha256:input.documentSha256,sourceSha256:input.sourceSha256,bundleFiles:input.bundleFiles}),states:input.states};}
export function pilotComparisonIssues(results,control){
 const issues=[];
 if(!results.length)issues.push('missing-paired-states');
 for(const result of results)if(result.error||!result.sizeEqual||result.changedPixels!==0||!result.behaviorEqual||!result.fontBytesEqual||result.baselineErrors?.length||result.candidateErrors?.length||result.fontProofErrors?.length)issues.push('unequal-or-incomplete-paired-state');
 if(!control?.detected)issues.push('styling-regression-control-not-detected');
 return issues;
}
export async function stylingRegressionEvidence({candidate,regression,directory,regressionDirectory}){
 const control=[];
 for(const original of candidate){const changed=regression.find(c=>c.state===original.state&&c.theme===original.theme&&c.viewport.width===original.viewport.width&&c.viewport.height===original.viewport.height);if(!changed)throw Error('pilot-regression-state-missing');
  const [leftBytes,rightBytes]=await Promise.all([readFile(path.join(directory,original.screenshot)),readFile(path.join(regressionDirectory,changed.screenshot))]);
  if(sha(leftBytes)!==original.screenshotSha256||sha(rightBytes)!==changed.screenshotSha256)throw Error('pilot-regression-image-digest');
  const [left,right]=await Promise.all([sharp(leftBytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}),sharp(rightBytes).ensureAlpha().raw().toBuffer({resolveWithObject:true})]);
  let changedPixels=0;if(left.info.width!==right.info.width||left.info.height!==right.info.height)throw Error('pilot-regression-size');
  for(let i=0;i<left.data.length;i+=4)if(left.data[i]!==right.data[i]||left.data[i+1]!==right.data[i+1]||left.data[i+2]!==right.data[i+2]||left.data[i+3]!==right.data[i+3])changedPixels++;
  control.push({state:original.state,viewport:original.viewport,changedPixels,candidateSha256:original.screenshotSha256,regressionSha256:changed.screenshotSha256});
 }
 return {detected:control.length>0&&control.some(c=>c.changedPixels>0),states:control};
}
const localBase=value=>{const u=new URL(value);if(!['localhost','127.0.0.1','app.lvh.me','lvh.me'].includes(u.hostname)&&!u.hostname.endsWith('.lvh.me')||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('pilot-local-server-only');return u.origin;};
/** Existing gate-container owns browser/server lifecycle and mounts private inputs.
 * @param {{base:string,paths:import('./native-migration-pilot-contract').NativeMigrationPilotPaths,browser:import('playwright').Browser,connectAgent:Function}} options */
export async function runNativeMigrationPilot({base,paths,browser,connectAgent}){
 process.umask(0o077);
 const server=localBase(base);
 const input=JSON.parse(await readFile(paths.input,'utf8'));
 if(await pilotHarnessSha256(path.resolve(import.meta.dirname,'../..'))!==input.harnessSha256)throw Error('pilot-harness-digest');
 const source=validatePilotInputs(input,await readFile(paths.canonical),await readFile(paths.recovery));
 for(const file of input.bundleFiles)if(sha(await readFile(path.join(paths.bundle,file.path)))!==file.sha256)throw Error('pilot-bundle-file-digest');
 await mkdir(paths.output,{recursive:true,mode:0o700});
 const {token}=await connectAgent(server);
 const publish=async(body,key)=>{const response=await fetch(server+'/api/artifacts',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(key?{'idempotency-key':key}:{})},body:JSON.stringify({visibility:'unlisted',...body})});if(!response.ok)throw Error(`pilot-publication-${response.status}`);const value=await response.json();if(typeof value.id!=='string')throw Error('pilot-publication-id');return value;};
 let staging,prepareBundle,skillSha256;
 try{
  if(input.implementation==='html'){
   const response=await fetch(server+'/skills/artifactbin.zip');if(!response.ok)throw Error('pilot-skill-archive');const archive=new Uint8Array(await response.arrayBuffer());skillSha256=sha(archive);const files=installedFiles(archive);staging=await mkdtemp(path.join(tmpdir(),'native-pilot-skill-'));
   for(const [name,bytes]of files)if(name.startsWith('scripts/')){const target=path.join(staging,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
   ({prepareBundle}=await import(pathToFileURL(path.join(staging,'scripts/publication-bundle.mjs'))));
  }
  const publishSnapshot=async regression=>{
   if(input.implementation==='jsx'){if(regression)throw Error('pilot-original-regression');const meta=source.row.meta??{};return publish({markup:source.markup,title:source.row.title,description:source.row.description,theme:meta.theme,template:meta.template,colorMode:meta.colorMode});}
   const entry=await readFile(path.join(paths.bundle,'index.html'),'utf8');
   const html=regression?entry.replace('</head>','<style>body{transform:translateX(17px)!important}</style></head>'):entry;
   const prepared=await prepareBundle({root:paths.bundle,entry:'index.html',entryHtml:html,server});return publish(prepared.body,prepared.idempotencyKey);
  };
  const fixture=pilotFixture(input),sourceRevision=input.implementation==='jsx'?input.originalRevision:input.candidateRevision;
  const capture=async(regression,output)=>{
   const published=await publishSnapshot(regression);
   return captureBrowserBaseline({browser,implementation:input.implementation,sourceRevision,output,fixtures:[fixture],themes:[input.theme],viewports:input.viewports,mount:async({page})=>{
    await page.goto(server+'/a/'+encodeURIComponent(published.id)+'/raw',{waitUntil:'networkidle'});
    return {frame:page.mainFrame(),ready:()=>page.waitForFunction(()=>!!document.querySelector('[data-mx-story-root],[data-mx-inline-story]'))};
   }});
  };
  const captures=await capture(false,paths.output);
  const issues=captures.flatMap(c=>[...c.errors,...(c.assertionErrors??[]),...(c.fontEvidence?.errors??[]),...(c.resourceEvidence?.errors??[])]);
  let control;
  if(input.implementation==='html'){
   const regressionDirectory=path.join(paths.output,'regression');const regression=await capture(true,regressionDirectory);control=await stylingRegressionEvidence({candidate:captures,regression,directory:paths.output,regressionDirectory});if(!control.detected)issues.push('styling-regression-control-not-detected');
  }
  const receipt={format:'native-migration-pilot-capture-v1',harnessSha256:input.harnessSha256,implementation:input.implementation,sourceRevision,sourceSha256:input.sourceSha256,documentSha256:input.documentSha256,canonicalSha256:input.canonicalSha256,bundleManifestSha256:digest(input.bundleFiles),theme:input.theme,viewports:input.viewports,states:input.states.map(s=>s.id),skillSha256,control,issues};
  await writeFile(path.join(paths.output,'migration-pilot.json'),JSON.stringify(receipt,null,2),{mode:0o600});
  if(issues.length)throw Error(`native-migration-pilot-incomplete:${issues.length}`);
  return receipt;
 }finally{if(staging)await rm(staging,{recursive:true,force:true});}
}

/** Paired comparison is distinct from capture; private inputs absent never create this proof. */
export async function compareNativeMigrationPilot({baselineDirectory,candidateDirectory,output}){
 const read=async(directory,name)=>JSON.parse(await readFile(path.join(directory,name),'utf8'));
 const [baselineProof,candidateProof,baseline,candidate]=await Promise.all([read(baselineDirectory,'migration-pilot.json'),read(candidateDirectory,'migration-pilot.json'),read(baselineDirectory,'jsx-captures.json'),read(candidateDirectory,'html-captures.json')]);
 if(baselineProof.format!=='native-migration-pilot-capture-v1'||candidateProof.format!==baselineProof.format||baselineProof.implementation!=='jsx'||candidateProof.implementation!=='html'||['harnessSha256','sourceSha256','documentSha256','canonicalSha256','bundleManifestSha256','theme','viewports','states'].some(key=>baselineProof[key]===undefined||candidateProof[key]===undefined||digest(baselineProof[key])!==digest(candidateProof[key])))throw Error('pilot-unmatched-evidence');
 const results=await compareBrowserBaselines({baseline,candidate,baselineDirectory,candidateDirectory,output});
 const issues=[...baselineProof.issues,...candidateProof.issues,...pilotComparisonIssues(results,candidateProof.control)];
 const report={format:'native-migration-pilot-comparison-v1',baselineRevision:baselineProof.sourceRevision,candidateRevision:candidateProof.sourceRevision,pairedStates:results.length,passed:issues.length===0,control:candidateProof.control,issues,results};
 await writeFile(path.join(output,'migration-pilot-comparison.json'),JSON.stringify(report,null,2),{mode:0o600});
 return report;
}
