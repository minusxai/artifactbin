/** Automated companion to the BrowserOS inspection. Separate fixture per engine. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
for(const [name,engine] of Object.entries({chromium,firefox,webkit})){
 const server=spawn(process.execPath,['scripts/planning/auth-boundary-server.mjs'],{stdio:['ignore','pipe','inherit']});
 const lines=createInterface({input:server.stdout});
 let browser;
 try{
  const [line]=await once(lines,'line');const {main,trusted,start}=JSON.parse(line);
  browser=await engine.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true});const page=await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>console.error(name,error.message));
  console.log(`CHECK ${name}: open fixture`);
  await page.goto(start);await page.waitForFunction(()=>document.querySelector('#result')?.textContent.startsWith('{'));
  const root=JSON.parse(await page.locator('#result').textContent());
  console.log(`CHECK ${name}: root`,root);
  assert.deepEqual(root,{privateStatus:200,crossOrigin:'TypeError',rootStatus:403,cookieVisible:false});
  const frame=page.frames().find(f=>f.url()===trusted+'/controls');assert(frame);
  console.log(`CHECK ${name}: child`);
  await frame.waitForFunction(()=>document.querySelector('#result')?.textContent.startsWith('{'));
  assert.deepEqual(JSON.parse(await frame.locator('#result').textContent()),{success:200,replay:409,dom:'SecurityError',cookieVisible:false});
  const cookies=await context.cookies(main);
  assert(!cookies.some(c=>c.name==='__Host-plan-session'),'full cookie never sent to main');
  assert(cookies.some(c=>c.name==='plan-read'&&c.httpOnly&&c.secure),'read cookie available to main');
  const report=await page.evaluate(()=>fetch('/report').then(r=>r.json()));
  console.log(`CHECK ${name}: requests`);
  assert.equal(report.writes,1);
  assert(report.observations.some(o=>o.kind==='write'&&o.origin===main&&o.hasFull&&o.status===403),'simple cross-origin write carried session but was denied');
  // Querying the DOM of a CSP-refused frame hangs in Firefox's automation
  // adapter. Assert the response policy here; BrowserOS separately verified
  // Chromium displays a refused frame rather than the token document.
  const tokenPage=await context.request.get(trusted+'/tokens');
  assert.equal(tokenPage.headers()['content-security-policy'],"frame-ancestors 'none'");
  await frame.evaluate(()=>window.logout());
  assert.equal(await page.evaluate(()=>fetch('/private').then(r=>r.status)),404,'revoked read credential denied without clearing browser cookie');
  assert((await context.cookies(main)).some(c=>c.name==='plan-read'),'revocation is server-side, not only cookie removal');
  console.log(`PASS ${name}: separate cookies, HttpOnly, trusted write, root/simple-write denial, replay, DOM isolation, token frame policy, private read revocation`);
 }finally{await browser?.close();lines.close();server.kill('SIGTERM');await once(server,'exit');}
}
