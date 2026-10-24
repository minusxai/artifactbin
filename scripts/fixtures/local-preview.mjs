// Bounded real-browser scenario: no app server, publication, account or network setup.
import {mkdtemp,mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {buildHtmlAssets} from '../../services/app/lib/html-runtime/build.server.ts';
const dir=await mkdtemp(join(tmpdir(),'local-preview-browser-'));let session,browser;
try {
 const skill=join(dir,'skill'),root=join(dir,'project');await mkdir(skill);await mkdir(root);
 for(const name of ['preview.mjs','preview-changes.mjs'])await writeFile(join(skill,name),await readFile(new URL('../../services/app/skills/artifactbin/scripts/'+name,import.meta.url)));
 await writeFile(join(skill,'preview-runtime.mjs'),'export default '+JSON.stringify(await buildHtmlAssets())+';');
 const {startPreview}=await import(pathToFileURL(join(skill,'preview.mjs')).href);
 await writeFile(join(root,'data.json'),'[7]');
 const html=`<!doctype html><html><head><script src="/af/v1/core.js" data-af="core"></script><script data-af="state" type="application/json">{"count":0}</script></head><body><button id="increment">Add one</button><output id="count"></output><output id="data"></output><script type="module">import {client,gql} from '@afbin/apollo';const query=gql\`{count}\`;client.watchQuery({query}).subscribe(({data})=>{document.querySelector('#count').textContent=String(data.count);});document.querySelector('#increment').onclick=()=>{client.updateQuery({query},({count})=>({count:count+1}));};document.querySelector('#data').textContent=(await (await fetch('./data.json')).json())[0];</script></body></html>`;
 await writeFile(join(root,'index.html'),html);
 session=await startPreview({root});browser=await chromium.launch({headless:true});const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(session.url);await page.getByRole('button',{name:'Add one'}).click();await page.waitForFunction(()=>document.querySelector('#count').textContent==='1');
 assert.equal(await page.locator('#data').textContent(),'7');
 await page.route('**/__af_preview/revision',route=>route.fulfill({status:503,body:'offline'}));
 await page.getByText('Preview disconnected — retrying',{exact:true}).waitFor();
 await page.unroute('**/__af_preview/revision');
 await page.getByText('Preview disconnected — retrying',{exact:true}).waitFor({state:'hidden'});
 let polls=0;page.on('request',request=>{if(request.url().endsWith('/__af_preview/revision'))polls++;});
 await page.evaluate(()=>dispatchEvent(new Event('pagehide')));const stopped=polls;
 await page.waitForTimeout(1700);assert.equal(polls,stopped);
 await page.evaluate(()=>dispatchEvent(new Event('pageshow')));
 await page.waitForTimeout(1700);assert.ok(polls>stopped);
 await writeFile(join(root,'data.json'),'[8]');await page.getByText('File changed',{exact:true}).waitFor();
 assert.equal(await page.locator('#data').textContent(),'7');
 await page.getByRole('button',{name:'Reload',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#data').textContent==='8');
 assert.equal(await page.locator('#count').textContent(),'1');
 await writeFile(join(root,'next.html'),html.replace('Add one','Increment'));await rename(join(root,'next.html'),join(root,'index.html'));
 await page.getByText('File changed',{exact:true}).waitFor();await page.getByRole('button',{name:'Reload',exact:true}).click();await page.getByRole('button',{name:'Increment',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: local Apollo state, relative JSON, dependency and atomic-save notification, explicit reload, CSP');
}finally{await browser?.close();await session?.close();await rm(dir,{recursive:true,force:true});}
