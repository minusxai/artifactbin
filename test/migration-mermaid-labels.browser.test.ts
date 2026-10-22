// @requires archived-compiler
import test from 'node:test';import assert from 'node:assert/strict';import{createServer}from'node:http';import{readFile}from'node:fs/promises';import{chromium}from'playwright';
import{compileArchivedLocal}from'../src/migration/conversion/compiled/local.ts';
const root=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('frozen Mermaid renders inert label syntax and sequence diagrams as sanitized offline theme variants',{skip:!root},async()=>{
 const codes=['flowchart LR; A["Image: saved text"] --> B[Done]','flowchart LR; A -->|Click to review| B','flowchart LR; A[First<br/>second] --> B','sequenceDiagram\nAlice->>Bob: Saved message'];
 const source='<div className="light">'+codes.map((code,i)=>`<Mermaid id="diagram${i}" className="mx-auto border" code={${JSON.stringify(code)}}/>`).join('')+'</div>';
 const result=await compileArchivedLocal({source,coreUrl:'/af/v1/core.js'},{legacyRoot:root!});assert.equal(result.classification,'functional',JSON.stringify(result.issues));
 const core=await readFile(new URL('../dist/core.js',import.meta.url),'utf8'),css=await readFile(new URL('../skills/pagegi-author/design-systems/meridian.css',import.meta.url),'utf8');
 const server=createServer((req,res)=>res.writeHead(200,{'content-type':req.url==='/af/v1/core.js'?'text/javascript':req.url?.endsWith('.css')?'text/css':'text/html'}).end(req.url==='/af/v1/core.js'?core:req.url?.endsWith('.css')?css:result.html));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch();
 try{const page=await browser.newPage(),errors:string[]=[],unexpected:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&!(u.hostname==='127.0.0.1'&&['/proof','/af/v1/core.js','/af/v1/design-systems/meridian.css'].includes(u.pathname)))unexpected.push(u.protocol);});await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/proof`);await page.locator('#diagram3[data-mx-mermaid-state="ready"] svg').waitFor();
 assert.equal(await page.locator('figure[data-mx-mermaid-state="ready"] svg').count(),4);assert.equal(await page.locator('figure svg foreignObject,figure svg a,figure svg image,figure svg script').count(),0);
 assert.equal(await page.locator('figure.mx-auto.border').count(),4);
 assert.match(await page.locator('#diagram0 svg').textContent()??'',/Image: saved text/);assert.match(await page.locator('#diagram1 svg').textContent()??'',/Click to review/);assert.match(await page.locator('#diagram3 svg').textContent()??'',/Saved message/);assert.equal(await page.locator('#diagram3').getAttribute('data-mermaid-type'),'sequence');
 const ids=await page.locator('figure svg').evaluateAll(nodes=>nodes.map(n=>n.id));await page.locator('figure').first().evaluate(n=>{const context=n.closest('[data-mx-inline-story]')??n.closest('.light')!;context.classList.replace('light','dark');context.setAttribute('data-color-mode','dark');});await page.waitForTimeout(100);const changed=await page.locator('figure svg').evaluateAll(nodes=>nodes.map(n=>n.id));assert.notDeepEqual(changed,ids);assert.equal(await page.locator('figure[data-mx-mermaid-state="ready"]').count(),4);
 await page.reload();await page.locator('#diagram3[data-mx-mermaid-state="ready"] svg').waitFor();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
});
