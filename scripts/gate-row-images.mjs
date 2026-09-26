/** Dataset image bindings, measured in a real browser. CI-only; no production data. */
import {chromium} from 'playwright';
import sharp from 'sharp';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import {startDocument,becomeOwner} from './lib/start-doc.mjs';
import {artifactDocument} from './lib/artifact-document.mjs';
import {createChecker} from './lib/assert.mjs';

const base=process.argv[2]??'http://localhost:3030';
const check=createChecker('row-images');
const {token}=await startDocument(base);
const create=async(body)=>{
 const response=await fetch(base+'/api/artifacts',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({...body,visibility:'unlisted'})});
 const result=await response.json();
 if(!response.ok)throw new Error(`fixture publish: ${response.status} ${JSON.stringify(result)}`);
 return result;
};
const refs=[];
for(const background of ['red','blue']){
 const bytes=await sharp({create:{width:48,height:64,channels:3,background}}).png().toBuffer();
 refs.push((await create({image:`data:image/png;base64,${bytes.toString('base64')}`})).id);
}
const rows=Array.from({length:1000},(_,i)=>({id:String(i),title:i%2?'Blue book':'Red book',cover_ref:`ref:${refs[i%2]}`,position:i}));
const dataset=await create({dataset:rows});
const markup=`<Helmet>
 <Value name="take" type="number" default={2}/><Value name="reverse" type="boolean" default={false}/><Value name="selected" type="string" default="0"/>
 <Import name="books_data" src="ref:${dataset.id}" /><Query name="books">{\`select * from books_data.rows order by case when $reverse then -position else position end limit $take\`}</Query>
 <Import name="detail_data" src="ref:${dataset.id}" /><Query name="detail">{\`select * from detail_data.rows where id=$selected\`}</Query>
</Helmet><main className="p-8">
<Input label="Rows" type="number" value="$take"/><Switch label="Reverse" checked="$reverse"/><Input label="Selected book" value="$selected"/>
<section aria-label="Selected"><For each={$detail} keyBy="id"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={48} height={64}/><p>{$_row.title}</p></For></section>
<section aria-label="Gallery"><For each={$books} keyBy="id"><article><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={48} height={64}/><h2>{$_row.title}</h2></article></For></section>
</main>`;
const doc=await create({markup});
check((doc.markup??markup).split('src="$_row.cover_ref"').length===3,'two authored image templates, independent of row count');
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:1100,height:800}});
 const requests=[];const errors=[];
 page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
 await becomeOwner(page,base,token);
 await page.goto(`${base}/a/${doc.id}`);await artifactDocument(page);
 const gallery=page.locator('#root [aria-label="Gallery"]');
 await gallery.locator('img').first().waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('#root [aria-label="Gallery"] img')].length===2&&[...document.querySelectorAll('#root [aria-label="Gallery"] img')].every(i=>i.naturalWidth>0));
 const pairs=await gallery.locator('article').evaluateAll(nodes=>nodes.map(n=>({title:n.querySelector('h2').textContent,alt:n.querySelector('img').alt,src:n.querySelector('img').currentSrc})));
 check(pairs.every((p,i)=>p.title===rows[i].title&&p.alt===p.title&&p.src.includes(`/a/${refs[i]}/raw`)),'red and blue decode and match their rows');
 await page.getByLabel('Selected book',{exact:true}).fill('1');
 await page.waitForFunction(id=>document.querySelector('#root [aria-label="Selected"] img')?.currentSrc.includes(`/a/${id}/raw`),refs[1]);
 check(await page.locator('#root [aria-label="Selected"] img').getAttribute('alt')==='Blue book','shared detail query updates its image');
 for(const count of [24,48,1000]){
  await page.getByLabel('Rows',{exact:true}).fill(String(count));
  await page.waitForFunction(n=>document.querySelectorAll('#root [aria-label="Gallery"] article').length===n,count);
  check(await gallery.locator('article').count()===count,`progressive query renders ${count} rows`);
 }
 const all=await gallery.locator('article').evaluateAll(nodes=>nodes.map(n=>({title:n.querySelector('h2').textContent,alt:n.querySelector('img').alt,src:n.querySelector('img').getAttribute('src'),lazy:n.querySelector('img').loading})));
 check(all.every((p,i)=>p.title===rows[i].title&&p.alt===p.title&&(p.src.includes(refs[i%2])||p.src.includes(encodeURIComponent(`ref:${refs[i%2]}`)))&&p.lazy==='lazy'),'1,000 items remain correctly paired');
 await page.getByRole('switch',{name:'Reverse',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#root [aria-label="Gallery"] img')?.alt==='Blue book');
 check(await gallery.locator('img').first().getAttribute('alt')==='Blue book','reordering retains image/text identity');
 // Each lazy image is scrolled into the browser's loading range before asserting decode.
 for(let i=0;i<1000;i+=10)await gallery.locator('article').nth(i).scrollIntoViewIfNeeded();
 await gallery.locator('article').last().scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>[...document.querySelectorAll('#root [aria-label="Gallery"] img')].every(i=>i.naturalWidth>0),null,{timeout:15000});
 check(!requests.some(url=>url.includes('$_row')||url.includes('%24_row')),'no literal row-binding URL requested');
 check(!errors.some(e=>/50000|hydration|#418/.test(e)),'no expansion or hydration errors');
 const guest=await browser.newPage();await guest.goto(`${base}/a/${doc.id}`);await artifactDocument(guest);
 await guest.waitForFunction(()=>[...document.querySelectorAll('#root [aria-label="Gallery"] img')].length===2&&[...document.querySelectorAll('#root [aria-label="Gallery"] img')].every(i=>i.naturalWidth>0));
 check(true,'signed-out reader decodes both permitted images');await guest.close();

 // Captures use the standalone opaque-origin document, without a parent asset relay.
 const capture=await browser.newPage();const captureErrors=[];
 capture.on('console',m=>{if(m.type()==='error')captureErrors.push(m.text());});
 capture.on('requestfailed',r=>captureErrors.push(`${new URL(r.url()).pathname}: ${r.failure()?.errorText}`));
 await capture.goto(`${base}/a/${doc.id}/raw?chrome=0`);
 await capture.waitForFunction(()=>[...document.querySelectorAll('[aria-label="Gallery"] img')].length===2&&[...document.querySelectorAll('[aria-label="Gallery"] img')].every(i=>i.naturalWidth>0),null,{timeout:5000}).catch(()=>{});
 check(await capture.locator('[aria-label="Gallery"] img').evaluateAll(images=>images.length===2&&images.every(i=>i.naturalWidth>0)),`standalone capture resolves row images: ${captureErrors.join('; ')}`);
 await capture.close();
 const exported=await fetch(`${base}/a/${doc.id}/export?format=png&refresh=1`,{headers:{Authorization:`Bearer ${token}`}});
 if(!exported.ok)throw new Error(`export: ${exported.status}`);
 const pixels=await sharp(Buffer.from(await exported.arrayBuffer())).removeAlpha().raw().toBuffer({resolveWithObject:true});
 let red=0,blue=0;
 for(let i=0;i<pixels.data.length;i+=pixels.info.channels){if(pixels.data[i]>220&&pixels.data[i+1]<30&&pixels.data[i+2]<30)red++;if(pixels.data[i]<30&&pixels.data[i+1]<30&&pixels.data[i+2]>220)blue++;}
 check(red>100&&blue>100,'PNG export contains both uploaded cover colors');

 // Distinct assets distinguish metadata resolution from original-byte downloads.
 const distinct=[];
 for(let i=0;i<32;i++){
  const bytes=await sharp({create:{width:48,height:64,channels:3,background:{r:i*7,g:32,b:180}}}).png().toBuffer();
  const image=await create({image:`data:image/png;base64,${bytes.toString('base64')}`});
  distinct.push({id:String(i),title:`Cover ${i}`,cover_ref:`ref:${image.id}`});
 }
 const lazyData=await create({dataset:distinct});
 const lazy=await create({markup:`<Helmet><Import name="covers_data" src="ref:${lazyData.id}" /><Query name="covers">{\`select * from covers_data.rows\`}</Query></Helmet><For each={$covers} keyBy="id"><article className="h-96"><img src="$_row.cover_ref" alt="$_row.title" loading="lazy" width={180} height={240}/></article></For>`});
 const probe=await browser.newPage({viewport:{width:1000,height:700}});const fetched=new Set();let metadata=0;
 probe.on('request',r=>{const u=new URL(r.url());if(r.resourceType()==='image'&&/^\/a\/[^/]+\/raw$/.test(u.pathname))fetched.add(u.pathname);if(u.pathname.endsWith('/assets')&&r.resourceType()!=='image')metadata++;});
 await probe.goto(`${base}/a/${lazy.id}`);await artifactDocument(probe);
 await probe.waitForFunction(()=>document.querySelector('#root article img')?.naturalWidth>0);
 await probe.waitForTimeout(500);
 const initial=fetched.size;check(initial>0&&initial<distinct.length,`lazy gallery initially downloads ${initial}/${distinct.length} image assets (${metadata} metadata requests)`);
 await probe.locator('#root article').last().scrollIntoViewIfNeeded();
 await probe.waitForFunction(()=>[...document.querySelectorAll('#root article img')].at(-1)?.naturalWidth>0);
 check(fetched.size>initial,'scrolling downloads additional image bytes');
 await probe.close();await page.close();
}finally{await browser.close();}
check.done();
