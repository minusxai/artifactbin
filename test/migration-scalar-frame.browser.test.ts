// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createMigrationConverter} from '../src/migration/convert.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('named and managed-frame mutations retain scalar arithmetic and local table writes',{skip:!root},async()=>{
 const source='<Helmet><Value name="count" type="number" default={0}/><Value name="drafts" type="table" value={[{label:"first"}]}/><Value name="note" type="string" default="draft"/><Query name="summary">{`select count(*) n from drafts`}</Query><Mutation name="inc">{`update _signals set count=count+1`}</Mutation><Mutation name="add">{`insert into drafts(label) values($note)`}</Mutation></Helmet><Button id="native-inc" run="$inc">Native increment</Button><Button id="native-add" run="$add">Native add</Button><p id="count">{$count}</p><DataTable id="result" data="$summary"><Column col="n"/></DataTable><Iframe id="frame"><button id="frame-inc">Frame increment</button><button id="frame-add">Frame add</button><p id="frame-count">Waiting</p><p id="one-state">No delivery</p><p id="lifetime">Running</p><button id="unsubscribe">Unsubscribe</button><button id="set-value">Set</button><button id="sync-probe">Probe</button><p id="sync-text">Waiting</p><script>{`import {onCleanup} from "solid-js";onCleanup(()=>document.querySelector("#lifetime").textContent="Stopped");document.querySelector("#frame-inc").onclick=()=>mx.mutate("inc");document.querySelector("#frame-add").onclick=()=>mx.mutate("add");mx.params.subscribe(["count"],v=>document.querySelector("#frame-count").textContent="Frame count "+v.count);const off=mx.params.subscribe(v=>document.querySelector("#one-state").textContent="One "+v.count);document.querySelector("#unsubscribe").onclick=()=>off();document.querySelector("#set-value").onclick=()=>mx.params.set("count",mx.params.get("count")+5);document.querySelector("#sync-probe").onclick=()=>{let delivered=false;const stop=mx.params.subscribe(v=>{delivered=true});mx.params.set("note","updated");document.querySelector("#sync-text").textContent=String(delivered);stop();};`}</script></Iframe>';
 const result=await createMigrationConverter({strategy:'archived-functional',sourceAdmission:'offline-prototype',legacyRoot:root!})({source,coreUrl:'/af/v1/core.js',meta:{title:'Counter'},document:{retained:source}});
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 const core=await readFile(new URL('../dist/core.js',import.meta.url));let posts=0;
 const server=createServer((req,res)=>{if(req.method==='POST')posts++;res.setHeader('content-type',req.url==='/af/v1/core.js'?'text/javascript':'text/html');res.end(req.url==='/af/v1/core.js'?core:result.html);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try{
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}/counter`);
  try{await page.waitForFunction(()=>document.querySelector('#frame-count')?.textContent==='Frame count 0',undefined,{timeout:5000});}catch(e){throw Error(JSON.stringify({body:await page.locator('body').innerText(),errors}));}
  assert.equal(await page.locator('#one-state').textContent(),'No delivery');
  await page.locator('#native-inc').click();await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='1');
  await page.locator('#frame-inc').click();await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='2'&&document.querySelector('#frame-count')?.textContent==='Frame count 2');
  await page.locator('#native-add').click();await page.waitForFunction(()=>document.querySelector('#result')?.textContent?.includes('2'));
  await page.locator('#frame-add').click();await page.waitForFunction(()=>document.querySelector('#result')?.textContent?.includes('3'));
  await page.waitForFunction(()=>document.querySelector('#one-state')?.textContent==='One 2');
  await page.locator('#unsubscribe').click();await page.locator('#set-value').click();
  await page.waitForFunction(()=>document.querySelector('#count')?.textContent==='7'&&document.querySelector('#frame-count')?.textContent==='Frame count 7');
  assert.equal(await page.locator('#one-state').textContent(),'One 2');
  await page.locator('#sync-probe').click();assert.equal(await page.locator('#sync-text').textContent(),'true');
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false})));
  assert.equal(await page.locator('#lifetime').textContent(),'Stopped');
  assert.equal(await page.locator('#frame-count').textContent(),'Frame count 7');
  assert.equal(posts,0);assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
