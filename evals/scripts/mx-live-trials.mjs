/** Opt-in, CI-only pi/Fireworks benchmark against the built product. No grader feedback is given. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { pi } from '../lib/harness/pi.ts';
import { runInvocation } from '../lib/spawn.ts';
import { serverEnv, startServer, devOutboxPath } from '../lib/server.ts';
import { acquireCredential } from '../lib/credential.ts';
import { materializeCli, browserShims } from '../lib/cli-kit.ts';
import { runCliAuth } from '../lib/auth.ts';
import { readDotEnv } from '../lib/env.ts';
import { scrubSecrets } from '../lib/secrets.ts';
import { sessionTasks, iframeTasks, fixtureMarkup, sessionVerdict } from '../lib/mx-trials/tasks.mjs';

// This executable owns its environment boundary; provider custody remains in this process.
const track = process.argv[2], out = path.resolve(process.argv[3] ?? 'tmp/mx-trials');
if (!['iframe','session'].includes(track) || process.platform !== 'linux' || process.env.CI !== 'true') throw new Error('Run in Linux CI with track iframe|session and an evidence directory');
const key = process.env.FIREWORKS_API_KEY;
if (!key) throw new Error('FIREWORKS_API_KEY is required');
const repoRoot = process.cwd(), work = fs.mkdtempSync(path.join(os.tmpdir(),'mx-held-out-'));
fs.mkdirSync(out,{recursive:true,mode:0o700});
const write = (name, value) => fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const listen = server => new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address().port));});
const readBody = async req => {const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw new Error('Request too large');chunks.push(chunk);}return Buffer.concat(chunks);};
let requests=0;
const relay=http.createServer(async(req,res)=>{
  try {
    if(++requests>320)throw new Error('Provider request budget exhausted');
    const body=JSON.stringify({...JSON.parse((await readBody(req)).toString()),reasoning_effort:'none'});
    const response=await fetch('https://api.fireworks.ai/inference/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'content-type':'application/json'},body,signal:AbortSignal.timeout(120000)});
    res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json'});
    Readable.fromWeb(response.body).pipe(res);
  } catch(error) {res.writeHead(502);res.end(JSON.stringify({error:{message:scrubSecrets(String(error.message),[key])}}));}
});
const relayPort=await listen(relay);
let active=null;
const proxy=http.createServer(async(req,res)=>{
  try {
    const bytes=await readBody(req);
    const body=req.url==='/api/browser-sessions'?JSON.parse(bytes.toString()||'{}'):null;
    const response=await fetch('http://127.0.0.1:3391'+req.url,{method:req.method,headers:{...req.headers,host:'127.0.0.1:3392'},...(bytes.length?{body:bytes}:{}),redirect:'manual'});
    if(body&&active){
      const result=await response.json();
      if(body.op==='script'){active.ids.add(body.session_id);active.scriptIds.add(body.execution_id);}
      if(body.op==='status')active.statusRead=true;
      if(result.execution_id)active.records.set(result.execution_id,result);
      res.writeHead(response.status,{'content-type':'application/json'});res.end(JSON.stringify(result));return;
    }
    // Record source writes while the agent is running, without storing credentials or unrelated bodies.
    if(active&&req.method!=='GET'&&req.method!=='HEAD'&&/^\/api\/artifacts(?:\/|$)/.test(req.url))active.sourceWrite=true;
    const headers=Object.fromEntries(response.headers);delete headers['content-encoding'];delete headers['content-length'];
    const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
    res.writeHead(response.status,headers);if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch(error){res.writeHead(502);res.end(scrubSecrets(String(error.message),[key]));}
});
await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(3392,'127.0.0.1',resolve);});
const base='http://127.0.0.1:3392', dataDir=path.join(work,'server');fs.mkdirSync(dataDir,{mode:0o700});
const server=await startServer({repoRoot,env:serverEnv({base:process.env,ports:{server:3391,proxy:3392},dataDir,repoRoot,extra:{PROXY__RATE_LIMIT_CONFIG_FILE:'services/proxy/dev_rate_limits.yml',ARTIFACTS__ALLOW_PUBLIC:'1'}}),logPath:path.join(out,'server.log')});
let credential, browser;
const summaries=[];
try {
  credential=await acquireCredential('outbox-oauth',{base,origin:base,env:{},localOutbox:devOutboxPath(dataDir),email:`mxmx_test_mx_${track}@example.com`});
  const api=async(route,body,method=body===undefined?'GET':'POST')=>{
    const response=await fetch(base+route,{method,headers:{Authorization:`Bearer ${credential.token}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value;
  };
  const publish=async code=>{const value=await api('/api/artifacts',{markup:fixtureMarkup(code)});if(!value.id)throw new Error(JSON.stringify(value));return value.id;};
  const script=async(session_id,code,create=false)=>{
    const execution_id=randomUUID();let result=await api('/api/browser-sessions',{op:'script',session_id,execution_id,create,code});
    while(['running','queued'].includes(result.status)){await sleep(100);result=await api('/api/browser-sessions',{op:'status',session_id,execution_id});}
    return result;
  };
  browser=await chromium.launch();
  const gradeWidget=async(kind,code)=>{
    const id=await publish(code), context=await browser.newContext();
    await context.addCookies(credential.cookie.split(';').map(pair=>{const at=pair.indexOf('=');return {name:pair.slice(0,at).trim(),value:pair.slice(at+1).trim(),url:base,httpOnly:true,sameSite:'Lax'};}));
    const page=await context.newPage();
    page.setDefaultTimeout(4000);
    const failedRequests=[];page.on('response',response=>{if(response.status()>=400)failedRequests.push({url:response.url().split('?')[0],method:response.request().method(),status:response.status()});});
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error.message)));page.on('console',message=>{if(message.type()==='error')pageErrors.push(message.text());});
    const checks=[];const check=async(name,fn)=>{try{await fn();checks.push({name,pass:true});}catch(error){checks.push({name,pass:false,error:String(error.message).slice(0,300)});}};
    try {
      await page.goto(base+'/a/'+id);await page.waitForFunction(()=>Boolean(window.mx));
      const frame=page.frameLocator('iframe[title="Trial widget"]').frameLocator('iframe');
      await frame.locator('#rows').waitFor({state:'attached'});
      const set=region=>page.evaluate(region=>mx.set({region}),region);
      const read=()=>page.evaluate(()=>mx.read(['region','taskTitle','tasks','sales'],{wait:true}));
      const text=expected=>frame.locator('#rows').filter({hasText:expected}).waitFor();
      const assert=(value,message)=>{if(!value)throw new Error(message);};
      if(kind==='read'||kind==='states'){
        await check('initial and parent-updated rows',async()=>{await text('North total');await set('South');await text('South total');});
        if(kind==='read')await check('safe text',async()=>{await set('<img src=x onerror=alert(1)>');await text('<img src=x onerror=alert(1)>');assert(await frame.locator('#rows img').count()===0,'Data became HTML');});
      }
      if(kind==='binding')await check('two-way control',async()=>{await text('North');await set('South');await text('South');assert(await frame.locator('#region').inputValue()==='South','Parent selection not reflected');await frame.locator('#region').selectOption('North');await text('North');assert((await read()).signals.region.value==='North','Child selection did not update parent');});
      if(kind==='table')await check('local table is reactive',async()=>{await text('Existing');await page.evaluate(()=>mx.mutate('addTask',{taskTitle:'New row'}));await text('New row');});
      if(kind==='mutate')await check('per-call mutation and double-submit',async()=>{
        await frame.locator('#label').fill('Held-out widget');await frame.locator('#add').evaluate(button=>{button.click();button.click();});
        for(let n=0;n<50&&(await read()).signals.tasks.value.rows.length===1;n++)await sleep(40);
        const state=await read();assert(state.signals.tasks.value.rows.length===2,'Expected exactly one inserted row');assert(state.signals.tasks.value.rows[1].title==='Held-out widget','Wrong inserted value');assert(!await frame.locator('#add').isDisabled(),'Button remained disabled');
      });
      if(kind==='invalid')await check('atomic refusal',async()=>{await frame.locator('#add').click();await frame.locator('#error').filter({hasText:'NOT_WRITABLE'}).waitFor();assert((await read()).signals.region.value==='North','Invalid patch changed region');});
      if(kind==='unsubscribe')await check('unsubscribe stops updates',async()=>{await text('North');await frame.locator('#stop').click();await set('South');await read();await sleep(100);assert((await frame.locator('#rows').innerText()).includes('North')&&!(await frame.locator('#rows').innerText()).includes('South'),'Stopped subscription updated');});
      if(kind==='describe')await check('capability discovery',async()=>{for(const name of ['region','taskTitle','tasks','sales','addTask'])await text(name);});
      if(kind==='states'){
        await check('pending is visible',async()=>{
          await page.route('**/*',async route=>{if(/query/.test(route.request().url()))await sleep(600);await route.continue();});
          await set('North');await frame.locator('#rows').filter({hasText:/loading/i}).waitFor({timeout:500});await text('North total');await page.unrouteAll({behavior:'wait'});
        });
        await check('query error and recovery',async()=>{await set('Broken');await frame.locator('#error').filter({hasText:/error|convert|cast|invalid/i}).waitFor();await set('South');await text('South total');assert((await frame.locator('#error').innerText()).trim()==='','Recovered query left an error');});
      }
      await check('no unintended scalar writes',async()=>{assert((await read()).signals.taskTitle.value==='untouched','Mutation overwrote its argument signal');});
      await check('no unintended row writes',async()=>{assert((await read()).signals.tasks.value.rows.length<=(['table','mutate'].includes(kind)?2:1),'Unexpected row write');});
      return {passed:checks.every(c=>c.pass),noUnintendedWrites:checks.filter(c=>c.name.startsWith('no unintended')).every(c=>c.pass),checks,
        ...(!checks.every(c=>c.pass)?{diagnostics:{pageErrors,failedRequests,state:await read(),html:await frame.locator('#rows').innerHTML(),error:await frame.locator('#error').innerText()}}:{})};
    }finally{await context.close();}
  };
  // Grader probes precede paid runs: an empty submission must fail its requested behavior.
  const probe=await gradeWidget('describe','');if(probe.passed)throw new Error('Broken widget passed the grader');write('grader-probe.json',probe);
  const control=await gradeWidget('describe',"mx.describe().then(d=>document.getElementById('rows').textContent=[...d.signals,...d.mutations].map(s=>s.name).join(', '));");
  if(!control.passed)throw new Error('Known-correct widget failed the grader: '+JSON.stringify(control));
  // This control was authored for a tbody; the generic benchmark outlet is a div.
  const knownWidget=fs.readFileSync(path.join(repoRoot,'scripts/fixtures/mx-agent/widget.js'),'utf8')
    .replaceAll("createElement('tr')","createElement('div')").replaceAll("createElement('td')","createElement('span')");
  for(const kind of ['states','mutate']){const checked=await gradeWidget(kind,knownWidget);write('grader-control-'+kind+'.json',checked);if(!checked.passed)throw new Error('Known-correct '+kind+' control failed: '+JSON.stringify(checked));}
  for(const [kind,brief] of Object.entries(track==='session'?sessionTasks:iframeTasks))for(let repeat=1;repeat<=3;repeat++){
    const name=`${kind}-${repeat}`,home=path.join(work,name),cwd=path.join(home,'task'),piHome=path.join(home,'pi'),evidence=path.join(out,name);
    for(const dir of [home,cwd,piHome,evidence])fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const bin=browserShims(materializeCli(path.join(home,'bin')));
    await runCliAuth({cliBin:bin,homeDir:home,harness:'pi',server:base,publicOrigin:base,cookie:credential.cookie});
    const secrets=[key,credential.token,credential.cookie];
    const connections=path.join(home,'.artifactbin','servers');
    for(const file of [path.join(home,'.artifactbin','.env'),...(fs.existsSync(connections)?fs.readdirSync(connections).map(file=>path.join(connections,file)):[])]){const env=readDotEnv(file);for(const [name,value]of Object.entries(env))if(/TOKEN/.test(name))secrets.push(value);}
    const ids=track==='session'?[await publish(''),await publish('')]:[];
    fs.writeFileSync(path.join(piHome,'models.json'),JSON.stringify({providers:{fireworks:{baseUrl:`http://127.0.0.1:${relayPort}/v1`,api:'openai-completions',apiKey:'driver-relay-no-secret',models:[{id:'accounts/fireworks/models/deepseek-v4-flash-0731',reasoning:false,input:['text'],contextWindow:65536,maxTokens:4096,compat:{supportsDeveloperRole:false,supportsReasoningEffort:false}}]}}}));
    const prompt=track==='session'
      ? `Use the installed afbin CLI to do this task on ${ids.map(id=>base+'/a/'+id).join(' and ')}. Read afbin help live-sessions first. Do not change artifact source or inspect unrelated files. Leave your sessions open for assessment. ${brief}`
      : `Write widget.js: a managed iframe module using the shipped mx API. Read afbin help markup-scripts first. The parent declares scalar region (North initially), scalar taskTitle (untouched), local table tasks with rows {title}, query sales with rows {name,revenue}, and mutation addTask taking taskTitle. Existing elements: #region select (North,South,Broken), #rows div, #label input, #add button, #stop button, #error paragraph. ${brief} Clean up subscriptions and handlers on pagehide. Use read/write/edit/bash tools to write the file, not just a code block. Do not publish, inspect unrelated files, or wait for pagehide before finishing.`;
    fs.writeFileSync(path.join(evidence,'prompt.txt'),prompt);
    const ledger={ids:new Set(),scriptIds:new Set(),records:new Map(),statusRead:false,sourceWrite:false};active=ledger;
    let summary, phase="model_run";
    try {
      const invocation={argv:['pi','--offline','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-session','--tools','read,write,edit,bash','--thinking','off','--model','fireworks/accounts/fireworks/models/deepseek-v4-flash-0731','-p','--mode','json',prompt],env:{PI_CODING_AGENT_DIR:piHome},unsetEnv:[],keepLine:pi.keepLine,redact:secrets};
      const run=await runInvocation(invocation,{cwd,homeDir:home,baseEnv:{PATH:bin+':'+process.env.PATH,HOME:home,TMPDIR:home},runAs:'eval-agent',checkoutRoots:[repoRoot],timeoutMs:180000,stdoutPath:path.join(evidence,'transcript.jsonl'),stderrPath:path.join(evidence,'stderr.txt'),turnCap:{maxTurns:14,countsAsTurn:pi.countsAsTurn}});
      active=null;
      const model=pi.reduce(run.stdout);
      let grade;phase="grading";
      if(track==='iframe'){
        const file=path.join(cwd,'widget.js');
        if(fs.existsSync(file)){const code=fs.readFileSync(file,'utf8');fs.writeFileSync(path.join(evidence,'widget.js'),scrubSecrets(code,secrets));grade=await gradeWidget(kind,code);}else grade={passed:false,error:'No widget.js submission'};
      }else{
        const pages=[],executions=[...ledger.scriptIds].map(id=>ledger.records.get(id)).filter(Boolean);
        let subscriptionStopped=false;
        for(const session_id of ledger.ids){
          const inspected=await script(session_id,`return await Promise.all(Object.entries(pages).map(async ([id,page])=>({id,url:page.url(),...await page.evaluate(async()=>({signals:(await mx.read(['region','taskTitle','tasks','sales'],{wait:true})).signals,marker:window.probeMarker,observed:window.observed}))})));`);
          if(inspected.status==='completed')pages.push(...inspected.result);
          if(kind==='subscribe'){
            const after=await script(session_id,`const page=Object.values(pages)[0];return await page.evaluate(async()=>{const before=JSON.stringify(window.observed);await mx.set({region:'North'});await new Promise(r=>setTimeout(r,100));return before===JSON.stringify(window.observed);});`);subscriptionStopped=after.result===true;
          }
        }
        let sourceChanged=false;
        for(const id of ids){try{if((await api('/api/artifacts/'+id)).version!==1)sourceChanged=true;}catch{sourceChanged=true;}}
        grade=sessionVerdict(kind,{pages,executions,statusRead:ledger.statusRead,sourceChanged,subscriptionStopped});
        fs.writeFileSync(path.join(evidence,'observations.json'),scrubSecrets(JSON.stringify({pages,executions:executions.map(x=>({...x,attachments:x.attachments?.map(a=>({mime:a.mime,bytes:Buffer.from(a.base64,'base64').length}))})),grade},null,2),secrets));
      }
      summary={track,kind,repeat,passed:grade.passed&&model.ok&&!run.timedOut&&!run.turnCapped,grade,modelOk:model.ok,modelError:model.error,timedOut:run.timedOut,turnCapped:run.turnCapped,turns:model.turns,toolCalls:model.toolCalls,tokens:model.tokens,costUsd:null,durationMs:run.durationMs};
    }catch(error){active=null;summary={track,kind,repeat,passed:false,failurePhase:phase,error:scrubSecrets(String(error.message),secrets)};}
    finally{active=null;for(const session_id of ledger.ids)await api('/api/browser-sessions',{op:'close',session_id}).catch(()=>{});}
    summary=JSON.parse(scrubSecrets(JSON.stringify(summary),secrets));
    summaries.push(summary);fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
    write('summary.json',{track,model:'fireworks/accounts/fireworks/models/deepseek-v4-flash-0731',requests,costUsd:null,results:summaries});
  }
  const passed=summaries.filter(s=>s.passed).length, unsafe=summaries.filter(s=>s.grade?.noUnintendedWrites===false).length;
  if(passed<22||unsafe)throw new Error(`${track}: ${passed}/24 first attempts passed; ${unsafe} unintended-write failures`);
}finally{
  await browser?.close();await server.stop();proxy.closeAllConnections();relay.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>relay.close(r))]);
  fs.rmSync(work,{recursive:true,force:true});
}
