/**
 * Gate: LIVE REGIONS — two people edit one page's `data-af-editable="rich"` region at once, in real browsers, against
 * the real server (lib/region-sessions), the parent's region client (artifact-backend/region-http, region-editing) and
 * the frame's editor (@afbin/regions). Three signed-in accounts: the owner (A), an editor share (B), a viewer share (C).
 *
 *   1. both editors open the page, press into the region and type at once: each sees the other's text and caret;
 *      the viewer reads the editors' live text with no save and never opens a session (no region request, no editor
 *      module);
 *      typing right after the press on a freshly loaded page (before the editor mounts), Enter and Backspace included,
 *      arrives intact; the formatting toolbar shows for editors only, follows the caret and its Bold reaches the peer;
 *      the `/` menu filters, inserts a heading with arrows and Enter (the `/` gone), and Escape leaves the `/`;
 *   2. latency: A types 20 marker characters, each timed from the key to the character in B's frame (p50/p95 logged,
 *      p95 > 1000 ms fails);
 *   3. IME: a composition driven through CDP (Input.imeSetComposition, then Input.insertText) in A's frame: B never
 *      sees the partial composition, and both converge on the committed text;
 *   4. paste: a real Ctrl/Cmd+V of Word-style and Google-Docs-style HTML (put on the system clipboard by a real copy
 *      of exactly that markup) leaves only region HTML on both sides, and after the save;
 *   5. reconnect: B goes offline while both type, comes back, and nothing typed is lost;
 *   6. an owner whole-page PUT at the current expectedVersion while B has unsaved typing keeps both;
 *   6b. an agent's Markdown write of the region (bearer, `PUT /regions/_doc` from the version it read: its read saved
 *      B's typing first) while B types on: one new version holding all of it, merged into both open pages live, without
 *      a reload;
 *   7. a comment B anchors inside the region after typing saves first and anchors to that version;
 *   8. the last editor leaving saves a version (the viewer's open page already showed its text, live).
 *
 * The owner's bearer read (`head`) of a page with unsaved typing saves it first (an agent's checkpoint); the viewer's
 * (`viewerHead`) reads the live text without saving anything, so it is what tells a saved version from live text.
 *
 *   node scripts/gates/gate-live-regions.mjs [base]
 */
import { performance } from 'node:perf_hooks';
import { connectAgent } from './lib/account-connection.mjs';
import { launchChromium } from './lib/browser.mjs';
import { documentFrame } from './lib/page-facts.mjs';
import { createChecker, createSection } from './lib/assert.mjs';
import { sleep } from './lib/sleep.mjs';
import { startMailSink, loginViaEmail } from '../lib/mail-login.mjs';
import { publishAs } from '../lib/start-doc.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('live-regions');
const section = createSection(check);
const started = performance.now();
const stamp = Date.now().toString(36);
const REGION = '[data-af-id="notes"]';
const page = (body) => `<!doctype html><html><head><title>Live regions</title></head><body style="padding:40px;font:18px/1.5 sans-serif;max-width:860px">${body}</body></html>`;
const SOURCE = page('<h1 data-af-id="title">Live regions</h1><article data-af-editable="rich" data-af-id="notes"><p data-af-id="p1">Owner line.</p><p data-af-id="p2">Editor line.</p></article><p data-af-id="tail">Outside the region.</p>');

async function until(read, want, budgetMs = 10_000) {
  const end = Date.now() + budgetMs;
  let value;
  do { value = await read().catch(() => undefined); if (want(value)) return value; await sleep(50); } while (Date.now() < end);
  return value;
}
const textOf = (frame) => frame.locator(REGION).evaluate((node) => node.textContent ?? '');
const both = (frames, ...parts) => Promise.all(frames.map((frame) => until(() => textOf(frame), (text) => parts.every((part) => text?.includes(part)), 15_000)));
/** The caret at the end of a block of the region (a press, then End). */
async function caretAtEnd(frame, page, selector) {
  await frame.locator(selector).click();
  await page.keyboard.press('End');
}
/** Every element inside the region as the editor draws it, as `tag[attr,…]` (the editor's own classes left out). */
const regionShape = (frame) => frame.locator(REGION).evaluate((root) => [...root.querySelectorAll('*')].map((element) => {
  const attrs = [...element.attributes].map((attr) => attr.name).filter((name) => !(name === 'class' && /^ProseMirror-/.test(element.getAttribute('class') ?? '')));
  return `${element.tagName.toLowerCase()}${attrs.length ? `[${attrs.join(',')}]` : ''}`;
}));
/**
 * Region HTML holds only the region schema's elements, and of attributes only ids and links; the editor draws a list
 * item or a quoted block as a flat block with its structure in data attributes (live-regions schema editingAttrs).
 */
const REGION_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'em', 'a', 'br', 'hr']);
const SAVED_ATTRS = new Set(['data-af-id', 'href']);
const EDITING_ATTRS = new Set([...SAVED_ATTRS, 'data-list', 'data-depth', 'data-quote']);
const foreign = (shape, allowed = EDITING_ATTRS) => shape.filter((entry) => {
  const [, tag, attrs = ''] = /^([^[]+)(?:\[(.*)\])?$/.exec(entry);
  return !REGION_TAGS.has(tag) || attrs.split(',').filter(Boolean).some((name) => !allowed.has(name));
});
/** The words of the region that sit inside a mark element (`strong`, `em`). */
const marked = (frame, tag) => frame.locator(REGION).evaluate((root, tag) => [...root.querySelectorAll(tag)].map((element) => element.textContent), tag);
/** The saved region's inner HTML from a page source. */
const savedRegion = (html) => /<article[^>]*data-af-id="notes"[^>]*>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
const savedShape = (inner) => [...inner.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>/g)].map(([, tag, rest]) => {
  const attrs = [...rest.matchAll(/([^\s=/]+)(?:="[^"]*")?/g)].map((match) => match[1]);
  return `${tag.toLowerCase()}${attrs.length ? `[${attrs.join(',')}]` : ''}`;
});

const browser = await launchChromium();
const sink = await startMailSink();
const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1100, height: 800 } })));
const [A, B, C] = await Promise.all(contexts.map((context) => context.newPage()));
const ownerEmail = `mxmx_test_regions_owner_${stamp}@example.com`;
const editorEmail = `mxmx_test_regions_editor_${stamp}@example.com`;
const viewerEmail = `mxmx_test_regions_viewer_${stamp}@example.com`;
/** Region traffic per page: what the viewer must never send, and what the IME leg counts. */
const traffic = new Map([[A, []], [B, []], [C, []]]);
for (const [p, log] of traffic) p.on('request', (request) => { const url = request.url(); if (url.includes('/regions')) log.push({ at: performance.now(), method: request.method(), url }); });
const updatesFrom = (p, since) => traffic.get(p).filter((entry) => entry.at >= since && entry.method === 'POST' && entry.url.endsWith('/updates')).length;

let id = '', token = '', frames = {};
const api = async (path, init = {}) => {
  const response = await fetch(`${BASE}/api/artifacts/${id}${path}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers } });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  return response.json();
};
const head = () => api('');
let viewerToken = '';
const viewerHead = async () => {
  const response = await fetch(`${BASE}/api/artifacts/${id}`, { headers: { authorization: `Bearer ${viewerToken}` } });
  if (!response.ok) throw new Error(`viewer GET → ${response.status} ${await response.text()}`);
  return response.json();
};

try {
  await section('setup: an owner, an editor share and a viewer share on one page', async () => {
    await Promise.all([loginViaEmail(A, BASE, sink, ownerEmail), loginViaEmail(B, BASE, sink, editorEmail), loginViaEmail(C, BASE, sink, viewerEmail)]);
    ({ token } = await connectAgent(BASE, { email: ownerEmail }));
    ({ token: viewerToken } = await connectAgent(BASE, { email: viewerEmail }));
    ({ id } = await publishAs(A, { title: 'Live regions', html: SOURCE, visibility: 'private' }));
    const shared = await A.evaluate(async ({ id, shares }) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares }) })).status,
      { id, shares: [{ email: editorEmail, role: 'editor' }, { email: viewerEmail, role: 'viewer' }] });
    if (shared !== 200) throw new Error(`sharing answered ${shared}`);
    await Promise.all([A, B, C].map((p) => p.goto(`${BASE}/a/${id}`, { waitUntil: 'load' })));
    const [a, b, c] = await Promise.all([A, B, C].map((p) => documentFrame(p)));
    frames = { a, b, c };
    await Promise.all([a, b, c].map((frame) => frame.locator(REGION).waitFor()));
  });
  // B's frame is reloaded below (a fresh page, its editor not mounted yet).
  let { a, b, c } = frames;

  await section('two editors type into the region at once', async () => {
    check(await until(() => a.locator(REGION).getAttribute('tabindex'), (value) => value === '0') === '0', 'the owner\'s frame is told the region is editable');
    check(await until(() => b.locator(REGION).getAttribute('tabindex'), (value) => value === '0') === '0', 'the editor\'s frame is told the region is editable');
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    check(await until(() => a.locator(REGION).getAttribute('contenteditable'), (value) => value === 'true') === 'true', 'the owner\'s press mounts the editor on the region');
    check(await until(() => b.locator(REGION).getAttribute('contenteditable'), (value) => value === 'true') === 'true', 'the editor\'s press mounts the editor on the region');
    await Promise.all([A.keyboard.type(' alpha from the owner', { delay: 25 }), B.keyboard.type(' bravo from the editor', { delay: 25 })]);
    const [atA, atB] = await both([a, b], 'Owner line. alpha from the owner', 'Editor line. bravo from the editor');
    check(atA?.includes('alpha from the owner') && atA?.includes('bravo from the editor'), `the owner sees both people's typing (${JSON.stringify(atA)})`);
    check(atB === atA, `the editor's region converges on the same text (${JSON.stringify(atB)})`);
    check(await until(() => b.locator('[data-af-region-caret]').count(), (n) => n > 0) > 0, 'the editor sees the owner\'s caret in the region');
    check(await until(() => a.locator('[data-af-region-caret]').count(), (n) => n > 0) > 0, 'the owner sees the editor\'s caret in the region');
  });

  await section('keys typed right after the press, before the editor mounts, all arrive', async () => {
    await B.reload({ waitUntil: 'load' });
    b = await documentFrame(B);
    await b.locator(REGION).waitFor();
    check(await until(() => b.locator(REGION).getAttribute('tabindex'), (value) => value === '0') === '0', 'the reloaded frame is told the region is editable');
    // No wait for the editor: the keys go at once (the press lands at the end of the line, the right of its box).
    const box = await b.locator('[data-af-id="p2"]').boundingBox();
    await b.locator('[data-af-id="p2"]').click({ position: { x: box.width - 4, y: box.height / 2 } });
    const mountedAtFirstKey = await b.locator(REGION).getAttribute('contenteditable');
    await B.keyboard.type(' fastX');
    await B.keyboard.press('Backspace');
    await B.keyboard.type('Y');
    await B.keyboard.press('Enter');
    await B.keyboard.type('next-line');
    check.note(`the editor was ${mountedAtFirstKey === 'true' ? 'already' : 'not yet'} mounted at the first key`);
    const [atB, atA] = await both([b, a], 'fastYnext-line');
    check(atB?.includes('bravo from the editor fastYnext-line') && !atB.includes('fastX'), `every key arrived, in order, Backspace and Enter included (${JSON.stringify(atB?.slice(-48))})`);
    check(await b.locator(REGION).evaluate((root) => [...root.children].some((child) => child.textContent === 'next-line')), 'Enter made a new block');
    check(atA === atB, 'the owner converges on the same text');
    check(await b.locator('textarea[data-af="region-keys"]').count() === 0, 'nothing of the key buffer is left in the page');
  });

  await section('the formatting toolbar follows the caret and its commands reach the peer', async () => {
    const toolbar = A.getByRole('toolbar', { name: 'Formatting' });
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await toolbar.waitFor({ timeout: 10_000 });
    check(await toolbar.isVisible(), 'an editor with a region editor sees the toolbar');
    check(await C.getByRole('toolbar', { name: 'Formatting' }).count() === 0, 'the viewer has no toolbar');
    const bold = toolbar.getByRole('button', { name: 'Bold', exact: true });
    check(await bold.getAttribute('aria-pressed') === 'false', 'Bold is not pressed in plain text');
    // A command crosses to the frame in a message: the toolbar says when it took (the caret's stored mark), then keys go.
    await bold.click();
    check(await until(() => bold.getAttribute('aria-pressed'), (value) => value === 'true') === 'true', 'Bold shows pressed as soon as it is on, before anything is typed');
    await A.keyboard.type(' toolbold');
    await bold.click();
    check(await until(() => bold.getAttribute('aria-pressed'), (value) => value === 'false') === 'false', 'Bold shows unpressed once it is off');
    await A.keyboard.type(' plainafter');
    await both([b], 'toolbold plainafter');
    const strong = await marked(b, 'strong');
    check(strong.some((text) => text.includes('toolbold')) && !strong.some((text) => text.includes('plainafter')), `the bold made with the toolbar reaches the peer, and only it (${JSON.stringify(strong)})`);
  });

  await section('the slash menu inserts a block, and Escape leaves the `/`', async () => {
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await A.keyboard.press('Enter');
    await A.keyboard.type('/');
    const filter = A.getByRole('combobox', { name: 'Filter blocks' });
    await filter.waitFor({ timeout: 10_000 });
    check(await filter.evaluate((node) => node.getRootNode().activeElement === node), 'the menu opens with its filter focused');
    await A.keyboard.type('head');
    const options = await A.getByRole('dialog', { name: 'Insert block' }).getByRole('option').allTextContents();
    check(JSON.stringify(options) === JSON.stringify(['Heading 1', 'Heading 2', 'Heading 3']), `typing filters it (${JSON.stringify(options)})`);
    await A.keyboard.press('ArrowDown');
    await A.keyboard.press('Enter');
    check(await until(() => filter.count(), (n) => n === 0) === 0, 'choosing closes the menu');
    await A.keyboard.type('Slash heading');
    const heading = await until(() => b.locator(`${REGION} h2`).allTextContents(), (texts) => texts?.includes('Slash heading'), 10_000);
    check(heading?.includes('Slash heading'), `the chosen block is a heading at the peer, without the \`/\` (${JSON.stringify(heading)})`);
    await A.keyboard.press('Enter');
    await A.keyboard.type('/');
    await filter.waitFor({ timeout: 10_000 });
    await A.keyboard.press('Escape');
    check(await until(() => filter.count(), (n) => n === 0) === 0, 'Escape closes the menu');
    await A.keyboard.type('kept');
    check((await both([a, b], '/kept'))[1]?.includes('/kept'), 'Escape left the `/`, and typing went on after it in the text');
    for (let i = 0; i < '/kept'.length; i++) await A.keyboard.press('Backspace');
    const cleared = await Promise.all([a, b].map((frame) => until(() => textOf(frame), (text) => text !== undefined && !text.includes('/kept'), 15_000)));
    check(cleared.every((text) => text !== undefined && !text.includes('/kept')), 'Backspace took the `/kept` back out on both editors');
  });

  await section('the viewer reads the live text with no save, and never opens a session', async () => {
    // The viewer follows live text one refetch at a time, so it can trail the editors' last keys (the Backspaces
    // above): what it must reach is the editors' settled text, not just words that were there before those keys.
    const settled = await textOf(a);
    const text = await until(() => textOf(c), (value) => value === settled, 15_000);
    check(text === settled && settled.includes('alpha from the owner') && settled.includes('bravo from the editor') && settled.includes('Slash heading') && settled.includes('fastYnext-line'), `the viewer's open page follows the editors' typing to their settled text (${JSON.stringify(text?.slice(0, 80))}…)`);
    const read = await viewerHead();
    check(read.version === 1 && read.html.includes('alpha from the owner'), `no version was made: the viewer reads the live text at version ${read.version}`);
    // A viewer is never told a region is editable, so its press asks for nothing: no key buffer is put in, no request
    // goes (the last leg checks the viewer's region traffic) and its keys reach no editor. All of it happens at the
    // press and the keys themselves, and nothing the editors typed is still on its way, so it is read at once.
    await c.locator('[data-af-id="p1"]').click();
    await C.keyboard.type('viewer keys');
    check(await c.locator('textarea[data-af="region-keys"]').count() === 0, 'a viewer\'s press holds no keys for an editor');
    check(await c.locator(REGION).getAttribute('contenteditable') === null && await c.locator(REGION).getAttribute('tabindex') === null, 'a viewer\'s press mounts no editor');
    const after = await textOf(c);
    check(after === text && !after.includes('viewer keys'), `a viewer's keys change nothing (${JSON.stringify(after.slice(-48))})`);
  });

  await section('latency: 20 characters from A\'s key to B\'s frame', async () => {
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await A.keyboard.type(' [');
    await both([b], ' [');
    const markers = 'qwertyuiopasdfghjklz';
    const samples = [];
    for (let i = 0; i < markers.length; i++) {
      const want = `[${markers.slice(0, i + 1)}`;
      const t0 = performance.now();
      await A.keyboard.type(markers[i]);
      await b.waitForFunction(({ selector, want }) => document.querySelector(selector)?.textContent?.includes(want), { selector: REGION, want }, { polling: 'raf', timeout: 10_000 });
      samples.push(performance.now() - t0);
    }
    const sorted = [...samples].sort((x, y) => x - y);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    check.note(`latency over ${samples.length} keys: p50 ${at(0.5).toFixed(0)} ms, p95 ${at(0.95).toFixed(0)} ms, max ${sorted.at(-1).toFixed(0)} ms`);
    check(at(0.95) <= 1000, `key-to-peer latency p95 ${at(0.95).toFixed(0)} ms is within 1000 ms`);
  });

  await section('IME: a composition never reaches the peer half-done', async () => {
    await caretAtEnd(a, A, '[data-af-id="p2"]');
    await A.keyboard.type(' ime:');
    await both([b], ' ime:');
    // Everything B's region ever shows from here on.
    await b.locator(REGION).evaluate((root) => {
      const seen = window.__regionTexts = [root.textContent];
      new MutationObserver(() => seen.push(root.textContent)).observe(root, { subtree: true, childList: true, characterData: true });
    });
    let cdp, method;
    try { cdp = await A.context().newCDPSession(a); method = 'CDP session on the frame target'; }
    catch (error) {
      check.note(`no separate CDP target for the document frame (${String(error.message).split('\n')[0]}); its input goes through the page target`);
      cdp = await A.context().newCDPSession(A); method = 'CDP session on the page target (the frame is in-process)';
    }
    check.note(`IME driven through: ${method}`);
    const since = performance.now();
    await cdp.send('Input.imeSetComposition', { text: 'かn', selectionStart: 2, selectionEnd: 2 });
    await cdp.send('Input.imeSetComposition', { text: 'かな', selectionStart: 2, selectionEnd: 2 });
    const composing = await until(() => textOf(a), (text) => text?.includes('かな'), 3000);
    check(composing?.includes('かな'), 'the composition shows in A\'s region while it is open');
    await sleep(600);
    check(updatesFrom(A, since) === 0, `no update leaves A while the composition is open (${updatesFrom(A, since)} sent)`);
    await cdp.send('Input.insertText', { text: '仮名' });
    const [atA, atB] = await both([a, b], 'ime:仮名');
    check(atB === atA && !atA.includes('かな'), `both converge on the committed text (${JSON.stringify(atB?.slice(-24))})`);
    const seen = await b.evaluate(() => window.__regionTexts);
    check(!seen.some((text) => text.includes('かな') || text.includes('かn')), `B never showed the partial composition (${seen.length} states seen)`);
    check(updatesFrom(A, since) > 0, 'the committed text was sent');
    await cdp.detach();
  });

  await section('paste: Word and Google Docs HTML become region HTML', async () => {
    const WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><style>p.MsoNormal{margin:0}</style></head><body lang=EN-US><!--StartFragment--><p class=MsoNormal style="margin-bottom:0in"><span style=\'font-size:12.0pt;font-family:"Calibri",sans-serif;mso-fareast-font-family:"Times New Roman"\'>Word para with <b>bold</b> and <i>italic</i><o:p></o:p></span></p><div class=WordSection1><p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style=\'font-family:Symbol\'>·</span><span>Word item</span></p></div><!--EndFragment--></body></html>';
    const DOCS = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-0a1b2c3d"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;background-color:transparent;font-weight:700;vertical-align:baseline;">Docs bold</span><span style="font-size:11pt;font-family:Arial;font-weight:400;"> and plain</span></p><ul style="margin-top:0;margin-bottom:0;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;"><p dir="ltr" role="presentation" style="line-height:1.38;"><span style="font-size:11pt;">Docs item</span></p></li></ul><div><span style="font-size:11pt;">Docs div</span></div></b>';
    const clip = await contexts[0].newPage();
    try {
      for (const [name, html, words, bold, plain] of [['Word', WORD, ['Word para with bold and italic', 'Word item'], 'bold', 'Word para with'], ['Google Docs', DOCS, ['Docs bold and plain', 'Docs item', 'Docs div'], 'Docs bold', 'and plain']]) {
        // A real copy puts exactly this markup on the system clipboard; a real paste takes it into A's region.
        await clip.setContent(`<button id="copy">copy</button>`);
        await clip.evaluate(({ html, plain }) => document.addEventListener('copy', (event) => { event.clipboardData.setData('text/html', html); event.clipboardData.setData('text/plain', plain); event.preventDefault(); }), { html, plain: words.join('\n') });
        await clip.bringToFront();
        await clip.locator('#copy').focus();
        await clip.keyboard.press('ControlOrMeta+C');
        await A.bringToFront();
        await caretAtEnd(a, A, '[data-af-id="p1"]');
        await A.keyboard.press('Enter');
        await A.keyboard.press('ControlOrMeta+V');
        const [atA] = await both([a, b], ...words);
        check(words.every((word) => atA?.includes(word)), `${name}: the pasted text reaches both editors`);
        const shapeA = await regionShape(a), shapeB = await regionShape(b);
        check(foreign(shapeA).length === 0, `${name}: A's region holds region HTML only (${foreign(shapeA).join(' ') || 'clean'})`);
        check(foreign(shapeB).length === 0, `${name}: B's region holds region HTML only (${foreign(shapeB).join(' ') || 'clean'})`);
        const strong = await marked(b, 'strong');
        check(strong.some((text) => text.includes(bold)) && !strong.some((text) => text.includes(plain)), `${name}: its bold stays bold and nothing else turns bold (${JSON.stringify(strong)})`);
      }
    } finally { await clip.close(); }
  });

  await section('reconnect: B offline while both type, then back', async () => {
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    await contexts[1].setOffline(true);
    await Promise.all([A.keyboard.type(' online-A', { delay: 20 }), B.keyboard.type(' offline-B', { delay: 20 })]);
    await sleep(1500);
    check(!(await textOf(a)).includes('offline-B'), 'what B types offline has not reached A');
    await contexts[1].setOffline(false);
    const [atA, atB] = await both([a, b], 'online-A', 'offline-B');
    check(atA?.includes('online-A') && atA?.includes('offline-B') && atA === atB, `both converge with nothing lost after B reconnects (${JSON.stringify(atB?.slice(0, 80))}…)`);
  });

  await section('an owner PUT at the current version while B has unsaved typing keeps both', async () => {
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    await B.keyboard.type(' unsaved-by-B');
    await both([a, b], 'unsaved-by-B');
    const current = await head();
    const html = current.html.replace('Outside the region.', 'Outside, rewritten by the owner.').replace(/(<article[^>]*data-af-id="notes"[^>]*>)/, '$1<p>Owner PUT line.</p>');
    if (html === current.html) throw new Error('the owner\'s edit did not apply to the saved source');
    const put = await api('', { method: 'PUT', body: JSON.stringify({ html, expectedVersion: current.version, expectedState: current.state }) });
    check(put.version === current.version + 1, `the PUT at the current expectedVersion lands (v${current.version} → v${put.version})`);
    const [atA, atB] = await both([a, b], 'Owner PUT line.', 'unsaved-by-B');
    check(atA === atB && atB?.includes('Owner PUT line.') && atB?.includes('unsaved-by-B'), 'both editors keep the owner\'s line and B\'s unsaved typing');
    check(await until(() => b.locator('[data-af-id="tail"]').textContent(), (text) => text === 'Outside, rewritten by the owner.') === 'Outside, rewritten by the owner.', 'the owner\'s change outside the region reaches the open page');
    const saved = savedRegion((await head()).html);
    check(saved.includes('Owner PUT line.') && saved.includes('unsaved-by-B'), 'the version the PUT made holds both');
  });

  await section('an agent writes the region as Markdown while B has unsaved typing: both open pages merge it live', async () => {
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    await B.keyboard.type(' typing-before-agent');
    await both([a, b], 'typing-before-agent');
    // A reload would drop these: the open pages must take the agent's text as they are.
    await Promise.all([a, b].map((frame) => frame.evaluate(() => { window.__gateAgentMarker = 'kept'; })));
    const read = await api('/regions/_doc?format=markdown');
    check(read.regionId === 'notes' && read.markdown.includes('typing-before-agent'), `the agent reads B's unsaved typing, saved first as the version it reads (v${read.version})`);
    await B.keyboard.type(' typing-after-read');
    await both([a], 'typing-after-read');
    const written = await api('/regions/_doc', { method: 'PUT', headers: { 'Idempotency-Key': `gate-agent-write-${stamp}` }, body: JSON.stringify({ markdown: `${read.markdown}\n\nAgent line from **Markdown**.`, base_version: read.version }) });
    check(written.version === read.version + 1, `the agent's write is saved as one new version (v${read.version} → v${written.version})`);
    check(written.html.includes('Agent line from <strong>Markdown</strong>.') && written.html.split('typing-before-agent').length === 2 && written.html.includes('typing-after-read'), 'the version the agent saved holds its line and all of B\'s typing, none of it twice');
    const [atA, atB] = await both([a, b], 'Agent line from Markdown.', 'typing-before-agent');
    check(atA === atB && atB?.includes('Agent line from Markdown.') && atB?.includes('typing-before-agent'), 'both open editors show the agent\'s line and keep B\'s typing');
    check((await marked(b, 'strong')).includes('Markdown'), 'the agent\'s Markdown bold arrives as bold');
    const kept = await Promise.all([a, b].map((frame) => frame.evaluate(() => window.__gateAgentMarker).catch(() => null)));
    check(kept.every((value) => value === 'kept'), `neither open page reloaded (${JSON.stringify(kept)})`);
  });

  await section('a comment inside the region after typing anchors to the saved version', async () => {
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    await B.keyboard.type(' commentword');
    await both([a], 'commentword');
    const before = await until(viewerHead, (row) => !!row?.html.includes('commentword'));
    check(!!before?.html.includes('commentword'), `the typed word is live, unsaved, at version ${before?.version}`);
    // A real double-click on the word, as a person selects it.
    const word = await b.locator(REGION).evaluate((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent.indexOf('commentword');
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + 'commentword'.length);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      return null;
    });
    const frameBox = await B.locator('iframe[data-mx-document-frame]').boundingBox();
    await B.mouse.dblclick(frameBox.x + word.x, frameBox.y + word.y);
    await b.getByRole('button', { name: 'Comment on selected text', exact: true }).click({ timeout: 15_000 });
    await B.getByLabel('Annotation comment', { exact: true }).fill('About the word just typed');
    await B.getByLabel('Save annotation', { exact: true }).click();
    await B.getByLabel('Annotation composer', { exact: true }).waitFor({ state: 'hidden', timeout: 15_000 });
    const listed = await api('/annotations');
    const mine = (listed.annotations ?? []).find((item) => JSON.stringify(item).includes('About the word just typed'));
    const after = await viewerHead();
    check(!!mine, 'the comment was stored');
    check(after.version > before.version && after.html.includes('commentword'), `commenting saved the region first (v${before.version} → v${after.version})`);
    check(mine?.anchor?.revision === String(after.version) && mine?.anchor?.quote === 'commentword', `the anchor names the saved version and the typed quote (${JSON.stringify(mine?.anchor && { revision: mine.anchor.revision, quote: mine.anchor.quote, nodeId: mine.anchor.nodeId })})`);
  });

  await section('the viewer follows every change; the last editor leaving saves a version', async () => {
    check((await until(() => textOf(c), (text) => text?.includes('commentword'), 15_000))?.includes('commentword'), 'the viewer\'s open page shows the version the comment saved');
    // Presence starts again on the new revision; A's caret has not moved since, and still shows.
    check(await until(() => b.locator('[data-af-region-caret]').count(), (n) => n > 0, 5000) > 0, 'after the save, the editor still sees the owner\'s unmoved caret');
    await caretAtEnd(a, A, '[data-af-id="p1"]');
    await A.keyboard.type(' leaving-A');
    await caretAtEnd(b, B, '[data-af-id="p2"]');
    await B.keyboard.type(' leaving-B');
    await both([a, b], 'leaving-A', 'leaving-B');
    const before = await viewerHead();
    check((await until(() => textOf(c), (text) => text?.includes('leaving-B'), 15_000))?.includes('leaving-B'), 'the viewer\'s open page shows the last typing live, before any save');
    await Promise.all([A.close({ runBeforeUnload: true }), B.close({ runBeforeUnload: true })]);
    const after = await until(viewerHead, (row) => row?.version > before.version && row.html.includes('leaving-A') && row.html.includes('leaving-B'), 20_000);
    check(after?.version > before.version, `the last editor leaving saved a version (v${before.version} → v${after?.version})`);
    const saved = savedRegion(after?.html ?? '');
    check(foreign(savedShape(saved), SAVED_ATTRS).length === 0, `the saved region is region HTML only (${foreign(savedShape(saved), SAVED_ATTRS).join(' ') || 'clean'})`);
    check(['Word item', 'Docs item', 'online-A', 'offline-B', 'ime:仮名', 'Owner PUT line.', 'Agent line from'].every((part) => saved.includes(part)), 'every leg\'s text is in the saved version');
    check(traffic.get(C).length === 0, `the viewer made no region request (${traffic.get(C).map((entry) => entry.url).join(' ') || 'none'})`);
    check(await c.locator(REGION).getAttribute('contenteditable') === null, 'the viewer never had an editor');
  });
} finally {
  check.note(`gate time ${((performance.now() - started) / 1000).toFixed(1)} s`);
  await browser.close();
  await sink.close();
}
check.done();
