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
<div data-mx-slide style="height:100px;background:#c33">one</div>
<div data-mx-slide style="height:100px;background:#3c3">two</div>
<div data-mx-slide style="height:100px;background:#33c">three</div></main></body></html>`;
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
let pages: RunningServer;
let url: string;

const local = createBrowser();
const server = serveBrowser(local);
const listening = server.listen(0);
const remote = browserClient(listening.url, { deadlineMs: 20_000 });
beforeAll(async () => {
  pages = await withHttpServer((q, s) => { if (q.url === '/slow') { const t = setTimeout(() => { if (!s.destroyed) { s.writeHead(200, { 'content-type': 'text/html' }); s.end(PAGE); } }, 1000); s.on('close', () => clearTimeout(t)); return; } s.writeHead(200, { 'content-type': 'text/html' }); s.end(q.url==='/mount'?MOUNT_PAGE:q.url==='/never-mounts'?NEVER_MOUNTS_PAGE:q.url==='/harvest'?HARVEST_PAGE:q.url==='/chart'?CHART_PAGE:q.url==='/stuck-chart'?STUCK_CHART_PAGE:q.url==='/diagram'?DIAGRAM_PAGE:q.url==='/ready'?READY_PAGE:q.url==='/never-ready'?NEVER_READY_PAGE:PAGE); });
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
    // A running browser first: the timed-out render before this one closed it, and relaunching within 250ms is not what this asserts.
    expect((await svc.render(base())).ok).toBe(true);
    const r=await svc.render({...base(),url:`${pages.base}/slow`,settleMs:0,timeoutMs:250});
    expect(!r.ok&&r.reason).toBe('failed');
  });
  it('shoots one slide as jpg', async () => {
    const r = await svc.render({ ...base(), format: 'jpg', capture: { slide: 2 } });
    expect(r.ok && r.mime).toBe('image/jpeg');
  });
  it('answers no_slide with the count', async () => {
    expect(await svc.render({ ...base(), capture: { slide: 9 } })).toEqual({ ok: false, reason: 'no_slide', slides: 3 });
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
