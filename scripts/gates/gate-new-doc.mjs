/**
 * Gate: NEW DOC — "New" makes a doc and the person types into it at once, Google Docs style, in a real browser against
 * the real server: the workspace's Create menu → Document (lib/workspace artifactStarter) → the doc's page, where the
 * page opens its one rich region with no press (solid/document/region-editing `autoOpen`) and the caret is in the title
 * (the frame's `focus` region command).
 *
 * The person's own test of a live doc, with nothing asking for a save (no flush, no pause): the live text IS the
 * document (lib/artifacts current-page), and versions are history.
 *   - the owner types a heading and a body into a new doc shared unlisted;
 *   - a signed-out reader with the doc open sees the text, and the header the heading names it by, within about
 *     three seconds of the typing, and a fresh signed-out visitor is served it;
 *   - the open reader follows further typing live, with no reload;
 *   - the API GET (a second account's token, a reader) returns the live text and title;
 *   - the version count does not grow while the owner types for about twenty seconds.
 *
 *   node scripts/gates/gate-new-doc.mjs [base]
 */
import { performance } from 'node:perf_hooks';
import { connectAgent } from './lib/account-connection.mjs';
import { launchChromium } from './lib/browser.mjs';
import { documentFrame } from './lib/page-facts.mjs';
import { createChecker, createSection } from './lib/assert.mjs';
import { sleep } from './lib/sleep.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('new-doc');
const section = createSection(check);
const started = performance.now();
const stamp = Date.now().toString(36);
const ownerEmail = `mxmx_test_newdoc_${stamp}@example.com`;
const readerEmail = `mxmx_test_newdoc_reader_${stamp}@example.com`;
const REGION = 'article[data-af-editable="rich"]';
/** How soon a reader sees typing: the live ping is throttled to ~300 ms, then the frame re-fetches and draws it. */
const LIVE_BUDGET_MS = 3000;

async function until(read, want, budgetMs = 10_000) {
  const end = Date.now() + budgetMs;
  let value;
  do { value = await read().catch(() => undefined); if (want(value)) return value; await sleep(50); } while (Date.now() < end);
  return value;
}
/** Waits for `want`, and says how long it took (ms) from `since`, or null when it never came. */
async function within(read, want, since, budgetMs) {
  const value = await until(read, want, budgetMs);
  return { value, ms: want(value) ? Date.now() - since : null };
}

const browser = await launchChromium();
const sink = await startMailSink();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
let id = '', token = '', readerToken = '';
const api = async (path, as = token) => {
  const response = await fetch(`${BASE}/api/artifacts/${id}${path}`, { headers: { authorization: `Bearer ${as}` } });
  if (!response.ok) throw new Error(`GET ${id}${path} → ${response.status}`);
  return response.json();
};
/** The doc as a reader's API GET answers it: the live text, at the saved version (a reader's read saves nothing). */
const asReader = () => api('', readerToken);
/** The version history, newest first (listing it saves nothing). */
const versions = async () => (await api('/versions')).versions ?? [];
const readerHeader = (reader) => reader.getByRole('navigation', { name: 'Current page' }).innerText();

try {
  await section('the Create menu\'s first item makes a doc and opens it', async () => {
    await loginViaEmail(page, BASE, sink, ownerEmail);
    ({ token } = await connectAgent(BASE, { email: ownerEmail }));
    ({ token: readerToken } = await connectAgent(BASE, { email: readerEmail }));
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const first = page.getByRole('menu', { name: 'Create menu' }).getByRole('menuitem').first();
    check(await first.getAttribute('aria-label') === 'Document' || (await first.textContent())?.trim() === 'Document', 'the first item of the Create menu is Document');
    await first.click();
    // The doc opens at its canonical address (/@handle/<id>-slug); a fresh account owns exactly this one artifact.
    await page.waitForURL((url) => url.pathname !== '/', { timeout: 15_000 });
    const owned = await page.evaluate(async () => (await (await fetch('/api/my/artifacts', { credentials: 'same-origin' })).json()).artifacts);
    check(owned.length === 1, `the account owns the one new artifact (${owned.length})`);
    id = owned[0].id;
    check(page.url().includes(id), `the page opened the new doc (${new URL(page.url()).pathname})`);
    const created = await api('');
    // The read wire carries no template for a page: the doc's mark shows as its page opening the region (below).
    check(/<article data-af-editable="rich"[^>]*><h1[^>]*><\/h1><p[^>]*><\/p><\/article>/.test(created.html), 'the new page is the doc template: one rich region with an empty title');
    check(created.version === 1 && created.visibility === 'private', `it is private at version 1 (${created.visibility} v${created.version})`);
    // Shared before anything is typed: the person's test is a doc others already have the link to.
    const shared = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'unlisted', expectedState: created.state }) });
    check(shared.ok, `the doc is shared as unlisted (${shared.status})`);
  });

  const reader = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
  let readerFrame;
  let historyBefore = 0;
  await section('a signed-out reader has the doc open; the owner types straight away, keys landing in the title', async () => {
    await reader.goto(page.url(), { waitUntil: 'load' });
    readerFrame = await documentFrame(reader);
    await readerFrame.locator(REGION).waitFor();
    // Markers a reload (of the reader's page, or of its frame) would drop.
    await reader.evaluate(() => { window.__gateReader = 'kept'; });
    await readerFrame.evaluate(() => { window.__gateReader = 'kept'; });
    historyBefore = (await versions()).length;
    const frame = await documentFrame(page);
    await frame.locator(REGION).waitFor();
    const mounted = await until(() => frame.locator(REGION).getAttribute('contenteditable'), (value) => value === 'true', 15_000);
    check(mounted === 'true', 'the owner\'s page opened the region\'s editor without a press');
    // No click anywhere: what is typed now goes where the page put the caret.
    await page.keyboard.type('Launch plan', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('First line of the body.', { delay: 20 });
    const typedAt = Date.now();
    const title = await until(() => frame.locator(`${REGION} > h1`).first().textContent(), (text) => text?.includes('Launch plan'));
    check(title?.trim() === 'Launch plan', `typing straight away lands in the title ("${title?.trim() ?? ''}")`);
    // With no save asked for and no pause, the open reader sees the text and the name.
    const read = await within(() => readerFrame.locator('article').textContent(), (text) => !!text?.includes('First line of the body.') && text.includes('Launch plan'), typedAt, 15_000);
    check(read.ms !== null && read.ms <= LIVE_BUDGET_MS, `the open signed-out reader sees the typed text within ${LIVE_BUDGET_MS / 1000} s (${read.ms === null ? 'never' : `${(read.ms / 1000).toFixed(1)} s`})`);
    const named = await within(() => readerHeader(reader), (text) => !!text?.includes('Launch plan'), typedAt, 15_000);
    check(named.ms !== null && named.ms <= LIVE_BUDGET_MS, `its header names the doc by the typed heading within ${LIVE_BUDGET_MS / 1000} s (${named.ms === null ? 'never' : `${(named.ms / 1000).toFixed(1)} s`})`);
    const chrome = await until(() => page.getByRole('navigation', { name: 'Current page' }).innerText(), (text) => !!text?.includes('Launch plan'), 10_000);
    check(!!chrome?.includes('Launch plan'), `the editor's own header shows the new name (${JSON.stringify(chrome?.split('\n').at(-1))})`);
  });

  await section('a fresh signed-out visitor is served the live text, and the API GET returns it', async () => {
    const visitor = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
    await visitor.goto(page.url(), { waitUntil: 'load' });
    const visitorFrame = await documentFrame(visitor);
    const served = await until(() => visitorFrame.locator('article').textContent(), (text) => !!text?.includes('First line of the body.'), 5000);
    check(!!served?.includes('First line of the body.') && served.includes('Launch plan'), 'a signed-out visitor opening the doc now is served what was typed');
    const header = await until(() => readerHeader(visitor), (text) => !!text?.includes('Launch plan'), 5000);
    check(!!header?.includes('Launch plan'), 'and its header carries the name from the first paint');
    await visitor.close();
    const read = await asReader();
    check(read.html.includes('First line of the body.') && /<h1[^>]*>Launch plan<\/h1>/.test(read.html), 'the API GET (a reader\'s token) returns the live text');
    check(read.title === 'Launch plan' && /<title[^>]*>Launch plan<\/title>/.test(read.html), `and the doc's name from its live heading (${read.title})`);
    check(read.version === 1 && Number.isInteger(read.live) && read.live > 0, `at version 1 with its live revision (v${read.version}, live ${read.live})`);
  });

  await section('the reader follows twenty seconds of typing live, and the version count does not grow', async () => {
    const typingStarted = Date.now();
    let lines = 0;
    while (Date.now() - typingStarted < 20_000) {
      await page.keyboard.press('Enter');
      await page.keyboard.type(`Typed while they read ${++lines}.`, { delay: 15 });
      await sleep(400);
    }
    const lastAt = Date.now();
    const followed = await within(() => readerFrame.locator('article').textContent(), (text) => !!text?.includes(`Typed while they read ${lines}.`), lastAt, 15_000);
    check(followed.ms !== null && followed.ms <= LIVE_BUDGET_MS, `the open reader shows the last of ${lines} lines within ${LIVE_BUDGET_MS / 1000} s (${followed.ms === null ? 'never' : `${(followed.ms / 1000).toFixed(1)} s`})`);
    const kept = [await reader.evaluate(() => window.__gateReader).catch(() => null), await readerFrame.evaluate(() => window.__gateReader).catch(() => null)];
    check(kept.every((value) => value === 'kept'), `the reader's page and frame never reloaded (${JSON.stringify(kept)})`);
    const read = await asReader();
    check(read.version === 1 && read.html.includes(`Typed while they read ${lines}.`), `no version was made by the typing: the reader reads it live at v${read.version}`);
    const history = (await versions()).length;
    check(history === historyBefore, `the version history did not grow while typing for ${((lastAt - typingStarted) / 1000).toFixed(0)} s (${historyBefore} → ${history})`);
    // The owner's own API read is an agent's checkpoint: it saves the live text as a version and returns it.
    const owner = await api('');
    check(owner.html.includes(`Typed while they read ${lines}.`) && owner.version === 2, `the owner's API GET saves the live text first and returns it (v${owner.version})`);
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
}
check.done();
