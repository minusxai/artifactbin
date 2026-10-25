// Installed HTTP archive, private loopback preview and portable Save browser scenario.
// Gates are SLOW-tier: run ONCE at completion in the orchestrator container, never on the host.
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {exerciseDirectVisualLibraries} from './direct-visual-libraries.mjs';
import {launchChromium} from '../gates/lib/browser.mjs';
import {readPortableDocument} from '../../services/app/lib/html-runtime/portable.ts';
import {recoverPortableSource} from '../../services/app/lib/html-runtime/portable-source.ts';
const dir=await mkdtemp(join(tmpdir(),'local-preview-browser-'));let session,browser;
try {
 const skill=join(dir,'skill'),root=join(dir,'project');await mkdir(skill);await mkdir(root);
 const origin=process.argv[2]??'http://localhost:3030';
 const response=await fetch(new URL('/skills/artifactbin.zip',origin));assert.equal(response.status,200,'Actual HTTP author archive must be available');
 const archive=Buffer.from(await response.arrayBuffer());assert.ok(archive.length<128*1024*1024,'bounded author archive');
 // The product archive uses stored UTF-8 ZIP members. Validate every extracted
 // path; this is the actual HTTP response, never reconstructed source helpers.
 let offset=0;
 while(offset+30<=archive.length&&archive.readUInt32LE(offset)===0x04034b50){
  assert.equal(archive.readUInt16LE(offset+8),0,'stored skill ZIP member');const size=archive.readUInt32LE(offset+18),nameBytes=archive.readUInt16LE(offset+26),extra=archive.readUInt16LE(offset+28),start=offset+30+nameBytes+extra,end=start+size;assert.ok(end<=archive.length,'complete skill member');
  const member=archive.subarray(offset+30,offset+30+nameBytes).toString('utf8');assert.ok(member.startsWith('artifactbin/'),'skill root');const relative=member.slice('artifactbin/'.length);assert.ok(!relative.split('/').some(part=>part==='..'||part==='.'||!part),'safe archive member');
  if(/^(?:scripts|components|references)\//.test(relative)){const target=join(skill,relative);await mkdir(dirname(target),{recursive:true});await writeFile(target,archive.subarray(start,end));}
  offset=end;
 }
 const scripts=join(skill,'scripts');
 const libraries=(await import(pathToFileURL(join(scripts,'preview-libraries.mjs')).href)).default;
 const vega=Object.keys(libraries).find(url=>/\/vega-\d/.test(url)),vegaLite=Object.keys(libraries).find(url=>/\/vega-lite-\d/.test(url));assert.ok(vega&&vegaLite,'installed registered Vega and Vega-Lite');
 const mermaid=Object.keys(libraries).find(url=>/\/mermaid-\d/.test(url)),deck=Object.keys(libraries).find(url=>/\/deck-gl-\d/.test(url));assert.ok(mermaid&&deck,'installed direct Mermaid and deck.gl');
 const {startPreview}=await import(pathToFileURL(join(scripts,'preview.mjs')).href);
 await writeFile(join(root,'data.json'),'[7]');
 const html=`<!doctype html><html><head><script>if(document.documentElement.getAttribute("data-af-private-preview")!=="true")throw Error("Private marker missing before source scripts");</script><script data-af="portable" type="application/json">{"version":1,"source":"<h1>Linked fixture</h1>","identity":{"platformOrigin":"https://example.invalid","artifactId":"linked-fixture","baseRevision":"1","sourceDigest":"0000000000000000000000000000000000000000000000000000000000000000"}}</script><script src="/af/v1/core.js" data-af="core"></script><script data-af="state" type="application/json">{"count":0}</script></head><body><button id="increment">Add one</button><output id="count"></output><output id="data"></output><script type="module">import {client,gql} from '@afbin/apollo';const query=gql\`{count}\`;client.watchQuery({query}).subscribe(({data})=>{document.querySelector('#count').textContent=String(data.count);});document.querySelector('#increment').onclick=()=>{client.updateQuery({query},({count})=>({count:count+1}));};document.querySelector('#data').textContent=(await (await fetch('./data.json')).json())[0];</script></body></html>`;
 await writeFile(join(root,'index.html'),html);
 session=await startPreview({root});browser=await launchChromium({headless:true});const page=await browser.newPage();
 await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(session.url).origin?route.continue():route.abort());
 const requests=[];page.on('request',request=>requests.push(request.url()));
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const chrome=page.locator('[data-af-local-chrome]');const chromeStatus=chrome.getByRole('status');
 await page.goto(session.url);await page.getByRole('button',{name:'Add one'}).click();await page.waitForFunction(()=>document.querySelector('#count').textContent==='1');
 await page.waitForFunction(()=>document.documentElement.getAttribute('data-af-local-chrome-ready')==='true');
 assert.equal(await chrome.count(),1);assert.equal(await page.locator('#data').textContent(),'7');assert.equal(await page.locator('iframe[data-af-local-broker]').count(),0);
 await page.route('**/__af_preview/revision',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Preview disconnected — retrying'})}));
 await chromeStatus.filter({hasText:'Preview disconnected — retrying'}).waitFor();
 await page.unroute('**/__af_preview/revision');
 await chromeStatus.filter({hasText:'Preview disconnected — retrying'}).waitFor({state:'hidden'});
 let polls=0;page.on('request',request=>{if(request.url().endsWith('/__af_preview/revision'))polls++;});
 await page.evaluate(()=>dispatchEvent(new Event('pagehide')));const stopped=polls;
 await page.waitForTimeout(1700);assert.equal(polls,stopped);
 await page.evaluate(()=>dispatchEvent(new Event('pageshow')));
 await page.waitForTimeout(1700);assert.ok(polls>stopped);
 await writeFile(join(root,'data.json'),'[8]');await chromeStatus.filter({hasText:'File changed on disk'}).waitFor();
 assert.equal(await page.locator('#data').textContent(),'7');
 await chrome.getByRole('button',{name:'Reload file',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#data').textContent==='8');
 assert.equal(await page.locator('#count').textContent(),'1');
 await writeFile(join(root,'next.html'),html.replace('Add one','Increment'));await rename(join(root,'next.html'),join(root,'index.html'));
 await chromeStatus.filter({hasText:'File changed on disk'}).waitFor();await chrome.getByRole('button',{name:'Reload file',exact:true}).click();await page.getByRole('button',{name:'Increment',exact:true}).waitFor();
 await writeFile(join(root,'sales.csv'),'amount\n2\n');
 const datasetHtml=`<!doctype html><html><head><link rel="af-dataset" data-af-name="sales" href="./sales.csv"><script src="/af/v1/core.js" data-af="core"></script></head><body><button id="insert">Insert local row</button><output id="rows"></output><output id="receipt"></output><script type="module">
 import {client,gql} from '@afbin/apollo';
 const discovered=await client.query({query:gql\`{sales{schema{revision tables{id columns{id}}}}}\`});if(discovered.errors)throw Error(JSON.stringify(discovered.errors));
 const schema=discovered.data.sales.schema,table=schema.tables[0];let revision=schema.revision;
 async function render(){const result=await client.query({query:gql\`query($table:ID!){sales{rows(tableId:$table){rows{id}}}}\`,variables:{table:table.id}});if(result.errors)throw Error(JSON.stringify(result.errors));document.querySelector('#rows').textContent=String(result.data.sales.rows.rows.length);}
 document.querySelector('#insert').onclick=async()=>{const result=await client.mutate({mutation:gql\`mutation($table:ID!,$revision:String!,$column:ID!){sales{writeRows(tableId:$table,expectedRevision:$revision,requestId:"fixture-insert",changes:[{kind:INSERT,cells:[{columnId:$column,value:{type:NUMBER,number:9}}]}]){outcome revision}}}\`,variables:{table:table.id,revision,column:table.columns[0].id}});if(result.errors)throw Error(JSON.stringify(result.errors));revision=result.data.sales.writeRows.revision;document.querySelector('#receipt').textContent=result.data.sales.writeRows.outcome;await render();};await render();
 </script></body></html>`;
 await writeFile(join(root,'dataset.html'),datasetHtml);await page.goto(new URL('dataset.html',session.url).href);await page.waitForFunction(()=>document.querySelector('#rows').textContent==='1');
 await page.getByRole('button',{name:'Insert local row'}).click();await page.waitForFunction(()=>document.querySelector('#receipt').textContent==='committed');
 await page.waitForFunction(()=>document.querySelector('#rows').textContent==='2');await chromeStatus.filter({hasText:'Local dataset edits are unsaved'}).waitFor();
 await writeFile(join(root,'sales.csv'),'amount\n4\n');await chromeStatus.filter({hasText:'File changed on disk'}).waitFor();
 await page.reload();await page.waitForFunction(()=>document.querySelector('#rows').textContent==='2'); // Native reload retains dirty session.
 await chrome.getByRole('button',{name:'Reload file',exact:true}).click();await page.getByRole('button',{name:'Reload and discard local edits'}).waitFor();
 assert.equal(await page.locator('#rows').textContent(),'2');
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Export sales',exact:true}).click();const download=await downloadPromise;const exported=join(dir,'export.json');await download.saveAs(exported);
 assert.equal(JSON.parse(await readFile(exported,'utf8')).tables[0].rows.length,2);assert.equal(await readFile(join(root,'sales.csv'),'utf8'),'amount\n4\n');
 await page.getByRole('button',{name:'Reload and discard local edits'}).click();await page.waitForFunction(()=>document.querySelector('#rows').textContent==='1');
 // A separate normal authored page exercises complete graph Save, rather than
 // relying on the live DOM or a manually assembled portable runtime.
 await mkdir(join(root,'components'));await writeFile(join(root,'components/shared.js'),'let count=0;export const next=()=>++count;');
 await writeFile(join(root,'components/cycle.js'),'import {cycleSeed} from "./main.js";export const cycle=()=>cycleSeed;');
 await writeFile(join(root,'components/lazy.js'),'import {next} from "./shared.js";import {cycle} from "./cycle.js";export const second=()=>next();export const readCycle=cycle;');
 await writeFile(join(root,'components/main.js'),`import {next} from './shared.js';import './cycle.js';import * as vega from ${JSON.stringify(vega)};import {compile} from ${JSON.stringify(vegaLite)};export const cycleSeed=7;export const first=next();export const later=()=>import('./lazy.js');export async function chart(target){const spec=compile({data:{values:[{category:'A',value:4}]},mark:'bar',encoding:{x:{field:'category',type:'nominal'},y:{field:'value',type:'quantitative'}}}).spec;const view=new vega.View(vega.parse(spec,undefined,{ast:true}),{renderer:'svg',expr:vega.expressionInterpreter});await view.initialize(target).runAsync();}`);
 await writeFile(join(root,'portable.css'),'.proof{color:rgb(20,90,40);background-image:url(./pixel.svg)}');await writeFile(join(root,'pixel.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"><path d="M0 0h3v3H0z" fill="#145a28"/></svg>');
 const portableSource=`<!doctype html><html><head><title>Local portable graph</title><link rel="stylesheet" href="./portable.css"><script data-af="state" type="application/json">{"count":0,"draft":"seed"}</script><script src="/af/v1/core.js" data-af="core"></script></head><body><p class="proof">Graph proof</p><img alt="Packed image" src="./pixel.svg"><output id="graph"></output><output id="private-count"></output><button id="private-increment">Update private state</button><div id="chart"></div><script type="module">import {client,gql} from '@afbin/apollo';import {first,later,chart} from './components/main.js';const lazy=await later();document.querySelector('#graph').textContent=JSON.stringify([first,lazy.second(),lazy.readCycle()]);await chart('#chart');const query=gql\`{count draft}\`;client.watchQuery({query}).subscribe(({data})=>{document.querySelector('#private-count').textContent=String(data.count);});document.querySelector('#private-increment').onclick=()=>client.updateQuery({query},({count})=>({count:count+1,draft:'private-draft'}));</script></body></html>`;
 await writeFile(join(root,'portable.html'),portableSource);await page.goto(new URL('portable.html',session.url).href);await page.waitForFunction(()=>document.querySelector('#graph').textContent==='[1,2,7]'&&document.querySelector('#chart svg'));
 await page.getByRole('button',{name:'Update private state'}).click();await page.waitForFunction(()=>document.querySelector('#private-count').textContent==='1');
 const savePage=async(target,name)=>{const downloading=target.waitForEvent('download');await target.locator('[data-af-local-chrome]').getByRole('button',{name:'Save HTML',exact:true}).click();const item=await downloading;const file=join(dir,name);await item.saveAs(file);return {file,html:await readFile(file,'utf8')};};
 const saved=await savePage(page,'portable-default.html');assert.equal(readPortableDocument(saved.html).source,portableSource);assert.equal(readPortableDocument(saved.html).privateState,undefined);assert.equal(recoverPortableSource(saved.html),portableSource);assert.equal(await readFile(join(root,'portable.html'),'utf8'),portableSource);
 const offlineContext=await browser.newContext(),offline=await offlineContext.newPage(),offlineRequests=[],offlineErrors=[];offline.on('request',request=>{if(/^https?:/.test(request.url()))offlineRequests.push(request.url());});offline.on('pageerror',error=>offlineErrors.push(error.message));await offline.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort():route.continue());
 await offline.goto(pathToFileURL(saved.file).href);await offline.waitForFunction(()=>document.querySelector('#graph').textContent==='[1,2,7]'&&document.querySelector('#chart svg')&&document.querySelector('#private-count').textContent==='0');
 assert.equal(await offline.locator('.proof').evaluate(node=>getComputedStyle(node).color),'rgb(20, 90, 40)');assert.equal(await offline.getByAltText('Packed image').evaluate(image=>image.complete&&image.naturalWidth===3),true);assert.equal(await offline.locator('#chart svg').count(),1);
 // Outside preview, Save explicitly selects the current file. Repeated Save
 // must retain the original canonical source, despite encoded module maps.
 const chooser=offline.waitForEvent('filechooser'),repeatDownload=offline.waitForEvent('download');await offline.locator('[data-af-local-chrome]').getByRole('button',{name:'Save HTML',exact:true}).click();await (await chooser).setFiles(saved.file);const repeat=await repeatDownload,repeatPath=join(dir,'portable-repeat.html');await repeat.saveAs(repeatPath);const repeated=await readFile(repeatPath,'utf8');assert.equal(readPortableDocument(repeated).source,portableSource);assert.equal(recoverPortableSource(repeated),portableSource);assert.equal(readPortableDocument(repeated).privateState,undefined);assert.equal(await readFile(saved.file,'utf8'),saved.html);
 await chrome.getByRole('button',{name:'Local file actions',exact:true}).click();await page.getByRole('menuitemcheckbox',{name:'Include private filters and drafts',exact:true}).click();const opted=await savePage(page,'portable-private.html');assert.equal(readPortableDocument(opted.html).privateState.count,1);assert.equal(readPortableDocument(opted.html).privateState.draft,'private-draft');assert.equal(readPortableDocument(opted.html).source,portableSource);
 assert.deepEqual(offlineRequests,[],'saved HTML must execute without network');assert.deepEqual(offlineErrors,[]);await offlineContext.close();
 await exerciseDirectVisualLibraries({browser,page,root,session,dir,origin,savePage,mermaid,deck,skill});
 // A real missing dependency must produce a visible error and no empty download.
 const failureSource='<!doctype html><script src="/af/v1/core.js" data-af="core"></script><script type="module">import "./components/missing.js";</script>';
 await writeFile(join(root,'failure.html'),failureSource);await page.goto(new URL('failure.html',session.url).href);await page.waitForFunction(()=>document.documentElement.getAttribute('data-af-local-chrome-ready')==='true');let failureDownloads=0;const failedDownload=()=>failureDownloads++;page.on('download',failedDownload);await chrome.getByRole('button',{name:'Save HTML',exact:true}).click();await chromeStatus.filter({hasText:'Missing local dependency: /components/missing.js'}).waitFor();assert.equal(failureDownloads,0);page.off('download',failedDownload);assert.equal(await readFile(join(root,'failure.html'),'utf8'),failureSource);assert.equal(await readFile(join(root,'portable.html'),'utf8'),portableSource);
 assert.ok(requests.every(url=>!/^https?:/.test(url)||new URL(url).origin===new URL(session.url).origin),JSON.stringify(requests));assert.ok(requests.every(url=>!url.includes('/local/connect')));
 assert.deepEqual(errors,[]);console.log('PASS: private request origins, local Apollo/JSON/datasets, dirty export and explicit discard, native reload preservation, disk notices, lifecycle cleanup, CSP, actual archive Save, offline shared/lazy/cyclic graph, Vega/Vega-Lite, canonical repeated Save, private-state opt-in, visible missing-dependency errors');
}finally{await browser?.close();await session?.close();await rm(dir,{recursive:true,force:true});}
