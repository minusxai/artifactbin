// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {compileArchivedLocal} from '../src/migration/conversion/compiled/local.ts';
import {rewriteMigrationLinks} from '../src/migration/links.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('frozen compiler preserves supporting metadata through readiness without fetching the supporting page',{skip:!root},async()=>{
 const result=await compileArchivedLocal({source:'<Helmet><Context src="ref:Ab1234"/></Helmet><Card id="card"><CardContent id="content"><p id="copy">Saved content</p></CardContent></Card>',coreUrl:'/af/v1/core.js',contexts:[{legacyId:'Forged'}]},{legacyRoot:root!});
 const noContext=await compileArchivedLocal({source:'<p id="plain">Plain</p>',coreUrl:'/af/v1/core.js',contexts:[{legacyId:'Forged'}]},{legacyRoot:root!});
 assert.equal(noContext.classification,'functional');assert.equal(noContext.provenance?.contexts,undefined);assert.ok(!noContext.html?.includes('data-migration-context'));
 assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 assert.deepEqual(result.provenance?.contexts,[{legacyId:'Ab1234'}]);
 const html=rewriteMigrationLinks(result.html!,{pages:{Ab1234:'new123'},users:{},groups:{},tokens:{}},{legacyOrigins:['https://legacy.test'],targetOrigin:'https://new.test'});
 const core=await readFile(new URL('../dist/core.js',import.meta.url),'utf8');
 const css=await readFile(new URL('../skills/pagegi-author/design-systems/meridian.css',import.meta.url),'utf8');
 const server=createServer((req,res)=>res.writeHead(200,{'content-type':req.url==='/af/v1/core.js'?'text/javascript':req.url?.endsWith('.css')?'text/css':'text/html'}).end(req.url==='/af/v1/core.js'?core:req.url?.endsWith('.css')?css:html));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try{const page=await browser.newPage();const errors:string[]=[],requests:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol))requests.push(u.pathname)});
 await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);await page.locator('#copy').waitFor();
 assert.equal(await page.locator('link[rel="related"][data-migration-context="supporting-document"]').getAttribute('href'),'/a/new123');
 assert.equal(await page.locator('body').innerText(),'Saved content');assert.equal(await page.locator('[data-af-id="copy"]').count(),1);
 await page.reload();await page.locator('#copy').waitFor();assert.deepEqual(errors,[]);assert.ok(requests.every(path=>path==='/proof'||path==='/af/v1/core.js'||path==='/af/v1/design-systems/meridian.css'),JSON.stringify(requests));
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
