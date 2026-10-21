import {build} from 'esbuild';
import {chromium,firefox,webkit} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {encode,render} from './renderer.mjs';
const dir=new URL('.',import.meta.url).pathname;
const bundle=async(file,format,globalName)=>(await build({entryPoints:[dir+file],bundle:true,minify:true,format,globalName,write:false})).outputFiles[0].text;
const component=await bundle('component.mjs','esm');
const offline=await bundle('component.mjs','iife','MarkdownComponent');
const loader=await bundle('loader.mjs','iife','MarkdownLoader');
const source='# café\n\n```html\n</script><b>&amp;</b>\n```\n\n[go](https://example.invalid/)';
const tag=`<af-markdown data-pagegi-id="root-1"><script type="application/json" data-af-source>${encode(source)}</script></af-markdown>`;
const output=[];
for(const [engine,type] of Object.entries({chromium,firefox,webkit})){
 const browser=await type.launch();
 for(const mode of ['absent','initial','dynamic','retry','offline-failure']){
  const page=await browser.newPage();let requests=0;
  await page.route('https://components.test/markdown.js*',r=>{
   requests++;if(mode==='offline-failure'||(mode==='retry'&&requests===1))return r.abort();
   return r.fulfill({contentType:'text/javascript',headers:{'access-control-allow-origin':'*'},body:component});
  });
  await page.route('https://document.test/',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><script>${loader}</script><script>window.captured=false;window.gate=new Promise(r=>window.capture=()=>{window.captured=true;window.sourceSnapshot=document.body.innerHTML;r()});window.loader=MarkdownLoader.start({sourceCaptured:gate,load:attempt=>import('https://components.test/markdown.js?attempt='+attempt)});</script><body>${['initial','retry','offline-failure'].includes(mode)?tag:''}</body>`}));
  await page.goto('https://document.test/');
  if(mode==='dynamic')await page.evaluate(()=>{window.el=document.createElement('af-markdown');el.dataset.pagegiId='root-1';document.body.append(el)});
  await page.evaluate(()=>new Promise(r=>setTimeout(r,30)));
  assert.equal(await page.locator('[data-af-output]').count(),0);
  await page.evaluate(()=>capture());
  if(mode==='absent') {await page.waitForTimeout(40);assert.equal(requests,0);}
  else {
   await page.waitForFunction(()=>['ready','failed'].includes(loader.status));
   if(mode==='retry'||mode==='offline-failure')await page.evaluate(()=>loader.retry());
   if(mode==='offline-failure'){
    await page.evaluate(()=>loader.retry());assert.equal(requests,2);assert.equal(await page.locator('[data-af-source]').count(),1);
   } else {
    if(mode==='dynamic')await page.evaluate(s=>el.setSource(s),source);
    await page.waitForSelector('[data-af-output] h1');
    assert.equal(await page.locator('h1').textContent(),'café');
    assert.equal(await page.locator('pre code').textContent(),'</script><b>&amp;</b>\n');
    assert.equal(await page.locator('af-markdown').getAttribute('data-pagegi-id'),'root-1');
    assert.equal(await page.locator('af-markdown').evaluate(e=>Boolean(e.shadowRoot)),false);
    await page.evaluate(()=>{const e=document.querySelector('af-markdown');e.remove();document.body.append(e)});
    assert.equal(await page.locator('[data-af-output]').count(),1);
    await page.evaluate(()=>document.querySelector('af-markdown').setSource(''));
    assert.equal(await page.locator('[data-af-output]').textContent(),'');
    assert.equal(requests,mode==='retry'?2:1);
    if(mode==='initial') assert.equal(await page.evaluate(()=>sourceSnapshot.includes('data-af-output')),false);
   }
  }
  output.push({engine,mode,requests,pass:true});await page.close();
 }
 const lifecycle=await browser.newPage();
 await lifecycle.setContent('<!doctype html><meta charset="utf-8">'+tag);
 await lifecycle.addScriptTag({content:offline});
 const extra=await lifecycle.evaluate(async()=>{
  let resolve;const gate=new Promise(r=>resolve=r);
  const first=MarkdownComponent.register({sourceCaptured:gate});
  const same=MarkdownComponent.register({sourceCaptured:gate})===first;
  const before=document.querySelector('[data-af-output]')===null;
  resolve();await gate;await Promise.resolve();
  const e=document.querySelector('af-markdown');
  const sourceBefore=e.querySelector('[data-af-source]').textContent;
  e.setSource('first\n\nfirst');const root=e.dataset.pagegiId;
  const noParagraphIds=[...e.querySelectorAll('p')].every(p=>!p.id&&!p.dataset.pagegiId);
  const latest=JSON.parse(e.querySelector('[data-af-source]').textContent);
  const exported=e.cloneNode(true);exported.querySelector('[data-af-output]').remove();
  e.querySelector('[data-af-source]').textContent='{}';e.draw();
  return {same,before,root,noParagraphIds,latest,sourceBefore,exportContainsOutput:exported.outerHTML.includes('data-af-output'),invalid:e.dataset.afError};
 });
 assert.equal(extra.same,true);assert.equal(extra.before,true);assert.equal(extra.root,'root-1');assert.equal(extra.noParagraphIds,true);
 assert.equal(extra.latest,'first\n\nfirst');assert.equal(extra.sourceBefore,encode(source));assert.equal(extra.exportContainsOutput,false);assert.equal(extra.invalid,'invalid-source');
 await lifecycle.close();output.push({engine,mode:'lifecycle-source-export-policy',pass:true});
 const temp=await mkdtemp(join(tmpdir(),'markdown-offline-'));
 try {
  const filename=join(temp,'index.html');
  await writeFile(filename,`<!doctype html><meta charset="utf-8"><body>${tag}<script>${offline}</script><script>MarkdownComponent.register({sourceCaptured:Promise.resolve()})</script>`);
  const context=await browser.newContext();await context.route(/^https?:/,r=>r.abort());const page=await context.newPage();
  await page.goto('file://'+filename);await page.waitForSelector('h1');assert.equal(await page.locator('h1').textContent(),'café');
  const staticFile=join(temp,'static.html');await writeFile(staticFile,`<!doctype html><meta charset="utf-8"><main data-pagegi-id="root-1">${render(source)}</main>`);
  const noJS=await browser.newContext({javaScriptEnabled:false});await noJS.route(/^https?:/,r=>r.abort());const staticPage=await noJS.newPage();await staticPage.goto('file://'+staticFile);assert.equal(await staticPage.locator('h1').textContent(),'café');
  await context.close();await noJS.close();output.push({engine,mode:'offline-bundle-and-static',pass:true});
 }finally{await rm(temp,{recursive:true,force:true});}
 await browser.close();
}
console.log(JSON.stringify({sizes:{component:{bytes:Buffer.byteLength(component),gzip:gzipSync(component).length},loader:{bytes:Buffer.byteLength(loader),gzip:gzipSync(loader).length},offline:{bytes:Buffer.byteLength(offline),gzip:gzipSync(offline).length}},cases:output},null,2));
