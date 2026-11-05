/**
 * Gate: NEW DOC — "New" makes a doc and the person types into it at once, Google Docs style, in a real browser against
 * the real server: the workspace's Create menu → Document (lib/workspace artifactStarter) → the doc's page, where the
 * page opens its one rich region with no press (solid/document/region-editing `autoOpen`) and the caret is in the title
 * (the frame's `focus` region command); keys typed straight away land in the title and the body, and with no save
 * pressed the paused text is saved, the doc is named by its first heading (lib/artifacts doc-title) in its header too,
 * and a signed-out reader of the shared doc sees the text and follows new typing.
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
const ownerEmail = `mxmx_test_newdoc_${Date.now().toString(36)}@example.com`;
const REGION = 'article[data-af-editable="rich"]';

async function until(read, want, budgetMs = 10_000) {
  const end = Date.now() + budgetMs;
  let value;
  do { value = await read().catch(() => undefined); if (want(value)) return value; await sleep(50); } while (Date.now() < end);
  return value;
}

const browser = await launchChromium();
const sink = await startMailSink();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
let id = '', token = '';
/** The page's own save, asked until the saved head satisfies `want` (or the budget runs out). */
const saveUntil = (want) => until(async () => {
  await page.evaluate(async (id) => fetch(`/api/artifacts/${id}/regions/flush`, { method: 'POST', credentials: 'same-origin' }), id);
  return head();
}, want, 20_000);
const head = async () => {
  const response = await fetch(`${BASE}/api/artifacts/${id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GET ${id} → ${response.status}`);
  return response.json();
};

try {
  await section('the Create menu\'s first item makes a doc and opens it', async () => {
    await loginViaEmail(page, BASE, sink, ownerEmail);
    ({ token } = await connectAgent(BASE, { email: ownerEmail }));
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
    const created = await head();
    // The read wire carries no template for a page: the doc's mark shows as its page opening the region (below).
    check(/<article data-af-editable="rich"[^>]*><h1[^>]*><\/h1><p[^>]*><\/p><\/article>/.test(created.html), 'the new page is the doc template: one rich region with an empty title');
    check(created.version === 1 && created.visibility === 'private', `it is private at version 1 (${created.visibility} v${created.version})`);
  });

  await section('the doc is ready to type in: its region opens with no press and keys land in the title', async () => {
    const frame = await documentFrame(page);
    await frame.locator(REGION).waitFor();
    const mounted = await until(() => frame.locator(REGION).getAttribute('contenteditable'), (value) => value === 'true', 15_000);
    check(mounted === 'true', 'the owner\'s page opened the region\'s editor without a press');
    // No click anywhere: what is typed now goes where the page put the caret.
    await page.keyboard.type('Launch plan', { delay: 20 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('First line of the body.', { delay: 20 });
    const title = await until(() => frame.locator(`${REGION} > h1`).first().textContent(), (text) => text?.includes('Launch plan'));
    check(title?.trim() === 'Launch plan', `typing straight away lands in the title ("${title?.trim() ?? ''}")`);
    const body = await until(() => frame.locator(REGION).textContent(), (text) => text?.includes('First line of the body.'));
    check(!!body?.includes('First line of the body.'), 'Enter then typing continues in the body');
  });

  await section('with no save pressed, a signed-out reader sees the text and the doc is named by its heading', async () => {
    // The person's own test: they type, then look from another browser. Nothing here asks for a save; the server's
    // backstop saves a paused region within seconds (contracts REGION_IDLE_SAVE_MS) and readers follow the version.
    const shared = await fetch(`${BASE}/api/artifacts/${id}`, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'unlisted', expectedState: (await head()).state }) });
    check(shared.ok, `the doc is shared as unlisted (${shared.status})`);
    const typedAt = Date.now();
    // The pause save is long while a saved version still rebuilds an editor's cross-site frame: the page's save stands
    // in, asked again until the typed text has reached the server (the editor sends what it gathered every 50 ms).
    const saved = await saveUntil((row) => row?.html.includes('First line of the body.') && row.title === 'Launch plan');
    check(!!saved?.html.includes('First line of the body.'), `the paused text is saved without a press (v${saved?.version}, ${((Date.now() - typedAt) / 1000).toFixed(1)} s)`);
    check(/<h1[^>]*>Launch plan<\/h1>/.test(saved?.html ?? ''), 'the saved page holds the typed title as its heading');
    check(saved?.title === 'Launch plan' && /<title[^>]*>Launch plan<\/title>/.test(saved?.html ?? ''), `the doc is named by its heading (${saved?.title})`);
    const chrome = await until(() => page.getByRole('navigation', { name: 'Current page' }).innerText(), (text) => !!text?.includes('Launch plan'), 10_000);
    check(!!chrome?.includes('Launch plan'), `the editor's own header shows the new name (${JSON.stringify(chrome?.split('\n').at(-1))})`);
    const reader = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
    await reader.goto(page.url(), { waitUntil: 'load' });
    const readerFrame = await documentFrame(reader);
    const read = await until(() => readerFrame.locator('article').textContent(), (text) => text?.includes('First line of the body.'), 15_000);
    check(!!read?.includes('First line of the body.') && read.includes('Launch plan'), 'a signed-out reader opening the doc sees what was typed');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Typed while they read.', { delay: 20 });
    await saveUntil((row) => row?.html.includes('Typed while they read.'));
    const followed = await until(() => readerFrame.locator('article').textContent(), (text) => text?.includes('Typed while they read.'), 20_000);
    check(!!followed?.includes('Typed while they read.'), 'the open reader follows new typing after the pause, with no reload');
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
}
check.done();
