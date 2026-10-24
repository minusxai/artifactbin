import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {baselineLocalOrigin,createBaselineSession,validateBaselineAccount} from './component-baseline-session.mjs';
import {publishBaselineFixtures} from '../fixtures/component-baseline/publication.mjs';
import {uploadBrowserParityFixtures} from '../fixtures/component-baseline/upload.mjs';
import {captureBrowserBaseline} from './component-browser-baseline.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Real HTTP publication, verified OTP session, actual frame upload port. No injected adapter, synthetic receipt, or credential in page code. */
export async function runUploadBaseline({base,implementation,browser,sourceRevision,output,connectAgent,signInAccount,account:providedAccount}){
 const origin=baselineLocalOrigin(base),account=validateBaselineAccount(providedAccount??{email:`mxmx_test_upload_${randomUUID()}@example.com`});
 const {token}=await connectAgent(origin,account);
 const publish=async(body,options={})=>{const response=await fetch(origin+'/api/artifacts',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',...(options.idempotencyKey?{'Idempotency-Key':options.idempotencyKey}:{})},body:JSON.stringify({visibility:'unlisted',...body})});assert.equal(response.status,201,'Actual upload fixture publication');return response.json();};
 const allowed=await publish({title:'Disposable upload backing data',dataset:[{fixture:'upload'}],access:'readwrite'});
 const denied=await publish({title:'Disposable read-only backing data',dataset:[{fixture:'upload-denied'}],access:'readonly'});
 let skillArchive;if(implementation==='html'){const response=await fetch(origin+'/skills/artifactbin.zip');assert.equal(response.status,200);skillArchive=new Uint8Array(await response.arrayBuffer());}
 const entries=[];
 for(const fixture of uploadBrowserParityFixtures)entries.push(...await publishBaselineFixtures({implementation,publish,serverOrigin:origin,skillArchive,fixtures:[fixture],substitutions:{uploadDataset:fixture.uploadScenario==='permission'?denied.id:allowed.id,platformOrigin:origin}}));
 /** @type {import('../fixtures/component-baseline/upload-contract').UploadBackendProof[]} */
 const proofs=[];
 const session=await createBaselineSession({base:origin,account,signIn:signInAccount});
 await mkdir(output,{recursive:true});
 let captures,complete=false;try{captures=await captureBrowserBaseline({browser,implementation,sourceRevision,output,fixtures:uploadBrowserParityFixtures,screenshotMode:'document-frame',mount:async({fixture,theme,viewport,page})=>{
  await session.mount(page);const entry=entries.find(entry=>entry.fixture===fixture.id&&entry.theme===theme);assert.ok(entry);
  const records=[];let dropped=false;const proof={fixture:fixture.id,theme,viewport:viewport.width,requests:0,statuses:[],requestIds:[],refs:[]};proofs.push(proof);
  await page.context().route('**/a/*/datasets/*/files',async route=>{
   const request=route.request();if(request.method()!=='POST'){await route.continue();return;}
   const response=await route.fetch();const body=await response.body();let receipt;try{receipt=JSON.parse(body.toString());}catch{}
   records.push({status:response.status(),requestId:request.headers()['idempotency-key'],receipt});proof.requests=records.length;proof.statuses.push(response.status());proof.requestIds.push(request.headers()['idempotency-key']);if(receipt?.ref)proof.refs.push(receipt.ref);
   if(fixture.uploadScenario==='lost-response-retry'&&!dropped&&response.status()===201){dropped=true;await route.abort('failed');}else await route.fulfill({response});
  });
  await page.goto(`${origin}/a/${entry.id}`,{waitUntil:'networkidle'});
  const element=page.locator('iframe[data-mx-document-frame]');await element.waitFor();const frame=await (await element.elementHandle()).contentFrame();assert.ok(frame);
  return {frame,screenshot:()=>element.screenshot({animations:'disabled',caret:'hide'}),ready:async()=>{
   const input=frame.locator('input[type=file]');await input.waitFor({state:'attached'});await frame.getByRole('button',{name:'Choose Attachments',exact:true}).waitFor();await input.evaluate(input=>{if(input.disabled)throw Error('Real authenticated chooser is disabled');});
  },performAction:async action=>{
   if(action.action==='upload')await frame.locator('input[type=file]').setInputFiles(action.files.map(file=>({name:file.name,mimeType:file.mimeType,buffer:file.bytes?Buffer.alloc(file.bytes,65):Buffer.from(file.text??'')})));
   else if(action.action==='click')await frame.getByRole(action.role,{name:action.name,exact:true}).click();
   else throw Error('Unsupported upload fixture action');
  },afterAction:async action=>{
   const scenario=fixture.uploadScenario,name=scenario==='invalid-type'?'sample.png':scenario==='server-invalid-type'?'sample.html':'sample.txt';
   if(['invalid-type','invalid-size'].includes(scenario)){await frame.getByRole('alert').waitFor();assert.equal(records.length,0,'Browser guidance must reject before sending bytes');}
   else if(['permission','server-invalid-type'].includes(scenario)){await frame.getByRole('button',{name:`Retry ${name}`,exact:true}).waitFor();assert.equal(records.length,1);assert.equal(records[0].status,scenario==='permission'?403:400);}
   else {
    if(scenario==='lost-response-retry'&&action.action==='upload'){await frame.getByRole('button',{name:'Retry sample.txt',exact:true}).waitFor();return;}
    if(action.name==='Remove sample.txt'){assert.equal(await frame.getByRole('link',{name:'sample.txt',exact:true}).count(),0);const receipt=records.at(-1).receipt;assert.equal((await page.request.get(new URL(receipt.url,origin).href)).status(),200,'Removing a reference must retain the stored file');return;}
    await frame.getByRole('link',{name:'sample.txt',exact:true}).waitFor();
    const successful=records.filter(record=>record.status===201);assert.equal(successful.length,scenario==='lost-response-retry'?2:1);
    const receipt=successful.at(-1).receipt;assert.match(receipt.ref,/^dfile:/);
    if(scenario==='lost-response-retry'){assert.equal(successful[0].requestId,successful[1].requestId);assert.equal(successful[0].receipt.ref,receipt.ref);assert.equal(receipt.replayed,true);}
    const read=await page.request.get(new URL(receipt.url,origin).href);assert.equal(read.status(),200);const bytes=await read.body();assert.deepEqual(bytes,Buffer.from('hello'));
    Object.assign(proof,{readbackSha256:sha(bytes),replayed:receipt.replayed===true});
   }
  }};
 }});complete=true;}finally{await writeFile(path.join(output,'upload-backend-proof.json'),JSON.stringify({complete,implementation,sourceRevision,account,proofs},null,2));}
 const issues=captures.flatMap(c=>[...c.errors,...c.assertionErrors,...c.fontEvidence.errors,...c.resourceEvidence.errors]);assert.deepEqual(issues,[],'Real upload capture issues');return {captures,proofs};
}
