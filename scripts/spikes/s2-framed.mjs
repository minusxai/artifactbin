// SPIKE S2, the leg the brief did not scope: an OWNER is served the SHELL, so
// their document is FRAMED — and `location` inside it is the frame's, not the
// address bar's. Measures which URL `__mxValues` actually rewrote.
import { chromium } from '/Users/ppsreejith/projects/artifactbin-spikes/node_modules/playwright/index.mjs';
import { becomeOwner, startDocument } from '/Users/ppsreejith/projects/artifactbin-spikes/scripts/lib/start-doc.mjs';
const BASE = 'http://localhost:5201';
const SCRIPT = "try{window.__mxValues({x:'1'})}catch(e){}document.body.setAttribute('data-spike',location.href);";
const { id, token } = await startDocument(BASE);
const put = await fetch(`${BASE}/api/artifacts/${id}`, {
  method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'spike S2 framed', markup: '<Helmet><title>F</title><script>{`' + SCRIPT + '`}</script></Helmet><h1>F</h1><p>framed</p>' }),
});
if (!put.ok) throw new Error(`PUT ${put.status} ${await put.text()}`);
const browser = await chromium.launch();
const page = await browser.newPage();
await becomeOwner(page, BASE, token);
await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
await page.waitForSelector('iframe[title="artifact"]');
await page.waitForTimeout(1200);
const frame = page.frames().find((f) => f.url().includes(`/a/${id}/raw`));
console.log(JSON.stringify({
  addressBar: page.url(),
  frameUrlNow: frame.url(),
  frameLocationHref: await frame.evaluate(() => location.href),
  whatTheScriptSaw: await frame.evaluate(() => document.body.getAttribute('data-spike')),
}, null, 1));
await browser.close();
