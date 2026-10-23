// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('prototype charts follow reader appearance and document colors without changing plotted data', {skip:!root}, async()=>{
  const source='<Helmet><Value name="rows" type="table" value={[{label:"A",amount:2},{label:"B",amount:4}]}/></Helmet><Question id="chart" data="$rows" height={300} viz={{kind:"vega-lite",spec:{mark:"bar",encoding:{x:{field:"label",type:"nominal"},y:{field:"amount",type:"quantitative"},color:{field:"label",type:"nominal"}}}}}/>';
  const result=await compileArchivedLocal({source,coreUrl:'/af/v1/core.js',theme:'drafting'}, {legacyRoot:root!,sourceAdmission:'offline-prototype'});
  assert.equal(result.classification,'functional',JSON.stringify(result.issues));
  const core=(await build({entryPoints:['src/browser/core/core.ts'],bundle:true,write:false,format:'iife',target:'es2022'})).outputFiles[0]!.text;
  const server=createServer((req,res)=>res.writeHead(200,{'content-type':req.url==='/af/v1/core.js'?'text/javascript':'text/html'}).end(req.url==='/af/v1/core.js'?core:result.html));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();const external:string[]=[];page.on('request',r=>{if(['http:','https:'].includes(new URL(r.url()).protocol)&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);
    const svg=page.locator('#chart [data-mx-chart-state="ready"] svg');await svg.waitFor();
    const bars=()=>page.locator('#chart svg .mark-rect.role-mark path').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),path:node.getAttribute('d')})));
    const labels=()=>page.locator('#chart svg text').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('fill')));
    const before=await bars();const light=await labels();assert.equal(before.length,2);
    await page.evaluate(()=>document.documentElement.setAttribute('data-af-dark','true'));
    await page.waitForFunction((previous)=>JSON.stringify([...document.querySelectorAll('#chart svg text')].map(n=>n.getAttribute('fill')))!==previous,JSON.stringify(light));
    assert.deepEqual(await bars(),before);
    await page.evaluate(()=>{const story=document.querySelector('[data-mx-inline-story]') as HTMLElement;story.style.setProperty('--chart-1','#ff0000');story.setAttribute('data-theme','custom');});
    await page.waitForFunction(()=>document.querySelector('#chart svg .mark-rect.role-mark path')?.getAttribute('fill')==='#ff0000');
    assert.deepEqual(await bars(),before);assert.deepEqual(external,[]);
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
