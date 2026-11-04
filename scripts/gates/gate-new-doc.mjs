/**
 * Gate: NEW DOC — "New" makes a doc and the person types into it at once, Google Docs style, in a real browser against
 * the real server: the workspace's Create menu → Document (lib/workspace artifactStarter) → the doc's page, where the
 * page opens its one rich region with no press (solid/document/region-editing `autoOpen`) and the caret is in the title
 * (the frame's `focus` region command); keys typed straight away land in the title and the body, a save keeps them, and
 * the doc is named by its first heading (lib/artifacts doc-title).
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
    check(created.template === 'doc', `the new artifact is a doc (template ${created.template})`);
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

  await section('a save keeps the text and names the doc by its heading', async () => {
    const before = await head();
    const flushed = await page.evaluate(async (id) => (await fetch(`/api/artifacts/${id}/regions/flush`, { method: 'POST', credentials: 'same-origin' })).status, id);
    check(flushed === 200, `the page's save answered ${flushed}`);
    const saved = await until(head, (row) => row?.version > before.version && row.html.includes('First line of the body.'), 15_000);
    check(saved?.version > before.version, `the save made a version (v${before.version} → v${saved?.version})`);
    check(/<h1[^>]*>Launch plan<\/h1>/.test(saved?.html ?? ''), 'the saved page holds the typed title as its heading');
    check(saved?.title === 'Launch plan' && /<title[^>]*>Launch plan<\/title>/.test(saved?.html ?? ''), `the doc is named by its heading (${saved?.title})`);
    check(saved?.template === 'doc', 'it is still a doc after the save');
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
}
check.done();
