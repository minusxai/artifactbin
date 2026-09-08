import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { BrowserService } from '@artifactbin/contracts';
import { browserClient, serveBrowser } from '@artifactbin/browser';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '../../app/__tests__/net';
import { gzipSync } from 'node:zlib';

const assetOrigin = 'https://cached-assets.invalid';
const path = '/assets/' + 'a'.repeat(64);
const local = createBrowser();
const server = serveBrowser(local);
const listening = server.listen(0);
const remote = browserClient(listening.url, { deadlineMs: 20_000 });
let app: RunningServer;
let assetReads = 0;
let body = '';
let image: Buffer;
let external: RunningServer;
let externalReads = 0;
beforeAll(async () => {
  external = await withHttpServer((_req,res) => { externalReads++;res.writeHead(200,{'access-control-allow-origin':'*'});res.end('external'); });
  image = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#33cc33' } }).png().toBuffer();
  app = await withHttpServer((req, res) => {
    if (req.url === '/assets/' + 'b'.repeat(64)) {
      assetReads++;
      expect(req.headers.host).toBe('cached-assets.invalid');
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(image); return;
    }
    if (req.url === path) {
      assetReads++;
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers.origin).toBeUndefined();
      expect(req.headers.host).toBe('cached-assets.invalid');
      res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip', 'set-cookie': 'asset=secret', 'location': '/evil' });
      res.end(gzipSync("if(import.meta.url.startsWith('https://cached-assets.invalid/assets/'))document.querySelector('main').style.background='#33cc33'"));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'private=secret; Path=/' });
    res.end(body);
  });
});
afterAll(async () => { await local.close?.(); await server.close(); await app.close(); await external.close(); });
describe.each<[string, BrowserService]>([['local', local], ['HTTP', remote]])('%s internal asset transport', (_, browser) => {
  it('renders an unreachable public asset through the internal app without cookies', async () => {
    const before = assetReads;
    body = `<body style="margin:0"><main style="width:100px;height:100px;background:#cc3333"></main><script type="module" src="${assetOrigin}${path}"></script>`;
    const result = await browser.render({ url: app.base + '/page', assetOrigin, sameOriginOnly: true, format: 'png', viewport: { width: 100, height: 100 }, selector: 'main', capture: 'full', settleMs: 0, timeoutMs: 5000 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([51, 204, 51]);
    expect(assetReads).toBe(before + 1);
  });
  it('loads a module and image inside an opaque sandbox, retaining their public URLs', async () => {
    const frame = `<body style="margin:0"><main style="width:100px;height:100px;background:#cc3333"><img style="position:absolute;left:40px;top:40px" src="${assetOrigin}/assets/${'b'.repeat(64)}"></main><script type="module" src="${assetOrigin}${path}"></script>`;
    body = `<body style="margin:0"><main><iframe sandbox="allow-scripts" style="border:0;width:100px;height:100px" srcdoc="${frame.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe></main>`;
    const result = await browser.render({ url: app.base + '/page', assetOrigin, sameOriginOnly: true, format: 'png', viewport: { width: 100, height: 100 }, selector: 'iframe', capture: 'full', settleMs: 50, timeoutMs: 5000 });
    if (!result.ok) throw Error(result.reason);
    const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    for(const [x,y] of [[0,0],[50,50]]) { const at=(y*info.width+x)*info.channels; expect([...data.subarray(at,at+3)]).toEqual([51,204,51]); }
  });
  it('refuses invalid paths and methods without falling through to an allowed public network origin',async()=>{
    const before=externalReads;
    body=`<body style="margin:0"><main style="width:100px;height:100px;background:#cc3333"></main><script>
    Promise.all([
      fetch('${external.base}/api/my/session'),
      fetch('${external.base}${path}?key=secret'),
      fetch('${external.base}${path}',{method:'POST',body:'forbidden'}),
    ].map(p=>p.then(()=>false,()=>true))).then(values=>{if(values.every(Boolean))document.querySelector('main').style.background='#33cc33'});
    </script>`;
    const result=await browser.render({url:app.base+'/page',assetOrigin:external.base,allowedOrigins:[external.base],sameOriginOnly:true,format:'png',viewport:{width:100,height:100},selector:'main',capture:'full',settleMs:100,timeoutMs:5000});
    if(!result.ok)throw Error(result.reason);
    const {data}=await sharp(result.bytes).raw().toBuffer({resolveWithObject:true});
    expect([...data.subarray(0,3)]).toEqual([51,204,51]);expect(externalReads).toBe(before);
  });
});
