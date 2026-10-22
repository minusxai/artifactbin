// @requires archived-compiler
import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{chromium}from'playwright';
import{compileArchivedLocal}from'../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('nested Collapsible preserves frozen interaction, mounted content identities, and disabled semantics',{skip:!root},async()=>{
 const source='<Tabs id="tabs" defaultValue="first"><TabsList><TabsTrigger id="tab" value="first">First</TabsTrigger></TabsList><TabsContent value="first"><Collapsible id="shell" disabled><CollapsibleTrigger id="toggle">Details</CollapsibleTrigger><CollapsibleContent id="panel"><p id="copy">Saved details</p></CollapsibleContent></Collapsible></TabsContent></Tabs>';
 const result=await compileArchivedLocal({source,coreUrl:'/af/v1/core.js'},{legacyRoot:root!});assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 const core=await readFile(new URL('../dist/core.js',import.meta.url),'utf8'),css=await readFile(new URL('../skills/pagegi-author/design-systems/meridian.css',import.meta.url),'utf8');
 const server=createServer((req,res)=>res.writeHead(200,{'content-type':req.url==='/af/v1/core.js'?'text/javascript':req.url?.endsWith('.css')?'text/css':'text/html'}).end(req.url==='/af/v1/core.js'?core:req.url?.endsWith('.css')?css:result.html));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try{const page=await browser.newPage(),errors:string[]=[],unexpected:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!(u.hostname==='127.0.0.1'&&['/proof','/af/v1/core.js','/af/v1/design-systems/meridian.css'].includes(u.pathname)))unexpected.push(u.protocol);});await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);await page.locator('#toggle').waitFor();
 for(const id of ['shell','toggle','panel','copy'])assert.equal(await page.locator(`[data-af-id="${id}"]`).count(),1);
 assert.equal(await page.locator('#toggle').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#copy').isVisible(),false);await page.locator('#toggle').click();await page.locator('#copy').waitFor();assert.equal(await page.locator('#toggle').getAttribute('aria-controls'),'panel');
 // The frozen module strips root disabled without disabling its trigger; preserve that exact behavior.
 assert.equal(await page.locator('#toggle').isDisabled(),false);await page.locator('#toggle').click();assert.equal(await page.locator('#copy').isVisible(),false);await page.reload();await page.locator('#toggle').waitFor();assert.equal(await page.locator('#copy').isVisible(),false);assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
