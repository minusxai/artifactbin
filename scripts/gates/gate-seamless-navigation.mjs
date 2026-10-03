/**
 * Full-document reader navigation, browser history, and in-tab shelf/profile links.
 *
 * The document runs in its frame on its own origin (lib/serving/document-frame); the app page around it is the
 * app's. A link inside the document takes the TAB (the frame may navigate the top on a user's click), so following
 * one is a full load of the next app page, which frames the next document. Each verdict is printed as it happens
 * (lib/assert), so one broken leg does not hide the others.
 */
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import assert from 'node:assert/strict';
import { launchChromium } from './lib/browser.mjs';
import { createChecker } from './lib/assert.mjs';
import { documentFrame, documentLocator, INLINE_STORY } from './lib/page-facts.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';

const base = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('seamless-navigation');
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

const browser = await launchChromium();
try {
  const page = await browser.newPage();
  const doc = () => documentLocator(page);
  const heading = (name) => doc().getByRole('heading', { name, exact: true });
  const seen = (locator, timeout = 6_000) => locator.waitFor({ timeout }).then(() => true, () => false);
  const onApp = (pathname) => { const url = new URL(page.url()); return url.origin === new URL(base).origin && url.pathname === pathname; };
  const viewReport = (id, timeout = 5_000) => page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/page/artifact/${id}/view` && response.request().method() === 'POST', { timeout })
    .then((response) => response.status(), () => null);

  const initialView = viewReport(first.id);
  await page.goto(`${base}/a/${first.id}`);
  check(await seen(heading('Artifact A'), 20_000), 'the first document renders in its frame');
  const initialStatus = await initialView;
  check(initialStatus === 204, `initial compiled reader records a view (${initialStatus ?? 'no view reported'})`);
  // (Was "compiled reader is in the top-level DOM": the reader now runs in the document's frame, never on the app page.)
  check(await page.locator(INLINE_STORY).count() === 0 && await doc().locator(INLINE_STORY).count() === 1,
    'the compiled reader runs in the document frame, not on the app page');
  const docA = await documentFrame(page);
  check(await docA.evaluate(() => document.querySelector('[aria-label="Artifact A"]')?.getRootNode() === document),
    'the document\'s heading is in its frame\'s own light DOM');
  await page.evaluate(() => { window.__navigationProbe = 'artifact-a'; });

  // ── a link inside the document takes the tab to the next document's app page ──
  const nextView = viewReport(second.id);
  await doc().getByRole('link', { name: 'Next artifact' }).click();
  await page.waitForLoadState('load').catch(() => {});
  const reachedB = await seen(heading('Artifact B'));
  check(onApp(`/a/${second.id}`) && reachedB, `a document link opens the next document's app page (${page.url()})`);
  const nextStatus = await nextView;
  check(nextStatus === 204, `navigation records the next document view (${nextStatus ?? 'no view reported'})`);
  check(await page.evaluate(() => window.__navigationProbe).catch(() => undefined) === undefined, 'reader link loads its document');
  check(await heading('Artifact A').count().catch(() => 0) === 0, 'old reader body left');
  check(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--mx-navigation-probe').trim()).catch(() => '') === '', 'old author CSS left');
  // The history legs below need B on screen; a broken link above is already a failure, so arrive by address.
  if (!reachedB) { await page.goto(`${base}/a/${second.id}`); await seen(heading('Artifact B'), 20_000); }

  await doc().getByRole('link', { name: 'Go home' }).click();
  await page.waitForURL(`${base}/login`, { timeout: 6_000 }).catch(() => {});
  check(onApp('/login') && await seen(page.getByRole('textbox', { name: 'Email', exact: true })), `a document link to / takes the tab to the app's home (${page.url()})`);
  await page.goBack();
  check(await seen(heading('Artifact B')), 'Back returns to the second document');
  await page.goBack();
  check(await seen(heading('Artifact A')), 'Back again returns to the first document');
  await page.goForward();
  check(await seen(heading('Artifact B')), 'Forward returns to the second document');

  await becomeOwner(page, base, first.token);
  const sink = await startMailSink();
  await loginViaEmail(page, base, sink, `mxmx_test_navigation_${Date.now()}@example.com`);
  check(await page.getByLabel('Add to my account', { exact: true }).count() === 0,
    'verified login adopts guest artifacts without a second claim step');

  // Leaving a document for an app route keeps the app bar whole: exactly one GitHub Star button on /account.
  await page.goto(`${base}/a/${first.id}`);
  await seen(heading('Artifact A'), 20_000);
  await page.getByLabel('Open menu', { exact: true }).click();
  await page.getByRole('link', { name: 'Account', exact: true }).click();
  await page.getByRole('heading', { name: 'account' }).waitFor();
  check(await page.getByRole('link', { name: 'Star artifactbin on GitHub' }).count() === 1,
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
  // A document's heading is in its frame; a folder's trail is the app page's own.
  for (const [label, id, destination] of [
    ['Open mxmx_test navigation A', first.id, () => heading('Artifact A')],
    ['Open folder Navigation folder', folder.id, () => page.getByLabel('Folder trail', { exact: true })],
  ]) {
    const link = page.getByLabel(label, { exact: true });
    check(await link.getAttribute('target') !== '_blank', `${label} stays in this tab`);
    await link.click();
    await page.waitForURL(url => url.pathname.includes(id));
    check(await seen(destination(), 20_000), `${label} lands on its page`);
    check(page.context().pages().length === pageCount, 'shelf click opens no tab');
    await page.goBack();
    await page.getByLabel('List view', { exact: true }).click();
    await page.getByLabel(label, { exact: true }).waitFor();
  }
  const account = await (await page.request.get(`${base}/api/page/account`)).json();
  await page.goto(`${base}/@${account.username}`);
  await page.getByLabel('List view', { exact: true }).click();
  const profileLink = page.getByLabel('Open mxmx_test navigation A', { exact: true });
  check(await profileLink.getAttribute('target') !== '_blank', 'profile list opens in this tab');
  await profileLink.click();
  check(await seen(heading('Artifact A'), 20_000), 'the profile link opens the document');
  check(page.context().pages().length === pageCount, 'profile click opens no tab');
  await page.goBack();
  await page.getByLabel('Open mxmx_test navigation A', { exact: true }).waitFor();
  await page.request.delete(`${base}/api/my/artifacts/${folder.id}`);
} finally {
  await browser.close();
  for (const id of [first.id, second.id]) await fetch(`${base}/api/artifacts/${id}`, { method: 'DELETE', headers: auth });
}
check.done();
