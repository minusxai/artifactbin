import sharp from 'sharp';
/** CI-only real Chromium proof. No mocked HTTP, persistence or SQL. */
import {State,HOME_SCOPE} from '../src/state';
import {saveConnection} from '../src/config';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
const root=await realpath(await mkdtemp(join(tmpdir(),'preview-browser-')));
const source='<p>Draft</p>';
await writeFile(join(root,'report.jsx'),source);await writeFile(join(root,'sales.csv'),'amount\n10\n20\n');
await writeFile(join(root,'appendix.jsx'),'<p id="text">Unpublished appendix</p>');
await writeFile(join(root,'covers.csv'),'id,title,cover_ref\na,Placeholder,\n');
for(const color of ['red','blue'])await sharp({create:{width:48,height:64,channels:3,background:color}}).png().toFile(join(root,`${color}-cover.png`));
await writeFile(join(root,'pixel.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4KsAAAAASUVORK5CYII=','base64'));
await writeFile(join(root,'published.jsx'),'---\nid: abc123\nhead_version: 3\n---\n<p id="text">Published local draft</p>');
const binary=resolve(process.argv[2]??`dist/afbin-${process.platform}-${process.arch}`);
const packaged=!binary.endsWith('.mjs');
const nativeBytes=packaged?await readFile(resolve(`dist/afbin-sql-${process.platform}-${process.arch}.gz`)):null;
const runtimeBytes=packaged?await readFile(resolve(`dist/afbin-runtime-${process.platform}-${process.arch}.gz`)):null;
const chromiumBytes=packaged?await readFile(resolve(`dist/afbin-chromium-${process.platform}-${process.arch}.gz`)):null;
let downloads=0;
const packages=createServer((req,res)=>{downloads++;res.end(req.url?.includes('/afbin-runtime-')?runtimeBytes:req.url?.includes('/afbin-chromium-')?chromiumBytes:nativeBytes);});
await new Promise<void>(resolve=>packages.listen(0,'127.0.0.1',resolve));
const packagePort=(packages.address() as {port:number}).port;
// Seed a server-issued pool fixture, then exercise actual offline add in the built CLI.
const privateHome=join(root,'engine-cache'),origin='http://127.0.0.1:7445';
const account='usr_preview_proof';
const state=await State.open(root,{ARTIFACTBIN_HOME:privateHome});
state.put(root,'workspace',root,{server:origin,account});
state.put(HOME_SCOPE,'identity-pool',JSON.stringify([origin,account]),{ids:Array.from({length:100},(_,i)=>'P'+String(i).padStart(5,'0'))});state.close();
await saveConnection({server:origin,token:'mxmx_test_offline_preview'},root,{ARTIFACTBIN_HOME:privateHome});
const addArgs=['add','sales.csv','appendix.jsx','pixel.png','report.jsx','covers.csv','red-cover.png','blue-cover.png','--json'];
const ids=await new Promise<Record<string,string>>((resolve,reject)=>{
 const child=spawn(packaged?binary:process.execPath,packaged?addArgs:[binary,...addArgs],{cwd:root,env:{...process.env,ARTIFACTBIN_HOME:privateHome,CLI__AUTO_UPDATE:'0'},stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(Error(out+err)));
});
const registered=(await readFile(join(root,'report.jsx'),'utf8'));
await writeFile(join(root,'covers.csv'),'id,title,cover_ref\n'+['red','blue'].map(color=>`${color},${color},ref:${ids[color+'-cover.png']}`).join('\n')+'\n');
await writeFile(join(root,'report.jsx'),registered.replace('<p>Draft</p>',`<Helmet><Value name="minimum" type="number" default={0} /><Query name="sales" source="ref:${ids['sales.csv']}">{\`select sum(amount) as total from public.rows where amount > $minimum\`}</Query></Helmet><div><a href="/a/${ids['appendix.jsx']}">Local appendix</a><img src="ref:${ids['pixel.png']}" alt="Local image" /><p id="text">Draft paragraph</p><Select label="Minimum" value="$minimum" options={[{"label":"All","value":0},{"label":"Above fifteen","value":15}]} /><Number data="$sales" col="total" agg="sum" /></div>`));
async function launch(port=0){
 const args=['preview',ids['report.jsx']!,'published.jsx','--port',String(port),'--json'];
 const child=spawn(packaged?binary:process.execPath,packaged?args:[binary,...args],{cwd:root,env:{...process.env,ARTIFACTBIN_HOME:join(root,'engine-cache'),CLI__AUTO_UPDATE:'0',CLI__SERVICE_BASE_URL:`http://127.0.0.1:${packagePort}/chat/releases`},stdio:['ignore','pipe','pipe']});
 let output='';child.stderr.on('data',chunk=>process.stderr.write(chunk));
 const url=await new Promise<string>((resolve,reject)=>{child.stdout.on('data',chunk=>{output+=chunk;for(const line of output.split('\n')){try{const value=JSON.parse(line);if(value.url)resolve(value.url);}catch{}}});child.on('exit',code=>reject(Error(`Host exited ${code}: ${output}`)));});
 return {url,close:()=>new Promise<void>((resolve,reject)=>{if(child.exitCode!==null){resolve();return;}child.once('exit',code=>code===0?resolve():reject(Error(`Host exit ${code}`)));child.kill('SIGTERM');})};
}
const phase=process.argv.find(value=>value.startsWith('--phase='))?.slice(8)??'all';
if(!['all','preview','export-basic','export-variants'].includes(phase))throw new Error('Unknown preview proof phase');
let server=phase.startsWith('export-')?undefined:await launch();
const browser=phase.startsWith('export-')?undefined:await chromium.launch();
const errors:string[]=[];
try{
 if(server&&browser){
 const a=await browser.newPage(),b=await browser.newPage();
 a.on('pageerror',error=>errors.push(error.message));b.on('pageerror',error=>errors.push(error.message));
 await a.goto(server.url);await b.goto(server.url);
 await a.locator('#text').waitFor();assert.equal(await a.locator('#text').textContent(),'Draft paragraph');
 await a.getByRole('img',{name:'Local image'}).evaluate((image:HTMLImageElement)=>image.decode());
 await a.getByRole('link',{name:'Local appendix'}).click();await a.locator('#text').filter({hasText:'Unpublished appendix'}).waitFor();await a.goto(server.url);await a.locator('#text').waitFor();
 console.log('PASS offline CLI add, ID preview, image and JSX link resolve before publication');
 await a.getByRole('button',{name:'Edit document',exact:true}).click();
 await a.waitForFunction(()=>document.getElementById('text')?.isContentEditable);
 await a.locator('#text').evaluate(element=>{(element as HTMLElement).focus();const range=document.createRange();range.selectNodeContents(element);const selection=getSelection()!;selection.removeAllRanges();selection.addRange(range);});
 await a.keyboard.type('Browser saved paragraph');
 await a.getByRole('button',{name:'Save file',exact:true}).click();
 await a.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
 assert.match(await readFile(join(root,'report.jsx'),'utf8'),/<p id="text">Browser saved paragraph<\/p>/);
 assert.ok((await readFile(join(root,'report.jsx'),'utf8')).includes('href="/a/'+ids['appendix.jsx']+'"'));
 assert.ok((await readFile(join(root,'report.jsx'),'utf8')).includes('src="ref:'+ids['pixel.png']+'"'));
 await b.locator('#text').filter({hasText:'Browser saved paragraph'}).waitFor();
 console.log('PASS real in-place editor -> HTTP -> file -> second browser');
 await a.getByRole('button',{name:'Stop editing',exact:true}).click();
 // Observe real DuckDB result changes through the production control/dataflow runtime.
 const firstQuery=a.waitForResponse(response=>response.url().endsWith('/query')&&response.request().postData()?.includes('15')===true);
 await a.getByRole('button',{name:'Minimum',exact:true}).click();
 await a.getByRole('option',{name:'Above fifteen',exact:true}).click();
 const answer=await (await firstQuery).json();assert.deepEqual(answer.tables.sales.rows,[{total:20}]);
 console.log('PASS control-driven SQL uses local CSV and real DuckDB');
 const before=await a.getByRole('textbox',{name:'Source',exact:true}).inputValue();
 await b.getByRole('textbox',{name:'Source',exact:true}).fill(before.replace('Browser saved paragraph','Second writer draft'));
 await a.getByRole('textbox',{name:'Source',exact:true}).fill(before.replace('Browser saved paragraph','First writer saves'));
 await a.getByRole('button',{name:'Save file',exact:true}).click();await a.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
 await b.getByRole('button',{name:'Save file',exact:true}).click();await b.getByRole('status').filter({hasText:'File changed'}).waitFor();
 assert.match(await b.getByRole('textbox',{name:'Source',exact:true}).inputValue(),/Second writer draft/);
 assert.match(await readFile(join(root,'report.jsx'),'utf8'),/First writer saves/);
 console.log('PASS stale second-browser save refused; both file and losing draft retained');
 await writeFile(join(root,'report.jsx'),(await readFile(join(root,'report.jsx'),'utf8')).replace('First writer saves','External editor saved'));
 await a.locator('#text').filter({hasText:'External editor saved'}).waitFor();
 console.log('PASS external file edit refreshes clean viewer');
 await a.getByRole('textbox',{name:'Name',exact:true}).fill('Sam');
 await a.getByRole('textbox',{name:'Comment',exact:true}).fill('Persistent note');await a.getByRole('button',{name:'Add comment'}).click();
 await a.getByRole('list',{name:'Comments'}).filter({hasText:'Persistent note'}).waitFor();
 const port=Number(new URL(server.url).port);await server.close();server=await launch(port);
 await a.reload();await a.getByRole('list',{name:'Comments'}).filter({hasText:'Persistent note'}).waitFor();
 console.log('PASS comments survive process restart with the same node anchor');
 await a.goto(server.url+'/?file=published.jsx');await a.locator('#text').filter({hasText:'Published local draft'}).waitFor();
 await a.getByRole('textbox',{name:'Source',exact:true}).fill('<p id="text">Local v3 edit</p>');await a.getByRole('button',{name:'Save file',exact:true}).click();await a.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
 assert.match(await readFile(join(root,'published.jsx'),'utf8'),/head_version: 3/);
 console.log('PASS published identity renders local bytes; save retains remote version');
 assert.equal((await a.request.get(server.url+'/document?file=home/preview-comments.sqlite')).status(),403);
 assert.equal((await a.request.post(server.url+'/save',{headers:{origin:'https://unrelated.example'},data:{}})).status(),403);
 assert.deepEqual(errors,[]);if(packaged)assert.equal(downloads,2,'Runtime and DuckDB each download once and reuses verified cache after process restart');console.log('PASS scope/origin restrictions; no browser exceptions'+(packaged?'; SEA ran outside checkout with lazy runtime and engine downloads':''));

 }
 if(phase!=='preview'){
 // Same proof runs against installed npm and all four standalone executables.
 async function imageExport(args:string[],ok=true,interrupt=false){
  const out=await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
   const argv=['export',...args,'--json'];
   const child=spawn(packaged?binary:process.execPath,packaged?argv:[binary,...argv],{cwd:root,env:{...process.env,ARTIFACTBIN_HOME:privateHome,CLI__AUTO_UPDATE:'0',CLI__SERVICE_BASE_URL:`http://127.0.0.1:${packagePort}/chat/releases`},stdio:['ignore','pipe','pipe']});
   const cancellation=interrupt?setTimeout(()=>child.kill('SIGTERM'),500):undefined;
   let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error(`Local export did not finish: ${args.join(' ')}\n${stdout.slice(-2000)}\n${stderr.slice(-2000)}`));},120000);
   child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',error=>{clearTimeout(timer);clearTimeout(cancellation);reject(error);});child.once('exit',code=>{clearTimeout(timer);clearTimeout(cancellation);resolve({code,stdout,stderr});});
  });
  assert.equal(out.code===0,ok,out.stdout+out.stderr);return out;
 }
 const beforeExport=await readFile(join(root,'report.jsx'));
 await imageExport([ids['report.jsx']!,'--output','report.png']);
 assert.equal((await sharp(await readFile(join(root,'report.png'))).metadata()).format,'png');
 assert.deepEqual(await readFile(join(root,'report.jsx')),beforeExport);
 const color=async(file:string)=>{const {data,info}=await sharp(await readFile(join(root,file))).removeAlpha().raw().toBuffer({resolveWithObject:true});const at=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels;return [data[at]!,data[at+1]!,data[at+2]!];};
 const red='<div className="h-64 bg-red-500"><p>Unpublished image</p></div>';
 if(phase!=='export-variants'){
 await writeFile(join(root,'capture.jsx'),red);
 await imageExport(['capture.jsx','--output','red.png']);

 const r=await color('red.png');assert.ok(r[0]!>r[2]!+60,`Red local content missing: ${r}`);
 assert.equal(await readFile(join(root,'capture.jsx'),'utf8'),red,'export never registers or rewrites the source');
 await writeFile(join(root,'capture.jsx'),red.replace('bg-red-500','bg-blue-500'));
 await imageExport(['capture.jsx','--output','blue.jpg']);
 assert.equal((await sharp(await readFile(join(root,'blue.jpg'))).metadata()).format,'jpeg');
 const blue=await color('blue.jpg');assert.ok(blue[2]!>blue[0]!+60,`Latest blue local edit missing: ${blue}`);
 }else await writeFile(join(root,'capture.jsx'),red.replace('bg-red-500','bg-blue-500'));
 if(phase!=='export-basic'){
 await writeFile(join(root,'gallery.jsx'),`<Helmet><Query name="books" source="ref:${ids['covers.csv']}">{\`select * from public.rows\`}</Query></Helmet><For each={$books} keyBy="id"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={48} height={64}/></For>`);
 await imageExport(['gallery.jsx','--output','gallery.png']);
 const pixels=await sharp(await readFile(join(root,'gallery.png'))).removeAlpha().raw().toBuffer({resolveWithObject:true});
 let redPixels=0,bluePixels=0;
 for(let i=0;i<pixels.data.length;i+=pixels.info.channels){if(pixels.data[i]!>220&&pixels.data[i+1]!<30&&pixels.data[i+2]!<30)redPixels++;if(pixels.data[i]!<30&&pixels.data[i+1]!<30&&pixels.data[i+2]!>220)bluePixels++;}
 assert.ok(redPixels>100&&bluePixels>100,'Local export must contain both dataset image refs');
 console.log('PASS local export resolves red and blue dataset image refs');
 // Warm-cache exports are independent. Two browser workers bound memory while
 // retaining the cold-cache proof and the ordered red -> edited blue assertion above.
 await writeFile(join(root,'pixel.png'),await sharp({create:{width:100,height:100,channels:3,background:'#ff0000'}}).png().toBuffer());
 await writeFile(join(root,'cover.jsx'),`<Helmet><meta name="artifactbin:og-image" content="ref:${ids['pixel.png']}" /></Helmet><p>Cover</p>`);
 await writeFile(join(root,'slides.jsx'),'<SlideDeck><Slide title="One"><p>First</p></Slide><Slide title="Two"><p>Second</p></Slide></SlideDeck>');
 await writeFile(join(root,'bad.jsx'),`<Helmet><Query name="bad" source="ref:${ids['sales.csv']}">{\`select missing from public.rows\`}</Query></Helmet><p>Bad SQL</p>`);
 await Promise.all([
  (async()=>{await imageExport(['capture.jsx','--og','--output','card.png']);assert.deepEqual((( {width,height})=>({width,height}))(await sharp(await readFile(join(root,'card.png'))).metadata()),{width:1600,height:840});})(),
  (async()=>{await imageExport(['cover.jsx','--og','--output','cover.png']);const cover=await color('cover.png');assert.ok(cover[0]!>240&&cover[2]!<10,'Local cover uses the same image pipeline as published exports');})(),
 ]);
 await Promise.all([
  imageExport(['slides.jsx','--page','2','--output','slide.png']),
  (async()=>{const missing=await imageExport(['slides.jsx','--page','3','--output','missing.png'],false);assert.match(missing.stdout,/slide_not_found/);await assert.rejects(readFile(join(root,'missing.png')),/ENOENT/);})(),
 ]);
 await Promise.all([
  (async()=>{const failed=await imageExport(['bad.jsx','--output','bad.png'],false);assert.match(failed.stdout,/render_failed/);await assert.rejects(readFile(join(root,'bad.png')),/ENOENT/);})(),
  (async()=>{await imageExport(['capture.jsx','--output','interrupted.png'],false,true);await assert.rejects(readFile(join(root,'interrupted.png')),/ENOENT/);})(),
 ]);
 }
 if(packaged)assert.equal(downloads,3,'Runtime, SQL and Chromium are downloaded once, then reused');
 console.log(`PASS local image export proof (${phase}); sources unchanged and lazy caches reused`);
 }
}catch(error){console.error('Browser errors:',errors);for(const context of browser?.contexts()??[])for(const page of context.pages())console.error((await page.locator('body').innerText()).slice(0,5000));throw error;}finally{await browser?.close();await server?.close();await new Promise<void>(resolve=>packages.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
