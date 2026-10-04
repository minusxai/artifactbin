/** CI-only complete journey through the actual installed npm entry, with no credentials or remote API. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
const entry=resolve(process.argv[2]);
const scratch=await realpath(await mkdtemp(join(tmpdir(),'afbin npm local é ')));
const workspace=join(scratch,'workspace'),copy=join(scratch,'transferred'),recovery=join(scratch,'recovered');
for(const directory of [workspace,recovery])await mkdir(directory);
let remoteRequests=0;
const unavailable=createServer((_req,res)=>{remoteRequests++;res.writeHead(503);res.end('Offline acceptance: remote service unavailable');});
await new Promise(done=>unavailable.listen(0,'127.0.0.1',done));
const server=`http://127.0.0.1:${unavailable.address().port}`;
const profiles=[join(scratch,'first-home'),join(scratch,'second-home'),join(scratch,'import-home')];
for(const home of profiles)await mkdir(home);
const environment=home=>({...process.env,HOME:home,USERPROFILE:home,ARTIFACTBIN_HOME:home,ARTIFACTBIN_URL:server,CLI__AUTO_UPDATE:'0'});
async function command(cwd,home,args,timeout=180000){
 const child=spawn(process.execPath,[entry,...args],{cwd,env:environment(home),stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
 return await new Promise((done,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error(`Installed command timed out: ${args.join(' ')}\n${stdout}\n${stderr}`));},timeout);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);code===0?done(stdout):reject(Error(`Installed command ${args.join(' ')} exited ${code}\n${stdout}\n${stderr}`));});
 });
}
const jsonCommand=async(...args)=>JSON.parse(await command(...args));
async function preview(cwd,home,path='report.jsx'){
 const child=spawn(process.execPath,[entry,'preview',path,'--port','0','--json'],{cwd,env:environment(home),stdio:['ignore','pipe','pipe','ipc']});
 let stdout='',stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const ready=new Promise((done,reject)=>{
  const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error(`Preview did not start\n${stdout}\n${stderr}`));},90000);
  child.on('error',error=>{clearTimeout(timer);reject(error);});child.stdout.on('data',chunk=>{stdout+=chunk;for(const line of stdout.split('\n'))try{const value=JSON.parse(line);if(value.url){clearTimeout(timer);done(value.url);}}catch{}});
  child.once('exit',code=>{clearTimeout(timer);reject(Error(`Preview exited ${code} before ready\n${stdout}\n${stderr}`));});
 });
 const url=await ready,origin=new URL(url).origin;
 return {url,origin,close:()=>new Promise((done,reject)=>{
  if(child.exitCode!==null){child.exitCode===0?done():reject(Error(`Preview had already exited ${child.exitCode}\n${stderr}`));return;}
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error(`Preview did not exit naturally\n${stderr}`));},15000);
  child.once('exit',code=>{clearTimeout(timer);code===0?done():reject(Error(`Preview shutdown exited ${code}\n${stderr}`));});child.send({type:'afbin.shutdown'},error=>{if(error){clearTimeout(timer);reject(error);}});
 })};
}
async function get(origin,path){const response=await fetch(origin+path);assert.equal(response.status,200,`${path}: ${await response.clone().text()}`);return response.json();}
async function post(origin,path,data){const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(response.status,200,`${path}: ${await response.clone().text()}`);return response.json();}
const body=source=>source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
function payload(html){const matches=[...html.matchAll(/<script\b[^>]*\bid=["']afbin-file["'][^>]*>([\s\S]*?)<\/script>/g)];assert.equal(matches.length,1);return JSON.parse(matches[0][1]);}
let active,browser;
try{
 await writeFile(join(workspace,'sales.csv'),'amount\n10\n20\n');
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4KsAAAAASUVORK5CYII=','base64');
 await writeFile(join(workspace,'pixel.png'),image);await writeFile(join(workspace,'report.jsx'),'<h1 id="title">Local report</h1><p id="text">Initial paragraph</p>');
 const ids=await jsonCommand(workspace,profiles[0],['add','sales.csv','pixel.png','report.jsx','--json']);
 assert.match(ids['report.jsx'],/^[A-Za-z0-9]{6,12}$/);
 const registered=await readFile(join(workspace,'report.jsx'),'utf8');
 const source=registered.replace('<h1 id="title">Local report</h1>',`<Helmet><Import name="sales_data" src="ref:${ids['sales.csv']}"/><Query name="sales">{\`select sum(amount) as total from sales_data.rows\`}</Query></Helmet><h1 id="title">Local report</h1><img id="picture" src="ref:${ids['pixel.png']}" alt="Portable image"/><Number id="sum" data="$sales" col="total" agg="sum"/>`);
 await writeFile(join(workspace,'report.jsx'),source);
 active=await preview(workspace,profiles[0],ids['report.jsx']);
 const document=await get(active.origin,'/document?file=report.jsx');assert.equal(body(document.source),document.body);
 const result=await post(active.origin,'/query',{file:'report.jsx',values:{}});assert.deepEqual(result.tables.sales.rows,[{total:30}]);
 const bytes=await fetch(active.origin+'/remote/'+ids['pixel.png']);assert.equal(bytes.status,200);assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),image);
 const thread=await post(active.origin,'/editor',{file:'report.jsx',operation:'annotations.create',key:'portable-thread',input:{node_id:'text',body:'Portable note'}});
 const saved=await post(active.origin,'/save',{file:'report.jsx',revision:document.revision,body:document.body.replace('Initial paragraph','Accepted local paragraph')});assert.notEqual(saved.revision,document.revision);
 const stale=await fetch(active.origin+'/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:'report.jsx',revision:document.revision,body:'<p id="text">Stale overwrite</p>'})});assert.equal(stale.status,409);
 await active.close();active=await preview(workspace,profiles[0]);
 const threads=await post(active.origin,'/editor',{file:'report.jsx',operation:'annotations.list'});assert.equal(threads[0].id,thread.id);assert.equal(threads[0].thread[0].body,'Portable note');
 await active.close();active=undefined;
 await cp(workspace,copy,{recursive:true});
 const transferredIds=await jsonCommand(copy,profiles[1],['add','sales.csv','pixel.png','report.jsx','--json']);assert.deepEqual(transferredIds,ids);
 active=await preview(copy,profiles[1]);
 assert.match((await get(active.origin,'/document?file=report.jsx')).body,/Accepted local paragraph/);
 const copiedThreads=await post(active.origin,'/editor',{file:'report.jsx',operation:'annotations.list'});assert.equal(copiedThreads[0].id,thread.id);
 assert.deepEqual((await post(active.origin,'/query',{file:'report.jsx',values:{}})).tables.sales.rows,[{total:30}]);
 browser=await chromium.launch();const context=await browser.newContext({acceptDownloads:true});
 let remoteBrowserRequests=0;await context.route(/^https?:/,route=>{if(new URL(route.request().url()).origin===active.origin)return route.continue();remoteBrowserRequests++;return route.abort();});
 const page=await context.newPage();await page.goto(active.url);await page.getByRole('heading',{name:'Local report',exact:true}).waitFor();await page.getByRole('img',{name:'Portable image'}).evaluate(element=>element.decode());
 await context.close();await active.close();active=undefined;
 assert.equal(remoteBrowserRequests,0);
 await command(copy,profiles[1],['export','report.jsx','--format','html','--json']);
 const exported=join(copy,'report.jsx.html');const html=await readFile(exported,'utf8');const file=payload(html);
 assert.equal(file.artifactId,ids['report.jsx']);assert.equal(file.threads[0].id,thread.id);assert.deepEqual(Object.keys(file.localWorkspace.assets).sort(),[ids['sales.csv'],ids['pixel.png']].sort());
 const offline=await browser.newContext({acceptDownloads:true});await offline.addInitScript(()=>{delete window.showSaveFilePicker;});
 let offlineRequests=0;await offline.route(/^https?:/,route=>{offlineRequests++;return route.abort();});
 const offlinePage=await offline.newPage();await offlinePage.goto(pathToFileURL(exported).href);await offlinePage.getByRole('heading',{name:'Local report',exact:true}).waitFor({timeout:30000});
 await offlinePage.getByRole('img',{name:'Portable image'}).evaluate(element=>element.decode());
 await offlinePage.getByRole('button',{name:'Edit',exact:true}).click();
 const name=offlinePage.getByRole('dialog',{name:'What should we call you?'});if(await name.count()){await name.getByRole('textbox',{name:'Your name'}).fill('Offline tester');await name.getByRole('button',{name:'Save',exact:true}).click();await name.waitFor({state:'hidden'});}
 await offlinePage.waitForFunction(()=>document.getElementById('title')?.isContentEditable);
 await offlinePage.locator('#title').evaluate(element=>{(element.closest('.ProseMirror')??element).focus();const text=document.createTreeWalker(element,NodeFilter.SHOW_TEXT).nextNode();const selection=getSelection();selection.removeAllRanges();selection.setBaseAndExtent(text,0,text,text.textContent.length);});
 await offlinePage.keyboard.insertText('Offline saved report');await offlinePage.getByRole('heading',{name:'Offline saved report',exact:true}).waitFor();
 await offlinePage.getByRole('button',{name:'Done editing',exact:true}).click();
 const downloaded=await Promise.all([offlinePage.waitForEvent('download'),offlinePage.getByRole('button',{name:'Save',exact:true}).click()]);
 const savedHtml=join(recovery,'report.jsx.html');await downloaded[0].saveAs(savedHtml);
 const reopened=await offline.newPage();await reopened.goto(pathToFileURL(savedHtml).href);await reopened.getByRole('heading',{name:'Offline saved report',exact:true}).waitFor();
 assert.equal(offlineRequests,0);await offline.close();
 const incoming=payload(await readFile(savedHtml,'utf8'));assert.match(incoming.source,/Offline saved report/);assert.equal(incoming.threads[0].id,thread.id);
 const imported=await jsonCommand(recovery,profiles[2],['import','report.jsx.html','--output','recovered.jsx','--json']);assert.equal(imported.path,'recovered.jsx');
 const restoredIds=await jsonCommand(recovery,profiles[2],['add','recovered.jsx','sales.csv','pixel.png','--json']);assert.equal(restoredIds['recovered.jsx'],ids['report.jsx']);assert.equal(restoredIds['sales.csv'],ids['sales.csv']);assert.equal(restoredIds['pixel.png'],ids['pixel.png']);assert.deepEqual(await readFile(join(recovery,'pixel.png')),image);
 active=await preview(recovery,profiles[2],'recovered.jsx');assert.match((await get(active.origin,'/document?file=recovered.jsx')).body,/Offline saved report/);
 const restoredThreads=await post(active.origin,'/editor',{file:'recovered.jsx',operation:'annotations.list'});assert.equal(restoredThreads[0].id,thread.id);assert.equal(restoredThreads[0].thread[0].body,'Portable note');
 assert.deepEqual((await post(active.origin,'/query',{file:'recovered.jsx',values:{}})).tables.sales.rows,[{total:30}]);
 assert.equal(remoteRequests,0,'No installed CLI command may reach the selected unavailable remote service');
 console.log('PASS installed npm add/preview SQL+image, accepted/stale saves, comments/restart, fresh-home workspace copy, HTML file edit/save/reopen/import, stable IDs/assets/threads, zero remote requests');
}finally{
 if(active)await active.close();if(browser)await browser.close();await new Promise(done=>unavailable.close(done));await rm(scratch,{recursive:true,force:true});
}
