/** Actual installed author-module graph. Candidate behavior/layout evidence only;
 * this gate does not manufacture or claim an old-browser visual baseline.
 * Gates are SLOW-tier: an implementer runs them ONCE at the end of the brief,
 * NEVER per edit. The orchestrator runs this gate with the final coordinated set. */
import {createServer} from 'node:http';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
import {launchChromium} from './lib/browser.mjs';
import {createChecker} from './lib/assert.mjs';
import {richFamilies,richViewports,richFixtureHtml} from '../lib/html-rich-components-fixture.mjs';
import {candidateMarkdownCopyCases} from '../fixtures/component-baseline/candidate-markdown-copy.mjs';
const repo=path.resolve(import.meta.dirname,'../..'),componentDir=path.join(repo,'services/app/skills/artifactbin/components');
const check=createChecker('html-rich-components'),artifacts=[];
const files=new Map();for(const name of (await readdir(componentDir)).filter(name=>/^[a-z][a-z0-9-]*\.js$/.test(name)))files.set(name,await readFile(path.join(componentDir,name)));
for(const [,file]of richFamilies)if(!files.has(file+'.js'))throw Error(`Missing shipped component ${file}.js: generate HTML component assets before this gate`);
const graph=Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b)).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
const server=createServer((request,response)=>{
 const url=new URL(request.url,'http://fixture.invalid');
 if(url.pathname.startsWith('/components/')){const bytes=files.get(url.pathname.slice('/components/'.length));response.writeHead(bytes?200:404,{'content-type':'text/javascript'});response.end(bytes??'Missing fixture module');return;}
 if(url.pathname==='/person.svg'){response.writeHead(200,{'content-type':'image/svg+xml'});response.end('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#2563eb"/><circle cx="16" cy="16" r="9" fill="#fff"/></svg>');return;}
 response.writeHead(200,{'content-type':'text/html'});response.end(richFixtureHtml(url.searchParams.get('dark')==='true'));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const output=path.resolve(repo,process.argv[3]??'tmp/rich-component-review');await mkdir(output,{recursive:true});
const browser=await launchChromium({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],remote=[];
try{
 const page=await browser.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(origin+'/')&&!url.startsWith('data:')&&!url.startsWith('blob:')){remote.push(url);return route.abort();}return route.continue();});
 async function save(name){const bytes=await page.screenshot({path:path.join(output,name),fullPage:true});artifacts.push({name,mediaType:'image/png',base64:bytes.toString('base64')});}
 for(const dark of [false,true])for(const viewport of richViewports){
  const tag=`${dark?'dark':'light'}-${viewport.width}`;await page.setViewportSize(viewport);await page.goto(`${origin}/?dark=${dark}`);await page.waitForFunction(()=>document.documentElement.dataset.fixtureReady==='yes');
  await page.locator('#diagram[data-state=ready] img').waitFor({timeout:20000});await page.locator('#map canvas').waitFor({timeout:12000});await page.waitForFunction(()=>document.querySelector('#person img')?.naturalWidth>0);
  check(await page.locator('#markdown h1').textContent()==='Field notes',`${tag} Markdown headings`);
  check(await page.locator('#markdown .mx-code-token-keyword').count()>0&&await page.locator('#markdown table').count()===1,`${tag} Markdown GFM table and code highlighting`);
  const heading=await page.locator('#markdown h1').getAttribute('id');
  await page.evaluate(()=>{const node=document.querySelector('#markdown');node.source='[bad](javascript:alert(1))';});check(await page.locator('#markdown [role=alert]').count()===1,`${tag} Markdown rejects unsafe links`);
  await page.evaluate(()=>{document.querySelector('#markdown').source=window.richFixture.markdownSource;});check(await page.locator('#markdown h1').getAttribute('id')===heading,`${tag} Markdown recovers with stable heading identity`);
  for(const scenario of candidateMarkdownCopyCases){
   if(scenario.clipboard==='real')await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin});
   else await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('Simulated clipboard write rejection'))}}));
   const code=await page.locator('#markdown pre code').first().textContent();
   await page.getByRole('button',{name:'Copy code',exact:true}).click();
   await page.waitForFunction(status=>document.querySelector('#markdown pre button')?.textContent===status,scenario.expectedStatus);
   if(scenario.clipboard==='real'){
    let copied='';try{copied=await page.evaluate(()=>navigator.clipboard.readText());}catch(error){check(false,`${tag} Markdown actual clipboard read (${error instanceof Error?error.message:String(error)})`);}
    check(copied===code,`${tag} Markdown candidate-only copy success transfers the rendered code block`);
   }else{
    check(await page.locator('#markdown pre button').textContent()===scenario.expectedStatus,`${tag} Markdown candidate-only rejected copy announces unavailability`);
    await page.evaluate(()=>delete navigator.clipboard);
   }
   await page.evaluate(()=>{document.querySelector('#markdown').source=window.richFixture.markdownSource;});
  }
  await page.getByLabel('Name 1',{exact:true}).fill('Draft retained');await page.evaluate(()=>{window.richFixture.input=document.querySelector('input[aria-label="Name 1"]');});
  await page.getByRole('columnheader',{name:'Sort by score',exact:true}).click();
  check(await page.locator('#table tbody tr[data-row-key]').first().locator('td').first().textContent()==='2',`${tag} table ascending sort`);
  check(await page.evaluate(()=>window.richFixture.input===document.querySelector('input[aria-label="Name 1"]')&&window.richFixture.input.value==='Draft retained'),`${tag} keyed editable cell keeps native input and draft`);
  await page.evaluate(()=>{const table=document.querySelector('#table');table.sort=null;table.data={columns:window.richFixture.columns,rows:Array.from({length:5000},(_,id)=>({id,name:'Row '+id,score:id}))};const scroll=table.querySelector('[data-slot=table-scroll]');scroll.scrollTop=72000;scroll.dispatchEvent(new Event('scroll'));});
  await page.waitForFunction(()=>{const input=document.querySelector('#table tbody input');return input&&Number(input.getAttribute('aria-label').slice(5))>1000;});
  const rendered=await page.locator('#table tbody tr[data-row-key]').count();check(rendered>0&&rendered<60,`${tag} table scroll renders a bounded window (${rendered})`);
  await page.evaluate(()=>{const table=document.querySelector('#table');table.data={columns:window.richFixture.columns,rows:window.richFixture.tableRows};});
  await page.evaluate(()=>{const node=document.querySelector('#assembly');window.richFixture.part=node.querySelector('[data-part=body]');node.options={...node.options,spread:1};});
  check(await page.evaluate(()=>window.richFixture.part===document.querySelector('#assembly [data-part=body]')&&window.richFixture.part.getAttribute('transform')!=='translate(0 0)'),`${tag} SVG pose preserves keyed geometry`);
  check(await page.evaluate(()=>{const canvas=document.querySelector('#map canvas'),gl=canvas.getContext('webgl2');return canvas.width>0&&canvas.height>0&&gl&&!gl.isContextLost();}),`${tag} DeckGL has a real live WebGL2 canvas`);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();await page.getByRole('button',{name:'Reset view',exact:true}).click();
  check(await page.locator('#map [role=status]').count()===0,`${tag} bundled map controls operate without engine error`);
  await page.evaluate(()=>{const user=document.querySelector('#person');user.error='Synthetic unavailable';});check(await page.locator('#person').getAttribute('data-state')==='error',`${tag} user error state`);
  await page.evaluate(()=>{document.querySelector('#person').error=null;});await page.waitForFunction(()=>document.querySelector('#person img')?.naturalWidth>0);check(await page.locator('#person').getAttribute('data-state')==='person'&&await page.getByRole('link',{name:'@alex',exact:true}).getAttribute('href')==='#person',`${tag} user recovers its handle profile link and loaded avatar`);
  // Actual Mermaid engine failure/recovery and a real attribute-driven theme redraw.
  await page.evaluate(()=>{document.querySelector('#diagram').code='flowchart LR\n A -->';});await page.locator('#diagram[data-state=error]').waitFor({timeout:20000});
  check(await page.locator('#diagram [role=alert]').count()>0,`${tag} Mermaid malformed syntax reports an error`);
  await page.evaluate(()=>{document.querySelector('#diagram').code='sequenceDiagram\n participant A\n participant B\n A->>B: Ready';});await page.locator('#diagram[data-state=ready] img').waitFor({timeout:20000});
  const image=await page.locator('#diagram img').getAttribute('src');
  await page.evaluate(value=>document.documentElement.setAttribute('data-af-dark',String(!value)),dark);await page.waitForFunction(previous=>document.querySelector('#diagram')?.dataset.state==='ready'&&document.querySelector('#diagram img')?.getAttribute('src')!==previous,image,{timeout:20000});
  check(await page.locator('#diagram img').evaluate(node=>node.complete&&node.naturalWidth>0),`${tag} Mermaid renders and redraws on live true/false theme change`);
  await page.evaluate(value=>document.documentElement.setAttribute('data-af-dark',String(value)),dark);await page.locator('#diagram[data-state=ready] img').waitFor({timeout:20000});
  const identities=await page.evaluate(()=>window.richFixture.identityFacts(window.richFixture.authoredIdentities,document));check(identities.retained&&await page.evaluate(()=>window.richFixture.authoredIdentities.length===12),`${tag} every authored node retains its original annotation identity`);check(identities.unique,`${tag} all live authored and generated annotation identities are unique`);
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${tag} rich outputs fit viewport without page overflow`);
  check(await page.evaluate(()=>['#diagram img','#assembly svg','#map canvas'].every(selector=>{const box=document.querySelector(selector).getBoundingClientRect();return box.width>0&&box.height>0&&box.right<=innerWidth+1;})),`${tag} rich output boxes visible within layout`);
  await save(`candidate-rich-${tag}.png`);
  await page.evaluate(()=>{window.richFixture.oldCanvas=document.querySelector('#map canvas');for(const id of ['map','assembly','diagram']){const element=document.getElementById(id);window.richFixture[id]={element,parent:element.parentElement};element.remove();}});
  check(await page.evaluate(()=>!window.richFixture.oldCanvas.isConnected&&!window.richFixture.map.element.querySelector('canvas')),`${tag} disconnected map finalizes and removes its own canvas`);
  await page.evaluate(()=>{for(const id of ['map','assembly','diagram']){const {element,parent}=window.richFixture[id];parent.append(element);}});await page.locator('#map canvas').waitFor({timeout:12000});await page.locator('#diagram[data-state=ready] img').waitFor({timeout:20000});
  check(await page.evaluate(()=>document.querySelector('#map canvas')!==window.richFixture.oldCanvas)&&await page.locator('#assembly [data-part=body]').count()===1&&await page.locator('#map [role=status]').count()===0,`${tag} rich engines reconnect without stale errors or duplicate geometry`);
 }
 check(errors.length===0,`no uncaught page errors (${errors.join('; ')||'none'})`);check(remote.length===0,`no external account, basemap or module requests (${remote.join('; ')||'none'})`);
}catch(error){
 check(false,`browser rich contract interrupted: ${error instanceof Error?error.stack:String(error)}`);
 const page=browser.contexts()[0]?.pages()[0];
 if(page)try{const bytes=await page.screenshot({path:path.join(output,'candidate-rich-failure.png'),fullPage:true});artifacts.push({name:'candidate-rich-failure.png',mediaType:'image/png',base64:bytes.toString('base64')});}catch{/* Preserve the original failure if the page itself closed. */}
}finally{
 const report={kind:'candidate-rich-components',comparison:'no baseline pixel comparison claimed',candidateOnlyEnhancements:candidateMarkdownCopyCases.map(({id,baselineCompatibility})=>({id,baselineCompatibility})),graph,viewports:richViewports,themes:[false,true],browser:browser.version(),failures:check.failures};
 await writeFile(path.join(output,'evidence.json'),JSON.stringify(report,null,2));artifacts.push({name:'evidence.json',mediaType:'application/json',base64:Buffer.from(JSON.stringify(report)).toString('base64')});
 console.log(`HTML_RICH_COMPONENT_EVIDENCE_GZIP_BASE64 ${gzipSync(Buffer.from(JSON.stringify({format:'component-parity-files-v1',files:artifacts}))).toString('base64')}`);
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
check.done();
