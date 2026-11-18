/**
 * A PAGE'S OWN PROBLEMS (`inspect`), over both transports, in a real Chromium: a failed native component, an uncaught
 * exception, a console error, a missing file and a refused request are each said once, and a page under a public host
 * name the browser cannot resolve is loaded from the internal origin by its own Host.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PAGE_IMAGE_LIMITS, type BrowserService, type PageInspectRequest } from '@artifactbin/contracts';
import { browserClient, serveBrowser } from '@artifactbin/browser';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';

const BROKEN = `<!doctype html><html><head><script src="APP/lib.js"></script></head><body><h1>Revenue</h1>
<af-chart label="Monthly revenue"><p role="status">Loading chart…</p></af-chart>
<img src="http://elsewhere.invalid/x.png" alt="">
<script>
fetch('./missing.csv');
console.error('the page said so');
setTimeout(() => { throw new Error('total is not defined'); });
setTimeout(() => { const chart = document.querySelector('af-chart'); chart.setAttribute('data-af-error', 'invalid_chart');
  chart.querySelector('[role=status]').textContent = 'Chart not drawn: the Vega-Lite spec is not valid at layer[1]'; }, 100);
</script></body></html>`;
const CLEAN = `<!doctype html><html><body><h1>Fine</h1><script src="APP/lib.js"></script></body></html>`;
// A design system's surface token (shadcn: --muted is a background) used as a text colour, on a page 5000px tall.
const FAINT = `<!doctype html><html><head><style>:where(:root){--muted:oklch(0.96 0 0)}.note{color:var(--muted)}</style></head>
<body style="margin:0;min-height:5000px;background:#fff"><h1>Churn</h1><p class="note">Churn rate by month</p><p class="note">Customers lost</p>
<p class="note">Net revenue</p><p style="color:#eee;background:#fafafa">Footnote</p>
<p class="note" style="background:linear-gradient(#000,#111)">Over a gradient</p><p class="note" style="visibility:hidden">Not shown</p>
<div style="position:relative;height:80px"><div style="position:absolute;inset:0;background:#123"></div><p style="position:relative;margin:0;color:#fff">Hero title over its tint</p></div>
<svg width="100" height="20"><text x="0" y="15" style="color:#fefefe">Drawn</text></svg></body></html>`;
const NEVER_SHOWN = `<!doctype html><html><body style="display:none"><h1>Hidden</h1></body></html>`;

let pages: RunningServer, port: string;
const hosts: string[] = [];
const local = createBrowser();
const server = serveBrowser(local);
const listening = server.listen(0);
const remote = browserClient(listening.url, { deadlineMs: 20_000 });
const page = (path: string) => `http://page.lvh.me:${port}${path}`;
const app = () => `http://app.lvh.me:${port}`;

beforeAll(async () => {
  pages = await withHttpServer((q, s) => {
    const host = String(q.headers.host ?? '');
    hosts.push(`${host}${q.url}`);
    const send = (status: number, type: string, body: string) => { s.writeHead(status, { 'content-type': type, 'set-cookie': 'leak=1' }); s.end(body); };
    if (host.startsWith('app.lvh.me') && q.url === '/lib.js') return send(200, 'text/javascript', 'window.libLoaded = true;');
    if (!host.startsWith('page.lvh.me')) return send(404, 'text/plain', 'no such host');
    const body = { '/broken': BROKEN, '/clean': CLEAN, '/hidden': NEVER_SHOWN, '/faint': FAINT }[q.url ?? ''];
    return body ? send(200, 'text/html', body.replaceAll('APP', app())) : send(404, 'text/plain', 'not found');
  });
  port = new URL(pages.base).port;
});
afterAll(async () => { await local.close?.(); await server.close(); await pages.close(); });

const request = (path: string): PageInspectRequest => ({ url: page(path), viewport: { width: 800, height: 600 }, selector: 'body',
  sameOriginOnly: true, allowedOrigins: [app()], internalOrigin: pages.base, settleMs: 300, timeoutMs: 10_000 });

describe.each<[string, BrowserService]>([['in-process', local], ['over HTTP', remote]])('%s', (_name, svc) => {
  it('says each of the page\'s own problems once: the failed component, the exception, the console, and the missing file, never the request this browser refused', async () => {
    const r = await svc.inspect!(request('/broken'));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.truncated).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([
      { kind: 'component', element: 'af-chart', code: 'invalid_chart', label: 'Monthly revenue', message: 'Chart not drawn: the Vega-Lite spec is not valid at layer[1]' },
      { kind: 'script', message: 'total is not defined' },
      { kind: 'console', message: 'the page said so' },
      { kind: 'request', message: 'GET /missing.csv answered 404' },
    ]));
    // The image this browser refused by its own rule may load for a reader: it is not the page's problem.
    expect(r.problems).toHaveLength(4);
  });

  it('loads the page and its allowed origins from the internal origin by their own Host, and answers a clean page with none', async () => {
    hosts.length = 0;
    expect(await svc.inspect!(request('/clean'))).toEqual({ ok: true, problems: [], truncated: false });
    expect(hosts).toEqual([`page.lvh.me:${port}/clean`, `app.lvh.me:${port}/lib.js`]);
  });

  it('answers a JPEG of the page when asked, within the image bounds', async () => {
    const r = await svc.inspect!({ ...request('/clean'), screenshot: true });
    if (!r.ok || !r.image) throw new Error(JSON.stringify(r));
    const bytes = Buffer.from(r.image.data, 'base64');
    expect(r.image).toEqual({ mime: 'image/jpeg', width: 800, height: expect.any(Number), bytes: bytes.length, data: expect.any(String) });
    expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(bytes.length).toBeLessThanOrEqual(PAGE_IMAGE_LIMITS.bytes);
    expect((await svc.inspect!(request('/clean'))).ok && 'image' in (await svc.inspect!(request('/clean')))).toBe(false);
  });

  it('says text too faint to read once per colour pair, naming the element and both colours, and pictures only the page\'s top within 2000 by 2000', async () => {
    const r = await svc.inspect!({ ...request('/faint'), viewport: { width: 1280, height: 800 }, screenshot: true });
    if (!r.ok || !r.image) throw new Error(JSON.stringify(r));
    expect(r.problems).toEqual([
      { kind: 'contrast', element: 'p.note', message: 'unreadable text: 3 elements (the first p.note "Churn rate by month") draw oklch(0.96 0 0) on rgb(255, 255, 255), a contrast of 1.12:1 (text needs at least 2:1). That is the theme\'s --muted, a background colour: write text in --foreground or --muted-foreground' },
      { kind: 'contrast', element: 'p', message: 'unreadable text: 1 element (the first p "Footnote") draws rgb(238, 238, 238) on rgb(250, 250, 250), a contrast of 1.11:1 (text needs at least 2:1)' },
    ]);
    const picture = await sharp(Buffer.from(r.image.data, 'base64')).metadata();
    expect([picture.width, picture.height]).toEqual([1280, 2000]);
    expect([r.image.width, r.image.height]).toEqual([1280, 2000]);
    expect(Math.max(PAGE_IMAGE_LIMITS.width, PAGE_IMAGE_LIMITS.height)).toBe(2000);
  });

  it('says a page that never finishes showing timed out', async () => {
    const r = await svc.inspect!({ ...request('/hidden'), timeoutMs: 2_000 });
    expect(r).toEqual({ ok: true, truncated: false, problems: [{ kind: 'timeout', message: 'the page did not finish loading and drawing in time' }] });
  });
});

describe('inspect over mixed versions', () => {
  it('a service without the operation answers inspect_unavailable, and so does an older server with no route', async () => {
    const renderOnly = serveBrowser({ render: local.render });
    const older = await withHttpServer((_q, res) => { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); });
    const listeningRenderOnly = renderOnly.listen(0);
    try {
      const asked = { url: 'http://127.0.0.1:1/', viewport: { width: 10, height: 10 }, selector: 'body' };
      expect(await browserClient(listeningRenderOnly.url).inspect!(asked)).toEqual({ ok: false, reason: 'inspect_unavailable' });
      expect(await browserClient(older.base).inspect!(asked)).toEqual({ ok: false, reason: 'inspect_unavailable' });
    } finally { await renderOnly.close(); await older.close(); }
  });
});
