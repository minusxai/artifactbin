import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {observeUploadRequests} from './component-upload-route.mjs';
/** Observe the genuine anonymous shell. No fake identity or page adapter is
 * installed; an enabled chooser must encounter the ordinary server's denial. */
export async function captureSignedOutUpload({browser,entries,origin,output,implementation}) {
 /** @type {import('../fixtures/component-baseline/upload-contract').UploadSignedOutProof[]} */
 const proofs=[];
 try{for(const theme of ['light','dark'])for(const width of [800,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:600},colorScheme:theme,reducedMotion:'reduce',locale:'en-US',timezoneId:'UTC'});
  try{
   const page=await context.newPage(),session=await page.request.get(origin+'/api/auth/get-session');
   assert.equal((await session.json())?.user?.id,undefined,'Signed-out observation must have no account session');
   const entry=entries.find(entry=>entry.fixture==='file-upload-success'&&entry.theme===theme);assert.ok(entry);
   const proof={theme,viewport:width,inputDisabled:false,inputHidden:false,buttonDisabled:false,text:'',requests:0,statuses:[],requestIds:[],refs:[]};proofs.push(proof);
   await page.goto(`${origin}/a/${entry.id}`,{waitUntil:'networkidle'});
   const element=page.locator('iframe[data-mx-document-frame]');await element.waitFor();const frame=await (await element.elementHandle()).contentFrame();assert.ok(frame);
   const records=await observeUploadRequests({page,origin,runnerOrigin:new URL(frame.url()).origin,proof});
   if(implementation==='html')await frame.waitForFunction(()=>document.documentElement.dataset.baselineReady==='yes');
   const input=frame.locator('input[type=file]');await input.waitFor({state:'attached'});
   const button=frame.locator('button[aria-label="Choose Attachments"]');await button.waitFor();
   // Retained viewer data is asynchronous; wait for its actual settled helper.
   await frame.getByText(implementation==='jsx'?'Sign in to upload files.':'Or drop files here.',{exact:true}).waitFor();
   Object.assign(proof,await input.evaluate(input=>({inputDisabled:input.disabled,inputHidden:input.hidden})),{buttonDisabled:await button.isDisabled(),text:await frame.locator('body').innerText()});
   await frame.evaluate(()=>document.fonts.ready);
   await element.screenshot({path:path.join(output,`signed-out-${theme}-${width}-initial.png`),animations:'disabled',caret:'hide'});
   if(!proof.inputDisabled){
    await input.setInputFiles({name:'anonymous.txt',mimeType:'text/plain',buffer:Buffer.from('anonymous upload must be denied')});
    await frame.getByRole('button',{name:'Retry anonymous.txt',exact:true}).waitFor();
    assert.equal(records.length,1);assert.equal(records[0].status,403,'Anonymous normal-port upload must be denied');
    await element.screenshot({path:path.join(output,`signed-out-${theme}-${width}-denied.png`),animations:'disabled',caret:'hide'});
   }else assert.equal(records.length,0);
  }finally{await context.close();}
 }}finally{await writeFile(path.join(output,'upload-signed-out-proof.json'),JSON.stringify({implementation,proofs},null,2));}
 return proofs;
}
