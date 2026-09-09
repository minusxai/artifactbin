/** Route boundaries, not timing benchmarks: one browser document across app and artifact navigation. */
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
  await page.goto(`${base}/a/${first.id}`);
  await page.locator('body > #root [data-mx-inline-story]').waitFor();
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
  const heldArtifact = [];
  const holdArtifact = (route) => { heldArtifact.push(route); };
  await page.route(`**/api/page/artifact/${second.id}`, holdArtifact);
  const artifactRefresh = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/page/artifact/${second.id}`);
  await page.goBack();
  await artifactRefresh;
  await page.getByLabel('Artifact B', { exact: true }).waitFor();
  assert(heldArtifact.length > 0, 'artifact Back actually starts a refresh');
  await page.unroute(`**/api/page/artifact/${second.id}`, holdArtifact);
  await Promise.all(heldArtifact.map((route) => route.continue()));
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
  const pageCount = page.context().pages().length;
  for (const [label, id] of [['Open mxmx_test navigation A', first.id], ['Open folder Navigation folder', folder.id]]) {
    const link = page.getByLabel(label, { exact: true });
    assert.notEqual(await link.getAttribute('target'), '_blank', `${label} does not force a new tab`);
    await link.click();
    await page.waitForURL((url) => url.pathname.includes(id));
    assert.equal(page.context().pages().length, pageCount, 'shelf click opens no tab');
    assert.equal(await page.evaluate(() => window.__navigationProbe), 'shelf-document', 'shelf click retains document');
    const held = [];
    const holdCore = (route) => { held.push(route); };
    await page.route('**/api/page/home?part=core', holdCore);
    await page.goBack();
    await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
    // The response is still held: this is retained account state, not a fast
    // fetch mistaken for an immediate Back restoration.
    await page.unroute('**/api/page/home?part=core', holdCore);
    await Promise.all(held.map((route) => route.continue()));
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
  await page.unroute(`**/api/page/artifact/${folder.id}`, holdFolder);
  await Promise.all(heldFolder.map((route) => route.continue()));
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
  await page.unroute('**/api/page/profile/**', holdProfile);
  await Promise.all(heldProfile.map((route) => route.continue()));
  assert.equal(await page.evaluate(() => window.__navigationProbe), 'profile-document', 'Back to profile retains document');
  await page.request.delete(`${base}/api/my/artifacts/${folder.id}`);
  console.log('PASS seamless app/artifact route matrix, top-level body, history and CSS disposal');
} finally {
  await browser.close();
  for (const id of [first.id, second.id]) await fetch(`${base}/api/artifacts/${id}`, { method: 'DELETE', headers: auth });
}
