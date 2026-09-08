/** Route boundaries, not timing benchmarks: one browser document across app and artifact navigation. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const first = await startDocument(base);
const auth = { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' };
const secondResponse = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'mxmx_test navigation B', visibility: 'public', markup: '<h1 aria-label="Artifact B">Second</h1><a href="/" aria-label="Go home">Home</a>' }) });
assert(secondResponse.ok, `create B: ${secondResponse.status}`);
const second = await secondResponse.json();
const published = await fetch(`${base}/api/artifacts/${first.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({ title: 'mxmx_test navigation A', visibility: 'public', markup: `<Helmet><style>{\`body { --mx-navigation-probe: artifact-a; }\`}</style></Helmet><h1 aria-label="Artifact A">First</h1><a href="/a/${second.id}" aria-label="Next artifact">Next</a>` }) });
assert(published.ok, `publish A: ${published.status}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${base}/a/${first.id}`);
  await page.getByLabel('Artifact A', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Artifact A"]')?.getRootNode() === document), true, 'artifact is in top-level DOM');
  await page.evaluate(() => { window.__navigationProbe = 'same-document'; });
  await page.getByLabel('Next artifact', { exact: true }).click();
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'artifact to artifact is client navigation');
  assert.equal(await page.getByLabel('Artifact A', { exact: true }).count(), 0, 'old body removed');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--mx-navigation-probe').trim()), '', 'old author stylesheet removed');
  await page.getByLabel('Go home', { exact: true }).click();
  await page.waitForURL(`${base}/`);
  await page.getByLabel('Get started', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'artifact to app is client navigation');
  await page.goBack();
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'back app to artifact retains browser document');
  await page.goBack();
  await page.getByLabel('Artifact A', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'back artifact to artifact retains browser document');
  await page.goForward();
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'forward retains browser document');
  console.log('PASS seamless app/artifact route matrix, top-level body, history and CSS disposal');
} finally {
  await browser.close();
  for (const id of [first.id, second.id]) await fetch(`${base}/api/artifacts/${id}`, { method: 'DELETE', headers: auth });
}
