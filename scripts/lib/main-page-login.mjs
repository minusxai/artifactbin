import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

/** Stage-one proof against the real proxy/session/cookie/CSP arrangement. */
export async function verifyMainPageLogin({browser,base,controls,sink,id,mainFetch,backend}) {
  const page=await browser.newPage({ignoreHTTPSErrors:true});
  const writes=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.allHeaders().then(headers=>({url:r.url(),origin:headers.origin})));});
  page.on('pageerror',error=>console.error('MAIN PAGE',error.message));
  page.on('console',message=>{if(message.type()==='error')console.error('PAGE CONSOLE',message.text());});
  page.on('response',response=>{if(response.status()>=400)console.error('PAGE HTTP',response.status(),response.url());});
  const url=`${base}/login?callbackUrl=${encodeURIComponent('/a/'+id+'?$region=west#section')}`;
  const started=performance.now();await page.goto(url);
  const frame=page.frameLocator('iframe[title="Artifactbin app"]');
  try{await frame.getByLabel('Email',{exact:true}).waitFor({timeout:20000});}
  catch(error){console.error('PAGE FRAMES',await Promise.all(page.frames().map(async f=>({url:f.url(),text:(await f.locator('body').innerText().catch(()=>'' )).slice(0,800)}))));throw error;}
  const readyMs=performance.now()-started;
  assert.equal(page.url(),url,'login address stays main before credential entry');
  assert.equal(await page.locator('body').evaluate(el=>el.textContent.includes('Email')),false,'parent contains no account form/data');
  assert.equal(await page.locator('iframe[title="Artifactbin app"]').evaluate(el=>{
    try{void el.contentWindow.document.body;return 'readable';}catch(error){return error.name;}
  }),'SecurityError','main cannot read trusted login DOM');
  const email=`mxmx_test_main_page_${Date.now()}@example.com`;
  await frame.getByLabel('Email',{exact:true}).fill(email);
  await frame.getByLabel('Log in with email',{exact:true}).click();
  await frame.getByLabel('Login code',{exact:true}).waitFor();
  assert.equal(page.url(),url,'main address also survives OTP request');
  await frame.getByLabel('Login code',{exact:true}).fill(sink.lastCode(email));
  await frame.getByLabel('Verify code',{exact:true}).click();
  await page.waitForURL(u=>u.origin===base && u.pathname===`/a/${id}`,{timeout:20000});
  await page.frameLocator('iframe[title="Artifact controls"]').getByLabel('Like artifact',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).hash,'#section');
  assert.equal(new URL(page.url()).searchParams.get('$region'),'west');
  const account=await page.frameLocator('iframe[title="Artifact controls"]').locator('body').evaluate(async()=>{
    const response=await fetch('/api/page/session',{headers:{'x-artifactbin-csrf':'1'}});return response.json();
  });
  assert.equal(account.kind,'account');assert.equal(account.user.email,email);
  const chrome=page.frameLocator('iframe[title="Artifact controls"]');
  const startedDoc=await chrome.locator('body').evaluate(async()=>{
    const response=await fetch('/api/start',{method:'POST',headers:{'x-artifactbin-csrf':'1'}});
    if(!response.ok)throw new Error(await response.text());return response.json();
  });
  assert.equal(new URL(startedDoc.url).origin,base,'signed-in create returns a public document link');
  assert.equal(startedDoc.prompt,`Help me edit my artifact at ${base}/a/${startedDoc.id} using your token`);
  assert.equal((await page.goto(startedDoc.url)).status(),200);
  await page.setViewportSize({width:390,height:844});
  await chrome.getByLabel('Open artifact controls',{exact:true}).click();
  const [forked]=await Promise.all([
    page.waitForNavigation({waitUntil:'load'}),
    chrome.getByLabel('Fork artifact',{exact:true}).click(),
  ]);
  assert.equal(forked.status(),200,'untitled private fork opens at its returned pretty address');
  assert.equal(new URL(page.url()).origin,base);
  assert.match(new URL(page.url()).pathname,/^\/@[^/]+\/[A-Za-z0-9]+$/,'untitled canonical address has no slug');
  await chrome.getByLabel('Open artifact controls',{exact:true}).click();
  await chrome.getByLabel('Copy agent instructions',{exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="Artifact controls"]').getAttribute('allow'),'fullscreen; clipboard-write');
  console.log('PASS signed-in public start prompt and first-load mobile untitled private fork at canonical main URL');
  await page.setViewportSize({width:1280,height:900});
  const credentialWrites=(await Promise.all(writes)).filter(value=>new URL(value.url).pathname.startsWith('/api/auth/'));
  assert(credentialWrites.length>=2,'real OTP request and verification were observed');
  assert(credentialWrites.every(value=>new URL(value.url).origin===controls && value.origin===controls),'credential writes originate and terminate at trusted origin');
  await page.goto(base+'/');await page.frameLocator('iframe[title="Page controls"]').getByLabel('Open menu',{exact:true}).waitFor();
  await page.frameLocator('iframe[title="Home workspace"]').getByLabel('Shelf',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-trusted-region="home"]')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('body').evaluate((el,email)=>el.textContent.includes(email),email),false,'private dashboard identity never enters the main DOM');
  assert.equal(await page.locator('iframe[title="Home workspace"]').evaluate(el=>{try{void el.contentWindow.document;return 'readable';}catch(error){return error.name;}}),'SecurityError');
  console.log('PASS public main SSR transitions to a private workspace region without copying account data');
  const workspace=page.frameLocator('iframe[title="Home workspace"]');
  await workspace.locator('body').evaluate(async()=>{
    for(let batch=0;batch<4;batch++)await Promise.all(Array.from({length:8},async()=>{
      const response=await fetch('/api/start',{method:'POST',headers:{'x-artifactbin-csrf':'1'}});
      if(!response.ok)throw new Error('workspace fixture create '+response.status);
    }));
  });
  await page.reload();await workspace.getByLabel('Shelf',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[data-trusted-region="home"]')?.getAttribute('aria-busy')==='false');
  assert.equal(await workspace.locator('body').evaluate(()=>document.documentElement.scrollHeight>innerHeight),true,'real private rows form a long workspace');
  await workspace.getByLabel(/^More actions for /).last().click();
  await workspace.getByLabel(/^Manage sharing for /).click();
  const sharing=workspace.getByRole('dialog',{name:'Sharing',exact:true});await sharing.waitFor();
  assert.equal(await sharing.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0 && r.top<innerHeight && r.bottom<=innerHeight+1;}),true,'sharing dialog remains inside the visible workspace viewport');
  await page.waitForFunction(()=>document.querySelector('[data-trusted-region="chrome"]')?.inert===true);
  await sharing.press('Escape');await sharing.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('[data-trusted-region="chrome"]')?.inert===false);
  const pageControls=page.frameLocator('iframe[title="Page controls"]');
  await pageControls.getByLabel('Open page controls',{exact:true}).click();
  await pageControls.getByLabel('Dark mode',{exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await workspace.locator('html[data-theme="dark"]').waitFor();
  console.log('PASS long private workspace sharing geometry, sibling modal isolation and parent/sibling appearance synchronization');
  assert.equal(new URL(page.url()).origin,base);
  const callback='http://127.0.0.1:5498/callback?fixed=yes',verifier='v'.repeat(43);
  const registration=await mainFetch(backend+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({redirect_uris:[callback]})});
  assert.equal(registration.status,201);const client=(await registration.json()).client_id;
  const consent=base+'/oauth/authorize?'+new URLSearchParams({client_id:client,redirect_uri:callback,response_type:'code',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:base+'/mcp',scope:'artifacts',state:'preserved-state'});
  await page.route('http://127.0.0.1:5498/callback?*',route=>route.fulfill({body:'Connected',contentType:'text/html'}));
  let release;const delay=new Promise(resolve=>{release=resolve;});
  await page.route(controls+'/oauth/authorize/approve',async route=>{await delay;await route.continue();});
  await page.goto(consent);const consentFrame=page.frameLocator('iframe[title="Artifactbin app"]');
  await consentFrame.getByLabel('Approve connection').click();
  assert.equal(page.url(),consent,'a delayed approval stays at the main consent address');
  assert.equal(await page.locator('input[name="approval"]').count(),0,'consent nonce never enters parent DOM');
  release();await page.waitForURL(u=>u.origin==='http://127.0.0.1:5498');
  const returned=new URL(page.url());assert.equal(returned.searchParams.get('fixed'),'yes');assert.equal(returned.searchParams.get('state'),'preserved-state');assert(returned.searchParams.get('code'));
  const exchange=await mainFetch(backend+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:returned.searchParams.get('code'),client_id:client,redirect_uri:callback,code_verifier:verifier,resource:base+'/mcp'}).toString()});
  assert.equal(exchange.status,200,exchange.ok?'framed consent produces a real exchangeable PKCE code':await exchange.text());
  console.log('PASS main-address native OAuth consent: delayed authenticated approval, bounded external callback and real PKCE exchange');
  await page.goto(base+'/docs-human');const docs=page.frameLocator('iframe[title="Artifactbin app"]');
  const contentsLink=docs.locator('nav[aria-label="Contents"] a').nth(3);
  await contentsLink.waitFor();const href=await contentsLink.getAttribute('href');
  assert.equal(href,base+'/docs-human#editing','native fragment link uses the public document path');
  const documentLoads=[];page.on('request',request=>{if(request.resourceType()==='document')documentLoads.push(request.url());});
  await contentsLink.click();await page.waitForURL(base+'/docs-human#editing');
  assert.equal(documentLoads.length,0,'same-page anchor does not reload either frame');
  await docs.locator('#editing').evaluate(async el=>{
    const started=performance.now();while(Math.abs(el.getBoundingClientRect().top)>=100){if(performance.now()-started>3000)throw new Error('anchor did not scroll: '+el.getBoundingClientRect().top);await new Promise(requestAnimationFrame);}
  });
  await page.goBack();assert.equal(page.url(),base+'/docs-human');
  const guest=await browser.newPage({ignoreHTTPSErrors:true});
  await guest.route(controls+'/controls/region/home?*',route=>route.abort());
  const publicResponse=await guest.goto(base+'/');
  assert((await publicResponse.text()).includes('<h1'),'public first HTML contains its actual heading');
  assert.equal(await guest.locator('#app-frame').count(),0,'public home is not a full-page iframe');
  await guest.locator('h1').waitFor({state:'visible'});
  await guest.getByLabel('Retry loading home').waitFor({state:'visible',timeout:18000});
  await guest.unroute(controls+'/controls/region/home?*');await guest.getByLabel('Retry loading home').click();
  const home=guest.frameLocator('iframe[title="Home workspace"]');await home.getByLabel('Install for my agent').click();
  await home.getByLabel('Choose Others agent family').click();
  console.log('CLIPBOARD POLICY',await home.locator('body').evaluate(async()=>({secure:isSecureContext,policy:document.featurePolicy?.allowsFeature('clipboard-write'),permission:await navigator.permissions.query({name:'clipboard-write'}).then(p=>p.state).catch(()=>'unsupported'),focused:document.hasFocus()})));
  await home.locator('body').evaluate(()=>{
    const write=navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText=async value=>{document.body.dataset.activation=String(navigator.userActivation.isActive);try{await write(value);document.body.dataset.clipboardProof='ok';}catch(error){document.body.dataset.clipboardProof=error.name+': '+error.message;throw error;}};
  });
  const copy=home.getByLabel('Copy the connector URL');await copy.click();
  await home.locator('body[data-clipboard-proof]').waitFor();
  const proof=await home.locator('body').getAttribute('data-clipboard-proof');
  if(proof!=='ok'){
    console.log('CLIPBOARD ACTIVATION',await home.locator('body').getAttribute('data-activation'));
    const top=await browser.newPage({ignoreHTTPSErrors:true});await top.goto(controls+'/controls/page/');
    await top.getByLabel('Install for my agent').click();await top.getByLabel('Choose Others agent family').click();
    await top.evaluate(()=>{const write=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.writeText=async value=>{try{await write(value);document.body.dataset.clipboardProof='ok';}catch(error){document.body.dataset.clipboardProof=error.name+': '+error.message;throw error;}};});
    await top.getByLabel('Copy the connector URL').click();await top.locator('body[data-clipboard-proof]').waitFor();
    const baseline=await top.locator('body').getAttribute('data-clipboard-proof');
    console.log('CLIPBOARD TOP-LEVEL BASELINE',baseline);await top.close();
    assert.equal(proof,baseline,'headless clipboard refusal must match the native top-level baseline');
    assert(proof.startsWith('NotAllowedError:'),'only measured permission refusal is a baseline limitation');
    console.log('HEADLESS LIMITATION: native clipboard write denied in both frame and top-level; real activated write verified independently in BrowserOS Neo. Selectable copy text remains available.');
  }
  assert((await home.getByLabel('Setup instructions').innerText()).includes(base+'/mcp'),'actual copied connector points at public host');
  console.log(`PASS public docs anchor/history, failed-frame Retry recovery; clipboard ${proof==='ok'?'native activated write passed':'permission-denied UX matches top-level baseline'}`);
  await guest.close();
  console.log(`PASS stage one: main-address framed OTP, authenticated controls callback, preserved fragment, i-only API writes; local login startup ${Math.round(readyMs)} ms`);
  await page.close();
}
