/**
 * Gate: EDITING AND COMMENTING A FRAMED DOCUMENT.
 *
 * A document served on its own origin is framed by the app page, which cannot touch its DOM. The editor's
 * document half (ProseMirror over the compiled DOM, lib/story-runtime/island-controller) runs INSIDE the frame,
 * loaded on demand through the door the page behaviour opens before the author's script
 * (lib/story-runtime/frame-bridge); the app half (toolbar, save path, comments) stays on the page and talks to it
 * over postMessage. The document is served on its own origin (APP__PAGES_HOST) and the app page adopts the frame the
 * server drew (solid/document/create-framed-story `framedDocumentFor`), so this gate drives a server that serves pages
 * (./lib/pages-server: its own, or a `--pages-host` dev server it is handed).
 *
 * The owner enters edit mode, types into a paragraph inside the frame, bolds a word from the PAGE's toolbar,
 * undoes it with Mod-Z pressed INSIDE the frame, and leaves: the stored source changed exactly as typed, every
 * node id survived, nothing logged an error. Then a comment is made on a paragraph through the page's layer, and
 * its pin lands on that paragraph inside the frame. The document's own script listens for the bridge's envelopes
 * and forges replies: it hears none, and none of its forgeries writes anything.
 *
 *   usage: node scripts/gates/gate-frame-editor.mjs [base]
 */
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { openArtifactControls } from './lib/reveal-chrome.mjs';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';
import { pagesServer } from './lib/pages-server.mjs';

const check = createChecker('frame-editor');
const pages = await pagesServer(process.argv[2], 'frame-editor');
const BASE = pages.app;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (probe, ok, timeout) => {
  const end = Date.now() + timeout;
  let value = await probe();
  while (!ok(value) && Date.now() < end) { await sleep(150); value = await probe(); }
  return value;
};
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

// The author's script: it listens for every message the frame gets, and forges what a bridge reply looks like.
const AUTHOR = `
  window.__mxHeardEnvelopes = 0;
  window.addEventListener('message', function (e) { if (e.data && e.data.type === 'mx:frame-bridge') window.__mxHeardEnvelopes++; }, true);
  window.addEventListener('message', function (e) { if (e.data && e.data.type === 'mx:frame-bridge') window.__mxHeardEnvelopes++; });
  function forge() {
    var edit = { type: 'mx:flow-edit', nonce: 'guessed', path: '0.1', expected: 'The lede paragraph.', replacement: 'FORGED BY THE SCRIPT' };
    try { window.parent.postMessage({ type: 'mx:frame-bridge', payload: { kind: 'ready', nonce: 'guessed' } }, '*'); } catch (e) {}
    try { window.parent.postMessage({ type: 'mx:frame-bridge', key: 'guessed-guessed-guessed', payload: { kind: 'event', event: edit } }, '*'); } catch (e) {}
    try { window.parent.postMessage({ type: 'mx:frame-bridge', key: 'guessed-guessed-guessed', payload: { kind: 'fetch', call: 1, path: '/api/my/artifacts', method: 'GET', headers: {}, body: null } }, '*'); } catch (e) {}
    try { window.parent.postMessage(edit, '*'); } catch (e) {}
  }
  forge();
  setInterval(forge, 1500);
`;
const markup = `<Helmet><script>{\`${AUTHOR}\`}</script></Helmet>`
  + '<div data-design="tw" className="p-10">'
  + '<h1 id="h" className="text-3xl">Framed editing</h1><p id="lede">The lede paragraph.</p>'
  + '<p id="second">A second paragraph that stays put.</p>'
  + '<p id="third">A third paragraph to comment on.</p>'
  + '<p id="after">A paragraph after.</p></div>';

const api = (id, token, path = '', init = {}) => fetch(`${BASE}/api/artifacts/${id}${path}`, {
  ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
});
const idsOf = (source) => [...source.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const head = async (start) => (await api(start.id, start.token)).json();

const start = await startDocument(BASE);
const put = await api(start.id, start.token, '', { method: 'PUT', body: JSON.stringify({ markup }) });
if (!put.ok) throw new Error(`PUT → ${put.status} ${await put.text()}`);
const before = await head(start);

const SELF = pages.origin(start.id);
const browser = await chromium.launch({ args: pages.browserArgs });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`[console ${message.location()?.url ?? ''}] ${message.text()}`.slice(0, 400)); });
  page.on('pageerror', (error) => errors.push(`[pageerror] ${String(error)}`.slice(0, 400)));
  await becomeOwner(page, BASE, start.token);
  await page.goto(`${BASE}/a/${start.id}`, { waitUntil: 'load' });

  const iframe = page.locator('iframe[data-mx-document-frame]');
  await iframe.waitFor({ timeout: 15000 });
  const frame = () => page.frames().find((f) => f.url().startsWith(SELF));
  await until(() => frame()?.locator('#lede').count() ?? 0, (n) => n === 1, 15000);
  check(!!frame(), `the app page frames the document (${frame()?.url() ?? 'no frame'})`);
  check(await page.locator('[aria-label="Artifact viewport"] #lede').count() === 0, 'and holds no adopted copy of its story');
  check(await frame().evaluate(() => window.origin) === SELF, `the framed document runs on its own origin (${SELF})`);

  // ── ENTER ──
  await openArtifactControls(page);
  await page.click('[aria-label="Edit artifact"]');
  await page.waitForSelector('[aria-label="Exit edit mode"]', { timeout: 20000 });
  const editable = await until(() => frame().evaluate(() => !!document.querySelector('#lede')?.closest('.ProseMirror[contenteditable="true"]')), (v) => v, 20000);
  check(editable, 'edit mode attaches ProseMirror to the compiled DOM inside the frame');

  // ── TYPE inside the frame ──
  const lede = frame().locator('#lede');
  await lede.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Typed in the frame.', { delay: 15 });
  const typed = await until(async () => (await head(start)).markup, (source) => source.includes('The lede paragraph. Typed in the frame.'), 15000);
  check(typed.includes('<p id="lede">The lede paragraph. Typed in the frame.</p>'), 'the typing is saved by the page, in place, with the paragraph\'s id');

  // ── BOLD a word from the page's toolbar ──
  const second = frame().locator('#second');
  await second.click();
  // Select the word "second" inside the frame (a Selection only the document can make).
  await frame().evaluate(() => {
    const text = document.querySelector('#second').firstChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.setEnd(text, 8);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await sleep(300);
  const bold = page.locator('[aria-label="Toggle bold"]').first();
  await bold.waitFor({ timeout: 10000 });
  await bold.click();
  const bolded = await until(() => second.evaluate((el) => el.innerHTML), (html) => /<strong[^>]*>second<\/strong>/.test(html), 8000);
  check(/<strong[^>]*>second<\/strong>/.test(bolded), `the page's toolbar bolds the word selected in the frame (${bolded})`);
  const boldSaved = await until(async () => (await head(start)).markup, (source) => /<p id="second">A <strong[^>]*>second<\/strong> paragraph/.test(source), 15000);
  check(/<p id="second">A <strong[^>]*>second<\/strong> paragraph/.test(boldSaved), 'and the bold is saved');

  // ── UNDO with Mod-Z pressed inside the frame ──
  await second.click({ position: { x: 120, y: 8 } });
  await page.keyboard.press(`${MOD}+z`);
  const undone = await until(() => second.evaluate((el) => el.innerHTML), (html) => !/<strong\b/.test(html), 8000);
  check(!/<strong\b/.test(undone), `Mod-Z inside the frame undoes the bold through the page's history (${undone})`);
  const undoSaved = await until(async () => (await head(start)).markup, (source) => source.includes('<p id="second">A second paragraph that stays put.</p>'), 15000);
  check(undoSaved.includes('<p id="second">A second paragraph that stays put.</p>'), 'and the undo is saved');

  // ── LEAVE ──
  await page.click('[aria-label="Exit edit mode"]');
  const reading = await until(() => frame().evaluate(() => !document.querySelector('.ProseMirror')), (v) => v, 20000);
  check(reading, 'Done returns the frame to reading (no editor left in it)');
  const after = await head(start);
  check(after.version > before.version, `the stored version advanced (v${before.version} → v${after.version})`);
  check(after.markup.includes('<p id="lede">The lede paragraph. Typed in the frame.</p>'), 'the stored source changed as typed');
  // The paragraph, not the word: the forged payload is in the author's script, which is in the source.
  check(/<p id="lede">([^<]*)<\/p>/.exec(after.markup)?.[1] === 'The lede paragraph. Typed in the frame.', 'nothing the author\'s script forged reached the paragraph it aimed at');
  check(JSON.stringify(idsOf(after.markup)) === JSON.stringify(idsOf(before.markup)), `node ids unchanged (${idsOf(after.markup).join(',')})`);
  check(await frame().evaluate(() => document.querySelector('#lede')?.textContent) === 'The lede paragraph. Typed in the frame.', 'the frame reads the saved text in place');
  const heard = await frame().evaluate(() => window.__mxHeardEnvelopes);
  check(heard === 0, `the author's listeners never heard a bridge envelope (heard ${heard})`);

  // ── COMMENT on a paragraph through the page's layer ──
  const third = frame().locator('#third');
  const bubble = frame().locator('[aria-label="Comment on selected text"]');
  const offered = await until(async () => {
    await third.click({ clickCount: 3, timeout: 2000 }).catch(() => {});
    return bubble.isVisible().catch(() => false);
  }, (v) => v === true, 15000);
  check(offered, 'selecting a paragraph inside the frame offers the comment action');
  await bubble.click();
  const composer = page.locator('[aria-label="Annotation comment"]');
  await composer.waitFor({ timeout: 10000 });
  check(true, 'the page opens its composer for the paragraph selected in the frame');
  await composer.fill('Framed comment');
  await page.locator('[aria-label="Save annotation"]').click();
  const tinted = await until(() => third.evaluate((el) => el.hasAttribute('data-mx-annotated')), (v) => v, 10000);
  check(tinted, 'the commented paragraph is marked inside the frame');
  const marker = page.locator('[aria-label^="Open annotation conversation by"]').first();
  await marker.waitFor({ timeout: 10000 });
  const pin = await until(async () => {
    const box = await marker.boundingBox();
    const frameBox = await iframe.boundingBox();
    const rect = await third.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    return box && frameBox ? { pin: box.y, top: frameBox.y + rect.top, bottom: frameBox.y + rect.bottom } : null;
  }, (value) => !!value && value.pin >= value.top - 8 && value.pin <= value.bottom + 8, 8000);
  check(!!pin && pin.pin >= pin.top - 8 && pin.pin <= pin.bottom + 8,
    `the comment's pin lands on the paragraph inside the frame (pin ${pin?.pin?.toFixed(1)}, paragraph ${pin?.top?.toFixed(1)}–${pin?.bottom?.toFixed(1)})`);
  const stored = await (await api(start.id, start.token, '/annotations')).json().catch(() => null);
  const anchored = JSON.stringify(stored ?? {});
  check(anchored.includes('Framed comment') && anchored.includes('third'), 'the stored comment is anchored on that paragraph');

  check(errors.length === 0, `no console errors${errors.length ? `:\n    ${errors.join('\n    ')}` : ''}`);
} finally {
  await browser.close();
  pages.stop();
}
check.done();
