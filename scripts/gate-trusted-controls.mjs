/** Opt-in two-origin build acceptance. Own server because its origin policy differs from legacy gates. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {createServer as httpsServer} from 'node:https';
import {request as httpRequest} from 'node:http';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {startDocument,becomeOwner} from './lib/start-doc.mjs';
import {loginViaEmail} from './lib/mail-login.mjs';

const scratch = mkdtempSync(join(tmpdir(),'afbin-controls-gate-'));
const interactive=process.argv.includes('--interactive');
const socket = net.createServer();
await new Promise(resolve => socket.listen(0,'127.0.0.1',resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const backend = `http://localhost:${port}`;
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=artifactbin.test','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'cert.pem')],{stdio:'ignore'});
const tls = httpsServer({key:readFileSync(join(scratch,'key.pem')),cert:readFileSync(join(scratch,'cert.pem'))},(req,res) => {
  const upstream = httpRequest(backend+req.url,{method:req.method,headers:{...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':'https'}},answer => {
    res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end();});
  req.pipe(upstream);
});
await new Promise(resolve=>tls.listen(0,'127.0.0.1',resolve));
const tlsPort = tls.address().port;
const hostname=interactive ? '127.0.0.1.nip.io' : 'artifactbin.test';
const base = `https://${hostname}:${tlsPort}`, controls = `https://i.${hostname}:${tlsPort}`;
const server = spawn(process.execPath,['--import',resolve('scripts/lib/controls-mail-stub.mjs'),resolve('dist/proxy-server.mjs')],{
  cwd:resolve('services/app'),stdio:['ignore','ignore','inherit'],env:{...process.env,
    NODE_ENV:'production',APP__PORT:String(port),APP__PUBLIC_BASE_URL:base,APP__CONTROLS_ORIGIN:controls,
    EMAIL__RESEND_API_KEY:'mxmx_test_controls_mail',EMAIL__DEV_OUTBOX_PATH:join(scratch,'mail.jsonl'),
    AUTH__SECRET:randomBytes(32).toString('hex'),DATABASE_URL:'pglite://memory',SQL__SERVICE_URL:'',BROWSER__SERVICE_URL:'',EVENTS__SERVICE_URL:'',
    OBJECT_STORE__LOCAL_DIR:join(scratch,'objects'),EXPORT__INTERNAL_ORIGIN:backend,ARTIFACTS__ALLOW_PUBLIC:'1',
    PROXY__RATE_LIMIT_CONFIG_FILE:resolve('services/proxy/dev_rate_limits.yml'),WEB_INGEST__ALLOW_PRIVATE:'1',
  },
});
let browser;
try {
  let ready = false;
  for (let i=0;i<300;i++) {
    if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`);
    if (await fetch(backend+'/health').then(r=>r.ok).catch(()=>false)) {ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,'server ready');
  const seed = await startDocument(backend);
  const authorScript=`
    try {parent.document.body.innerHTML='ESCAPED';mx.params.set('dom','escaped');}
    catch(error) {mx.params.set('dom',error.name);}
    try {localStorage.getItem('session');mx.params.set('storage','escaped');}
    catch(error) {mx.params.set('storage',error.name);}
    fetch('${base}/api/my/artifacts/${seed.id}/like',{method:'POST',credentials:'include'})
      .then(()=>mx.params.set('network','escaped'),()=>mx.params.set('network','blocked'));
    for (const kind of ['like','follow','edit']) {
      parent.postMessage({type:'mx:reader-action',kind},'*');
      parent.frames[0].postMessage({type:'mx:reader-action',kind},'${controls}');
    }
    parent.frames[0].postMessage({type:'mx:text-edit',path:'0',nonce:'guessed',innerHtml:'FORGED'},'${controls}');
  `;
  const markup='<Helmet><Value name="count" type="number" default={0}/><Value name="dom" type="string" default="waiting"/><Value name="storage" type="string" default="waiting"/><Value name="network" type="string" default="waiting"/><Mutation name="inc">{`update _signals set count=count+1`}</Mutation><script>{`'+authorScript+'`}</script></Helmet><main className="p-20"><h1>Top-level controls</h1><p id="editable">Original paragraph</p><Button run="$inc">Increment</Button><p>{$count}</p></main>';
  const response = await fetch(`${backend}/api/artifacts/${seed.id}`,{method:'PUT',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup,expectedVersion:1})});
  assert(response.ok,await response.text());
  if (interactive) {
    console.log(`Interactive local fixture: ${base}/a/${seed.id}\nControls host: ${controls}/a/${seed.id}`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  } else {
  browser = await chromium.launch({args:['--host-resolver-rules=MAP artifactbin.test 127.0.0.1, MAP i.artifactbin.test 127.0.0.1','--proxy-bypass-list=*']});
  const page = await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
  page.setDefaultTimeout(10000);
  page.on('response',response=>{if(response.status()>=400) console.error('HTTP',response.status(),response.url());});
  page.on('pageerror',error=>console.error(error.message));
  page.on('console',message=>{if(message.type()==='error') console.error(message.text());});
  await becomeOwner(page,base,seed.token);
  const privilegedRequests=[];
  page.on('request',r=>{if(r.method()!=='GET' && /\/(like|follow|edits|annotations)(?:\?|$)/.test(new URL(r.url()).pathname)) privilegedRequests.push(r.url());});
  await page.goto(`${base}/a/${seed.id}`);
  assert.equal(await page.locator('iframe[title="artifact"]').count(),0);
  await page.getByRole('heading',{name:'Top-level controls'}).waitFor();
  await page.waitForFunction(()=>window.mx?.params.get('dom')==='SecurityError' && window.mx.params.get('storage')==='SecurityError' && window.mx.params.get('network')==='blocked');
  assert.deepEqual(privilegedRequests,[],'isolated author code cannot invoke account APIs');
  assert.equal(await page.locator('iframe[title="Isolated artifact script"]').getAttribute('sandbox'),'allow-scripts');
  const chrome = page.frameLocator('iframe[title="Artifact controls"]');
  await chrome.getByRole('button',{name:'Open artifact controls',exact:true}).waitFor().catch(async error => {
    for (const frame of page.frames()) console.error('Frame:',frame.url(),(await frame.locator('body').innerText()).slice(0,700));
    throw error;
  });
  assert.equal(await chrome.locator('body').evaluate((_,main)=>new Promise(resolve=>{
    const listener=e=>{if(e.source===parent && e.origin===main && e.data==='mx:painted') {clearTimeout(timer);removeEventListener('message',listener);resolve(true);}};
    const timer=setTimeout(()=>{removeEventListener('message',listener);resolve(false);},1500);
    addEventListener('message',listener);parent.postMessage('mx:hello',main);
  }),base),true,'top-level runtime answers controls liveness checks');
  await page.getByRole('button',{name:'Increment',exact:true}).click();
  await page.waitForFunction(()=>window.mx?.params.get('count')===1);
  await chrome.getByRole('button',{name:'Open artifact controls',exact:true}).click();
  assert.equal(await chrome.getByLabel('Artifact viewport',{exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','expanded controls must not paint over the top-level artifact');
  await chrome.getByRole('button',{name:'Dark mode',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
  await chrome.getByRole('button',{name:'Light mode',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.classList.contains('light'));
  await chrome.getByRole('button',{name:'Edit artifact',exact:true}).click();
  const paragraph = page.locator('#editable[contenteditable="true"]');
  await paragraph.waitFor();
  await paragraph.fill('Saved from the top-level document');
  await paragraph.press('Tab');
  await page.waitForTimeout(1500);
  const saved = await fetch(`${backend}/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());
  assert.match(saved.markup,/Saved from the top-level document/);
  await page.reload();
  await page.getByText('Saved from the top-level document',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="artifact"]').count(),0);
  const beforeComment=await fetch(`${backend}/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());
  await page.locator('#editable').click({clickCount:3});
  await page.getByLabel('Comment on selected text',{exact:true}).click();
  await chrome.getByLabel('Annotation comment',{exact:true}).fill('Two-origin comment');
  await chrome.getByLabel('Save annotation',{exact:true}).click();
  await page.locator('#editable[data-mx-annotated]').waitFor();
  const afterComment=await fetch(`${backend}/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());
  assert.equal(afterComment.version,beforeComment.version,'comments do not create document edits');
  assert.equal(afterComment.markup,beforeComment.markup,'comments leave markup unchanged');
  await chrome.getByLabel('Toggle comments',{exact:true}).click();
  await chrome.getByLabel('Annotation sidebar',{exact:true}).waitFor();
  await chrome.getByLabel('Close comments',{exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await chrome.getByLabel('Toggle comments',{exact:true}).click();
  await chrome.getByLabel('Annotation sidebar',{exact:true}).waitFor();
  await chrome.getByLabel('Close comments',{exact:true}).click();
  await page.getByRole('button',{name:'Increment',exact:true}).click();
  await page.waitForFunction(()=>window.mx?.params.get('count')===2);
  const scriptElement=await page.locator('iframe[title="Isolated artifact script"]').elementHandle();
  const isolated=await scriptElement.contentFrame();
  const beforeNavigation=privilegedRequests.length;
  await isolated.evaluate(url=>{location.href=url;},`${controls}/a/${seed.id}`);
  await page.locator('iframe[title="Isolated artifact script"]').waitFor({state:'detached'});
  assert.equal(privilegedRequests.length,beforeNavigation,'navigating the opaque author frame cannot acquire trusted controls authority');
  const sink={lastCode(email) {
    const messages=readFileSync(join(scratch,'mail.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    return /\b(\d{6})\b/.exec(messages.filter(m=>m.to===email).at(-1)?.text ?? '')?.[1];
  }};
  await loginViaEmail(page,base,sink,`mxmx_test_controls_${Date.now()}@example.com`);
  await page.goto(base+'/account');
  await page.getByLabel('Token to claim',{exact:true}).fill(seed.token);
  await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.getByLabel('Claim token',{exact:true}).click()]);
  await page.goto(`${base}/a/${seed.id}`);
  await chrome.getByLabel('Like artifact',{exact:true}).click();
  await chrome.locator('[aria-label="Like artifact"][aria-pressed="true"]').waitFor();
  await page.reload();
  await chrome.locator('[aria-label="Like artifact"][aria-pressed="true"]').waitFor();
  await chrome.getByLabel('Open artifact controls',{exact:true}).click();
  await chrome.getByLabel('Share',{exact:true}).click();
  await chrome.getByLabel('Edit social preview',{exact:true}).click();
  await chrome.getByAltText('Artifact preview',{exact:true}).evaluate(el=>new Promise((resolve,reject)=>{
    if(el.complete && el.naturalWidth>0) return resolve(true);
    el.addEventListener('load',()=>resolve(true),{once:true});
    el.addEventListener('error',()=>reject(new Error('Protected preview failed to load from API origin')),{once:true});
    setTimeout(()=>reject(new Error('Protected preview timed out')),30000);
  }));
  await chrome.getByLabel('Cancel social preview',{exact:true}).click();
  const datasetResponse=await fetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({dataset:[{secret:41}],visibility:'private'})});
  assert.equal(datasetResponse.status,201);
  const dataset=await datasetResponse.json();
  const privateResponse=await fetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:`<Helmet><Value name="delta" type="number" default={0}/><Query name="answers">{\`select secret + $delta as answer from ref_${dataset.id}\`}</Query><Mutation name="inc">{\`update _signals set delta=delta+1\`}</Mutation></Helmet><h1>Private data</h1><Number data="$answers" col="answer" agg="sum"/><Button run="$inc">Change private query</Button>`})});
  assert.equal(privateResponse.status,201,privateResponse.status===201 ? undefined : await privateResponse.text());
  const privateDoc=await privateResponse.json();
  await page.goto(`${base}/a/${privateDoc.id}`);
  await page.getByText('41',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Change private query',exact:true}).click();
  await page.getByText('42',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="artifact"]').count(),0,'private data also renders top-level');
  await page.goto(`${base}/a/${seed.id}`);
  const reader=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
  await loginViaEmail(reader,base,sink,`mxmx_test_controls_reader_${Date.now()}@example.com`);
  await reader.goto(`${base}/a/${seed.id}`);
  const readerChrome=reader.frameLocator('iframe[title="Artifact controls"]');
  await readerChrome.getByLabel('Follow author',{exact:true}).click();
  await readerChrome.locator('[aria-label="Follow author"][aria-pressed="true"]').waitFor();
  assert.equal((await reader.goto(`${base}/a/${privateDoc.id}`)).status(),404,'private dataset document is not exposed to another account');
  await reader.goto(`${base}/a/${seed.id}`);
  await reader.reload();
  await readerChrome.locator('[aria-label="Follow author"][aria-pressed="true"]').waitFor();
  const privateStatus=await chrome.locator('body').evaluate(async (_,args)=>(await fetch(args.base+`/api/my/artifacts/${args.id}/sharing`,{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({visibility:'private'})})).status,{base,id:seed.id});
  assert.equal(privateStatus,200);
  assert.equal((await reader.reload()).status(),404,'a nonmember loses private document access');
  assert.equal(await reader.getByRole('heading',{name:'Top-level controls'}).count(),0);
  await page.reload();
  await page.getByRole('heading',{name:'Top-level controls'}).waitFor();
  await chrome.getByLabel('Open menu',{exact:true}).click();
  await chrome.getByLabel('Sign out',{exact:true}).click();
  await page.waitForURL(base+'/');
  assert.notEqual(await page.evaluate(async ()=>(await fetch('/api/page/session').then(r=>r.json())).kind),'account','cross-origin sign-out clears the account session');
  // Account logout deliberately does not revoke independently held agent
  // capabilities. Disconnect that browser capability through its own UI.
  await page.getByLabel('Open menu',{exact:true}).click();
  await page.getByLabel('Disconnect this browser',{exact:true}).click();
  await page.waitForFunction(async ()=>(await fetch('/api/page/session').then(r=>r.json())).kind!=='anon');
  assert.equal((await page.goto(`${base}/a/${seed.id}`)).status(),404,'disconnected browser loses private document access');
  await reader.close();
  console.log('PASS: two-origin top-level editing/reload, local SQL, appearance, relation-only comments, mobile hit-testing, author isolation/navigation revocation, OTP login, like/follow persistence, private ACLs, logout and browser disconnect');
  }
} finally {
  await browser?.close();
  if (server.exitCode === null) {server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
  tls.closeAllConnections();
  await new Promise(resolve=>tls.close(resolve));
  rmSync(scratch,{recursive:true,force:true});
}
