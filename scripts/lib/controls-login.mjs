import assert from 'node:assert/strict';

/** Real logged-out gestures, real OTP, actual main→controls→main navigation. */
export async function verifyControlsLogin({browser,owner,base,controls,sink}) {
  const fixture=await owner.locator('body').evaluate(async()=>{
    const res=await fetch('/api/my/artifacts',{method:'POST',headers:{'Content-Type':'application/json','x-artifactbin-csrf':'1'},body:JSON.stringify({title:'Login return fixture',visibility:'unlisted',markup:'<Helmet><Value name="region" type="string" default="west"/></Helmet><main><h1>Login return fixture</h1><p id="section">Return here</p></main>'})});
    if(!res.ok) throw new Error(await res.text());return res.json();
  });
  for(const [index,scenario] of ['fork','comment','like','follow','comment-enabled'].entries()) {
    const intent=scenario==='comment-enabled'?'comment':scenario;
    if(scenario==='comment-enabled') {
      const status=await owner.locator('body').evaluate(async(_,id)=>(await fetch(`/api/my/artifacts/${id}/sharing`,{method:'PUT',headers:{'Content-Type':'application/json','x-artifactbin-csrf':'1'},body:JSON.stringify({linkRole:'commenter'})})).status,fixture.id);
      assert.equal(status,200);
    }
    const page=await browser.newPage({ignoreHTTPSErrors:true,viewport:index%2 ? {width:390,height:844} : {width:1280,height:900}});
    page.setDefaultTimeout(20000);
    const writes=[];page.on('request',r=>{if(r.method()==='POST') writes.push(new URL(r.url()).pathname);});
    // Slow initial controls startup must not drop the parent address/intent.
    await page.route(`${controls}/controls/a/*`,async route=>{await new Promise(resolve=>setTimeout(resolve,1500));await route.continue();});
    await page.goto(`${base}/a/${fixture.id}?$region=west#section`);
    const chrome=page.frameLocator('iframe[title="Artifact controls"]');
    await chrome.getByLabel('Like artifact',{exact:true}).waitFor();
    assert.equal(await chrome.getByLabel('Like artifact',{exact:true}).locator('svg.lucide-heart').count(),1);
    assert.equal(await chrome.getByLabel('Toggle comments',{exact:true}).locator('svg.lucide-message-square').count(),1);
    await page.evaluate(()=>{window.__mxValues({region:'east'});location.hash='section';});
    const original=new URL(page.url());
    if(intent==='fork') {
      await chrome.getByLabel('Open artifact controls',{exact:true}).click();
      await chrome.getByLabel('Fork artifact',{exact:true}).click();
    } else await chrome.getByLabel({comment:'Toggle comments',like:'Like artifact',follow:'Follow author'}[intent],{exact:true}).click();
    await page.waitForURL(url=>url.origin===controls && url.pathname==='/login');
    const callback=new URL(page.url()).searchParams.get('callbackUrl');
    const returned=new URL(callback,base);
    assert.equal(returned.pathname,original.pathname,'returns to the real main artifact, never /controls/a');
    assert.equal(returned.searchParams.get('$region'),'east');assert.equal(returned.hash,'#section');assert.equal(returned.searchParams.get('intent'),intent);
    const email=`mxmx_test_controls_${intent}_${Date.now()}@example.com`;
    await page.getByLabel('Email',{exact:true}).fill(email);
    await page.getByLabel('Log in with email',{exact:true}).click();
    await page.getByLabel('Login code',{exact:true}).waitFor();
    await page.getByLabel('Login code',{exact:true}).fill(sink.lastCode(email));
    await page.getByLabel('Verify code',{exact:true}).click();
    await page.waitForURL(url=>url.origin===base && url.pathname===original.pathname);
    await chrome.getByLabel('Like artifact',{exact:true}).waitFor();
    await page.waitForFunction(()=>!new URL(location.href).searchParams.has('intent'));
    assert.equal(new URL(page.url()).searchParams.get('$region'),'east');assert.equal(new URL(page.url()).hash,'#section');
    if(intent==='fork') {
      await chrome.getByLabel('Fork this artifact',{exact:true}).waitFor();
      assert.equal(writes.filter(path=>path.endsWith('/fork')).length,1,'only the original signed-out attempt, never an automatic fork on login');
      await chrome.getByLabel('Cancel fork',{exact:true}).click();
      await page.reload();await chrome.getByLabel('Like artifact',{exact:true}).waitFor();
      assert.equal(await chrome.getByLabel('Fork this artifact',{exact:true}).count(),0,'consumed intent does not re-open after reload');
      const askAgain=new URL(original);askAgain.searchParams.set('intent','fork');
      await page.goto(askAgain.href);await chrome.getByLabel('Confirm fork',{exact:true}).click();
      await page.waitForURL(url=>url.origin===base && url.pathname!==original.pathname);
      assert.equal(writes.filter(path=>path.endsWith('/fork')).length,2,'explicit confirmation makes exactly one authenticated copy');
    } else if(intent==='comment') {
      await chrome.getByLabel('Annotation sidebar',{exact:true}).waitFor();
      const text=await chrome.getByLabel('Annotation sidebar',{exact:true}).innerText();
      if(scenario==='comment-enabled') assert.doesNotMatch(text,/Commenting is not enabled/);
      else assert.match(text,/Commenting is not enabled/);
      assert.equal(writes.filter(path=>path.includes('/annotations')).length,0,'login never posts a comment or raises viewer ACL');
    } else await chrome.locator(`[aria-label="${intent==='like'?'Like artifact':'Follow author'}"][aria-pressed="true"]`).waitFor();
    await page.close();
  }
  console.log('PASS: desktop/mobile signed-out fork/comment/heart/follow → top-level login → original artifact, current values/hash, one-shot intent and unchanged viewer ACL');
}
