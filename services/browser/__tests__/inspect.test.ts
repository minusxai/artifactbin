/**
 * A PAGE'S OWN PROBLEMS (`inspect`), over both transports, in a real Chromium: a failed native component, an uncaught
 * exception, a console error, a missing file and a refused request are each said once, and a page under a public host
 * name the browser cannot resolve is loaded from the internal origin by its own Host.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BrowserService, PageInspectRequest } from '@artifactbin/contracts';
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
    const body = { '/broken': BROKEN, '/clean': CLEAN, '/hidden': NEVER_SHOWN }[q.url ?? ''];
    return body ? send(200, 'text/html', body.replaceAll('APP', app())) : send(404, 'text/plain', 'not found');
  });
  port = new URL(pages.base).port;
});
afterAll(async () => { await local.close?.(); await server.close(); await pages.close(); });

const request = (path: string): PageInspectRequest => ({ url: page(path), viewport: { width: 800, height: 600 }, selector: 'body',
  sameOriginOnly: true, allowedOrigins: [app()], internalOrigin: pages.base, settleMs: 300, timeoutMs: 10_000 });

describe.each<[string, BrowserService]>([['in-process', local], ['over HTTP', remote]])('%s', (_name, svc) => {
  it('says each of the page\'s own problems once: the failed component, the exception, the console, the missing and the refused file', async () => {
    const r = await svc.inspect!(request('/broken'));
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.truncated).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining([
      { kind: 'component', element: 'af-chart', code: 'invalid_chart', label: 'Monthly revenue', message: 'Chart not drawn: the Vega-Lite spec is not valid at layer[1]' },
      { kind: 'script', message: 'total is not defined' },
      { kind: 'console', message: 'the page said so' },
      { kind: 'request', message: 'GET /missing.csv answered 404' },
      { kind: 'request', message: 'http://elsewhere.invalid/x.png was refused: a page loads only its own files and the platform\'s' },
    ]));
    expect(r.problems).toHaveLength(5);
  });

  it('loads the page and its allowed origins from the internal origin by their own Host, and answers a clean page with none', async () => {
    hosts.length = 0;
    expect(await svc.inspect!(request('/clean'))).toEqual({ ok: true, problems: [], truncated: false });
    expect(hosts).toEqual([`page.lvh.me:${port}/clean`, `app.lvh.me:${port}/lib.js`]);
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
