// Bounded real-browser scenario: no app server, publication, account or network setup.
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildPreviewParser,buildPreviewDatasets} from '../../services/app/lib/skills/preview-assets.server.ts';
import {buildHtmlAssets} from '../../services/app/lib/html-runtime/build.server.ts';
const dir=await mkdtemp(join(tmpdir(),'local-preview-browser-'));let session,browser;
try {
 const skill=join(dir,'skill'),root=join(dir,'project');await mkdir(skill);await mkdir(root);
 for(const name of ['preview.mjs','preview-changes.mjs','preview-files.mjs','preview-sessions.mjs','preview-runtime-assets.mjs'])await writeFile(join(skill,name),await readFile(new URL('../../services/app/skills/artifactbin/scripts/'+name,import.meta.url)));
 await writeFile(join(skill,'preview-html.mjs'),await buildPreviewParser(await readFile(new URL('../../services/app/skills/artifactbin/scripts/preview-html.mjs',import.meta.url),'utf8')));
 await writeFile(join(skill,'preview-datasets.mjs'),await buildPreviewDatasets());
 await writeFile(join(skill,'preview-runtime.mjs'),'export default '+JSON.stringify(await buildHtmlAssets())+';');
 const {startPreview}=await import(pathToFileURL(join(skill,'preview.mjs')).href);
 await writeFile(join(root,'data.json'),'[7]');
 const html=`<!doctype html><html><head><script>if(document.documentElement.getAttribute("data-af-private-preview")!=="true")throw Error("Private marker missing before source scripts");</script><script data-af="portable" type="application/json">{"version":1,"source":"<h1>Linked fixture</h1>","identity":{"platformOrigin":"https://example.invalid","artifactId":"linked-fixture","baseRevision":"1","sourceDigest":"0000000000000000000000000000000000000000000000000000000000000000"}}</script><script src="/af/v1/core.js" data-af="core"></script><script data-af="state" type="application/json">{"count":0}</script></head><body><button id="increment">Add one</button><output id="count"></output><output id="data"></output><script type="module">import {client,gql} from '@afbin/apollo';const query=gql\`{count}\`;client.watchQuery({query}).subscribe(({data})=>{document.querySelector('#count').textContent=String(data.count);});document.querySelector('#increment').onclick=()=>{client.updateQuery({query},({count})=>({count:count+1}));};document.querySelector('#data').textContent=(await (await fetch('./data.json')).json())[0];</script></body></html>`;
 await writeFile(join(root,'index.html'),html);
 session=await startPreview({root});browser=await chromium.launch({headless:true});const page=await browser.newPage();
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
 assert.ok(requests.every(url=>!/^https?:/.test(url)||new URL(url).origin===new URL(session.url).origin),JSON.stringify(requests));assert.ok(requests.every(url=>!url.includes('/local/connect')));
 assert.deepEqual(errors,[]);console.log('PASS: private request origins, local Apollo/JSON/datasets, dirty export and explicit discard, native reload preservation, disk notices, lifecycle cleanup, CSP');
}finally{await browser?.close();await session?.close();await rm(dir,{recursive:true,force:true});}
