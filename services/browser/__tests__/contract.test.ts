/**
 * THE BROWSER CONTRACT over both transports: Playwright in this process, and
 * the same behind `serveBrowser` through `browserClient`. Real Chromium, a
 * real page: the verdicts are the contract as much as the bytes are.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserService, RenderRequest } from '@artifactbin/contracts';
import { BROWSER_ROUTES, browserClient, serveBrowser } from '@artifactbin/browser';
import { createBrowser,requestOriginAllowed } from '@artifactbin/browser/local';
import sharp from 'sharp';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';

const PAGE = `<html><head><style>
.density{position:absolute;left:10px;top:10px;width:20px;height:20px;background:#c33}
@media(min-resolution:2dppx){.density{background:#3c3}}
</style></head><body style="margin:0"><main style="position:relative;width:600px">
<img src="http://127.0.0.1:1/cross-origin.png" alt="">
<div class="density"></div>
<!-- Bare decks retain hidden rail miniature slides for hydration. -->
<nav hidden style="display:none"><div data-af-slide>cover miniature</div><div data-af-slide>second miniature</div></nav>
<div data-af-slide style="height:100px;background:#c33">one</div>
<div data-af-slide style="height:100px;background:#3c3">two</div>
<div data-af-slide style="height:100px;background:#33c">three</div></main></body></html>`;
const SLIDE_CHROME_PAGE=`<html><body style="margin:0"><main style="width:600px"><af-slide-deck>
<div data-af-slide style="height:630px;background:#c33">First</div>
<div data-af-slide style="height:630px;background:#3c3;position:relative">Second<footer style="position:absolute;bottom:0;width:100%;height:20px;background:#33c">Authored footer</footer></div>
<nav data-af-deck-chrome="toolbar" style="position:fixed;bottom:0;left:0;width:600px;height:100px;background:#f00">1 / 2<i style="position:absolute;inset:0;background:#f00;transition:all 2s"></i><b class="dot"></b></nav><style>.dot::after{content:"";position:absolute;inset:0;background:#f00;transition:all 2s}</style>
</af-slide-deck></main></body></html>`;
/* A stacked deck: every slide sits in the same box, hidden until the deck's script marks it active. */
const STACKED_COLORS=Array.from({length:8},(_,i)=>[30*i+10,200-20*i,90+10*i]);
const STACKED_DECK_PAGE=`<html><head><style>.slide{position:absolute;inset:0;visibility:hidden;opacity:0;transition:opacity .26s ease,visibility .26s}.slide.is-active{visibility:visible;opacity:1}</style></head><body style="margin:0"><main style="position:relative;width:600px;height:630px">
${STACKED_COLORS.map(([r,g,b],i)=>`<section data-af-slide class="slide${i<7?'':' is-active'}" style="background:rgb(${r},${g},${b})">Slide ${i+1}<i class="mark" style="display:block;width:40px;height:40px;background:rgb(${r},${g},${b})"></i></section>`).join('')}</main></body></html>`;
/*
 * A dashboard: a red tile, a chart drawn only once its SQL read answers (a green bar over the left half of a box with
 * no background of its own, so the page's blue shows behind the rest), and elements a selector may find but must not
 * photograph: hidden, invisible, sizeless, taller than the capture allows, and one tall enough for 1x only.
 */
const ELEMENT_PAGE = `<html><body style="margin:0;background:rgb(51,51,204)"><main style="width:1200px">
<div id="other" style="width:300px;height:100px;background:#c33"></div>
<div id="chart" data-mx-chart-state="pending" style="width:200px;height:100px"></div>
<div id="hidden" style="display:none;width:50px;height:50px"></div><div id="ghost" style="visibility:hidden;width:50px;height:50px"></div><div id="empty"></div>
<div id="long" style="width:50px;height:5000px;background:#3c3"></div><div id="tall" style="width:50px;height:9000px;background:#3c3"></div>
</main><script>fetch('/api/artifacts/x/sql',{method:'POST',body:'{}'}).then(r=>r.json()).then(()=>setTimeout(()=>{const c=document.getElementById('chart');c.innerHTML='<div style="width:100px;height:100px;background:rgb(51,204,51)"></div>';c.dataset.mxChartState='ready'},100))</script></body></html>`;
/* A deck whose script threw before drawing a slide: only the fixed deck chrome is left, so the body has no height. */
const EMPTY_DECK_PAGE = `<html><body style="margin:0"><main id="deck"></main><nav data-af-deck-chrome style="position:fixed;bottom:0;left:0;width:200px;height:40px">01 / 06</nav><script type="module">throw Error('The dataset returned no usable rows.')</script></body></html>`;
const READY_PAGE = `<html><body style="margin:0"><main style="width:100px;height:100px;background:#c33"><div data-mx-managed-frame><iframe></iframe></div></main><script>setTimeout(()=>{document.querySelector('iframe').setAttribute('data-mx-author-ready','');document.querySelector('main').style.background='#3c3'},300)</script></body></html>`;
/* A script component's mount: the server fallback (red) until the page's script replaces it (green), as the page runtime does. */
const MOUNT_PAGE = `<html><body style="margin:0"><main style="width:100px;height:100px"><div data-mx-mount="Spark" style="width:100px;height:100px;background:#c33"><p style="margin:0">Loading</p></div></main><script>setTimeout(()=>{const m=document.querySelector('[data-mx-mount]');m.replaceChildren();const d=document.createElement('div');d.style.cssText='width:100px;height:100px;background:#3c3';m.append(d)},400)</script></body></html>`;
const NEVER_MOUNTS_PAGE = `<html><body style="margin:0"><main style="width:100px;height:100px"><div data-mx-mount="Spark" style="width:100px;height:100px;background:#c33"><p>Loading</p></div></main></body></html>`;
const NEVER_READY_PAGE = `<html><body><main><div data-mx-managed-frame><iframe></iframe></div></main></body></html>`;
const DIAGRAM_PAGE = `<html><body style="margin:0"><main data-mx-mermaid-state="pending" style="width:100px;height:100px;background:#c33"></main><script>setTimeout(()=>{document.querySelector('main').dataset.mxMermaidState='ready';document.querySelector('main').style.background='#3c3'},400)</script></body></html>`;
const CHART_PAGE = `<html><body style="margin:0"><main data-mx-chart-state="pending" style="width:100px;height:100px;background:#c33"></main><script>setTimeout(()=>{const m=document.querySelector('main');m.innerHTML='<div data-mx-chart-state="pending"></div>';m.removeAttribute('data-mx-chart-state');setTimeout(()=>{m.firstChild.dataset.mxChartState='ready';m.style.background='#3c3'},300)},300)</script></body></html>`;
const STUCK_CHART_PAGE = `<html><body><main data-mx-chart-state="pending" style="width:100px;height:100px">Loading chart</main></body></html>`;
/*
 * A page that draws the way the kit's diagrams do: an SVG `data:` URL in an
 * <img>, pending until drawn. One figure is reproducible, one draws a random
 * number every load, and one is a plain image the harvest must skip.
 */
const DRAWN = (label: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${label}</text></svg>`)}`;
const HARVEST_PAGE = `<html><body style="margin:0"><main><figure data-mx-mermaid-state="pending" data-kind="fixed"></figure><figure data-mx-mermaid-state="pending" data-kind="random"></figure><figure data-mx-mermaid-state="ready" data-kind="png"><img src="data:image/png;base64,iVBORw0KGgo="></figure><img src="http://127.0.0.1:1/cross-origin.png"></main><script>
setTimeout(()=>{const [a,b]=document.querySelectorAll('figure');a.innerHTML='<img width="120" height="80" src=${JSON.stringify(DRAWN('fixed & sound'))}>';b.innerHTML='<img src="'+${JSON.stringify(DRAWN('').split('%3C%2Ftext%3E')[0])}+Math.random()+'%3C%2Ftext%3E%3C%2Fsvg%3E">';a.dataset.mxMermaidState='ready';b.dataset.mxMermaidState='ready';},200)</script></body></html>`;
/* A tile drawn from the page's own SQL read, which answers after the settle: red until its rows arrive and draw. */
const DATA_PAGE = `<html><body style="margin:0"><main style="width:100px;height:100px;background:#c33"></main><script>fetch('/api/artifacts/x/sql',{method:'POST',body:'{}'}).then(r=>r.json()).then(()=>setTimeout(()=>{document.querySelector('main').style.background='#3c3'},100))</script></body></html>`;
/* A data read that never answers; and a long-lived stream, which is not a data read and never holds a capture. */
const HUNG_DATA_PAGE = `<html><body style="margin:0"><main style="width:100px;height:100px;background:#c33"></main><script>fetch('/api/artifacts/x/graphql',{method:'POST',body:'{}'})</script></body></html>`;
const STREAM_PAGE = `<html><body style="margin:0"><main style="width:100px;height:100px;background:#3c3"></main><script>fetch('/api/artifacts/x/regions/stream')</script></body></html>`;
/** The fixture's data doors: sql answers late, graphql and the stream never do (until the page goes away). */
const DATA_DOORS: Record<string, number> = { '/api/artifacts/x/sql': 1200, '/api/artifacts/x/graphql': 60_000, '/api/artifacts/x/regions/stream': 60_000 };
let pages: RunningServer;
let url: string;

const local = createBrowser();
const server = serveBrowser(local);
const listening = server.listen(0);
const remote = browserClient(listening.url, { deadlineMs: 20_000 });
beforeAll(async () => {
  pages = await withHttpServer((q, s) => { const late = DATA_DOORS[q.url ?? '']; if (late !== undefined) { const t = setTimeout(() => { if (!s.destroyed) { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"columns":[],"rows":[]}'); } }, late); t.unref?.(); s.on('close', () => clearTimeout(t)); return; } if (q.url === '/slow') { const t = setTimeout(() => { if (!s.destroyed) { s.writeHead(200, { 'content-type': 'text/html' }); s.end(PAGE); } }, 1000); s.on('close', () => clearTimeout(t)); return; } s.writeHead(200, { 'content-type': 'text/html' }); s.end(q.url==='/element'?ELEMENT_PAGE:q.url==='/empty-deck'?EMPTY_DECK_PAGE:q.url==='/stacked'?STACKED_DECK_PAGE:q.url==='/slide-chrome'?SLIDE_CHROME_PAGE:q.url==='/mount'?MOUNT_PAGE:q.url==='/never-mounts'?NEVER_MOUNTS_PAGE:q.url==='/harvest'?HARVEST_PAGE:q.url==='/chart'?CHART_PAGE:q.url==='/stuck-chart'?STUCK_CHART_PAGE:q.url==='/diagram'?DIAGRAM_PAGE:q.url==='/ready'?READY_PAGE:q.url==='/data'?DATA_PAGE:q.url==='/hung-data'?HUNG_DATA_PAGE:q.url==='/stream'?STREAM_PAGE:q.url==='/never-ready'?NEVER_READY_PAGE:PAGE); });
  url = `${pages.base}/a/x`;
});
afterAll(async () => { await local.close?.(); await server.close(); await pages.close(); });

const base = (): RenderRequest => ({ url, format: 'png', viewport: { width: 1200, height: 630 }, selector: 'main', capture: 'full', sameOriginOnly: true, settleMs: 50, timeoutMs: 10_000 });
const pngSize = (b: Uint8Array) => { const v = new DataView(b.buffer, b.byteOffset); return { width: v.getUint32(16), height: v.getUint32(20) }; };

it('matches allowed request origins exactly, never by prefix',()=>{
  expect(requestOriginAllowed('https://assets.example/x','https://app.example',['https://assets.example'])).toBe(true);
  expect(requestOriginAllowed('https://assets.example.evil/x','https://app.example',['https://assets.example'])).toBe(false);
  expect(requestOriginAllowed('https://app.example.evil/x','https://app.example')).toBe(false);
});

describe.each<[string, BrowserService]>([['in-process', local], ['over HTTP', remote]])('%s', (_name, svc) => {
  it('waits across lazy chart loading and asynchronous chart rendering', async () => {
    const r=await svc.render({...base(),url:`${pages.base}/chart`,settleMs:0});
    if(!r.ok)throw new Error(JSON.stringify(r));
    const {data,info}=await sharp(Buffer.from(r.bytes)).raw().toBuffer({resolveWithObject:true});
    const at=(50*info.width+50)*info.channels;expect([...data.subarray(at,at+3)]).toEqual([51,204,51]);
  });
  it('waits for the page\'s data reads to answer and draw, past the settle, before capturing',async()=>{
    const r=await svc.render({...base(),url:`${pages.base}/data`});
    if(!r.ok)throw new Error(JSON.stringify(r));
    const {data,info}=await sharp(Buffer.from(r.bytes)).raw().toBuffer({resolveWithObject:true});
    const at=(50*info.width+50)*info.channels;expect([...data.subarray(at,at+3)]).toEqual([51,204,51]);
  });
  it('fails a render whose data read never answers, instead of an image without its data',async()=>{
    const r=await svc.render({...base(),url:`${pages.base}/hung-data`,timeoutMs:3_000});
    expect(r).toMatchObject({ok:false,reason:'failed'});
  });
  it('never waits on a long-lived stream, which is not a data read',async()=>{
    const r=await svc.render({...base(),url:`${pages.base}/stream`,timeoutMs:5_000});
    expect(r.ok).toBe(true);
  });
  it('returns failure when a chart never finishes, instead of cacheable loading pixels',async()=>{
    const r=await svc.render({...base(),url:`${pages.base}/stuck-chart`,settleMs:0,timeoutMs:250});
    expect(!r.ok&&r.reason).toBe('failed');
  });
  it('waits for script component mounts to replace their fallback, and the capture differs from the fallback render', async () => {
    const centre = async (r: Awaited<ReturnType<BrowserService['render']>>) => {
      if (!r.ok) throw new Error(JSON.stringify(r));
      const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
      const at = (50 * info.width + 50) * info.channels;
      return [...data.subarray(at, at + 3)];
    };
    // The fallback render is a page whose script never mounts (no race with the swap), the capture one that does.
    const fallback = await centre(await svc.render({ ...base(), url: `${pages.base}/never-mounts`, settleMs: 0 }));
    const mounted = await centre(await svc.render({ ...base(), url: `${pages.base}/mount`, settleMs: 0, waitForMountsMs: 5000 }));
    expect(fallback).toEqual([204, 51, 51]);
    expect(mounted).toEqual([51, 204, 51]);
  });
  it('captures the fallback after the mount cap instead of failing when a component never mounts', async () => {
    const started = Date.now();
    const r = await svc.render({ ...base(), url: `${pages.base}/never-mounts`, settleMs: 0, waitForMountsMs: 300 });
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('waits for a lazy diagram before capturing export pixels', async () => {
    const r = await svc.render({ ...base(), url: `${pages.base}/diagram`, settleMs: 0 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    const at = (50 * info.width + 50) * info.channels;
    expect([...data.subarray(at, at + 3)]).toEqual([51, 204, 51]);
  });
  it('shoots the selected element as png, with the cross-origin request aborted', async () => {
    const r = await svc.render(base());
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.mime).toBe('image/png');
    expect(pngSize(r.bytes)).toEqual({ width: 600, height: 300 });
  });
  it('waits for managed author readiness instead of capturing a cold blank frame',async()=>{
    const r=await svc.render({...base(),url:`${pages.base}/ready`,selector:'main',viewport:{width:100,height:100},waitForManagedFrames:true,settleMs:0});
    if(!r.ok)throw new Error(JSON.stringify(r));
    const {data,info}=await sharp(Buffer.from(r.bytes)).raw().toBuffer({resolveWithObject:true});
    const at=(50*info.width+50)*info.channels;
    expect([...data.subarray(at,at+3)]).toEqual([51,204,51]);
  });
  it('fails a managed readiness timeout instead of returning cacheable blank bytes',async()=>{
    const r=await svc.render({...base(),url:`${pages.base}/never-ready`,waitForManagedFrames:true,settleMs:0,timeoutMs:250});
    expect(!r.ok&&r.reason).toBe('failed');
  });
  it('fails a render whose deadline elapses while the page is still loading, instead of calling it unreachable',async()=>{
    // A warm page load first, so the 250ms budget below is spent loading the slow page, not on a cold launch.
    expect((await svc.render(base())).ok).toBe(true);
    const r=await svc.render({...base(),url:`${pages.base}/slow`,settleMs:0,timeoutMs:250});
    expect(!r.ok&&r.reason).toBe('failed');
  });
  it('shoots the visible document slide as jpg, excluding hidden miniature slides', async () => {
    const r = await svc.render({ ...base(), format: 'jpg', capture: { slide: 2 } });
    expect(r.ok && r.mime).toBe('image/jpeg');
    if (!r.ok) throw new Error(JSON.stringify(r));
    const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    const at = (50 * info.width + 50) * info.channels;
    expect(data[at + 1]).toBeGreaterThan(150);
    expect(data[at]).toBeLessThan(80);
    expect(data[at + 2]).toBeLessThan(80);
  });
  it('excludes generated fixed deck navigation while retaining the selected slide and authored footer',async()=>{
    const r=await svc.render({...base(),url:pages.base+'/slide-chrome',viewport:{width:600,height:630},capture:{slide:2}});
    if(!r.ok)throw Error(JSON.stringify(r));
    const {data,info}=await sharp(Buffer.from(r.bytes)).raw().toBuffer({resolveWithObject:true});
    expect(info).toMatchObject({width:600,height:630});
    const pixel=(y:number)=>[...data.subarray((y*info.width+300)*info.channels,(y*info.width+300)*info.channels+3)];
    expect(pixel(580)).toEqual([51,204,51]);
    expect(pixel(620)).toEqual([51,51,204]);
    const live=await svc.render({...base(),url:pages.base+'/slide-chrome',viewport:{width:600,height:630},capture:'full'});
    if(!live.ok)throw Error(JSON.stringify(live));
    const full=await sharp(Buffer.from(live.bytes)).raw().toBuffer({resolveWithObject:true});
    const at=(580*full.info.width+300)*full.info.channels;
    expect([...full.data.subarray(at,at+3)]).toEqual([255,0,0]);
  });
  // A restyled deck may stack its slides and show only the active one: every slide is still exportable, drawn
  // on its own, the count the check reports.
  it('shoots each slide of a stacked deck whose inactive slides are hidden', async () => {
    for (let n = 1; n <= 8; n++) {
      const r = await svc.render({ ...base(), url: pages.base + '/stacked', viewport: { width: 600, height: 630 }, capture: { slide: n } });
      if (!r.ok) throw Error(`slide ${n}: ${JSON.stringify(r)}`);
      const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 600, height: 630 });
      const at = (300 * info.width + 500) * info.channels;
      expect([...data.subarray(at, at + 3)], `slide ${n}`).toEqual(STACKED_COLORS[n - 1]);
    }
    expect(await svc.render({ ...base(), url: pages.base + '/stacked', capture: { slide: 9 } })).toEqual({ ok: false, reason: 'no_slide', slides: 8 });
  });
  /*
   * ONE ELEMENT, ALONE: the chart a reader asked for, drawn from its data, at twice the CSS pixels, with the page's own
   * background behind it, and nothing of the tiles around it. The selector is the page's CSS only: what Playwright
   * would read as another engine (xpath=, text=) is not a selector here, it is refused.
   */
  it('shoots one element alone at 2x, after its data reads, with the page background behind it', async () => {
    const r = await svc.render({ ...base(), url: `${pages.base}/element`, selector: 'body', capture: { element: '#chart' } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.element).toBe(true);
    const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([400, 200]);
    const px = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    expect(px(100, 100)).toEqual([51, 204, 51]);
    expect(px(300, 100)).toEqual([51, 51, 204]);
    // At 2x device pixels: the page's own high-density rule is the one drawn.
    const dense = await svc.render({ ...base(), capture: { element: '.density' } });
    if (!dense.ok) throw new Error(JSON.stringify(dense));
    const d = await sharp(Buffer.from(dense.bytes)).raw().toBuffer({ resolveWithObject: true });
    expect([d.info.width, d.info.height]).toEqual([40, 40]);
    expect([...d.data.subarray((20 * 40 + 20) * d.info.channels, (20 * 40 + 20) * d.info.channels + 3)]).toEqual([51, 204, 51]);
  });
  it('answers no_element, naming why, for a selector that matches nothing, nothing visible, or is not CSS', async () => {
    const at = (element: string) => svc.render({ ...base(), url: `${pages.base}/element`, selector: 'body', capture: { element } });
    expect(await at('#nope')).toEqual({ ok: false, reason: 'no_element', why: 'none' });
    for (const element of ['#hidden', '#ghost', '#empty']) expect(await at(element), element).toEqual({ ok: false, reason: 'no_element', why: 'hidden' });
    for (const element of ['#a[', 'xpath=//main', 'text=one', 'main >> #chart']) expect(await at(element), element).toEqual({ ok: false, reason: 'no_element', why: 'invalid' });
    expect(await at('#tall')).toEqual({ ok: false, reason: 'no_element', why: 'too_large', width: 50, height: 9000 });
    const long = await at('#long');
    if (!long.ok) throw new Error(JSON.stringify(long));
    expect(pngSize(long.bytes)).toEqual({ width: 50, height: 5000 });
  });
  it('shoots an element of one slide, revealed, and finds an inactive slide\'s element hidden without it', async () => {
    const r = await svc.render({ ...base(), url: pages.base + '/stacked', viewport: { width: 600, height: 630 }, capture: { element: '.mark', slide: 5 } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const { data, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([80, 80]);
    expect([...data.subarray((40 * 80 + 40) * info.channels, (40 * 80 + 40) * info.channels + 3)]).toEqual(STACKED_COLORS[4]);
    expect(await svc.render({ ...base(), url: pages.base + '/stacked', capture: { element: '.mark' } })).toEqual({ ok: false, reason: 'no_element', why: 'hidden' });
    expect(await svc.render({ ...base(), url: pages.base + '/stacked', capture: { element: '.mark', slide: 9 } })).toEqual({ ok: false, reason: 'no_slide', slides: 8 });
  });
  it('answers no_slide with the count', async () => {
    expect(await svc.render({ ...base(), capture: { slide: 9 } })).toEqual({ ok: false, reason: 'no_slide', slides: 3 });
  });
  it('answers no_slide with a zero count at once when the document drew no slide, instead of waiting out the deadline for an empty body', async () => {
    const started = Date.now();
    expect(await svc.render({ ...base(), url: `${pages.base}/empty-deck`, selector: 'body', capture: { slide: 1 } })).toEqual({ ok: false, reason: 'no_slide', slides: 0 });
    expect(Date.now() - started).toBeLessThan(5_000);
  });
  /**
   * `card` is a CLIP of the page, not an element shot: the stage is the
   * viewport's HEIGHT (a card is a fixed ratio — the whole point of the mode)
   * and the SURFACE's width, capped at the viewport. A served document's body
   * spans the viewport, so in the product the two coincide; here `main` is
   * 600px and the clip follows it, which is the rule that stopped an embedded
   * player's box from cropping every og card to its width.
   */
  it('clips the card stage to the surface width, at the viewport height', async () => {
    const r = await svc.render({ ...base(), capture: 'card', viewport: { width: 1600, height: 840 } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 600, height: 840 });
  });
  it('clips the card to the VIEWPORT when the surface is wider', async () => {
    const r = await svc.render({ ...base(), capture: 'card', selector: 'body', viewport: { width: 300, height: 200 } });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 300, height: 200 });
  });
  it('scales a positioned locked-ratio card crop to the requested output without relayout', async () => {
    const r = await svc.render({
      ...base(),
      capture: { card: { x: 200, y: 100, width: 400 } },
      viewport: { width: 1200, height: 630 },
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 1200, height: 630 });
    const { data: pixels, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const start = (y * info.width + x) * info.channels;
      return [...pixels.subarray(start, start + 3)];
    };
    expect(at(600, 100)).toEqual([51, 204, 51]); // source y≈133: green band
    expect(at(600, 400)).toEqual([51, 51, 204]); // source y≈233: blue band
  });
  it('rasterizes a magnified card at the density needed by its output', async () => {
    const r = await svc.render({
      ...base(),
      capture: { card: { x: 0, y: 0, width: 400 } },
      viewport: { width: 1200, height: 630 },
    });
    if (!r.ok) throw new Error(JSON.stringify(r));
    const { data: pixels, info } = await sharp(Buffer.from(r.bytes)).raw().toBuffer({ resolveWithObject: true });
    const at = (60 * info.width + 60) * info.channels;
    expect([...pixels.subarray(at, at + 3)]).toEqual([51, 204, 51]);
  });
  it('produces a height-bounded overview using the same layout', async () => {
    const r = await svc.render({ ...base(), capture: 'preview' });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(pngSize(r.bytes)).toEqual({ width: 1600, height: 800 });
  });
  it('names a page that cannot be reached', async () => {
    const r = await svc.render({ ...base(), url: 'http://127.0.0.1:1/nope', timeoutMs: 2000 });
    expect(!r.ok && r.reason).toBe('navigation');
  });
  it('names a selector that never appears as failed', async () => {
    const r = await svc.render({ ...base(), selector: '#never', timeoutMs: 1000 });
    expect(!r.ok && r.reason).toBe('failed');
  });
  it('harvests the drawn SVGs as text, after they draw, with their attributes, once per load', async () => {
    const r = await svc.harvestSvg!({ url: `${pages.base}/harvest`, viewport: { width: 600, height: 400 }, selector: 'main', collect: 'figure', sameOriginOnly: true, settleMs: 0, timeoutMs: 10_000, loads: 2 });
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.loads).toHaveLength(2);
    for (const load of r.loads) {
      // The PNG figure is not a drawing; both SVG figures are, in document order.
      expect(load.map(d => d.attributes['data-kind'])).toEqual(['fixed', 'random']);
      expect(load[0]).toEqual({ attributes: { 'data-kind': 'fixed', 'data-mx-mermaid-state': 'ready' }, width: 120, height: 80, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>fixed & sound</text></svg>' });
    }
    // Two fresh loads: a caller can tell the reproducible drawing from the random one.
    expect(r.loads[0][0].svg).toBe(r.loads[1][0].svg);
    expect(r.loads[0][1].svg).not.toBe(r.loads[1][1].svg);
  });
  it('names an unreachable harvest page as navigation', async () => {
    const r = await svc.harvestSvg!({ url: 'http://127.0.0.1:1/nope', viewport: { width: 600, height: 400 }, selector: 'main', collect: 'figure', timeoutMs: 2000 });
    expect(!r.ok && r.reason).toBe('navigation');
  });
});

describe('browserClient', () => {
  it('answers unavailable for a dead service within the deadline', async () => {
    const dead = browserClient('http://127.0.0.1:1', { deadlineMs: 500 });
    expect(await dead.render(base())).toEqual({ ok: false, reason: 'unavailable', detail: expect.any(String) });
  });
});

describe('harvest over mixed versions', () => {
  it('a service without the operation answers harvest_unavailable, and so does an older server with no route', async () => {
    const renderOnly = serveBrowser({ render: local.render });
    const older = await withHttpServer((_q, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); });
    const listeningRenderOnly = renderOnly.listen(0);
    try {
      const request = { url, viewport: { width: 10, height: 10 }, selector: 'main', collect: 'figure' };
      expect(await browserClient(listeningRenderOnly.url).harvestSvg!(request)).toEqual({ ok: false, reason: 'harvest_unavailable' });
      expect(await browserClient(older.base).harvestSvg!(request)).toEqual({ ok: false, reason: 'harvest_unavailable' });
      expect(await browserClient('http://127.0.0.1:1', { deadlineMs: 500 }).harvestSvg!(request)).toEqual({ ok: false, reason: 'unavailable', detail: expect.any(String) });
    } finally { await renderOnly.close(); await older.close(); }
  });
});

describe('serveBrowser health', () => {
  it('GET /health answers 200 {ok:true}, the liveness/readiness probe for whatever orchestrates the service', async () => {
    const res = await fetch(`${listening.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('a GET anywhere else stays 405 — render is POST-only, health is the one GET', async () => {
    const res = await fetch(`${listening.url}${BROWSER_ROUTES.render}`);
    expect(res.status).toBe(405);
  });
});

describe('serveBrowser service authentication', () => {
  it('keeps health public but refuses render without the configured service secret', async () => {
    const protectedServer = serveBrowser(local, { serviceSecret: 'browser-test-secret' });
    const protectedUrl = protectedServer.listen(0).url;
    try {
      expect((await fetch(`${protectedUrl}/health`)).status).toBe(200);
      expect((await fetch(`${protectedUrl}${BROWSER_ROUTES.render}`, { method: 'POST', body: '{}' })).status).toBe(401);
      const client = browserClient(protectedUrl, { serviceSecret: 'browser-test-secret', deadlineMs: 20_000 });
      expect((await client.render(base())).ok).toBe(true);
    } finally { await protectedServer.close(); }
  });
});

it('renders a ready chart and uploads its pixels while the HTTP result contains metadata only',async()=>{
 let uploaded=Buffer.alloc(0);
 const sink=await withHttpServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));uploaded=Buffer.concat(chunks);res.end();});
 const renderer=createBrowser({upload:{origin:sink.base,prefix:'/exports/objects/'}}),shell=serveBrowser(renderer),listener=shell.listen(0);
 try{
  const client=browserClient(listener.url,{deadlineMs:35_000});
  const result=await client.renderAndUpload!({render:{...base(),url:`${pages.base}/chart`,settleMs:0},upload:{url:`${sink.base}/exports/objects/test.png?signature=test`,contentType:'image/png'}});
  expect(result).toEqual({ok:true,mime:'image/png',bytes:uploaded.length,width:100,height:100});
  const {data,info}=await sharp(uploaded).raw().toBuffer({resolveWithObject:true});
  expect([...data.subarray((50*info.width+50)*info.channels,(50*info.width+50)*info.channels+3)]).toEqual([51,204,51]);
 }finally{await renderer.close();await shell.close();await sink.close();}
});
