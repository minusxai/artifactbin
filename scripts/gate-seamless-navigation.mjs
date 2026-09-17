/** Route boundaries, not timing benchmarks: one browser document across app and artifact navigation. */
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from './lib/mail-login.mjs';

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
  const viewReport = (id) => page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/page/artifact/${id}/view` && response.request().method() === 'POST');
  const initialView = viewReport(first.id);
  await page.goto(`${base}/a/${first.id}`);
  await page.locator('body > #root [data-mx-inline-story]').waitFor();
  await page.getByLabel('Artifact A', { exact: true }).waitFor();
  assert.equal((await initialView).status(), 204, 'initial inline reader records a view');
  assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Artifact A"]')?.getRootNode() === document), true, 'artifact is in top-level DOM');
  await page.evaluate(() => { window.__navigationProbe = 'same-document'; });
  const nextView = viewReport(second.id);
  await page.getByLabel('Next artifact', { exact: true }).click();
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert.equal((await nextView).status(), 204, 'client navigation records the next document view');
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'artifact to artifact is client navigation');
  assert.equal(await page.getByLabel('Artifact A', { exact: true }).count(), 0, 'old body removed');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--mx-navigation-probe').trim()), '', 'old author stylesheet removed');
  await page.getByLabel('Go home', { exact: true }).click();
  await page.waitForURL(`${base}/`);
  await page.getByRole('region', { name: 'About Artifactbin', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'artifact to app is client navigation');
  const heldArtifact = [];
  const holdArtifact = (route) => { heldArtifact.push(route); };
  await page.route(`**/api/page/artifact/${second.id}`, holdArtifact);
  const artifactRefresh = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/page/artifact/${second.id}`);
  const cachedView = viewReport(second.id);
  await page.goBack();
  await artifactRefresh;
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert(heldArtifact.length > 0, 'artifact Back actually starts a refresh');
  assert.equal((await cachedView).status(), 204, 'cached Back records a view before page-data refresh completes');
  await Promise.all(heldArtifact.map((route) => route.continue()));
  await page.unroute(`**/api/page/artifact/${second.id}`, holdArtifact);
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'back app to artifact retains browser document');
  await page.goBack();
  await page.getByLabel('Artifact A', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'back artifact to artifact retains browser document');
  await page.goForward();
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'same-document', 'forward retains browser document');
  // The real shared shelf's LIST links used to force target=_blank. Checking
  // hand-authored links above alone could never catch that regression.
  await becomeOwner(page, base, first.token);
  const sink = await startMailSink();
  await loginViaEmail(page, base, sink, `mxmx_test_navigation_${Date.now()}@example.com`);
  await page.getByLabel('Add to my account', { exact: true }).click();
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  const folderResponse = await page.request.post(`${base}/api/my/artifacts`, { data: { format: 'folder', title: 'Navigation folder' } });
  assert(folderResponse.ok(), 'create owned folder');
  const folder = await folderResponse.json();
  await page.reload();
  await page.getByLabel('List view', { exact: true }).click();
  await page.evaluate(() => { window.__navigationProbe = 'shelf-document'; });
  // Capture actual pointer targets when a navigation assertion fails: a lost
  // click and a router refusal need different fixes.
  await page.evaluate(() => {
    window.__navigationClicks = [];
    let pressed;
    for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, event => {
      const target = event.target;
      const anchor = target.closest?.('a');
      if (type === 'pointerdown') pressed = anchor;
      window.__navigationClicks.push({ type, tag: target.tagName, label: target.getAttribute?.('aria-label'), href: anchor?.getAttribute('href'), prevented: event.defaultPrevented, pressedConnected: pressed?.isConnected, pressedBounds: pressed?.getBoundingClientRect().toJSON(), x: event.clientX, y: event.clientY });
      window.__navigationClicks = window.__navigationClicks.slice(-12);
    });
  });
  const pageCount = page.context().pages().length;
  for (const [label, id] of [['Open mxmx_test navigation A', first.id], ['Open folder Navigation folder', folder.id]]) {
    const link = page.getByLabel(label, { exact: true });
    assert.notEqual(await link.getAttribute('target'), '_blank', `${label} does not force a new tab`);
    await link.click();
    await page.waitForURL((url) => url.pathname.includes(id)).catch(async (error) => {
      const clicks = await page.evaluate(() => window.__navigationClicks);
      throw new Error(`${label}: expected ${id}, href ${await link.getAttribute('href').catch(() => '<unmounted>')}, current ${page.url()}, pointer events ${JSON.stringify(clicks)}`, {cause:error});
    });
    // URL changes precede lazy route mounting. Back must leave a mounted destination.
    await page.getByLabel(id === first.id ? 'Artifact A' : 'Folder trail', { exact: true }).waitFor();
    assert.equal(page.context().pages().length, pageCount, 'shelf click opens no tab');
    assert.equal(await page.evaluate(() => window.__navigationProbe), 'shelf-document', 'shelf click retains document');
    const held = [];
    const holdCore = (route) => { held.push(route); };
    await page.route('**/api/page/home?part=core', holdCore);
    const coreRefresh = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname === '/api/page/home' && url.searchParams.get('part') === 'core';
    });
    await page.goBack();
    await coreRefresh;
    await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
    // The response is still held: this is retained account state, not a fast
    // fetch mistaken for an immediate Back restoration.
    assert(held.length > 0, 'home Back actually starts a refresh');
    const refreshed = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/page/home' && url.searchParams.get('part') === 'core'; });
    await Promise.all(held.map((route) => route.continue()));
    await (await refreshed).finished();
    await page.unroute('**/api/page/home?part=core', holdCore);
    assert.equal(await page.evaluate(() => window.__navigationProbe), 'shelf-document', 'Back retains document');
  }
  await page.getByLabel('Open folder Navigation folder', { exact: true }).click();
  await page.getByLabel('Folder trail').getByRole('link').first().click();
  await page.getByLabel('Open folder Navigation folder', { exact: true }).waitFor();
  const heldFolder = [];
  const holdFolder = (route) => { heldFolder.push(route); };
  await page.route(`**/api/page/artifact/${folder.id}`, holdFolder);
  const folderRefresh = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/page/artifact/${folder.id}`);
  await page.goBack();
  await folderRefresh;
  await page.getByLabel('Folder trail').waitFor();
  assert(heldFolder.length > 0, 'folder Back actually starts a refresh');
  await Promise.all(heldFolder.map((route) => route.continue()));
  await page.unroute(`**/api/page/artifact/${folder.id}`, holdFolder);
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'shelf-document', 'Back folder paints retained payload before refresh');
  const account = await (await page.request.get(`${base}/api/page/account`)).json();
  await page.goto(`${base}/@${account.username}`);
  await page.getByLabel('List view', { exact: true }).click();
  await page.evaluate(() => { window.__navigationProbe = 'profile-document'; });
  const profileLink = page.getByLabel('Open mxmx_test navigation A', { exact: true });
  assert.notEqual(await profileLink.getAttribute('target'), '_blank', 'profile list does not force a new tab');
  await profileLink.click();
  await page.getByLabel('Artifact A', { exact: true }).waitFor();
  assert.equal(page.context().pages().length, pageCount, 'profile click opens no tab');
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'profile-document', 'profile to artifact retains document');
  const heldProfile = [];
  const holdProfile = (route) => { heldProfile.push(route); };
  await page.route('**/api/page/profile/**', holdProfile);
  const profileRefresh = page.waitForRequest((request) => new URL(request.url()).pathname.startsWith('/api/page/profile/'));
  await page.goBack();
  await profileRefresh;
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  assert(heldProfile.length > 0, 'profile Back actually starts a refresh');
  await Promise.all(heldProfile.map((route) => route.continue()));
  await page.unroute('**/api/page/profile/**', holdProfile);
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'profile-document', 'Back to profile retains document');
  await page.request.delete(`${base}/api/my/artifacts/${folder.id}`);
  console.log('PASS seamless app/artifact route matrix, top-level body, history and CSS disposal');
} finally {
  await browser.close();
  for (const id of [first.id, second.id]) await fetch(`${base}/api/artifacts/${id}`, { method: 'DELETE', headers: auth });
}
