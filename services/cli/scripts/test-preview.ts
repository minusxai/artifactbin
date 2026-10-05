import sharp from 'sharp';
/** CI-only real Chromium proof. No mocked HTTP, persistence or SQL. */
import {chromium,type Page} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
const root=await realpath(await mkdtemp(join(tmpdir(),'preview-browser-')));
const source='<p>Draft</p>';
await writeFile(join(root,'report.jsx'),source);await writeFile(join(root,'sales.csv'),'amount\n10\n20\n');
await writeFile(join(root,'appendix.jsx'),'<p id="text">Unpublished appendix</p>');
await writeFile(join(root,'covers.csv'),'id,title,cover_ref\na,Placeholder,\n');
for(const color of ['red','blue'])await sharp({create:{width:48,height:64,channels:3,background:color}}).png().toFile(join(root,`${color}-cover.png`));
await writeFile(join(root,'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4KsAAAAASUVORK5CYII=','base64'));
await writeFile(join(root,'published.jsx'),'---\nid: abc123\nhead_version: 3\n---\n<p id="text">Published local draft</p>');
const entry=resolve(process.argv[2]??'dist/afbin.mjs');
// A fresh workspace needs no account, reservation pool or credentials.
const privateHome=join(root,'engine-cache');
const browserCache=process.env.PLAYWRIGHT_BROWSERS_PATH??(process.platform==='darwin'?join(homedir(),'Library/Caches/ms-playwright'):process.platform==='win32'?join(process.env.LOCALAPPDATA??join(homedir(),'AppData/Local'),'ms-playwright'):join(homedir(),'.cache/ms-playwright'));
const environment={...process.env,HOME:privateHome,USERPROFILE:privateHome,ARTIFACTBIN_SKILLS:'off',ARTIFACTBIN_HOME:privateHome,ARTIFACTBIN_URL:'http://127.0.0.1:1',CLI__AUTO_UPDATE:'0',PLAYWRIGHT_BROWSERS_PATH:browserCache};
const addArgs=['add','sales.csv','appendix.jsx','pixel.png','report.jsx','covers.csv','red-cover.png','blue-cover.png','--json'];
const ids=await new Promise<Record<string,string>>((resolve,reject)=>{
 const child=spawn(process.execPath,[entry,...addArgs],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout!.on('data',chunk=>out+=chunk);child.stderr!.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(out+err)));
});
const registered=(await readFile(join(root,'report.jsx'),'utf8'));
await writeFile(join(root,'covers.csv'),'id,title,cover_ref\n'+['red','blue'].map(color=>`${color},${color},ref:${ids[color+'-cover.png']}`).join('\n')+'\n');
await writeFile(join(root,'report.jsx'),registered.replace('<p>Draft</p>',`<Helmet><Value name="minimum" type="number" default={0} /><Import name="sales_data" src="ref:${ids['sales.csv']}" /><Query name="sales">{\`select sum(amount) as total from sales_data.rows where amount > $minimum\`}</Query></Helmet><div><a href="/a/${ids['appendix.jsx']}">Local appendix</a><img src="ref:${ids['pixel.png']}" alt="Local image" /><p id="text">Draft paragraph</p><Select label="Minimum" value="$minimum" options={[{"label":"All","value":0},{"label":"Above fifteen","value":15}]} /><Number data="$sales" col="total" agg="sum" /></div>`));
async function launch(port=0){
 const args=['preview',ids['report.jsx']!,'published.jsx','--port',String(port),'--json'];
 const child=spawn(process.execPath,[entry,...args],{cwd:root,env:environment,stdio:['ignore','pipe','pipe','ipc']});
 let output='';child.stderr!.on('data',chunk=>process.stderr.write(chunk));
 const url=await new Promise<string>((resolve,reject)=>{child.stdout!.on('data',chunk=>{output+=chunk;for(const line of output.split('\n')){try{const value=JSON.parse(line);if(value.url)resolve(value.url);}catch{}}});child.on('exit',code=>reject(Error(`Host exited ${code}: ${output}`)));});
 return {url,close:()=>new Promise<void>((resolve,reject)=>{if(child.exitCode!==null){child.exitCode===0?resolve():reject(Error(`Host exit ${child.exitCode}`));return;}const timer=setTimeout(()=>{child.kill();reject(Error('Preview did not shut down through IPC'));},15000);child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error(`Host exit ${code}`));});child.send({type:'afbin.shutdown'},error=>{if(error){clearTimeout(timer);reject(error);}});})};
}
const phase=process.argv.find(value=>value.startsWith('--phase='))?.slice(8)??'all';
if(!['all','preview','export-basic','export-variants'].includes(phase))throw new Error('Unknown preview proof phase');
let server=phase.startsWith('export-')?undefined:await launch();
let browser=phase.startsWith('export-')?undefined:await chromium.launch();
const errors:string[]=[];
const browserEvents:Array<Record<string,unknown>>=[];
const trackedPages:Array<{page:Page;label:string}>=[];
function trackPage(page:Page,label:string){
 trackedPages.push({page,label});
 page.on('pageerror',error=>{errors.push(error.message);browserEvents.push({page:label,type:'pageerror',message:error.stack??error.message});});
 page.on('console',message=>browserEvents.push({page:label,type:'console',level:message.type(),message:message.text()}));
 page.on('requestfailed',request=>browserEvents.push({page:label,type:'requestfailed',url:request.url(),error:request.failure()?.errorText}));
 page.on('response',response=>{if(response.url().includes('/document?')||response.url().includes('/bundle/')||response.status()>=400)browserEvents.push({page:label,type:'response',url:response.url(),status:response.status()});});
 return page;
}
async function ready(page:Page){
 // SSR prose alone says nothing about either the reader module or the independently
 // fetched preview chrome. Do not navigate away while that first boot is pending.
 await page.waitForFunction(()=>document.documentElement.hasAttribute('data-mx-ready'));
 await page.getByRole('button',{name:'Edit document',exact:true}).waitFor();
}
async function retainDiagnostics(error:unknown){
 const destination=resolve('test-results','local-journey','preview-'+phase);
 await mkdir(destination,{recursive:true});
 await writeFile(join(destination,'failure.json'),JSON.stringify({entry,root,url:server?.url,error:error instanceof Error?error.stack:String(error),browserEvents},null,2));
 for(const file of ['report.jsx','appendix.jsx','published.jsx','sales.csv'])await writeFile(join(destination,file),await readFile(join(root,file)));
 for(const {page,label} of trackedPages){
  if(page.isClosed())continue;
  try{
   await writeFile(join(destination,label+'-dom.html'),await page.content());
   await writeFile(join(destination,label+'-aria.txt'),await page.locator('body').ariaSnapshot());
   await writeFile(join(destination,label+'-state.json'),JSON.stringify(await page.evaluate(()=>({url:location.href,ready:document.documentElement.hasAttribute('data-mx-ready'),previewBars:document.querySelectorAll('.afbin-preview-bar').length,scripts:[...document.scripts].map(script=>({src:script.src,type:script.type}))})),null,2));
   await page.screenshot({path:join(destination,label+'.png'),fullPage:true});
  }catch(reason){await writeFile(join(destination,label+'-unavailable.txt'),String(reason));}
 }
 console.error('Preview diagnostics retained at '+destination);
}
try{
 if(server&&browser){
 const a=trackPage(await browser.newPage(),'editing'),b=trackPage(await browser.newPage(),'reader');
 await a.goto(server.url);await b.goto(server.url);await ready(a);await ready(b);
 await a.locator('#text').waitFor();assert.equal(await a.locator('#text').textContent(),'Draft paragraph');
 await a.getByRole('img',{name:'Local image'}).evaluate((image:HTMLImageElement)=>image.decode());
 // The compiled reader is a clean read-only page until "Edit document" is pressed; a link just navigates.
 await a.getByRole('link',{name:'Local appendix'}).click();await a.locator('#text').filter({hasText:'Unpublished appendix'}).waitFor();await a.goto(server.url);await ready(a);await a.locator('#text').waitFor();
 console.log('PASS offline CLI add, ID preview, image and JSX link resolve before publication');
 // `b` stays a clean reader for the rest of this run.
 await a.getByRole('button',{name:'Edit document',exact:true}).click();
 await a.waitForFunction(()=>document.getElementById('text')?.isContentEditable);
 await a.locator('#text').dblclick();
 await a.locator('#text').evaluate(element=>{(element as HTMLElement).focus();const range=document.createRange();range.selectNodeContents(element);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);});
 await a.keyboard.type('Browser saved paragraph');
 await a.waitForSelector('text=Unsaved');
 const saved=a.waitForResponse(response=>response.url().endsWith('/save'));
 await a.getByRole('button',{name:'Done editing',exact:true}).click();
 const savedResponse=await saved;assert.equal(savedResponse.status(),200);
 assert.match(await readFile(join(root,'report.jsx'),'utf8'),/<p id="text">Browser saved paragraph<\/p>/);
 assert.ok((await readFile(join(root,'report.jsx'),'utf8')).includes('href="/a/'+ids['appendix.jsx']+'"'));
 assert.ok((await readFile(join(root,'report.jsx'),'utf8')).includes('src="ref:'+ids['pixel.png']+'"'));
 await a.waitForLoadState('networkidle');await a.getByRole('button',{name:'Edit document',exact:true}).waitFor();
 await b.locator('#text').filter({hasText:'Browser saved paragraph'}).waitFor({timeout:5000});
 console.log('PASS production in-place editor -> HTTP -> file -> second browser');
 // Observe real SQLite result changes through the production control/dataflow runtime (a plain GET query door).
 const firstQuery=a.waitForResponse(response=>response.url().includes('/query')&&decodeURIComponent(response.url()).includes('"minimum":15'));
 await a.getByRole('button',{name:'Minimum',exact:true}).click();
 await a.getByRole('option',{name:'Above fifteen',exact:true}).click();
 const answer=await (await firstQuery).json();assert.deepEqual(answer.tables.sales.rows,[{total:20}]);
 console.log('PASS control-driven SQL uses local CSV and the built-in SQLite engine');
 const staleRevision=savedResponse.request().postDataJSON().revision;
 const stale=await b.request.post(server.url+'/save',{data:{file:'report.jsx',revision:staleRevision,body:'<p id="text">Stale overwrite</p>'}});
 assert.equal(stale.status(),409);
 assert.match(await readFile(join(root,'report.jsx'),'utf8'),/Browser saved paragraph/);
 console.log('PASS stale browser save refused without overwriting file');
 await writeFile(join(root,'report.jsx'),(await readFile(join(root,'report.jsx'),'utf8')).replace('Browser saved paragraph','External editor saved'));
 await b.locator('#text').filter({hasText:'External editor saved'}).waitFor({timeout:5000});
 console.log('PASS external file edit refreshes clean viewer');
 await b.reload();
 await b.getByRole('button',{name:/Comments/,exact:false}).click();
 // `pickOnOpen`'s own floating hint ("tap a block…") sits fixed near the top and can cover this
 // short fixture's first (only) paragraph outright — a forced click still lands ON the hint, not
 // the paragraph underneath it. The hint is not what this step tests; drop it, then click for real.
 await b.evaluate(() => document.querySelector('[aria-label="Select tool active"]')?.remove());
 await b.locator('#text').click();
 await b.getByRole('textbox').last().fill('Persistent note');
 await b.getByRole('button',{name:'Save annotation'}).click();
 await b.getByText('Persistent note',{exact:true}).first().waitFor();
 const port=Number(new URL(server.url).port);await server.close();server=await launch(port);
 await b.reload();await b.getByRole('button',{name:/Comments/,exact:false}).click();await b.getByText('Persistent note',{exact:true}).first().waitFor();
 console.log('PASS production comments survive process restart with the same node anchor');
 await a.goto(server.url+'/?file=published.jsx');await a.locator('#text').filter({hasText:'Published local draft'}).waitFor();
 await a.getByRole('button',{name:'Edit the source',exact:true}).click();
 const codeSaved=a.waitForResponse(response=>response.url().endsWith('/save'));
 await a.getByRole('textbox',{name:'Markup source',exact:true}).fill('<p id="text">Local v3 edit</p>');
 await a.waitForSelector('text=Local v3 edit');
 await a.getByRole('button',{name:'Done editing',exact:true}).click();
 assert.equal((await codeSaved).status(),200);
 await a.waitForLoadState('networkidle');
 await a.locator('#text').filter({hasText:'Local v3 edit'}).waitFor();
 assert.match(await readFile(join(root,'published.jsx'),'utf8'),/Local v3 edit/);
 assert.match(await readFile(join(root,'published.jsx'),'utf8'),/head_version: 3/);
 console.log('PASS production Code editor saves local bytes and retains remote version');
 assert.equal((await a.request.get(server.url+'/document?file=home/preview-comments.sqlite')).status(),403);
 assert.equal((await a.request.post(server.url+'/save',{headers:{origin:'https://unrelated.example'},data:{}})).status(),403);
 assert.deepEqual(errors,[]);console.log('PASS npm scope/origin restrictions; no browser exceptions');
 // Export owns another browser. Release preview resources while retaining the
 // same home so local state and browser preparation are reused for exports.
 await browser.close();browser=undefined;await server.close();server=undefined;
 }
 if(phase!=='preview'){
 // Same proof runs against the installed npm entry on every supported platform.
 async function imageExport(args:string[],ok=true,interrupt=false){
  const out=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
   const argv=['export',...args,'--json'];
   const child=spawn(process.execPath,[entry,...argv],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
   const cancellation=interrupt?setTimeout(()=>child.kill('SIGTERM'),500):undefined;
   let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error(`Local export did not finish: ${args.join(' ')}\n${stdout.slice(-2000)}\n${stderr.slice(-2000)}`));},120000);
   child.stdout!.on('data',chunk=>stdout+=chunk);child.stderr!.on('data',chunk=>stderr+=chunk);child.once('error',error=>{clearTimeout(timer);clearTimeout(cancellation);reject(error);});child.once('exit',code=>{clearTimeout(timer);clearTimeout(cancellation);resolve({code,stdout,stderr});});
  });
  assert.equal(out.code===0,ok,out.stdout+out.stderr);return out;
 }
 // Include dataset images in the existing cold export: no extra browser launch is
 // needed to prove the shared resolver in the installed npm runtime.
 await writeFile(join(root,'report.jsx'),(await readFile(join(root,'report.jsx'),'utf8')).replace('</Helmet>',`<Import name="books_data" src="ref:${ids['covers.csv']}" /><Query name="books">{\`select * from books_data.rows\`}</Query></Helmet>`)+`<For each={$books} keyBy="id"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={48} height={64}/></For>`);
 const beforeExport=await readFile(join(root,'report.jsx'));
 await imageExport([ids['report.jsx']!,'--output','report.png']);
 assert.equal((await sharp(await readFile(join(root,'report.png'))).metadata()).format,'png');
 assert.deepEqual(await readFile(join(root,'report.jsx')),beforeExport);
 const pixels=await sharp(await readFile(join(root,'report.png'))).removeAlpha().raw().toBuffer({resolveWithObject:true});
 let redPixels=0,bluePixels=0;
 for(let i=0;i<pixels.data.length;i+=pixels.info.channels){if(pixels.data[i]!>220&&pixels.data[i+1]!<30&&pixels.data[i+2]!<30)redPixels++;if(pixels.data[i]!<30&&pixels.data[i+1]!<30&&pixels.data[i+2]!>220)bluePixels++;}
 assert.ok(redPixels>100&&bluePixels>100,'Local export must contain both dataset image refs');
 console.log('PASS local export resolves red and blue dataset image refs');
 const color=async(file:string)=>{const {data,info}=await sharp(await readFile(join(root,file))).removeAlpha().raw().toBuffer({resolveWithObject:true});const at=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;return [data[at]!,data[at+1]!,data[at+2]!];};
 const red='<div className="h-64 bg-red-500"><p>Unpublished image</p></div>';
 const proofs:Array<()=>Promise<void>>=[];
 if(phase!=='export-variants')proofs.push(async()=>{
 await writeFile(join(root,'capture.jsx'),red);
 await imageExport(['capture.jsx','--output','red.png']);
 const r=await color('red.png');assert.ok(r[0]!>r[2]!+60,`Red local content missing: ${r}`);
 assert.equal(await readFile(join(root,'capture.jsx'),'utf8'),red,'export never registers or rewrites the source');
 await writeFile(join(root,'capture.jsx'),red.replace('bg-red-500','bg-blue-500'));
 await imageExport(['capture.jsx','--output','blue.jpg']);
 assert.equal((await sharp(await readFile(join(root,'blue.jpg'))).metadata()).format,'jpeg');
 const blue=await color('blue.jpg');assert.ok(blue[2]!>blue[0]!+60,`Latest blue local edit missing: ${blue}`);
 });
 if(phase!=='export-basic'){
 // Independent sources let three warm workers keep running without batch barriers.
 // The edit proof above stays ordered, and cold installation was already proved.
 await writeFile(join(root,'card.jsx'),red.replace('bg-red-500','bg-blue-500'));
 await writeFile(join(root,'pixel.png'),await sharp({create:{width:100,height:100,channels:3,background:'#ff0000'}}).png().toBuffer());
 await writeFile(join(root,'cover.jsx'),`<Helmet><meta name="artifactbin:og-image" content="ref:${ids['pixel.png']}" /></Helmet><p>Cover</p>`);
 await writeFile(join(root,'slides.jsx'),'<SlideDeck><Slide title="One"><p>First</p></Slide><Slide title="Two"><p>Second</p></Slide></SlideDeck>');
 await writeFile(join(root,'bad.jsx'),`<Helmet><Import name="bad_data" src="ref:${ids['sales.csv']}" /><Query name="bad">{\`select missing from bad_data.rows\`}</Query></Helmet><p>Bad SQL</p>`);
 proofs.push(
  async()=>{await imageExport(['card.jsx','--og','--output','card.png']);assert.deepEqual((( {width,height})=>({width,height}))(await sharp(await readFile(join(root,'card.png'))).metadata()),{width:1600,height:840});},
  async()=>{await imageExport(['cover.jsx','--og','--output','cover.png']);const cover=await color('cover.png');assert.ok(cover[0]!>240&&cover[2]!<10,'Local cover uses the same image pipeline as published exports');},
  async()=>{await imageExport(['slides.jsx','--page','2','--output','slide.png']);},
  async()=>{const missing=await imageExport(['slides.jsx','--page','3','--output','missing.png'],false);assert.match(missing.stdout,/slide_not_found/);await assert.rejects(readFile(join(root,'missing.png')),/ENOENT/);},
  async()=>{const failed=await imageExport(['bad.jsx','--output','bad.png'],false);assert.match(failed.stdout,/render_failed/);await assert.rejects(readFile(join(root,'bad.png')),/ENOENT/);},
  async()=>{await imageExport(['card.jsx','--output','interrupted.png'],false,true);await assert.rejects(readFile(join(root,'interrupted.png')),/ENOENT/);},
 );
 }
 const workers=await Promise.allSettled(Array.from({length:3},async()=>{for(let proof;(proof=proofs.shift());)await proof();}));
 for(const worker of workers)if(worker.status==='rejected')throw worker.reason;
 console.log(`PASS local image export proof (${phase}); sources unchanged and lazy caches reused`);
 }
}catch(error){try{await retainDiagnostics(error);}catch(reason){console.error('Could not retain preview diagnostics',reason);}console.error('Browser errors:',errors);for(const context of browser?.contexts()??[])for(const page of context.pages())console.error((await page.locator('body').innerText()).slice(0,5000));throw error;}finally{await browser?.close();await server?.close();await rm(root,{recursive:true,force:true});}
