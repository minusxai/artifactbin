/**
 * A DRAFT CHECKED IN A REAL CHROMIUM through the real app: the seam makes the draft, the in-process browser loads it
 * under its draft origin from the listening app (the page runtime, the chart component and its CSV table all real),
 * and the answer names the chart that could not draw and the script that threw. Only the internal address is this
 * test server's, as EXPORT_INTERNAL_ORIGIN is the app's own in a deployment.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getRequestListener } from '@hono/node-server';
import { attachActor } from '@artifactbin/utils';
import { ANONYMOUS, CANONICAL_DRAFT_CHECK_PATH } from '@artifactbin/contracts';
import { createBrowser } from '@artifactbin/browser/local';
import { withHttpServer, type RunningServer } from '@artifactbin/test-support/net';
import { services, setServices } from '@/lib/platform';
import { pagesSite } from '@/lib/http';
import { useAppHarness } from '@/__tests__/harness';
import { createAppServer } from '@/server/app';

useAppHarness();
const app = createAppServer({ indexHtml: async () => '<html></html>', pagesSite: pagesSite() });
const chromium = createBrowser(), original = services().browser;
let listening: RunningServer;
beforeAll(async () => {
  listening = await withHttpServer(getRequestListener(app.fetch));
  setServices({ browser: { ...original, inspect: request => chromium.inspect!({ ...request, internalOrigin: listening.base }) } });
});
afterAll(async () => { setServices({ browser: original }); await chromium.close(); await listening.close(); });

const b64 = (text: string) => Buffer.from(text).toString('base64');
const page = (spec: string, script = '') => '<!doctype html><html><head><meta charset="utf-8"><title>Revenue</title>'
  + '<link rel="af-dataset" data-af-name="monthly" href="./monthly.csv"><script type="module">import \'@afbin/chart\';</script></head>'
  + `<body><h1>Revenue by month</h1><af-chart label="Monthly revenue" height="240" sql="select month, revenue from monthly order by month">`
  + `<script type="application/json">${spec}</script></af-chart>${script}</body></html>`;
const check = async (html: string) => {
  const req = new Request('http://localhost' + CANONICAL_DRAFT_CHECK_PATH, { method: 'POST',
    body: JSON.stringify({ html, entryPath: 'revenue.html', files: [{ path: 'monthly.csv', base64: b64('month,revenue\n2026-01,10\n2026-02,14\n') }] }) });
  const answered = await app.fetch(attachActor(req, ANONYMOUS));
  expect(answered.status).toBe(200);
  return answered.json() as Promise<{ problems: Array<Record<string, string>>; truncated: boolean }>;
};
const GOOD = '{"mark":"line","encoding":{"x":{"field":"month","type":"ordinal"},"y":{"field":"revenue","type":"quantitative"}}}';

it('names the chart that could not draw and the script that threw', async () => {
  const found = await check(page('{"layer":[{"mark":"bar"},{"mark":"bogus"}],"encoding":{"x":{"field":"month","type":"ordinal"}}}',
    '<script type="module">setTimeout(() => { throw new Error("total is not defined"); });</script>'));
  expect(found.problems).toEqual(expect.arrayContaining([
    { kind: 'component', element: 'af-chart', code: expect.any(String), label: 'Monthly revenue', message: expect.stringMatching(/^Chart not drawn/i) },
    { kind: 'script', message: 'total is not defined' },
  ]));
}, 30_000);

it('answers a page that draws with no problems', async () => {
  expect(await check(page(GOOD))).toEqual({ problems: [], truncated: false });
}, 30_000);
