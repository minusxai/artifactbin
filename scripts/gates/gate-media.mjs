/** Native media journeys retain actual file navigation/download, HTTP uploads,
 * image paint and dynamic image choices. The source editor's picker/drop/paste,
 * kit File cards, blur placeholders and held web-import rewrites were retired.
 * Native authors own their links and responsive image HTML. */
import {createChecker,createSection} from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import {launchChromium} from './lib/browser.mjs';
import {documentFrame} from './lib/page-facts.mjs';
import {samplePdf} from '../lib/sample-pdf.mjs';
import {openArtifactControls} from './lib/reveal-chrome.mjs';
import {readFile} from 'node:fs/promises';
import {startDocument} from '../lib/start-doc.mjs';
import {nativeHtml,nativeChoiceScript} from './lib/native-surface.mjs';
import sharp from 'sharp';
const BASE=process.argv[2]??'http://localhost:3030';
const check=createChecker('media'),section=createSection(check);
const browser=await launchChromium();
await section('file', async () => {
  const B = BASE;
  const PDF = samplePdf(3);

  const owner = await startDocument(B);
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.token}` };

  // 1. the file itself
  const fileRes = await fetch(`${B}/api/artifacts`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: 'Quarterly review', pdf: `data:application/pdf;base64,${PDF.toString('base64')}`, visibility: 'public' }),
  });
  const file = await fileRes.json();
  if (fileRes.status !== 201) {
    console.error(`could not publish the pdf (${fileRes.status} ${JSON.stringify(file)})`);
    throw new Error('the pdf fixture could not be published');
  }

  // 2. the document that links it, published PUBLIC so a stranger may read it
  const html=nativeHtml('The review', `<main style="padding:40px"><h1>The review</h1><article data-slot="file"><a data-slot="file-link" href="${B}/a/${file.id}/raw?v=1" target="_blank" rel="noopener">Quarterly review — 3 pages — ${PDF.length} bytes</a></article></main>`);
  const put = await fetch(`${B}/api/artifacts/${owner.id}`, {
    method: 'PUT', headers: auth, body: JSON.stringify({ title: 'The review', html, visibility: 'public' }),
  });
  const wrote = await put.json();
  if (put.status !== 200) {
    console.error(`could not publish the document (${put.status} ${JSON.stringify(wrote)})`);
    throw new Error('the pdf fixture could not be published');
  }

  // A STRANGER: a fresh context with no session. The app page frames the
  // document on its own origin; the card is in that frame.
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(`${B}/a/${owner.id}`, { waitUntil: 'networkidle' });
  const doc = await documentFrame(page);
  await doc.waitForSelector('[data-slot="file"]', { timeout: 20_000 }).catch(() => {}); // a missing card fails below

  const card = await doc.evaluate(() => {
    const el = document.querySelector('[data-slot="file"]');
    const link = document.querySelector('[data-slot="file-link"]');
    return {
      text: el ? (el.textContent ?? '') : null,
      href: link ? link.getAttribute('href') : null,
      target: link ? link.getAttribute('target') : null,
    };
  });
  check(card.text !== null, 'the reader is served a file card');
  check((card.text ?? '').includes('Quarterly review'), `the card names the file (${JSON.stringify(card.text)})`);
  check((card.text ?? '').includes('3 pages'), 'the card says how long the file is');
  check(/kB|bytes|MB/.test(card.text ?? ''), 'the card says how big the file is');
  check(card.href === `${B}/a/${file.id}/raw?v=1`, `the card links the file itself (${card.href})`);
  check(card.target === '_blank', 'the link opens in a new tab');

  /*
   * A REAL CLICK. The document is sandboxed with allow-popups and
   * allow-popups-to-escape-sandbox, and the spike measured that a popup opens
   * only with genuine user activation — a programmatic .click() opened nothing.
   * So this is a mouse click on the element's own box, and what it produces is
   * either a popup page or a download; headless Chromium always chooses the
   * download for application/pdf, which is why both are accepted here.
   */
  // Every request the whole context makes, so the address the click reached is
  // readable even when the popup becomes a download (headless always downloads a
  // PDF, and a download that began in a sandboxed context reports no url).
  const asked = [];
  context.on('request', (r) => asked.push(r.url()));
  const [popup, download] = await Promise.all([
    page.waitForEvent('popup', { timeout: 8_000 }).catch(() => null),
    page.waitForEvent('download', { timeout: 8_000 }).catch(() => null),
    doc.click('[data-slot="file-link"]'),
  ]);
  check(popup !== null || download !== null, 'a real click opened the file');
  check(asked.some((u) => u.endsWith(`/a/${file.id}/raw?v=1`)),
    `…at the file's own address (${JSON.stringify(asked.slice(-3))})`);
  if (download) {
    // The name the browser would save it under: `Quarterly review.pdf` comes from
    // Content-Disposition, `raw.pdf` or `raw` would be the URL's own last
    // segment. This is the one thing headless CAN say about that header.
    check(download.suggestedFilename() === 'Quarterly review.pdf',
      `the download is named by Content-Disposition, not by the URL (${download.suggestedFilename()})`);
  } else {
    check(true, 'the popup rendered rather than downloading — a viewer is present (headful)');
  }

  await context.close();
  console.log('NOTE: headless Chromium has no PDF viewer, so nothing above proves the file RENDERS — that check is headful and by hand.');
});


await section('native web images and viewer-local choice',async()=>{
 const owner=await startDocument(BASE);
 const auth={'Content-Type':'application/json',Authorization:`Bearer ${owner.token}`};
 const uploaded=await fetch(`${BASE}/api/artifacts`,{method:'POST',headers:auth,body:JSON.stringify({image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8dMpruoH2PPOFgAET03KV/drCuIgtChmqHYMtbxE8GIDtUMxZcghBGOdjhwe1weeF8xbShDdKgAAAABJRU5ErkJggg==',visibility:'public'})});
 check(uploaded.status===201,'referenced image uploads through the original API');const reference=await uploaded.json();
 const html=nativeHtml('Native media' ,`<main><h1>Native media</h1><img id="stored" src="ref:${reference.id}" alt="Uploaded reference"><img id="photo" src="https://media.example.com/photo.png" alt="Selected picture"><img id="svg" src="https://media.example.com/logo.svg" alt="Vector logo"><button id="next">Next picture</button><output id="choice"></output></main>`,{
  state:{picture:1},css:'main{padding:24px;max-width:800px;margin:auto}img{display:block;max-width:100%;height:auto}',
  script:nativeChoiceScript({field:'picture',button:'#next',output:'#choice',value:2,onPaint:"document.querySelector('#photo').src='https://media.example.com/photo'+value+'.png';"})
 });
 const saved=await fetch(`${BASE}/api/artifacts/${owner.id}`,{method:'PUT',headers:auth,body:JSON.stringify({html,visibility:'public'})});
 check(saved.status===200,'complete native media HTML publishes');
 const png=await sharp({create:{width:48,height:32,channels:3,background:'#33cc33'}}).png().toBuffer();
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.route('https://media.example.com/**',route=>route.fulfill({contentType:route.request().url().endsWith('.svg')?'image/svg+xml':'image/png',body:route.request().url().endsWith('.svg')?'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>':png}));
 const page=await context.newPage();await page.goto(`${BASE}/a/${owner.id}`,{waitUntil:'load'});
 const frame=await documentFrame(page);await frame.waitForFunction(()=>document.querySelector('#choice')?.textContent==='1');
 await frame.waitForFunction(()=>Array.from(document.images).every(image=>image.complete&&image.naturalWidth>0));
 check(await frame.locator('#photo').getAttribute('src')==='https://media.example.com/photo1.png','native image keeps its authored external URL');
 check(await frame.locator('#stored').evaluate(image=>image.complete&&image.naturalWidth===48),'native ref image paints through the original scoped image door');
 check(await frame.locator('#svg').evaluate(image=>image.naturalWidth===40),'SVG paints as an image');
 await frame.locator('#next').click();await frame.waitForFunction(()=>document.querySelector('#choice')?.textContent==='2'&&document.querySelector('#photo')?.complete);
 check(await frame.locator('#photo').getAttribute('src')==='https://media.example.com/photo2.png','viewer-local choice updates the actual image');
 await page.reload({waitUntil:'load'});const reloaded=await documentFrame(page);await reloaded.waitForFunction(()=>document.querySelector('#choice')?.textContent==='2');
 check(await reloaded.locator('#photo').getAttribute('src')==='https://media.example.com/photo2.png','image choice survives refresh in this viewer');
 check(await reloaded.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'native images fit a phone without horizontal overflow');
 await openArtifactControls(page);
 const downloadPromise=page.waitForEvent('download');await page.getByLabel('Download for offline',{exact:true}).click();const download=await downloadPromise;
 check(download.suggestedFilename().endsWith('.html'),'original reader downloads an actual HTML file');
 const downloaded=await readFile(await download.path(),'utf8');
 const {rendered,canonicalSource}=await page.evaluate(html=>{
  const parsed=new DOMParser().parseFromString(html,'text/html'),portable=parsed.querySelector('script[data-af="portable"]');
  const canonicalSource=portable?JSON.parse(portable.textContent).source:undefined;portable?.remove();
  return {rendered:parsed.documentElement.outerHTML,canonicalSource};
 },downloaded);
 check(!downloaded.includes(owner.token)&&!rendered.includes(`ref:${reference.id}`),'download packs admitted image bytes without a bearer or unresolved rendered reference');
 check(typeof canonicalSource==='string'&&canonicalSource.includes(`ref:${reference.id}`),'portable provenance preserves the original author image reference');
 const offline=await browser.newContext();await offline.setOffline(true);const offlinePage=await offline.newPage();await offlinePage.setContent(downloaded,{waitUntil:'load'});
 await offlinePage.locator('#stored').evaluate(image=>image.decode());
 check(await offlinePage.locator('#stored').evaluate(image=>image.complete&&image.naturalWidth===48),'downloaded referenced image paints with the browser offline');
 check(await offlinePage.locator('#stored').getAttribute('src').then(src=>src.startsWith('data:image/')),'portable image uses bytes rather than an authenticated remote URL');await offline.close();

 await context.close();
});
await section('HTTP image upload and original media viewer',async()=>{
 const owner=await startDocument(BASE),auth={'Content-Type':'application/json',Authorization:`Bearer ${owner.token}`};
 const png=await sharp({create:{width:96,height:64,channels:3,background:'#cc3333'}}).png().toBuffer();
 const upload=await fetch(`${BASE}/api/artifacts`,{method:'POST',headers:auth,body:JSON.stringify({title:'Uploaded picture',image:`data:image/png;base64,${png.toString('base64')}`,visibility:'public'})});
 check(upload.status===201,'normal HTTP image upload remains available');const image=await upload.json();
 const raw=await fetch(`${BASE}/a/${image.id}/raw`);check(raw.status===200&&raw.headers.get('content-type')?.startsWith('image/'),'uploaded image serves real image bytes');
 check((await sharp(Buffer.from(await raw.arrayBuffer())).metadata()).width===96,'uploaded image retains its pixel width');
 const page=await browser.newPage();await page.goto(`${BASE}/a/${image.id}`,{waitUntil:'load'});
 await page.locator('main img').first().waitFor();
 check(await page.locator('main img').first().evaluate(image=>image.complete&&image.naturalWidth===96),'original image viewer paints the uploaded asset');await page.close();
});
await browser.close();check.done();
