/**
 * Gate: what a crawler gets, and the owner's shell.
 *
 * What only a browser (and a raw fetch) can prove:
 *   1. a session-less fetch of /a/<id> — a crawler — gets html carrying the
 *      document's text: it is served the DOCUMENT itself (proxy.ts), not a
 *      shell around an iframe whose content would never be attributed to it
 *   2. the same html carries the unfurl tags (title + og:image)
 *   3. it is the SAME markup for everyone — no user-agent branch
 *   4. a reader with JS DISABLED still reads the document (it is server-rendered)
 *   5. the OWNER's shell: navigation and artifact controls sit on the page,
 *      context lives inside the menu, and the frame shows the real document
 *
 * usage: node scripts/gate-shell-seo.mjs [base]   (default :3040)
 */
import { chromium } from 'playwright';
import { openMenu } from './lib/reveal-chrome.mjs';
import { becomeOwner } from './lib/start-doc.mjs';
import { mintAnon } from './lib/mint-anon.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const failures = [];
const check = (ok, label) => { console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`); if (!ok) failures.push(label); };

const mint = await mintAnon(BASE);
const publish = async (body) => {
  const res = await fetch(`${BASE}/api/artifacts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

const PHRASE = 'Indexable sentence about quarterly revenue';
const doc = await publish({
  markup: [
    '<Helmet><title>Crawlable doc</title><meta name="description" content="A document that indexes." /></Helmet>',
    '<h1 className="text-4xl font-bold">Crawlable heading</h1>',
    `<p className="mt-4 leading-relaxed">${PHRASE}. And a second paragraph for good measure.</p>`,
  ].join('\n'),
});
console.log(`   doc: ${BASE}/a/${doc.id}`);

// 1 + 2. What a crawler fetches: no JS, no browser, no session — the document.
const pageHtml = await (await fetch(`${BASE}/a/${doc.id}`)).text();
check(pageHtml.includes(PHRASE), "what a crawler fetches carries the document's text");
check(pageHtml.includes('Crawlable heading'), 'and its heading');
check(/<title>[^<]*Crawlable doc/.test(pageHtml), 'the page title is the document title');
check(pageHtml.includes(`/a/${doc.id}/export`), 'og:image points at the export card');
check(/property="og:title"|name="og:title"/.test(pageHtml), 'og:title is present');

// 3. Same markup for everyone: a "crawler" user-agent gets byte-identical html.
const asBot = await (await fetch(`${BASE}/a/${doc.id}`, {
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
})).text();
// Compare the MARKUP, not the framework payload: Next stamps a fresh render
// id and dev-only chunks into <script> on every request, which differ between
// any two fetches — including two by the same agent.
//
// Scanned, not regexped, and NOT a sanitizer: this drops script elements from
// two responses so the rest can be compared. A regexp of this shape reads as
// HTML filtering to any auditor (CodeQL flags exactly that: it misses <SCRIPT>
// and nested forms), and a fragile lookalike sitting next to real security
// code is worth more as a scanner that says what it is.
const dropScripts = (h) => {
  const lower = h.toLowerCase();
  let out = '';
  let at = 0;
  for (;;) {
    const open = lower.indexOf('<script', at);
    if (open === -1) return out + h.slice(at);
    out += h.slice(at, open);
    const close = lower.indexOf('</script', open);
    if (close === -1) return out;
    const after = h.indexOf('>', close);
    if (after === -1) return out;
    at = after + 1;
  }
};
const strip = (h) => dropScripts(h).replace(/\s+/g, ' ').trim();
check(strip(asBot) === strip(pageHtml), 'a crawler UA gets the same page — nothing is cloaked');

const browser = await chromium.launch();

// 5. Page-mounted chrome.
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
// The shell (and its frame) belongs to the owner; readers get the document.
await becomeOwner(page, BASE, mint.token);
await page.goto(`${BASE}/a/${doc.id}`);
const frameEl = await page.waitForSelector('iframe[title="artifact"]', { timeout: 20000 });
const before = await frameEl.boundingBox();
// The shell draws no hamburger or controls button of its own now: the framed
// document carries the chrome and asks the page for its panels.
check((await page.locator('[aria-label="Open menu"], [aria-label="Open artifact controls"]').count()) === 0, 'the shell draws no corner buttons of its own');
const docFrame = page.frames().find((f) => f !== page.mainFrame());
check(!!docFrame && (await docFrame.locator('[data-mx-reader-trigger="menu"]').count()) === 1, 'the framed document carries the menu control');
check(!!docFrame && (await docFrame.locator('[data-mx-reader-trigger="controls"]').count()) === 1, 'and the artifact controls');
await openMenu(page);
for (const item of ['Artifacts', 'Account', 'Human Docs', 'Agent docs']) {
  check(await page.isVisible(`[aria-label="${item}"]`), `the menu carries ${item}`);
}
check((await page.locator('nav[aria-label="Menu"] [aria-label="Current page"]').first().textContent())?.includes('Crawlable'), 'the menu names the document');
await page.keyboard.press('Escape');
check(!(await page.isVisible('[aria-label="Artifacts"]').catch(() => false)), 'Escape closes the menu');

/**
 * Clicking away closes it too — and the layer must really cover the document,
 * or a click would fall into the opaque artifact frame instead.
 */
await openMenu(page);
await page.waitForTimeout(300);
const covers = await page.evaluate(() => {
  const el = document.querySelector('[aria-label="Close the menu"]');
  const r = el?.getBoundingClientRect();
  return !!r && r.height > window.innerHeight / 2 && document.elementFromPoint(
    Math.round(window.innerWidth * 0.7), Math.round(window.innerHeight * 0.6)) === el;
});
check(covers, 'the click-away layer actually covers the document');
await page.mouse.click(Math.round(1400 * 0.7), Math.round(900 * 0.6));
await page.waitForTimeout(400);
check(!(await page.isVisible('[aria-label="Artifacts"]').catch(() => false)), 'clicking outside closes the menu');

// The document must not move while the page settles.
await page.waitForTimeout(2500);
const after = await frameEl.boundingBox();
check(before.y === after.y && before.x === after.x, `the document never shifts (${before.x},${before.y} → ${after.x},${after.y})`);
check(after.width >= 1390, `the document is full-bleed (${after.width}px of ${1400})`);

// The frame is the one place the document renders in the shell.
const frame = await frameEl.contentFrame();
check(!(await page.evaluate((phrase) => document.body.innerText.includes(phrase), PHRASE)),
  "the shell's own html carries none of the document's text");
await frame.waitForSelector('h1', { timeout: 20000 });
check((await frame.evaluate('document.body.innerText')).includes(PHRASE), 'the frame shows the real document');

// 4. JS off: the served document is server-rendered, so the text is there.
const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1200, height: 800 } });
const plain = await noJs.newPage();
await plain.goto(`${BASE}/a/${doc.id}`);
const plainText = await plain.evaluate('document.body.innerText');
check(plainText.includes(PHRASE), 'a reader with JS disabled still reads the document');

await browser.close();
if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
console.log('\nall shell + seo checks passed');
