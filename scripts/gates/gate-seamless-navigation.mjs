/** Full-document reader navigation, browser history, and in-tab shelf/profile links. */
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const first = await startDocument(base);
const auth = { Authorization: `Bearer ${first.token}`, 'Content-Type': 'application/json' };
const secondResponse = await fetch(`${base}/api/artifacts`, { method: 'POST', headers: auth, body: JSON.stringify({
  title: 'mxmx_test navigation B', visibility: 'public',
  markup: '<h1 aria-label="Artifact B">Second</h1><a href="/" aria-label="Go home">Home</a>',
}) });
assert(secondResponse.ok, `create B: ${secondResponse.status}`);
const second = await secondResponse.json();
const published = await fetch(`${base}/api/artifacts/${first.id}`, { method: 'PUT', headers: auth, body: JSON.stringify({
  title: 'mxmx_test navigation A', visibility: 'public',
  markup: `<Helmet><style>{\`body { --mx-navigation-probe: artifact-a; }\`}</style></Helmet><h1 aria-label="Artifact A">First</h1><a href="/a/${second.id}" aria-label="Next artifact">Next</a>`,
}) });
assert(published.ok, `publish A: ${published.status}`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const heading = (name) => page.getByRole('heading', { name, exact: true });
  const viewReport = (id) => page.waitForResponse(response =>
    new URL(response.url()).pathname === `/api/page/artifact/${id}/view` && response.request().method() === 'POST');
  const initialView = viewReport(first.id);
  await page.goto(`${base}/a/${first.id}`);
  await heading('Artifact A').waitFor();
  assert.equal((await initialView).status(), 204, 'initial compiled reader records a view');
  assert.equal(await page.locator('[data-mx-inline-story]').count(), 1, 'compiled reader is in the top-level DOM');
  assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Artifact A"]')?.getRootNode() === document), true);
  await page.evaluate(() => { window.__navigationProbe = 'artifact-a'; });
  const nextView = viewReport(second.id);
  await page.getByRole('link', { name: 'Next artifact' }).click();
  await heading('Artifact B').waitFor();
  assert.equal((await nextView).status(), 204, 'navigation records the next document view');
  assert.equal(new URL(page.url()).pathname, `/a/${second.id}`);
  assert.equal(await page.evaluate(() => window.__navigationProbe), undefined, 'reader link loads its document');
  assert.equal(await heading('Artifact A').count(), 0, 'old reader body left');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--mx-navigation-probe').trim()), '', 'old author CSS left');
  await page.getByRole('link', { name: 'Go home' }).click();
  await page.waitForURL(`${base}/login`);
  await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor();
  await page.goBack();
  await heading('Artifact B').waitFor();
  await page.goBack();
  await heading('Artifact A').waitFor();
  await page.goForward();
  await heading('Artifact B').waitFor();

  await becomeOwner(page, base, first.token);
  const sink = await startMailSink();
  await loginViaEmail(page, base, sink, `mxmx_test_navigation_${Date.now()}@example.com`);
  assert.equal(await page.getByLabel('Add to my account', { exact: true }).count(), 0,
    'verified login adopts guest artifacts without a second claim step');

  // A served document's own head sheets (data-mx-story-css chief among them) must leave with it: left
  // behind on an SPA hop to a non-document route, they collide with the app bar's own Tailwind classes
  // and its GitHub Star button stops picking one of its two (mobile/desktop) spans.
  await page.goto(`${base}/a/${first.id}`);
  await heading('Artifact A').waitFor();
  await page.getByLabel('Open menu', { exact: true }).click();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('heading', { name: 'account' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Star artifactbin on GitHub' }).count(), 1,
    'exactly one GitHub Star button after leaving an adopted document for /account');

  await page.goto(base);
  await page.getByLabel('List view', { exact: true }).click();
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  const folderResponse = await page.request.post(`${base}/api/my/artifacts`, { data: { format: 'folder', title: 'Navigation folder' } });
  assert(folderResponse.ok(), 'create owned folder');
  const folder = await folderResponse.json();
  await page.reload();
  await page.getByLabel('List view', { exact: true }).click();
  const pageCount = page.context().pages().length;
  for (const [label, id, destination] of [
    ['Open mxmx_test navigation A', first.id, 'Artifact A'],
    ['Open folder Navigation folder', folder.id, 'Folder trail'],
  ]) {
    const link = page.getByLabel(label, { exact: true });
    assert.notEqual(await link.getAttribute('target'), '_blank', `${label} stays in this tab`);
    await link.click();
    await page.waitForURL(url => url.pathname.includes(id));
    await page.getByLabel(destination, { exact: true }).waitFor();
    assert.equal(page.context().pages().length, pageCount, 'shelf click opens no tab');
    await page.goBack();
    await page.getByLabel('List view', { exact: true }).click();
    await page.getByLabel(label, { exact: true }).waitFor();
  }
  const account = await (await page.request.get(`${base}/api/page/account`)).json();
  await page.goto(`${base}/@${account.username}`);
  await page.getByLabel('List view', { exact: true }).click();
  const profileLink = page.getByLabel('Open mxmx_test navigation A', { exact: true });
  assert.notEqual(await profileLink.getAttribute('target'), '_blank', 'profile list opens in this tab');
  await profileLink.click();
  await heading('Artifact A').waitFor();
  assert.equal(page.context().pages().length, pageCount, 'profile click opens no tab');
  await page.goBack();
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  await page.request.delete(`${base}/api/my/artifacts/${folder.id}`);
  console.log('PASS compiled reader links, history, CSS disposal, and shelf/profile in-tab navigation');
} finally {
  await browser.close();
  for (const id of [first.id, second.id]) await fetch(`${base}/api/artifacts/${id}`, { method: 'DELETE', headers: auth });
}
