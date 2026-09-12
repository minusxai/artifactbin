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
 *   5. a real browser mounts that same document TOP-LEVEL (the owner's shell
 *      chrome itself is gate-secure-arch's, gate-reader-chrome's and
 *      gate-mobile's, each of which drives it directly)
 *
 * usage: node scripts/gate-shell-seo.mjs [base]   (default :3040)
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { becomeOwner } from './lib/start-doc.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';

const BASE = process.argv[2] ?? 'http://localhost:3040';
const check = createChecker('shell-seo');

const mint = await connectAgent(BASE);
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

/*
 * 5. THE DOCUMENT REALLY IS THE PAGE, in a browser as well as in the bytes.
 *
 * The owner's SHELL — the menu's items, the click-away layer, Escape, the
 * full-bleed geometry — is driven by gate-secure-arch §2, gate-reader-chrome
 * §11 and gate-mobile §2, each of them against the same chrome; what is left
 * here is the seam this gate is about, one step further than the fetch above:
 * what the crawler read is what a real browser mounts, top-level.
 */
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
// The shell (and its chrome) belongs to the owner; readers get the document.
await becomeOwner(page, BASE, mint.token);
await page.goto(`${BASE}/a/${doc.id}`);
await artifactDocument(page, { timeout: 20000 });

// The frame is the one place the document renders in the shell.
const frame = page.mainFrame();
check(await page.locator('[data-mx-inline-story]').innerText().then(text => text.includes(PHRASE)),
  'the document text is in the actual top-level page');
await frame.waitForSelector('h1', { timeout: 20000 });
check((await frame.evaluate('document.body.innerText')).includes(PHRASE), 'the main document shows the real content');

// 4. JS off: the served document is server-rendered, so the text is there.
const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1200, height: 800 } });
const plain = await noJs.newPage();
await plain.goto(`${BASE}/a/${doc.id}`);
const plainText = await plain.evaluate('document.body.innerText');
check(plainText.includes(PHRASE), 'a reader with JS disabled still reads the document');

await browser.close();
check.done();
