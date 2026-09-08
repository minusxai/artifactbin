import {storyFrame,assertTrustedChrome} from './lib/gate-browser.mjs';
/** First-party shadow chrome + opaque author realms + asset-only origin acceptance. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {createServer as httpsServer} from 'node:https';
import {request as httpRequest,createServer as httpServer} from 'node:http';
import net from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {chromium,firefox,webkit} from './lib/gate-browser.mjs';
import {startDocument,becomeOwner} from './lib/start-doc.mjs';
import {loginViaEmail} from './lib/mail-login.mjs';
import {measureInteraction} from './lib/interaction-perf.mjs';
import {verifyControlsLogin} from './lib/controls-login.mjs';
import {verifyMainPageLogin} from './lib/main-page-login.mjs';
import {verifyPublicFirstPaint} from './lib/public-first-paint.mjs';

const scratch = mkdtempSync(join(tmpdir(),'afbin-controls-gate-'));
const interactive=process.argv.includes('--interactive');
const localDev=process.argv.includes('--local-dev');
const anonymousLive=process.argv.find(arg=>arg.startsWith('--anonymous-live='))?.split('=')[1] !== 'false';
// A delegated worktree may reserve its own port block; default gates remain ephemeral.
const portBase=Number(process.argv.find(arg=>arg.startsWith('--port-base='))?.split('=')[1] ?? 0);
assert(Number.isInteger(portBase) && portBase>=0 && portBase<=65400,'valid port block');
// Planning validation can run the exact product gate in other engines.
const engineName=process.argv.find(arg=>arg.startsWith('--browser='))?.split('=')[1] ?? 'chromium';
const engine={chromium,firefox,webkit}[engineName];
assert(engine,`Unknown browser engine: ${engineName}`);
const socket = net.createServer();
await new Promise(resolve => socket.listen(portBase ? portBase+1 : 0,'127.0.0.1',resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const backend = `http://localhost:${port}`;
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=artifactbin.test','-keyout',join(scratch,'key.pem'),'-out',join(scratch,'cert.pem')],{stdio:'ignore'});
const forward=(req,res) => {
  const upstream = httpRequest(backend+req.url,{method:req.method,headers:{...req.headers,'x-forwarded-host':req.headers.host,'x-forwarded-proto':localDev?'http':'https'}},answer => {
    res.writeHead(answer.statusCode,answer.headers);answer.pipe(res);
  });
  upstream.on('error',()=>{res.writeHead(502);res.end();});
  req.pipe(upstream);
};
const tls = localDev?httpServer(forward):httpsServer({key:readFileSync(join(scratch,'key.pem')),cert:readFileSync(join(scratch,'cert.pem'))},forward);
await new Promise(resolve=>tls.listen(portBase,'127.0.0.1',resolve));
const tlsPort = tls.address().port;
const hostname=localDev?'artifactbin.localhost':interactive || engineName!=='chromium' ? '127.0.0.1.nip.io' : 'artifactbin.test';
const scheme=localDev?'http':'https';
const base = `${scheme}://${hostname}:${tlsPort}`, controls = `${scheme}://i.${hostname}:${tlsPort}`;
const assets=`${scheme}://assets.${hostname}:${tlsPort}`,authSecret=randomBytes(32).toString('hex');
const assetFixture=httpServer((req,res)=>{if(req.url!=='/preview.js'){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/javascript'});res.end('mx.params.set("privateAsset","loaded")');});
await new Promise(resolve=>assetFixture.listen(portBase?portBase+2:0,'127.0.0.1',resolve));
const previewBundle=`http://127.0.0.1:${assetFixture.address().port}/preview.js`;
// Node's fetch ignores an explicit Host header (measured on Node 22). Use
// the HTTP client for fixture setup against the actual configured hostname.
const mainFetch = (url, init = {}) => new Promise((resolve,reject) => {
  const req=httpRequest(url,{method:init.method ?? 'GET',headers:{...init.headers,host:new URL(base).host}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
    res.on('end',()=>resolve(new Response([204,304].includes(res.statusCode) ? null : Buffer.concat(chunks),{status:res.statusCode,headers:res.headers})));
  });
  req.on('error',reject);req.end(init.body);
});
const server = spawn(process.execPath,['--import',resolve('scripts/lib/controls-mail-stub.mjs'),resolve('dist/proxy-server.mjs')],{
  cwd:resolve('services/app'),stdio:['ignore','ignore','inherit'],env:{...process.env,
    NODE_ENV:'production',APP__PORT:String(port),APP__PUBLIC_BASE_URL:base,APP__CONTROLS_ORIGIN:'',APP__ASSETS_ORIGIN:assets,
    FEATURE_FLAG__LIVE_UPDATES_ANON_ENABLED:String(anonymousLive),
    EMAIL__RESEND_API_KEY:'mxmx_test_controls_mail',EMAIL__DEV_OUTBOX_PATH:join(scratch,'mail.jsonl'),
    AUTH__SECRET:authSecret,DATABASE_URL:'pglite://memory',SQL__SERVICE_URL:'',BROWSER__SERVICE_URL:'',EVENTS__SERVICE_URL:'',
    OBJECT_STORE__LOCAL_DIR:join(scratch,'objects'),EXPORT__INTERNAL_ORIGIN:base,ARTIFACTS__ALLOW_PUBLIC:'1',
    PROXY__RATE_LIMIT_CONFIG_FILE:resolve('services/proxy/dev_rate_limits.yml'),WEB_INGEST__ALLOW_PRIVATE:'1',
  },
});
let browser;
try {
  let ready = false;
  for (let i=0;i<300;i++) {
    if (server.exitCode !== null) throw new Error(`Server exited ${server.exitCode}`);
    if (await mainFetch(backend+'/health').then(r=>r.ok).catch(()=>false)) {ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(ready,'server ready');
  const seed = await startDocument(backend,{},mainFetch);
  const authorScript=`
    try {parent.document.body.innerHTML='ESCAPED';mx.params.set('dom','escaped');}
    catch(error) {mx.params.set('dom',error.name);}
    try {localStorage.getItem('session');mx.params.set('storage','escaped');}
    catch(error) {mx.params.set('storage',error.name);}
    fetch('${base}/api/my/artifacts/${seed.id}/like',{method:'POST',credentials:'include'})
      .then(()=>mx.params.set('network','escaped'),()=>mx.params.set('network','blocked'));
    for (const kind of ['like','follow','edit']) {
      parent.postMessage({type:'mx:reader-action',kind},'*');
      parent.postMessage({type:'mx:reader-action',kind},'${base}');
    }
    parent.postMessage({type:'mx:text-edit',path:'0',nonce:'guessed',innerHtml:'FORGED'},'${base}');
  `;
  const markup='<Helmet><Value name="count" type="number" default={0}/><Value name="dom" type="string" default="waiting"/><Value name="storage" type="string" default="waiting"/><Value name="network" type="string" default="waiting"/><Mutation name="inc">{`update _signals set count=count+1`}</Mutation><script>{`'+authorScript+'`}</script></Helmet><main className="p-20"><h1>Top-level controls</h1><p id="editable">Original paragraph</p><Button run="$inc">Increment</Button><p>{$count}</p></main>';
  const fixtureMarkup=markup.replace('<Helmet>','<Helmet><Value name="region" type="string" default="east"/>');
  const response = await mainFetch(`${backend}/api/artifacts/${seed.id}`,{method:'PUT',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:fixtureMarkup,expectedVersion:1})});
  assert(response.ok,await response.text());
  const sink={lastCode(email) {
    const messages=readFileSync(join(scratch,'mail.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    return /\b(\d{6})\b/.exec(messages.filter(m=>m.to===email).at(-1)?.text ?? '')?.[1];
  }};
  if (interactive) {
    const demoHtml='<canvas id="scene" style="width:100%;height:100%"></canvas><span style="position:absolute;bottom:12px;left:16px;color:#cbd5e1;font:14px system-ui">Drag to rotate · scroll to zoom · Increment changes the cube</span>';
    const demoScript=`(async()=>{
      const T=await artifact.library('three'),canvas=document.getElementById('scene');
      const renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
      const scene=new T.Scene();scene.background=new T.Color('#0f172a');
      const camera=new T.PerspectiveCamera(45,1,.1,100);camera.position.set(3,2,4);
      const cube=new T.Mesh(new T.BoxGeometry(1.3,1.3,1.3),new T.MeshNormalMaterial());scene.add(cube);
      const controls=new T.OrbitControls(camera,canvas);
      const render=()=>renderer.render(scene,camera);
      const resize=()=>{renderer.setSize(innerWidth,innerHeight,false);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();};
      controls.addEventListener('change',render);addEventListener('resize',resize);
      const unsubscribe=mx.params.subscribe(v=>{cube.rotation.y=v.count*.35;render();});resize();
      addEventListener('pagehide',()=>{unsubscribe();controls.dispose();cube.geometry.dispose();cube.material.dispose();renderer.dispose();});
    })().catch(e=>{document.body.textContent=e.message;});`;
    const demo=markup+`<Sandbox title="Interactive cube" height={360} html={${JSON.stringify(demoHtml)}} script={${JSON.stringify(demoScript)}}/>`;
    const saved=await mainFetch(`${backend}/api/artifacts/${seed.id}`,{method:'PUT',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:demo,expectedVersion:2})});
    assert(saved.ok,await saved.text());
    console.log(`Interactive local fixture: ${base}/a/${seed.id}\nControls host: ${controls}/controls/a/${seed.id}`);
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
  } else if(process.argv.includes('--main-page-login-only')) {
    browser=await engine.launch(engineName==='chromium'?{args:['--host-resolver-rules=MAP artifactbin.test 127.0.0.1, MAP i.artifactbin.test 127.0.0.1, MAP assets.artifactbin.test 127.0.0.1','--proxy-bypass-list=*']}:{});
    await verifyMainPageLogin({browser,base,controls,sink,id:seed.id,mainFetch,backend});
  } else {
  browser = await engine.launch(engineName==='chromium' ? {args:['--host-resolver-rules=MAP artifactbin.test 127.0.0.1, MAP i.artifactbin.test 127.0.0.1, MAP assets.artifactbin.test 127.0.0.1','--proxy-bypass-list=*']} : {});
  await verifyPublicFirstPaint({browser,base,controls});
  await verifyMainPageLogin({browser,base,controls,sink,id:seed.id,mainFetch,backend});
  // Actual production configuration, no client mocks: an anonymous reader
  // either subscribes normally or never opens a connection, including reload.
  const snapshot=await browser.newPage({ignoreHTTPSErrors:true});
  const anonStreams=[];
  snapshot.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/events')) anonStreams.push(request.url());});
  for(let load=0;load<2;load++){
    await snapshot.goto(`${base}/a/${seed.id}`);
    await snapshot.mainFrame().getByRole('button',{name:'Open artifact controls',exact:true}).waitFor();
    await snapshot.waitForFunction(()=>!!window.mx);
    await snapshot.getByRole('button',{name:'Increment',exact:true}).click();
    await snapshot.waitForFunction(()=>window.mx.params.get('count')===1);
    if(anonymousLive) await snapshot.waitForTimeout(300);
    assert.equal(anonStreams.length>0,anonymousLive,'anonymous live configuration governs the actual controls stream, not local UI');
  }
  if(!anonymousLive){
    assert.equal(anonStreams.length,0);
    // A stale pre-flag client receives EventSource's terminal response, not a
    // retrying error. The stream endpoint also refuses frame-poll bypasses.
    await snapshot.evaluate(()=>{window.__probeStream=new EventSource(location.pathname+'/events');});
    await snapshot.waitForTimeout(3500);
    assert.equal(anonStreams.length,1,'204 prevents stale clients from reconnecting');
    const status=await Promise.all(['events/frame','events/authorize'].map(path=>mainFetch(`${backend}/a/${seed.id}/${path}`).then(r=>r.status)));
    assert.deepEqual(status,[204,204]);
  }
  await snapshot.close();
  const page = await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
  page.setDefaultTimeout(10000);
  page.on('response',response=>{if(response.status()>=400) console.error('HTTP',response.status(),response.url());});
  page.on('pageerror',error=>console.error(error.message));
  page.on('console',message=>{if(message.type()==='error') console.error(message.text());});
  await becomeOwner(page,base,seed.token);
  const anonymousPrivate=await mainFetch(`${backend}/api/artifacts`,{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:'<h1>Anonymous private fixture</h1>',visibility:'private'})});
  assert.equal(anonymousPrivate.status,400);
  assert.equal((await anonymousPrivate.json()).error,'private_requires_account','the auth split does not change who may create private documents');
  const peer=await browser.newPage({ignoreHTTPSErrors:true});
  peer.on('console',message=>{if(message.type()==='error')console.error('PEER',message.text());});
  peer.on('requestfailed',request=>console.error('PEER REQUEST FAILED',new URL(request.url()).pathname,request.failure()?.errorText));
  await becomeOwner(peer,base,seed.token);
  const privilegedRequests=[];
  const authenticatedStreams=[];
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/events')) authenticatedStreams.push(request.url());});
  page.on('request',r=>{if(r.method()!=='GET' && /\/(like|follow|edits|annotations)(?:\?|$)/.test(new URL(r.url()).pathname)) privilegedRequests.push(r.url());});
  await page.goto(`${base}/a/${seed.id}`);
  assert.equal(await page.locator('iframe[title="artifact"]').count(),0);
  await page.getByRole('heading',{name:'Top-level controls'}).waitFor();
  await page.waitForFunction(()=>window.mx?.params.get('dom')==='SecurityError' && window.mx.params.get('storage')==='SecurityError' && window.mx.params.get('network')==='blocked');
  assert.deepEqual(privilegedRequests,[],'isolated author code cannot invoke account APIs');
  assert.equal(await page.locator('iframe[title="Isolated artifact script"]').getAttribute('sandbox'),'allow-scripts');
  const chrome = page.mainFrame();
  await chrome.getByRole('button',{name:'Open artifact controls',exact:true}).waitFor().catch(async error => {
    for (const frame of page.frames()) console.error('Frame:',frame.url(),(await frame.locator('body').innerText()).slice(0,700));
    throw error;
  });
  assert(authenticatedStreams.length>0,'a token-holding authenticated browser stays live under either flag');
  await assertTrustedChrome(page);
  assert.equal(await page.locator('iframe[title="Artifact controls"],iframe[title="Artifactbin app"]').count(),0,'no whole-page controls transport');
  assert.equal(await page.evaluate(()=>location.origin),base,'browser and authentication remain first-party');
  for(const path of ['/login','/api/page/session','/api/my/artifacts','/oauth/authorize']){
    const denied=await page.request.get(assets+path,{maxRedirects:0});
    assert.equal(denied.status(),404,'asset-only origin exposes no UI/auth/API: '+path);
  }
  await page.getByRole('button',{name:'Increment',exact:true}).click();
  if(process.argv.includes('--measure-perf')) await measureInteraction({page,base,controls,engineName,publish:async body=>{
    const response=await mainFetch(`${backend}/api/artifacts`,{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,201);return response.json();
  }});
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
  const saved = await mainFetch(`${backend}/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());
  assert.match(saved.markup,/Saved from the top-level document/);
  await page.reload();
  await page.getByText('Saved from the top-level document',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="artifact"]').count(),0);
  const beforeComment=await mainFetch(`${backend}/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());
  await page.locator('#editable').click({clickCount:3});
  await page.getByLabel('Comment on selected text',{exact:true}).click();
  await chrome.getByLabel('Annotation comment',{exact:true}).fill('Two-origin comment');
  await chrome.getByLabel('Save annotation',{exact:true}).click();
  await page.locator('#editable[data-mx-annotated]').waitFor();
  const afterComment=await mainFetch(`${backend}/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${seed.token}`}}).then(r=>r.json());
  assert.equal(afterComment.version,beforeComment.version,'comments do not create document edits');
  assert.equal(afterComment.markup,beforeComment.markup,'comments leave markup unchanged');
  await chrome.getByLabel('Toggle comments',{exact:true}).click();
  await chrome.getByLabel('Annotation sidebar',{exact:true}).waitFor();
  await chrome.getByLabel('Close comments',{exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await chrome.getByLabel('Toggle comments',{exact:true}).click();
  await chrome.getByLabel('Annotation sidebar',{exact:true}).waitFor();
  assert.equal(await chrome.getByLabel('Annotation sidebar',{exact:true}).getAttribute('aria-modal'),null,'half sheet is nonmodal');
  assert.equal(await chrome.getByLabel('Annotation sidebar',{exact:true}).evaluate(el=>getComputedStyle(el).animationName),'none','controls geometry does not animate ahead of its clip');
  await page.getByRole('button',{name:'Increment',exact:true}).click();
  await page.waitForFunction(()=>window.mx?.params.get('count')===2);
  await page.keyboard.press('Escape');
  await chrome.getByLabel('Annotation sidebar',{exact:true}).waitFor({state:'detached'});
  await chrome.getByRole('button',{name:'Open artifact controls',exact:true}).click();
  await chrome.getByRole('button',{name:'Share',exact:true}).click();
  await chrome.getByRole('dialog',{name:'Sharing',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('#editable')?.closest('[inert]'));
  for(let i=0;i<20;i++) {
    await page.keyboard.press('Tab');
    assert.equal(await chrome.getByRole('dialog',{name:'Sharing',exact:true}).evaluate(el=>el.contains(el.getRootNode().activeElement)),true,'Tab stays within the actual closed-root modal');
  }
  await page.keyboard.press('Escape');
  await chrome.getByRole('dialog',{name:'Sharing',exact:true}).waitFor({state:'detached'});
  await page.waitForFunction(()=>!document.querySelector('#editable')?.closest('[inert]'));
  const scriptElement=await page.locator('iframe[title="Isolated artifact script"]').elementHandle();
  const isolated=await scriptElement.contentFrame();
  const beforeNavigation=privilegedRequests.length;
  await isolated.evaluate(url=>{location.href=url;},`${base}/account`);
  await page.locator('iframe[title="Isolated artifact script"]').waitFor({state:'detached'});
  assert.equal(privilegedRequests.length,beforeNavigation,'navigating the opaque author frame cannot acquire trusted controls authority');
  await loginViaEmail(page,base,sink,`mxmx_test_controls_${Date.now()}@example.com`);
  await page.goto(base+'/account');
  const appFrame=page.mainFrame();
  await appFrame.getByLabel('Token to claim',{exact:true}).fill(seed.token);
  assert.equal(await appFrame.getByLabel('Token to claim',{exact:true}).evaluate(el=>el.ownerDocument===document),true,'account claim UI is first-party');
  await appFrame.getByLabel('Claim token',{exact:true}).click();
  await appFrame.getByText(/Claimed —/).waitFor();
  await page.goto(`${base}/a/${seed.id}`);
  await verifyControlsLogin({browser,owner:chrome,base,controls,sink});
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
  // Native HTTP callback admission deliberately stays literal loopback; the
  // app's same-site *.localhost development hosts do not broaden that policy.
  const oauthRedirect=(localDev?'http://127.0.0.1:5498':base)+'/oauth-browser-callback',verifier=randomBytes(32).toString('base64url');
  if(localDev)await page.route(oauthRedirect+'?*',route=>route.fulfill({contentType:'text/html',body:'Connected'}));
  const registered=await mainFetch(backend+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Security gate client',redirect_uris:[oauthRedirect]})});
  assert.equal(registered.status,201);
  const client=(await registered.json()).client_id;
  const authorizeQuery=new URLSearchParams({client_id:client,redirect_uri:oauthRedirect,response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:base+'/mcp',scope:'artifacts',state:'browser-gate'});
  await page.goto(base+'/oauth/authorize?'+authorizeQuery);
  await appFrame.getByLabel('Approve connection',{exact:true}).click();
  await page.waitForURL(url=>url.origin===new URL(oauthRedirect).origin && url.pathname==='/oauth-browser-callback');
  const oauthCallback=new URL(page.url());
  assert.equal(oauthCallback.searchParams.get('state'),'browser-gate');
  const exchange=await mainFetch(backend+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client,redirect_uri:oauthRedirect,code:oauthCallback.searchParams.get('code'),code_verifier:verifier,resource:base+'/mcp'}).toString()});
  assert.equal(exchange.status,200);
  const mcpToken=(await exchange.json()).access_token;
  assert.equal(typeof mcpToken,'string','native trusted approval produces a real MCP credential');
  assert.equal((await mainFetch(backend+`/api/artifacts/${seed.id}`,{headers:{Authorization:`Bearer ${mcpToken}`}})).status,401,'MCP credentials cannot regain authority through a legacy app bearer resolver');
  await page.goto(`${base}/a/${seed.id}`);
  const datasetResponse=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({dataset:[{secret:41}],visibility:'private'})});
  assert.equal(datasetResponse.status,201);
  const dataset=await datasetResponse.json();
  const privateResponse=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:`<Helmet><Value name="delta" type="number" default={0}/><Query name="answers">{\`select secret + $delta as answer from ref_${dataset.id}\`}</Query><Mutation name="inc">{\`update _signals set delta=delta+1\`}</Mutation></Helmet><h1>Private data</h1><Number data="$answers" col="answer" agg="sum"/><Button run="$inc">Change private query</Button>`})});
  assert.equal(privateResponse.status,201,privateResponse.status===201 ? undefined : await privateResponse.text());
  const privateDoc=await privateResponse.json();
  // The capture shell is the remaining real framed ArtifactSurface path.
  // Exercise its scoped parent relay, not just the top-level reader resolver.
  const previewMarkup='<Helmet><Value name="privateAsset" type="string" default="waiting"/></Helmet><p aria-label="Private asset">{$privateAsset}</p><Iframe title="Private managed preview"><p id="managed-style-proof" style="color:rgb(12, 34, 56)">Styled content</p><script src="'+previewBundle+'"/></Iframe>';
  const previewResponse=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:previewMarkup,visibility:'private'})});
  assert.equal(previewResponse.status,201,await previewResponse.clone().text());const previewDoc=await previewResponse.json();
  const capture=await browser.newPage({ignoreHTTPSErrors:true});
  capture.on('console',message=>{if(message.type()==='error')console.error('CAPTURE',message.text());});
  capture.on('pageerror',error=>console.error('CAPTURE PAGE',error.message));
  assert.equal((await capture.goto(base+'/a/'+previewDoc.id)).status(),404);
  const expiry=Date.now()+60_000,key=expiry+'.'+createHmac('sha256',authSecret).update(previewDoc.id+'.'+expiry).digest('hex');
  const resolverRequests=[];capture.on('request',request=>{if(request.url().includes('/assets?'))resolverRequests.push(request.url());});
  await capture.addInitScript(()=>{window.__typedAssets=[];addEventListener('message',event=>{if(event.data?.type==='mx:asset')window.__typedAssets.push(event.data.kind);});});
  await capture.goto(base+'/a/'+previewDoc.id+'?key='+key);
  const previewFrame=await storyFrame(capture);
  try{await previewFrame.getByLabel('Private asset',{exact:true}).filter({hasText:'loaded'}).waitFor({timeout:20000});}
  catch(error){console.error('CAPTURE STATE',await previewFrame.locator('body').innerText(),await capture.evaluate(()=>window.__typedAssets),resolverRequests.map(url=>new URL(url).pathname));throw error;}
  assert((await capture.evaluate(()=>window.__typedAssets)).includes('script'),'private capture imports script through typed parent relay');
  assert(resolverRequests.some(url=>new URL(url).searchParams.get('key')===key),'platform parent supplies source-scoped capture key');
  let styled=false;
  for(const inner of capture.frames())if(await inner.locator('#managed-style-proof').count()){
    assert.equal(await inner.locator('#managed-style-proof').evaluate(el=>getComputedStyle(el).color),'rgb(12, 34, 56)','managed CSS survives inherited wrapper CSP');styled=true;
  }
  assert(styled,'managed styled DOM was rendered inside its own isolated frame');
  await capture.close();
  console.log('PASS: private framed capture preview resolves bundled script via typed asset relay and parent-owned scoped key');
  const invitedEmail=`mxmx_test_controls_invited_${Date.now()}@example.com`;
  assert.equal(await chrome.locator('body').evaluate(async (_,args)=>(await fetch(`/api/my/artifacts/${args.id}/sharing`,{method:'PUT',headers:{'Content-Type':'application/json','x-artifactbin-csrf':'1'},body:JSON.stringify({shares:[{email:args.email,role:'viewer'}]})})).status,{id:privateDoc.id,email:invitedEmail}),200);
  const invited=await browser.newPage({ignoreHTTPSErrors:true});
  await invited.goto(`${base}/login?callbackUrl=${encodeURIComponent('/a/'+privateDoc.id)}`);
  const invitedLogin=invited.mainFrame();
  await invitedLogin.getByLabel('Email',{exact:true}).fill(invitedEmail);
  await invitedLogin.getByLabel('Log in with email',{exact:true}).click();
  await invitedLogin.getByLabel('Login code',{exact:true}).waitFor();
  await invitedLogin.getByLabel('Login code',{exact:true}).fill(sink.lastCode(invitedEmail));
  const invitedLanding=invited.waitForResponse(r=>new URL(r.url()).pathname===`/api/page/artifact/${privateDoc.id}`);
  await invitedLogin.getByLabel('Verify code',{exact:true}).click();
  const invitedResponse=await invitedLanding;
  assert.equal(invitedResponse.status(),200,'first login can open an email-shared private artifact directly, without visiting the workspace first');
  assert.equal(new URL(invitedResponse.url()).origin,base,'private page data is delivered only by the first-party authenticated endpoint');
  await invited.getByRole('heading',{name:'Private data'}).waitFor();
  const publishShared=async body=>{
    const response=await mainFetch(backend+'/api/artifacts',{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(response.status,201,await response.clone().text());return response.json();
  };
  const sharedDataset=await publishShared({dataset:[{n:1}],access:'readwrite'});
  const sharedDoc=await publishShared({markup:`<Helmet><Query name="rows">{\`select * from ref_${sharedDataset.id}\`}</Query><Mutation name="add">{\`insert into ref_${sharedDataset.id} values (2)\`}</Mutation></Helmet><h1>Shared mutation</h1><Number data="$rows" col="n" agg="sum"/><Button run="$add">Add shared row</Button>`});
  for(const [id,role] of [[sharedDataset.id,'editor'],[sharedDoc.id,'viewer']]){
    assert.equal(await chrome.locator('body').evaluate(async(_,args)=>(await fetch(`/api/my/artifacts/${args.id}/sharing`,{method:'PUT',headers:{'Content-Type':'application/json','x-artifactbin-csrf':'1'},body:JSON.stringify({shares:[{email:args.email,role:args.role}]})})).status,{id,role,email:invitedEmail}),200);
  }
  await invited.goto(`${base}/a/${sharedDoc.id}`);
  await invited.getByText('1',{exact:true}).waitFor();
  await invited.getByRole('button',{name:'Add shared row',exact:true}).click();
  await invited.getByText('3',{exact:true}).waitFor();
  assert.equal(new URL(invited.url()).origin,base,'a permitted shared mutation needs no approval navigation');
  await invited.reload();
  await invited.getByText('3',{exact:true}).waitFor();
  await invited.close();
  assert.equal((await peer.goto(`${base}/a/${privateDoc.id}`)).status(),200,'a browser holding the claimed token can render private content without an account session');
  await peer.getByRole('heading',{name:'Private data'}).waitFor();
  await page.goto(`${base}/a/${privateDoc.id}`);
  await page.getByText('41',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Change private query',exact:true}).click();
  await page.getByText('42',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="artifact"]').count(),0,'private data also renders top-level');
  await page.goto(`${base}/a/${seed.id}`);
  const reader=await browser.newPage({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});
  await loginViaEmail(reader,base,sink,`mxmx_test_controls_reader_${Date.now()}@example.com`);
  await reader.goto(`${base}/a/${seed.id}`);
  const readerChrome=reader.mainFrame();
  await readerChrome.getByLabel('Follow author',{exact:true}).click();
  await readerChrome.locator('[aria-label="Follow author"][aria-pressed="true"]').waitFor();
  assert.equal((await reader.goto(`${base}/a/${privateDoc.id}`)).status(),404,'private dataset document is not exposed to another account');
  await reader.goto(`${base}/a/${seed.id}`);
  await reader.reload();
  await readerChrome.locator('[aria-label="Follow author"][aria-pressed="true"]').waitFor();
  const privateStatus=await chrome.locator('body').evaluate(async (_,args)=>(await fetch(`/api/my/artifacts/${args.id}/sharing`,{method:'PUT',headers:{'Content-Type':'application/json','x-artifactbin-csrf':'1'},body:JSON.stringify({visibility:'private'})})).status,{id:seed.id});
  assert.equal(privateStatus,200);
  assert.equal((await reader.reload()).status(),404,'a nonmember loses private document access');
  assert.equal(await reader.getByRole('heading',{name:'Top-level controls'}).count(),0);
  await page.reload();
  await page.getByRole('heading',{name:'Top-level controls'}).waitFor();
  await chrome.getByLabel('Open menu',{exact:true}).click();
  await chrome.getByLabel('Sign out',{exact:true}).click();
  await page.waitForURL(base+'/');
  const homeChrome=page.mainFrame();
  const sessionKind=()=>homeChrome.locator('body').evaluate(async ()=>{
    const response=await fetch('/api/page/session',{headers:{'x-artifactbin-csrf':'1'}});
    if (!response.ok) throw new Error(`Session read failed: ${response.status}`);
    return (await response.json()).kind;
  });
  assert.equal(await sessionKind(),'anon','sign-out clears the account session but preserves independent agent capabilities');
  // Account logout deliberately does not revoke independently held agent
  // capabilities. Disconnect that browser capability through its own UI.
  await homeChrome.getByLabel('Open menu',{exact:true}).click();
  const retainedCookies=await page.context().cookies();
  // Disconnect performs a same-URL full navigation. Polling fetch during that
  // transition fails in WebKit's outgoing context; await the navigation itself.
  await homeChrome.getByLabel('Disconnect this browser',{exact:true}).click();
  await page.waitForFunction(async()=>{const r=await fetch('/api/page/session');return r.ok&&(await r.json()).kind==='none';});
  assert.equal(await sessionKind(),'none');
  assert.equal((await page.goto(`${base}/a/${seed.id}`)).status(),404,'disconnected browser loses private document access');
  await page.context().addCookies(retainedCookies);
  assert.equal((await page.goto(`${base}/a/${privateDoc.id}`)).status(),404,'retaining old cookies does not undo browser disconnect');
  assert.equal((await peer.reload()).status(),200,'disconnecting one browser does not revoke another holding the same token');
  // The visible author realm uses the same bridge as the hidden script, with
  // its own DOM and pinned libraries but no access to parent/control authority.
  const sandboxScript=`(async()=>{
    const THREE=await artifact.library('three');
    const report={vector:new THREE.Vector3(3,4,0).length()};
    const canvas=document.getElementById('scene');
    const draw=()=>{canvas.width=innerWidth;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='#ef3340';ctx.fillRect(0,0,canvas.width,100);mx.params.set('sandboxWidth',innerWidth);};
    addEventListener('resize',draw);draw();
    const increment=document.getElementById('increment');
    // WebKit does not focus native buttons on pointer click by default.
    // This fixture deliberately supports click-then-keyboard interaction.
    increment.addEventListener('click',()=>{increment.focus();mx.mutate('inc');});
    try{parent.document.body.textContent='ESCAPED';report.parent='escaped'}catch(e){report.parent=e.name}
    try{localStorage.setItem('leak','1');report.storage='escaped'}catch(e){report.storage=e.name}
    report.network=await fetch('${base}/api/my/artifacts',{credentials:'include'}).then(()=>false,()=>true);
    parent.postMessage({type:'mx:text-edit',path:'0',nonce:'guessed',innerHtml:'FORGED'},'*');
    mx.params.set('sandboxReport',JSON.stringify(report));
  })().catch(e=>mx.params.set('sandboxReport',JSON.stringify({error:String(e)})));`;
  const sandboxMarkup='<Helmet><Value name="sandboxReport" type="string" default=""/><Value name="sandboxWidth" type="number" default={0}/><Value name="n" type="number" default={0}/><Mutation name="inc">{`update _signals set n=n+1`}</Mutation></Helmet><h1>Visible sandbox boundary</h1><p>{$n}</p>'
    +`<Sandbox title="Interactive model" height={180} html={${JSON.stringify('<canvas id="scene" style="display:block;height:100px"></canvas><button id="increment" style="display:block;width:150px;height:40px" aria-label="Increment inside sandbox">Increment</button>')}} script={${JSON.stringify(sandboxScript)}}/>`;
  const sandboxResponse=await mainFetch(`${backend}/api/artifacts`,{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({markup:sandboxMarkup,visibility:'unlisted'})});
  assert.equal(sandboxResponse.status,201,await sandboxResponse.clone().text());
  const sandboxDoc=await sandboxResponse.json();
  await peer.goto(`${base}/a/${sandboxDoc.id}`);
  const visual=peer.locator('iframe[title="Interactive model"]');
  await peer.waitForFunction(()=>window.mx?.params.get('sandboxReport'));
  assert.deepEqual(await peer.evaluate(()=>JSON.parse(window.mx.params.get('sandboxReport'))),
    {vector:5,parent:'SecurityError',storage:'SecurityError',network:true});
  assert.equal(await peer.locator('#scene').count(),0);
  await visual.scrollIntoViewIfNeeded();
  const box=await visual.boundingBox();
  await peer.mouse.click(box.x+30,box.y+120);
  await peer.waitForFunction(()=>window.mx.params.get('n')===1);
  await peer.keyboard.press('Enter');
  await peer.waitForFunction(()=>window.mx.params.get('n')===2);
  const wide=await peer.evaluate(()=>window.mx.params.get('sandboxWidth'));
  await peer.setViewportSize({width:390,height:844});
  await peer.waitForFunction(w=>window.mx.params.get('sandboxWidth')<w,wide);
  assert((await peer.evaluate(()=>window.mx.params.get('sandboxWidth')))<=390,'sandbox resizes within mobile page');
  const storedSandbox=await (await mainFetch(`${backend}/api/artifacts/${sandboxDoc.id}`,{headers:{Authorization:`Bearer ${seed.token}`}})).json();
  assert.equal(storedSandbox.version,1,'forged edits and local state never change source');
  await peer.reload();
  await peer.waitForFunction(()=>window.mx.params.get('n')===0);
  const touch=await browser.newPage({ignoreHTTPSErrors:true,hasTouch:true,viewport:{width:390,height:844}});
  await touch.goto(`${base}/a/${sandboxDoc.id}`);
  const touchFrame=touch.locator('iframe[title="Interactive model"]');
  await touch.waitForFunction(()=>window.mx?.params.get('sandboxReport'));
  await touchFrame.scrollIntoViewIfNeeded();const touchBox=await touchFrame.boundingBox();
  await touch.touchscreen.tap(touchBox.x+30,touchBox.y+120);
  await touch.waitForFunction(()=>window.mx.params.get('n')===1);
  await touch.close();
  console.log('PASS: visible sandbox pinned library, canvas, pointer/keyboard input, responsive resize, local SQL, parent DOM/storage/API refusal and reload reset');
  await peer.close();
  await reader.close();
  assert(privilegedRequests.length>0 && privilegedRequests.every(url=>new URL(url).origin===base),'all observed authenticated writes stay on the first-party main origin');
  console.log('PASS: first-party shadow chrome, top-level editing/reload, local SQL, appearance, relation-only comments, mobile hit-testing, author isolation/navigation revocation, OTP login, like/follow persistence, human/anonymous private ACLs, immediate authorized shared mutations, logout, retained-cookie revocation and independent browser disconnect');
  }
} finally {
  await browser?.close();
  await new Promise(resolve=>assetFixture.close(resolve));
  if (server.exitCode === null && server.signalCode === null) {
    // Export starts Playwright inside this disposable server. Its signal
    // handler can keep Node alive after SIGTERM, even after every assertion
    // passed. Bound cleanup of this exact child, not the gate's assertions.
    const exited = new Promise(resolve=>server.once('exit',resolve));
    const force = setTimeout(()=>server.kill('SIGKILL'),2000);
    server.kill('SIGTERM');
    try {await exited;} finally {clearTimeout(force);}
  }
  tls.closeAllConnections();
  await new Promise(resolve=>tls.close(resolve));
  rmSync(scratch,{recursive:true,force:true});
}
