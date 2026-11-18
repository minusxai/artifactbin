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
const check = async (html: string, status = 200) => {
  const req = new Request('http://localhost' + CANONICAL_DRAFT_CHECK_PATH, { method: 'POST',
    body: JSON.stringify({ html, entryPath: 'revenue.html', files: [{ path: 'monthly.csv', base64: b64('month,revenue\n2026-01,10\n2026-02,14\n') }] }) });
  const answered = await app.fetch(attachActor(req, ANONYMOUS));
  expect(answered.status).toBe(status);
  return answered.json() as Promise<{ problems: Array<Record<string, string>>; truncated: boolean; image?: Record<string, unknown> }>;
};
const GOOD = '{"mark":"line","encoding":{"x":{"field":"month","type":"ordinal"},"y":{"field":"revenue","type":"quantitative"}}}';

it('names the chart that could not draw and the script that threw, with a picture of the page', async () => {
  // As production saw it: a top-level facet with no spec.
  const found = await check(page('{"facet":{"field":"month","type":"ordinal"},"mark":"bar","encoding":{"y":{"field":"revenue","type":"quantitative"}}}',
    '<script type="module">setTimeout(() => { throw new Error("total is not defined"); });</script>'));
  expect(found.problems).toEqual(expect.arrayContaining([
    { kind: 'component', element: 'af-chart', code: expect.any(String), label: 'Monthly revenue', message: expect.stringMatching(/^Chart not drawn/i) },
    { kind: 'script', message: 'total is not defined' },
  ]));
  expect(found.image).toMatchObject({ mime: 'image/jpeg', width: 1280, data: expect.any(String) });
}, 30_000);

it('answers a page that draws with no problems', async () => {
  expect(await check(page(GOOD))).toMatchObject({ problems: [], truncated: false });
}, 30_000);

// The chat guide's page as an agent writes it (Graphite, a CSV link, a chart with its spec): nothing to fix.
const GUIDE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="artifactbin:design-system" content="graphite">
<title>Revenue by month</title>
<link rel="af-dataset" data-af-name="monthly" href="./monthly.csv">
<script type="module">import '@afbin/chart';</script>
</head><body>
<h1>Revenue by month</h1>
<af-chart label="Monthly revenue" height="320" sql="select month, revenue from monthly order by month">
  <script type="application/json">{"mark":{"type":"line","point":true},"encoding":{
    "x":{"field":"month","type":"ordinal","sort":null},"y":{"field":"revenue","type":"quantitative"}}}</script>
</af-chart>
</body></html>`;

it('answers the guide\'s own page with no problems', async () => {
  expect(await check(GUIDE)).toMatchObject({ problems: [], truncated: false });
}, 30_000);

it('says nothing of live data it may not read here, from a chart or a script', async () => {
  const live = GUIDE.replace('<link rel="af-dataset"', '<link rel="af-dataset" data-af-name="wh" href="default:warehouse">\n<link rel="af-dataset"')
    .replace('</af-chart>', '</af-chart><af-chart label="Live" sql="select 1 as month, 2 as revenue from wh.orders"><script type="application/json">{"mark":"bar"}</script></af-chart>'
      + '<script type="module">import {sql} from "@afbin/apollo"; const rows = await sql`select count(*) from wh.orders`; document.title = String(rows.length);</script>');
  expect(await check(live)).toMatchObject({ problems: [], truncated: false });
}, 30_000);
