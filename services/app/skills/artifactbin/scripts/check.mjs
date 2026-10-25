/** Browser check contracts. Smoke evidence never implies task or visual acceptance.
 * @typedef {{width:number,height:number}} CheckViewport
 * @typedef {{pageErrors:string[],consoleErrors:string[],failedRequests:object[],httpErrors:object[],telemetry:object[],text:string,overflow:{viewport:number,content:number,fits:boolean},task?:unknown,error?:string}} CheckEvidence
 * @typedef {{target:string,viewports?:CheckViewport[],steps?:string,timeoutMs?:number}} CheckOptions
 */
import {readFile,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {runTool,resolveTarget,selectedServer,makeClient,positional,enumValue,credentialRoot,ToolError,exclusive} from './toolbox-client.mjs';

export function checkTarget(value){
 if(/^[A-Za-z0-9]{6,}$/.test(value))return {mode:'hosted',target:'/a/'+value};
 let url;try{url=new URL(value);}catch{throw Error('Use an artifact ID or an HTTP loopback preview URL.');}
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('Use an artifact ID or an HTTP loopback preview URL.');
 return {mode:'local',target:url.href,origin:url.origin};
}
/** Runs in either the server session or a fresh local browser context. No credentials. */
export async function inspectPage(page,options,task){
 const pageErrors=[],consoleErrors=[],failedRequests=[],httpErrors=[],telemetry=[];
 const classify=(value)=>{try{const url=new URL(value);return url.origin===new URL(page.url()).origin&&/^\/api\/page\/artifact\/[A-Za-z0-9]+\/view$/.test(url.pathname);}catch{return false;}};
 const record=(list,item)=>{if(list.length<100)list.push(item);};
 page.on('pageerror',error=>record(pageErrors,String(error.message)));
 page.on('console',message=>{if(message.type()==='error'){const url=message.location?.().url;if(url&&classify(url))record(telemetry,{url,error:message.text()});else record(consoleErrors,message.text());}});
 page.on('requestfailed',request=>{const item={url:request.url(),error:request.failure()?.errorText};record(classify(item.url)?telemetry:failedRequests,item);});
 page.on('response',response=>{if(response.status()>=400){const item={url:response.url(),status:response.status()};record(classify(item.url)?telemetry:httpErrors,item);}});
 page.setDefaultTimeout(options.timeoutMs??4000);
 const evidence={viewport:options.viewport,pageErrors,consoleErrors,failedRequests,httpErrors,telemetry,text:'',overflow:null,task:null};
 try{
  await page.setViewportSize(options.viewport);
  await page.goto(options.target,{waitUntil:'domcontentloaded',timeout:4000});
  // Do not wait for networkidle: charts, telemetry and subscriptions can remain active.
  if(options.hosted)await page.mainFrame().locator('iframe[data-mx-document-frame]').waitFor({timeout:2000});
  await page.locator('body').waitFor({timeout:2000});
  if(task){
   let timer;
   try{evidence.task=await Promise.race([task(page),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Task deadline exceeded; inspect the awaited condition')),6000);})]);}
   finally{clearTimeout(timer);}
  }
 }catch(error){evidence.error=String(error.message);}
 try{
  evidence.text=(await page.locator('body').innerText({timeout:1000})).slice(0,24000);
  evidence.overflow=await page.locator('html').evaluate(html=>{
   const content=Math.max(html.scrollWidth,html.ownerDocument.body.scrollWidth);
   return {viewport:html.clientWidth,content,fits:content<=html.clientWidth+1};
  },undefined,{timeout:1000});
 }catch(error){evidence.inspectionError=String(error.message);}
 if(options.capture)try{evidence.screenshot={mime:'image/png',base64:Buffer.from(await page.locator('body').screenshot({timeout:1000})).toString('base64')};}catch(error){evidence.screenshotError=String(error.message);}
 // Do not let page-close cancellation events mutate evidence already collected.
 return {...evidence,pageErrors:[...pageErrors],consoleErrors:[...consoleErrors],failedRequests:[...failedRequests],httpErrors:[...httpErrors],telemetry:[...telemetry]};
}
export function checkScript({target,viewports,steps='',timeoutMs=2500,capture=false}){
 if(!viewports||viewports.length!==1)throw Error('Each hosted execution checks one viewport.');
 return `const page=await context.newPage();try{return await (${inspectPage.toString()})(page,${JSON.stringify({target,viewport:viewports[0],timeoutMs,hosted:true,capture})},${steps?`async(page)=>{${steps}\n}`:'null'});}finally{await page.close();}`;
}
export function summarizeCheck(checks){
 return {smokePassed:checks.length>0&&checks.every(check=>!check.error&&!check.inspectionError&&check.overflow?.fits===true&&check.text.length>0&&['pageErrors','consoleErrors','failedRequests','httpErrors'].every(key=>check[key]?.length===0)),checks,
  unverified:['visual appearance','task behavior','persistence','permissions'],note:'Smoke evidence only. Inspect task results separately; text and geometry cannot establish visual acceptance.'};
}
function origin(value){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Select a server origin.');return url.origin;}
/** One session, one execution per viewport, receipt-safe status polling and close. */
/** @param {any} options */
export async function checkHosted({target,viewports,steps='',viewer,server,token=undefined,requester=undefined,capture=false},fetcher=fetch){
 server=origin(server);if(!token&&!requester)throw Error('Supply ARTIFACTBIN_TOKEN outside page code.');
 const session_id=randomUUID(),checks=[];let accepted=false;
 async function request(body){
  if(requester)return requester(body);
  const response=await fetcher(server+'/api/browser-sessions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:server},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error('Browser session refused (HTTP '+response.status+'): '+(result.error?.code??result.error??'unknown'));return result;
 }
 try{
  for(const viewport of viewports){
   const execution_id=randomUUID();
   const body={op:'script',session_id,execution_id,create:!accepted,code:checkScript({target,viewports:[viewport],steps,capture}),...(accepted||!viewer?{}:{viewer})};
   let run;
   try{run=await request(body);accepted=true;}
   catch(error){
    // A lost submission response may still have executed. Observe the same receipt; never replay actions.
    try{run=await request({op:'status',session_id,execution_id});accepted=run.session_id===session_id;}catch{throw error;}
   }
   if(run.session_id!==session_id||run.execution_id!==execution_id)throw Error('Mismatched browser receipt.');
   for(const deadline=Date.now()+25000;['queued','running'].includes(run.status)&&Date.now()<deadline;){
    await new Promise(resolve=>setTimeout(resolve,250));run=await request({op:'status',session_id,execution_id});
   }
   if(run.status!=='completed'){checks.push({viewport,error:run.error??run.status,session_id,execution_id,pages:run.pages});break;}
   checks.push(run.result);
  }
 }finally{if(accepted)try{await request({op:'close',session_id});}catch(error){checks.push({error:'Session cleanup failed: '+error.message});}}
 return summarizeCheck(checks);
}
export async function checkLocal({target,viewports,steps='',capture=false},chromium){
 const selected=checkTarget(target);if(selected.mode!=='local')throw Error('Local checks require a loopback preview URL.');
 // launch() creates a disposable temporary profile; never attach to an existing browser or userDataDir.
 let browser;try{browser=await chromium.launch({headless:true});}catch{throw new ToolError('browser_dependency_missing','Chromium could not start in this harness.',1,'Install the Playwright Chromium build and its OS dependencies.');}
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===selected.origin?route.continue():route.abort('blockedbyclient');});
  const checks=[];
  for(const viewport of viewports){const page=await context.newPage();try{checks.push(await inspectPage(page,{target,viewport,capture},steps?new (Object.getPrototypeOf(async function(){}).constructor)('page',steps):null));}finally{await page.close();}}
  return summarizeCheck(checks);
 }finally{await browser.close();}
}
export async function checkCommand({values,positionals},options={}){
 const input=positional(positionals),widths=values.viewport??['1280x800','390x844'];
 if(widths.length>8)throw new ToolError('viewport_limit','At most eight viewports are supported.',2);
 const viewports=widths.map(value=>{const match=/^(\d+)x(\d+)$/.exec(value);if(!match||[match[1],match[2]].some(n=>Number(n)<240||Number(n)>3840))throw new ToolError('invalid_viewport','Use WIDTHxHEIGHT with dimensions from 240 to 3840.',2);return {width:Number(match[1]),height:Number(match[2])};});
 const steps=values.steps?await readFile(values.steps,'utf8'):'';if(Buffer.byteLength(steps)>48000)throw new ToolError('steps_too_large','Task steps exceed 48 KB.',2);
 let result;
 const local=/^http:\/\//.test(input)&&!/^\/a\/[A-Za-z0-9]{6,12}\/?$/.test(new URL(input).pathname);
 if(local){
  if(values.viewer||values.server)throw new ToolError('local_identity','Loopback preview has no platform viewer/server selection.',2);
  let chromium;try{({chromium}=await import(values['playwright-module']?pathToFileURL(realpathSync(values['playwright-module'])).href:'playwright'));}catch{throw new ToolError('browser_dependency_missing','Local checks need Playwright and its installed Chromium browser.',1,'Install Playwright in the isolated harness and pass --playwright-module when needed.');}
  result=await checkLocal({target:checkTarget(input).target,viewports,steps,capture:true},chromium);
 }else{
  if(values['playwright-module'])throw new ToolError('hosted_browser','Hosted checks use server browser sessions.',2);
  const {server,id}=resolveTarget(input,selectedServer(values,options.env)),client=makeClient(server,options);
  const viewer=values.viewer?enumValue(values.viewer,['self','guest'],'viewer'):'self';
  result=await checkHosted({target:'/a/'+id,server,viewports,steps,capture:true,viewer:viewer==='guest'?'guest':undefined,requester:body=>client.request('/api/browser-sessions',{method:'POST',body})});
 }
 const directory=path.join(credentialRoot(options.env),'checks',randomUUID());let created=false;
 for(const check of result.checks){if(check.screenshot){if(!created){await mkdir(directory,{recursive:true,mode:0o700});created=true;}const file=path.join(directory,`${check.viewport.width}x${check.viewport.height}.png`);await exclusive(file,Buffer.from(check.screenshot.base64,'base64'));check.screenshot={path:file,mime:'image/png',visuallyReviewed:false};}}
 if(!result.smokePassed)throw new ToolError('check_failed','Smoke or task checks failed.',1,'Inspect partial diagnostics and remaining unverified acceptance.',result);
 return result;
}
await runTool('check',import.meta.url,checkCommand);
