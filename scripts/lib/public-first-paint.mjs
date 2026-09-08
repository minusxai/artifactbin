import assert from 'node:assert/strict';
import {assertTrustedChrome} from './gate-browser.mjs';

/** Public Landing is useful with JS disabled; one shared root replaces static
 * presentation when the app starts, including deliberately delayed startup. */
export async function verifyPublicFirstPaint({browser,base}) {
  const noJs=await browser.newContext({ignoreHTTPSErrors:true,javaScriptEnabled:false});
  const document=await noJs.newPage();const response=await document.goto(base+'/');
  assert.equal(response.status(),200);await document.locator('h1').waitFor({state:'visible'});
  assert.equal(await document.locator('#app-frame').count(),0);
  assert.match(await document.title(),/artifactbin/i);await noJs.close();
  const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
  const samples=[];
  for(const cache of ['cold','warm']){
    await page.goto(base+'/');await assertTrustedChrome(page);
    await page.getByLabel('Install for my agent').waitFor();
    samples.push({cache,...await page.evaluate(()=>({ready:Math.round(performance.now()),fcp:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime??0),bytes:performance.getEntriesByType('resource').reduce((sum,r)=>sum+r.transferSize,0)}))});
    assert.equal(await page.getByLabel('Page bar',{exact:true}).evaluate(el=>Math.round(el.getBoundingClientRect().height)),44);
    assert.equal(await page.locator('main').first().evaluate(el=>el.getBoundingClientRect().height>100),true);
  }
  let release;const hydration=new Promise(resolve=>{release=resolve;});
  await page.route('**/assets/app-*.js',async route=>{await hydration;await route.continue();});
  const blocked=page.waitForRequest(request=>/\/assets\/app-[^/]+\.js$/.test(new URL(request.url()).pathname),{timeout:10000});
  const navigation=page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await blocked;
  try{
    await page.locator('h1').waitFor({state:'visible'});
    const bootstrap=await page.locator('head script#mx-page-data').evaluate(el=>JSON.parse(el.textContent));
    assert.equal(bootstrap.path,'/');assert.equal(bootstrap.ssr,true);assert.equal(bootstrap.session.kind,'none');
  }finally{release();}
  await navigation;await assertTrustedChrome(page);
  await page.getByLabel('Install for my agent').waitFor();
  await page.unroute('**/assets/app-*.js');
  assert.equal(await page.locator('iframe[title="Home workspace"],iframe[title="Page controls"]').count(),0);
  console.log('PASS no-JS public Landing, stable shared chrome, delayed app startup; local first-paint samples',JSON.stringify(samples));
  await context.close();
}
