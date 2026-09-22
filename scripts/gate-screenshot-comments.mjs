/** CI-only: actual Chromium tab capture, plus unsupported-browser upload/brush flows. */
import assert from 'node:assert/strict';
import {chromium,firefox,webkit} from 'playwright';
import {expect} from 'playwright/test';
import sharp from 'sharp';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import {startDocument,becomeOwner} from './lib/start-doc.mjs';
import {openArtifactControls} from './lib/reveal-chrome.mjs';
const base=process.argv[2]??'http://localhost:3030';
const seed=await startDocument(base);
const published=await fetch(`${base}/api/artifacts/${seed.id}`,{method:'PUT',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify({title:'Screenshot capture gate',markup:'<Helmet><style>{`#capturebox{width:400px;height:240px;background:rgb(220,30,30);margin:100px 40px}`}</style></Helmet><div id="capturebox"><p>Screenshot capture fixture</p></div>',visibility:'unlisted'})});
assert(published.ok,`publish: ${published.status}`);
const input=await sharp({create:{width:200,height:100,channels:3,background:{r:220,g:30,b:30}}}).png().toBuffer();
const failures=[];
for(const [name,engine] of [['chromium',chromium],['firefox',firefox],['webkit',webkit]]){
 const browser=await engine.launch(name==='chromium'?{channel:'chromium',args:['--enable-usermedia-screen-capturing','--auto-select-tab-capture-source-by-title=Screenshot capture gate','--allow-http-screen-capture','--autoplay-policy=no-user-gesture-required']}:{});
 try{
  const context=await browser.newContext({viewport:{width:1280,height:900}});const page=await context.newPage();
  await page.addInitScript(()=>{window.__captureTrace=[];const native=navigator.mediaDevices?.getDisplayMedia?.bind(navigator.mediaDevices);if(native)navigator.mediaDevices.getDisplayMedia=async(...args)=>{try{const stream=await native(...args);window.__captureTrace.push({event:'stream',surface:stream.getVideoTracks()[0]?.getSettings().displaySurface});const reference=document.createElement('video');reference.muted=true;reference.srcObject=stream;window.__captureReference=reference;void reference.play();return stream;}catch(e){window.__captureTrace.push({event:'error',message:e.message});throw e;}};});
  await becomeOwner(page,base,seed.token);await page.goto(`${base}/a/${seed.id}`);await page.locator('#capturebox').waitFor();
  await openArtifactControls(page);await page.getByRole('button',{name:'Toggle comments',exact:true}).click();
  await page.getByRole('button',{name:'Select',exact:true}).click();
  await page.getByRole('status',{name:'Select tool active'}).waitFor({timeout:20000});
  const box=await page.locator('#capturebox').boundingBox();assert(box);
  let referencePixel=[220,30,30];
  if(name==='chromium'){
   await expect.poll(()=>page.evaluate(()=>window.__captureReference?.readyState??0)).toBeGreaterThanOrEqual(2);
   referencePixel=await page.evaluate(({x,y})=>{const v=window.__captureReference,c=document.createElement('canvas');c.width=innerWidth;c.height=innerHeight;c.getContext('2d').drawImage(v,0,0,c.width,c.height);return Array.from(c.getContext('2d').getImageData(x+35,y+65,1,1).data).slice(0,3);},box);
  }
  await page.mouse.move(box.x+30,box.y+60);await page.mouse.down();await page.mouse.move(box.x+230,box.y+160,{steps:12});await page.mouse.up();
  if(name!=='chromium'){
   await expect(page.getByLabel('Save annotation',{exact:true})).toBeDisabled();
   await page.getByLabel('Upload screenshot',{exact:true}).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:input});
  }
  const editor=page.getByRole('dialog',{name:'Draw on screenshot',exact:true});try{await editor.waitFor({timeout:20000});}catch(error){console.error(name,{alerts:await page.getByRole('alert').allTextContents(),status:await page.getByRole('status').allTextContents(),trace:await page.evaluate(()=>window.__captureTrace),composer:await page.getByRole('dialog',{name:'Annotation composer'}).count()});throw error;}
  const canvas=editor.getByLabel('Screenshot drawing canvas');
  await expect(editor.getByRole('button',{name:'Done drawing',exact:true})).toBeEnabled();
  // Exact crop corner must contain content, not a selection outline or app panel.
  const pixel=await canvas.evaluate(c=>Array.from(c.getContext('2d').getImageData(5,5,1,1).data));
  assert(pixel.slice(0,3).every((value,i)=>Math.abs(value-referencePixel[i])<=3),`${name}: content pixel ${pixel}; unmarked reference ${referencePixel}`);
  await editor.getByLabel('Brush color').fill('#00ff00');
  await editor.getByLabel('Brush thickness').fill('8');
  const drawing=await canvas.boundingBox();assert(drawing);
  await page.mouse.move(drawing.x+30,drawing.y+30);await page.mouse.down();await page.mouse.move(drawing.x+130,drawing.y+50,{steps:10});await page.mouse.up();
  await expect(editor.getByRole('button',{name:'Undo stroke'})).toBeEnabled();
  // Strokes paint on requestAnimationFrame; wait for the pixels, not just the undo button.
  await expect.poll(()=>canvas.evaluate(c=>{const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]<30&&pixels[i+1]>200&&pixels[i+2]<30)count++;return count;})).toBeGreaterThan(100);
  await editor.getByRole('button',{name:'Done drawing'}).click();
  await expect(editor).toHaveCount(0);
  await page.getByLabel('Annotation comment',{exact:true}).pressSequentially(`Screenshot from ${name}`);
  await page.getByLabel('Save annotation',{exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Annotation composer'})).toHaveCount(0);
  await page.reload();
  await openArtifactControls(page);await page.getByRole('button',{name:'Toggle comments',exact:true}).click();
  const thumbnail=page.getByRole('img',{name:'Screenshot attached to comment'}).last();await thumbnail.waitFor();
  assert(await thumbnail.evaluate(img=>img.complete&&img.naturalWidth>0),`${name}: persisted thumbnail`);
  await page.getByRole('button',{name:'Open comment screenshot'}).last().click();
  await expect(page.getByRole('dialog',{name:'Comment screenshot'})).toBeVisible();
  console.log(`${name}: capture/fallback → brush → upload → comment → reload passed`);
 }catch(error){failures.push(new Error(`${name}: ${error.message}`));}finally{await browser.close();}
}
if(failures.length)throw new AggregateError(failures,'Screenshot browser checks failed');
