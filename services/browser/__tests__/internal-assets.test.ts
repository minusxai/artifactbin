import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { BrowserService } from '@artifactbin/contracts';
import { browserClient, serveBrowser } from '@artifactbin/browser';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '../../app/__tests__/net';

const assetOrigin = 'https://cached-assets.invalid';
const path = '/assets/' + 'a'.repeat(64);
const local = createBrowser();
const server = serveBrowser(local);
const listening = server.listen(0);
const remote = browserClient(listening.url, { deadlineMs: 20_000 });
let app: RunningServer;
let assetReads = 0;
beforeAll(async () => {
  app = await withHttpServer((req, res) => {
    if (req.url === path) {
      assetReads++;
      expect(req.headers.cookie).toBeUndefined();
      expect(req.headers.authorization).toBeUndefined();
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end("document.querySelector('main').style.background='#33cc33'");
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'private=secret; Path=/' });
    res.end(`<body style="margin:0"><main style="width:100px;height:100px;background:#cc3333"></main><script src="${assetOrigin}${path}"></script>`);
  });
});
afterAll(async () => { await local.close?.(); await server.close(); await app.close(); });
describe.each<[string, BrowserService]>([['local', local], ['HTTP', remote]])('%s internal asset transport', (_, browser) => {
  it('renders an unreachable public asset through the internal app without cookies', async () => {
    const before = assetReads;
    const result = await browser.render({ url: app.base + '/page', assetOrigin, sameOriginOnly: true, format: 'png', viewport: { width: 100, height: 100 }, selector: 'main', capture: 'full', settleMs: 0, timeoutMs: 5000 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(result.reason);
    const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)]).toEqual([51, 204, 51]);
    expect(assetReads).toBe(before + 1);
  });
});
