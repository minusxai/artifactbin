import assert from 'node:assert/strict';

/** Built browser proof: public HTML is useful before any script or trusted child. */
export async function verifyPublicFirstPaint({browser,base,controls}) {
  const noJs=await browser.newContext({ignoreHTTPSErrors:true,javaScriptEnabled:false});
  const document=await noJs.newPage();const response=await document.goto(base+'/');
  assert.equal(response.status(),200);await document.locator('h1').waitFor({state:'visible'});
  assert.equal(await document.locator('#app-frame').count(),0);
  assert.match(await document.title(),/artifactbin/i);await noJs.close();
  const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
  const samples=[];
  for(const cache of ['cold','warm']){
    await page.goto(base+'/');
    await page.waitForFunction(()=>['chrome','home'].every(kind=>document.querySelector(`[data-trusted-region="${kind}"]`)?.getAttribute('aria-busy')==='false'));
    const metrics=await page.evaluate(()=>({ready:Math.round(performance.now()),fcp:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime??0),bytes:performance.getEntriesByType('resource').reduce((sum,r)=>sum+r.transferSize,0)}));
    samples.push({cache,...metrics});
    assert.equal(await page.locator('[data-trusted-region="chrome"]').evaluate(el=>Math.round(el.getBoundingClientRect().height)),44);
    assert.equal(await page.locator('iframe[title="Home workspace"]').evaluate(el=>el.getBoundingClientRect().height>100),true);
  }
  // Force the real SSR race: the region finishes before public hydration.
  let release;const hydration=new Promise(resolve=>{release=resolve;});
  await page.route('**/assets/public-*.js',async route=>{await hydration;await route.continue();});
  const blocked=page.waitForRequest(request=>/\/assets\/public-[^/]+\.js$/.test(new URL(request.url()).pathname),{timeout:10000});
  const navigation=page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await blocked;
  await page.frameLocator('iframe[title="Home workspace"]').getByLabel('Install for my agent').waitFor();
  await page.locator('h1').waitFor({state:'visible'});release();await navigation;
  await page.waitForFunction(()=>['chrome','home'].every(kind=>document.querySelector(`[data-trusted-region="${kind}"]`)?.getAttribute('aria-busy')==='false'));
  await page.unroute('**/assets/public-*.js');
  assert.equal(new URL(await page.locator('iframe[title="Page controls"]').getAttribute('src')).origin,controls);
  console.log('PASS no-JS public SSR, stable chrome, bounded late-parent handshake; local first-paint samples',JSON.stringify(samples));
  await context.close();
}
