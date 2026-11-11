/**
 * Gate: LIVE REGIONS WITH THE PAGE FRAME IN ITS OWN PROCESS — production's shape. Production serves every document from
 * a pages host that is a site of its own, so Chromium's site isolation runs the document frame out of process (its own
 * renderer and its own CDP target). The live-regions gate's pages host (`<hex id>.lvh.me`, the app's own site) keeps the
 * frame in the app page's process, so its IME leg never crosses that boundary. This gate boots a server whose pages host
 * is `localhost` (documents at `<hex id>.localhost`, another site than the app at `app.lvh.me`; Chromium and Node resolve
 * it to loopback themselves), launches Chromium with site isolation as desktop Chrome has it (`--site-per-process`; the
 * headless shell leaves it off), and, with an owner (A) and an editor share (B) on one `data-af-editable="rich-native-v1"` region:
 *
 *   1. the frame really is out of process: a CDP session attaches to the frame itself (Playwright refuses for a frame in
 *      its page's process), and its target is an `iframe` at the document's origin, which the browser lists as a target
 *      of its own beside the app page (Chromium gives a frame its own target only when it renders in another process);
 *   2. both frames are told the region is editable, a press mounts the editor, and typing from both converges;
 *   3. IME through the frame's own target (Input.imeSetComposition, then Input.insertText): the composition shows in A's
 *      region, no update leaves A while it is open, B never shows any part of it, and both converge on the committed text;
 *   4. the last editor leaving saves a version holding the committed text.
 *
 *   node scripts/gates/gate-live-regions-oop.mjs [base]   (boots its own server unless `base` frames pages at localhost)
 */
import { performance } from 'node:perf_hooks';
import { launchChromium } from './lib/browser.mjs';
import { pagesServer } from './lib/pages-server.mjs';
import { documentFrame } from './lib/page-facts.mjs';
import { connectAgent } from './lib/account-connection.mjs';
import { createChecker, createSection } from './lib/assert.mjs';
import { sleep } from './lib/sleep.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { publishAs } from '../lib/start-doc.mjs';

const PAGES_HOST = 'localhost';
const check = createChecker('live-regions-oop');
const section = createSection(check);
const started = performance.now();
const stamp = Date.now().toString(36);
const REGION = '[data-af-id="notes"]';
const EDITOR = `${REGION} > [contenteditable="true"]`;
const SOURCE = '<!doctype html><html><head><title>Live regions out of process</title></head><body style="padding:40px;font:18px/1.5 sans-serif;max-width:860px"><h1 data-af-id="title">Out of process</h1><article data-af-editable="rich-native-v1" data-af-id="notes"><p data-af-id="p1">Owner line.</p><p data-af-id="p2">Editor line.</p></article></body></html>';

async function until(read, want, budgetMs = 10_000) {
  const end = Date.now() + budgetMs;
  let value;
  do { value = await read().catch(() => undefined); if (want(value)) return value; await sleep(50); } while (Date.now() < end);
  return value;
}
const textOf = (frame) => frame.locator(REGION).evaluate((node) => node.textContent ?? '');
const both = (frames, ...parts) => Promise.all(frames.map((frame) => until(() => textOf(frame), (text) => parts.every((part) => text?.includes(part)), 15_000)));
async function caretAtEnd(frame, page, selector) {
  // Splits retain the old identity on the right; find the original text after Enter.
  const block = selector === '[data-af-id="p1"]' ? frame.locator(`${REGION} p`).filter({ hasText: 'Owner line.' }).first()
    : selector === '[data-af-id="p2"]' ? frame.locator(`${REGION} p`).filter({ hasText: 'Editor line.' }).first() : frame.locator(selector);
  await block.click();
  await page.keyboard.press('End');
}
/** The target a CDP session is attached to. */
const targetOf = async (session) => (await session.send('Target.getTargetInfo')).targetInfo;

const server = await pagesServer(process.argv[2], 'live-regions-oop', { pagesHost: PAGES_HOST });
const BASE = server.app;
check.note(`server ${server.booted ? 'booted' : 'driven'} at ${BASE}, documents at ${server.origin('<id>')}`);
// Desktop Chrome isolates every site in its own process; Playwright's headless shell does not unless asked (MEASURED: a
// cross-site frame shares its page's process there without this switch, and an `*.lvh.me` frame stays in process with it).
const browser = await launchChromium({ args: ['--site-per-process'] });
const sink = await startMailSink();
// Fresh contexts: cookies ignore ports, so a session another server set for app.lvh.me must not reach this one.
const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1100, height: 800 } })));
const [A, B] = await Promise.all(contexts.map((context) => context.newPage()));
const ownerEmail = `mxmx_test_regions_oop_owner_${stamp}@example.com`;
const editorEmail = `mxmx_test_regions_oop_editor_${stamp}@example.com`;
const traffic = new Map([[A, []], [B, []]]);
for (const [p, log] of traffic) p.on('request', (request) => { const url = request.url(); if (url.includes('/regions')) log.push({ at: performance.now(), method: request.method(), url }); });
const updatesFrom = (p, since) => traffic.get(p).filter((entry) => entry.at >= since && entry.method === 'POST' && entry.url.endsWith('/updates')).length;

let id = '', token = '';
const head = async () => {
  const response = await fetch(`${BASE}/api/artifacts/${id}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`GET → ${response.status}`);
  return response.json();
};

try {
  let a, b;
  await section('setup: an owner and an editor share on a page served from another site', async () => {
    await Promise.all([loginViaEmail(A, BASE, sink, ownerEmail), loginViaEmail(B, BASE, sink, editorEmail)]);
    ({ token } = await connectAgent(BASE, { email: ownerEmail }));
    ({ id } = await publishAs(A, { title: 'Live regions out of process', html: SOURCE, visibility: 'private' }));
    const shared = await A.evaluate(async ({ id, shares }) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares }) })).status,
      { id, shares: [{ email: editorEmail, role: 'editor' }] });
    if (shared !== 200) throw new Error(`sharing answered ${shared}`);
    await Promise.all([A, B].map((p) => p.goto(`${BASE}/a/${id}`, { waitUntil: 'load' })));
    [a, b] = await Promise.all([A, B].map((p) => documentFrame(p)));
    await Promise.all([a, b].map((frame) => frame.locator(REGION).waitFor()));
    check(a.url().startsWith(server.origin(id)) && new URL(a.url()).hostname.endsWith(`.${PAGES_HOST}`), `the document runs at its own origin on another site (${new URL(a.url()).origin}, app ${new URL(BASE).origin})`);
  });

  let cdp;
  await section('the document frame runs in its own process', async () => {
    try { cdp = await A.context().newCDPSession(a); }
    catch (error) { check(false, `a CDP session attaches to the document frame itself (${String(error.message).split('\n')[0]})`); throw error; }
    check(true, 'a CDP session attaches to the document frame itself (it is not part of the page\'s session)');
    const frameTarget = await targetOf(cdp);
    check(frameTarget.type === 'iframe' && frameTarget.url.startsWith(server.origin(id)), `the frame's target is an iframe at the document origin (${frameTarget.type} ${new URL(frameTarget.url).origin})`);
    const pageSession = await A.context().newCDPSession(A);
    const pageTarget = await targetOf(pageSession);
    await pageSession.detach();
    const browserSession = await browser.newBrowserCDPSession();
    const { targetInfos } = await browserSession.send('Target.getTargets');
    await browserSession.detach();
    const listed = targetInfos.find((target) => target.targetId === frameTarget.targetId);
    check(pageTarget.type === 'page' && listed?.type === 'iframe' && listed.targetId !== pageTarget.targetId, `the browser lists the frame as a target of its own beside the app page (${targetInfos.map((target) => target.type).join(', ')})`);
  });

  await section('both editors type into the region of the out-of-process frame', async () => {
    check(await until(() => a.locator(REGION).getAttribute('tabindex'), (value) => value === '0') === '0', 'the owner\'s frame is told the region is editable');
    check(await until(() => b.locator(REGION).getAttribute('tabindex'), (value) => value === '0') === '0', 'the editor\'s frame is told the region is editable');
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    check(await until(() => a.locator(EDITOR).getAttribute('contenteditable'), (value) => value === 'true') === 'true', 'the owner\'s press mounts the editor');
    check(await until(() => b.locator(EDITOR).getAttribute('contenteditable'), (value) => value === 'true') === 'true', 'the editor\'s press mounts the editor');
    await Promise.all([A.keyboard.type(' alpha', { delay: 25 }), B.keyboard.type(' bravo', { delay: 25 })]);
    const [atA, atB] = await both([a, b], 'Owner line. alpha', 'Editor line. bravo');
    check(atA?.includes('Owner line. alpha') && atA?.includes('Editor line. bravo') && atB === atA, `both converge (${JSON.stringify(atB)})`);
  });

  await section('IME through the frame\'s own target: a composition never reaches the peer half-done', async () => {
    await caretAtEnd(a, A, '[data-af-id="p2"]');
    await A.keyboard.type(' ime:');
    await both([b], ' ime:');
    await b.locator(REGION).evaluate((root) => {
      const seen = window.__regionTexts = [root.textContent];
      new MutationObserver(() => seen.push(root.textContent)).observe(root, { subtree: true, childList: true, characterData: true });
    });
    const since = performance.now();
    await cdp.send('Input.imeSetComposition', { text: 'かn', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
    const composing = await until(() => textOf(a), (text) => text?.includes('かな'), 3000);
    check(composing?.includes('かな'), `the composition shows in A's region while it is open (${JSON.stringify(composing?.slice(-16))})`);
    await sleep(600);
    check(updatesFrom(A, since) === 0, `no update leaves A while the composition is open (${updatesFrom(A, since)} sent)`);
    await cdp.send('Input.insertText', { text: '仮名' });
    const [atA, atB] = await both([a, b], 'ime:仮名');
    check(atA?.includes('ime:仮名') && atB === atA && !atA.includes('かな'), `both converge on the committed text (${JSON.stringify(atB?.slice(-24))})`);
    const seen = await b.evaluate(() => window.__regionTexts);
    check(!seen.some((text) => text.includes('かな') || text.includes('かn')), `B never showed the partial composition (${seen.length} states seen)`);
    check(updatesFrom(A, since) > 0, 'the committed text was sent');
    await cdp.detach();
  });

  await section('the last editor leaving saves the committed text', async () => {
    // The committed text is live, not saved (a version is cut after two quiet minutes, contracts REGION_IDLE_SAVE_MS);
    // the leave saves it. (Over plain http a cross-site frame's own cookie is not sent, so live text cannot be drawn into
    // the frame, and is skipped there, while a saved version reloads this page: what survives a save under an editor is
    // checked on the same-site gates and on https deployments.)
    const before = await head();
    await Promise.all([A.close({ runBeforeUnload: true }), B.close({ runBeforeUnload: true })]);
    const after = await until(head, (row) => row?.html.includes('ime:仮名'), 20_000);
    check(after?.version >= before.version && after.html.includes('alpha') && after.html.includes('bravo') && after.html.includes('ime:仮名'), `every typed part is saved (v${before.version} → v${after?.version})`);
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
  server.stop();
}
check.done();
