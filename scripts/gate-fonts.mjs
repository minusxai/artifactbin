/**
 * Gate: a document's own typeface must not arrive after the reader does.
 *
 * The fault this pins: story @font-face rules are injected CLIENT-side into
 * the surface root, so the browser could not discover a font until React had
 * hydrated and mounted the iframe — then downloaded a 1.8 MB TTF over a
 * `max-age=0` URL that had to be revalidated on EVERY view. Measured on
 * production: text painted in Georgia and reflowed into Noto Serif 1.5 s
 * later, and still 0.7 s later on a fully warm cache.
 *
 * Three separate things had to be true to fix it, and each can regress alone,
 * so each is checked alone:
 *   1. the bytes are small (subset woff2, not TTF),
 *   2. the URL is immutable (a warm view spends NO round trip),
 *   3. the head preloads it (discovery at parse time, not after hydration).
 *
 * Check 4 is the one that looks like success while failing: a preload lands in
 * the PARENT document, but the font is used inside a sandboxed srcdoc iframe
 * whose CSP has its own `font-src`. If that ever stops allowing 'self', the
 * parent timeline still shows a perfect fast preload and every document still
 * renders in a fallback face. So the gate asserts the font resolved INSIDE the
 * iframe, not merely that it was fetched.
 *
 *   usage: node scripts/gate-fonts.mjs [base]
 */
import { chromium } from 'playwright';
import { becomeOwner, startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const out = [];
const ok = (c, l) => { out.push(`${c ? '  ok ' : 'FAIL'} ${l}`); return c; };

// A serif theme on purpose: Noto Serif was both the biggest asset (1.8 MB) and
// the most jarring swap, since the fallback is Georgia — a different face
// entirely, not a near-miss weight.
const MARKUP = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-4xl font-bold">Typography holds still</h1>'
  + '<p className="mt-4 text-lg">The body copy a reader starts reading immediately.</p>'
  + '<table className="mt-4"><tbody><tr><td>1,234.50</td></tr><tr><td>9,876.10</td></tr></tbody></table>'
  + '</div>';

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });

// ── a themed document, published over the API ──────────────────────────────
// The token comes from the start LINK (lib/agent-session): /api/start hands the
// browser an httpOnly cookie, never a secret. startDocument throws rather than
// walking on — anonymous minting is per-IP rate limited, and a gate that walked
// on measured /a/undefined and reported font problems that did not exist.
const st = await startDocument(B);
await fetch(`${B}/api/artifacts/${st.id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
  body: JSON.stringify({ title: 'Font gate', markup: MARKUP, theme: 'manuscript' }),
});
// The shell — and the frame these checks measure — belongs to the owner;
// anyone else is served the document itself.
await becomeOwner(p, B, st.token);

// ── 1. the asset itself ────────────────────────────────────────────────────
// The preloads live in the DOCUMENT's head (see section 3 for why), so that is
// where they are read from.
const html = await (await fetch(`${B}/a/${st.id}/raw`)).text();
const preloadTags = [...html.matchAll(/<link[^>]+rel="preload"[^>]*>/g)].map((m) => m[0])
  .filter((t) => t.includes('as="font"'));
ok(preloadTags.length > 0, `the served document preloads the font (${preloadTags.length} link)`);
ok(preloadTags.length <= 2, 'and preloads only the display/body faces, not the whole registry');
ok(preloadTags.every((t) => t.includes('crossorigin')), 'each preload is crossorigin (or the font downloads twice)');
ok(preloadTags.every((t) => /href="\/fonts\/[^"]+\.woff2"/.test(t)), 'each preload points at a woff2');

// Fall back to the surface's own @font-face when there is no preload at all,
// so a missing preload reports as the one failure it is rather than taking
// every later check down with it.
const fontUrl = /href="(\/fonts\/[^"]+)"/.exec(preloadTags[0] ?? '')?.[1]
  ?? /url\(\\?"(\/fonts\/[^"\\]+)/.exec(html)?.[1];
if (!fontUrl) {
  ok(false, 'no /fonts/ URL anywhere in the document — cannot check delivery');
} else {
  const asset = await fetch(`${B}${fontUrl}`);
  const bytes = (await asset.arrayBuffer()).byteLength;
  const cc = asset.headers.get('cache-control') ?? '';
  ok(asset.status === 200, `the font serves (${fontUrl})`);
  ok(bytes < 300 * 1024, `and is small — ${Math.round(bytes / 1024)} KB (a full TTF was 1842 KB)`);
  ok(cc.includes('immutable'), `and is immutable, so a warm view revalidates nothing (${cc})`);
  ok(/max-age=\d{7,}/.test(cc), 'with a long max-age');
}

// ── 2. no TTF is reachable any more ────────────────────────────────────────
const ttf = await fetch(`${B}/fonts/NotoSerif-Regular.ttf`);
ok(ttf.status === 404, `the unhashed TTF is gone (${ttf.status})`);

/**
 * ── 3. the DOCUMENT preloads its own faces ────────────────────────────────
 *
 * The parent page used to preload for a same-origin srcdoc frame that shared
 * its HTTP cache. The served document has an OPAQUE origin now (sandbox, no
 * allow-same-origin), so it has its own cache partition and a parent preload
 * would warm an entry nothing inside can use. The preload therefore lives in
 * the document's own head — which is also where the @font-face is.
 */
const docHead = html.slice(0, html.indexOf('</head>'));
ok(docHead.includes('rel="preload"'), "the preload is in the DOCUMENT's own head, not the app page's");
ok(docHead.indexOf('rel="preload"') < docHead.indexOf('@font-face'), 'and it comes before the @font-face that uses it');

// ── 4. the font actually resolves INSIDE the document frame ────────────────
const reqs = [];
p.on('request', (r) => { if (r.url().includes('/fonts/')) reqs.push(r.url()); });
await p.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
const frameEl = await p.waitForSelector('iframe[title="artifact"]', { timeout: 20_000 });
const docFrame = await frameEl.contentFrame();
await docFrame.waitForSelector('h1', { timeout: 20_000 });
await p.waitForTimeout(2500);

ok(reqs.length > 0, `the font is actually fetched (${reqs.length} request)`);
ok(reqs.every((u) => u.endsWith('.woff2')), 'and nothing requests a .ttf');
ok(new Set(reqs).size === 2, `and exactly the display and body files are needed (${new Set(reqs).size})`);

const inside = await docFrame.evaluate(async () => {
  await document.fonts.ready;
  const faces = [...document.fonts].filter((x) => x.family === 'Noto Serif');
  const el = document.querySelector('h1');
  const res = performance.getEntriesByType('resource').filter((x) => x.name.includes('/fonts/'));
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    declared: faces.length,
    loaded: faces.filter((x) => x.status === 'loaded').length,
    check: document.fonts.check('16px "Noto Serif"'),
    rendered: el ? getComputedStyle(el).fontFamily : '',
    initiator: res.map((x) => x.initiatorType),
    start: res.length ? Math.round(Math.min(...res.map((x) => x.startTime))) : null,
    domInteractive: Math.round(nav?.domInteractive ?? 0),
  };
});
ok(inside.loaded > 0, `the face LOADS inside the sandboxed document (${inside.loaded}/${inside.declared} — a font-src regression fails here)`);
ok(inside.check === true, 'and the document reports it usable');
ok(/Cormorant Garamond/.test(inside.rendered), `and the heading asks for the display face (${String(inside.rendered).slice(0, 40)})`);
// The whole point of a preload: discovery at PARSE time, not after hydration.
ok(inside.initiator.includes('link'), `the fetch is initiated by a <link>, not by hydration (${inside.initiator.join(',')})`);
ok(inside.start !== null && inside.start <= inside.domInteractive,
  `and starts before the document is even interactive (${inside.start}ms vs ${inside.domInteractive}ms)`);

// ── 5. a WARM load spends no round trip (the immutable win) ────────────────
await p.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
const warmFrame = await (await p.waitForSelector('iframe[title="artifact"]', { timeout: 20_000 })).contentFrame();
await warmFrame.waitForSelector('h1', { timeout: 20_000 });
await p.waitForTimeout(2000);
const warm = await warmFrame.evaluate(() => performance.getEntriesByType('resource')
  .filter((x) => x.name.includes('/fonts/'))
  .map((x) => ({ transfer: x.transferSize, ms: Math.round(x.duration) })));
ok(warm.length > 0, 'the warm view still resolves the font');
ok(warm.every((r) => r.transfer === 0), `served from cache with no bytes on the wire (${warm.map((r) => r.transfer).join(',')})`);
// This is the header fix, measured: it was 466ms of Georgia on production.
ok(warm.every((r) => r.ms < 50), `and with no revalidation round trip (${warm.map((r) => r.ms + 'ms').join(',')})`);

/**
 * ── 6. the reader never sees two typefaces ────────────────────────────────
 *
 * The ORDERING is the property: the font must be ready before the document
 * paints text. Both are measured on the DOCUMENT's own timeline (its
 * navigation is the time origin for both entries), which is the only clock
 * where the comparison means anything.
 */
const FONT_ORDER_PROBE = async () => {
  let textAt = null;
  for (let i = 0; i < 200 && textAt === null; i++) {
    const h = document.querySelector('h1');
    if (h?.firstChild?.nodeType === 3) textAt = performance.now();
    await new Promise((r) => setTimeout(r, 20));
  }
  const font = performance.getEntriesByType('resource').filter((x) => x.name.includes('/fonts/'));
  return {
    textAt: textAt === null ? null : Math.round(textAt),
    fontEnd: font.length ? Math.round(Math.max(...font.map((x) => x.responseEnd))) : null,
  };
};

const cdp = await p.context().newCDPSession(p);
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

/*
 * Retried. The frame is remounted whenever the page learns a new `edit_id`,
 * and against a REMOTE server with the cache disabled the first mount is slow
 * enough that the remount can land inside this measurement — "Execution
 * context was destroyed" is that race, not a fault in the document. Locally
 * the window is too small to hit. Measure again on the new context.
 */
const measure = async () => {
  await p.goto(`${B}/a/${st.id}`, { waitUntil: 'commit' });
  /*
   * Wait for the frame to be AT the document, not merely to exist. React mounts
   * the iframe on `about:blank` and points it at /raw a moment later; binding to
   * the context that early means the real navigation destroys it underneath the
   * probe ("Execution context was destroyed"). Locally those moments are close
   * enough to get away with — against a remote server it failed every time.
   * Verified with a frame-navigation log: the document is still fetched exactly
   * ONCE, so this is the gate's timing, not the page's behaviour.
   */
  const el = await p.waitForSelector('iframe[title="artifact"]', { timeout: 30_000 });
  for (let i = 0; i < 300; i++) {
    const f = await el.contentFrame();
    if (f && f.url().includes('/raw')) return f.evaluate(FONT_ORDER_PROBE);
    await p.waitForTimeout(100);
  }
  throw new Error('the document frame never navigated to /raw');
};
let order = null;
for (let attempt = 0; attempt < 3 && order === null; attempt++) {
  try { order = await measure(); } catch (err) {
    if (attempt === 2) throw err;
    console.log(`  …frame navigated mid-measurement, retrying (${String(err).split('\n')[0]})`);
  }
}

ok(order.textAt !== null, 'the document paints the heading');
ok(order.fontEnd !== null && order.fontEnd < order.textAt,
  `and the font was ready BEFORE it did — font ${order.fontEnd}ms vs text ${order.textAt}ms`);

await p.screenshot({ path: '/tmp/gate-fonts.png' });
await b.close();

console.log(out.join('\n'));
const failed = out.filter((l) => l.startsWith('FAIL')).length;
console.log(failed ? `\n${failed} FAILED` : `\nall ${out.length} checks passed`);
process.exit(failed ? 1 : 0);
