/** Browser check contracts. Smoke evidence never implies task or visual acceptance.
 * @typedef {{width:number,height:number}} CheckViewport
 * @typedef {{pageErrors:string[],consoleErrors:string[],failedRequests:object[],httpErrors:object[],telemetry:object[],text:string,overflow:{viewport:number,content:number,fits:boolean},task?:unknown,error?:string}} CheckEvidence
 * @typedef {{target:string,viewports?:CheckViewport[],steps?:string,timeoutMs?:number}} CheckOptions
 */
import {readFile,writeFile} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';

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
  await page.goto(options.target,{waitUntil:'domcontentloaded',timeout:5000});
  // Do not wait for networkidle: charts, telemetry and subscriptions can remain active.
  if(options.hosted)await page.mainFrame().locator('iframe[data-mx-document-frame]').waitFor({timeout:4000});
  await page.locator('body').waitFor({timeout:4000});
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
 // Do not let page-close cancellation events mutate evidence already collected.
 return {...evidence,pageErrors:[...pageErrors],consoleErrors:[...consoleErrors],failedRequests:[...failedRequests],httpErrors:[...httpErrors],telemetry:[...telemetry]};
}
export function checkScript({target,viewports,steps='',timeoutMs=4000}){
 if(!viewports||viewports.length!==1)throw Error('Each hosted execution checks one viewport.');
 return `const page=await context.newPage();try{return await (${inspectPage.toString()})(page,${JSON.stringify({target,viewport:viewports[0],timeoutMs,hosted:true})},${steps?`async(page)=>{${steps}\n}`:'null'});}finally{await page.close();}`;
}
export function summarizeCheck(checks){
 return {smokePassed:checks.length>0&&checks.every(check=>!check.error&&!check.inspectionError&&check.overflow?.fits===true&&check.text.length>0&&['pageErrors','consoleErrors','failedRequests','httpErrors'].every(key=>check[key]?.length===0)),checks,
  unverified:['visual appearance','task behavior','persistence','permissions'],note:'Smoke evidence only. Inspect task results separately; text and geometry cannot establish visual acceptance.'};
}
function origin(value){const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Select a server origin.');return url.origin;}
/** One session, one execution per viewport, receipt-safe status polling and close. */
export async function checkHosted({target,viewports,steps='',viewer,server,token},fetcher=fetch){
 server=origin(server);if(!token)throw Error('Supply ARTIFACTBIN_TOKEN outside page code.');
 const session_id=randomUUID(),checks=[];let accepted=false;
 async function request(body){
  const response=await fetcher(server+'/api/browser-sessions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:server},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error('Browser session refused (HTTP '+response.status+'): '+(result.error?.code??result.error??'unknown'));return result;
 }
 try{
  for(const viewport of viewports){
   const execution_id=randomUUID();
   const body={op:'script',session_id,execution_id,create:!accepted,code:checkScript({target,viewports:[viewport],steps}),...(accepted||!viewer?{}:{viewer})};
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
 }finally{if(accepted)await request({op:'close',session_id});}
 return summarizeCheck(checks);
}
export async function checkLocal({target,viewports,steps=''},chromium){
 const selected=checkTarget(target);if(selected.mode!=='local')throw Error('Local checks require a loopback preview URL.');
 // launch() creates a disposable temporary profile; never attach to an existing browser or userDataDir.
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===selected.origin?route.continue():route.abort('blockedbyclient');});
  const checks=[];
  for(const viewport of viewports){const page=await context.newPage();try{checks.push(await inspectPage(page,{target,viewport},steps?new (Object.getPrototypeOf(async function(){}).constructor)('page',steps):null));}finally{await page.close();}}
  return summarizeCheck(checks);
 }finally{await browser.close();}
}
const help=`Usage: node check.mjs ID [--viewport WIDTH] [--height HEIGHT] [--steps FILE.js] [--viewer guest|TESTUSER_ID] [--output FILE.json]
       node check.mjs http://127.0.0.1:PORT/ [--viewport WIDTH] [--height HEIGHT] [--steps FILE.js] [--playwright-module FILE.mjs] [--output FILE.json]
       node check.mjs --help
Default viewports: 1280 and 390; height: 844. Repeat --viewport (at most 8). Hosted checks use ARTIFACTBIN_URL and ARTIFACTBIN_TOKEN.
Steps is an async function body receiving page (document-scoped on hosted pages); return task evidence and throw on failed assertions.
Local mode requires Playwright and its Chromium browser, launches a fresh temporary profile and blocks other HTTP origins.
Run untrusted drafts/evaluators in an OS/container sandbox with only test credentials and selected project assets; changing HOME is not isolation.
JSON reports smoke checks and explicit unverified acceptance. No screenshot or visual acceptance is claimed. Exit 1 means smoke failure.`;
async function main(args){
 if(args.length===1&&args[0]==='--help'){console.log(help);return;}
 const target=checkTarget(args.shift()??''),options={},widths=[];
 while(args.length){const flag=args.shift(),value=args.shift();if(!value||!['--viewport','--height','--steps','--viewer','--output','--playwright-module'].includes(flag)||flag!=='--viewport'&&Object.hasOwn(options,flag))throw Error(help);if(flag==='--viewport')widths.push(Number(value));else options[flag]=value;}
 const height=Number(options['--height']??844);if(!widths.length)widths.push(1280,390);
 if(widths.length>8||[...widths,height].some(value=>!Number.isInteger(value)||value<240||value>3840))throw Error('Viewport dimensions must be integers from 240 to 3840; at most 8 widths.');
 const viewports=widths.map(width=>({width,height})),steps=options['--steps']?await readFile(options['--steps'],'utf8'):'';
 if(Buffer.byteLength(steps)>48000)throw Error('Task steps exceed 48 KB.');
 let result;
 if(target.mode==='local'){
  if(options['--viewer'])throw Error('Private preview has no platform viewer identity.');
  const {chromium}=await import(options['--playwright-module']?pathToFileURL(realpathSync(options['--playwright-module'])).href:'playwright');
  result=await checkLocal({target:target.target,viewports,steps},chromium);
 }else{
  if(options['--playwright-module'])throw Error('Hosted checks use the server browser.');
  const selected=options['--viewer'];if(selected&&selected!=='guest'&&!/^[A-Za-z0-9_-]+$/.test(selected))throw Error('Invalid test-user ID.');
  result=await checkHosted({target:target.target,viewports,steps,viewer:selected==='guest'?'guest':selected?{testuser:selected}:undefined,server:process.env.ARTIFACTBIN_URL,token:process.env.ARTIFACTBIN_TOKEN});
 }
 const json=JSON.stringify(result,null,2)+'\n';if(options['--output'])await writeFile(options['--output'],json,{flag:'wx',mode:0o600});else process.stdout.write(json);
 if(!result.smokePassed)process.exitCode=1;
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
