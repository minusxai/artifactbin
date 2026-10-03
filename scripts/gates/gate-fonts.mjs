import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
/**
 * Gate: a document's own typeface must not arrive after the reader does.
 *
 * The fault this pins: story @font-face rules are injected CLIENT-side into
 * the surface root, so the browser could not discover a font until the app had
 * hydrated and mounted the document — then downloaded a 1.8 MB TTF over a
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
 *   usage: node scripts/gates/gate-fonts.mjs [base]
 */
import { launchChromium } from './lib/browser.mjs';
import { tsImport } from 'tsx/esm/api';
import { becomeOwner, startDocument } from '../lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('fonts');

// A serif theme on purpose: Noto Serif was both the biggest asset (1.8 MB) and
// the most jarring swap, since the fallback is Georgia — a different face
// entirely, not a near-miss weight.
const MARKUP = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-4xl font-bold">Typography holds still</h1>'
  + '<p className="mt-4 text-lg">The body copy a reader starts reading immediately.</p>'
  + '<table className="mt-4"><tbody><tr><td>1,234.50</td></tr><tr><td>9,876.10</td></tr></tbody></table>'
  + '</div>';

const b = await launchChromium();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });

// ── a themed document, published over the API ──────────────────────────────
// The token comes from the start LINK (lib/agent-session): /api/start hands the
// browser an httpOnly cookie, never a secret. startDocument throws rather than
// walking on — the start_doc door is per-IP rate limited, and a gate that walked
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
check(preloadTags.length > 0, `the served document preloads the font (${preloadTags.length} link)`);
check(preloadTags.length <= 2, 'and preloads only the display/body faces, not the whole registry');
check(preloadTags.every((t) => t.includes('crossorigin')), 'each preload is crossorigin (or the font downloads twice)');
check(preloadTags.every((t) => /href="\/fonts\/[^"]+\.woff2"/.test(t)), 'each preload points at a woff2');

// Fall back to the surface's own @font-face when there is no preload at all,
// so a missing preload reports as the one failure it is rather than taking
// every later check down with it.
const fontUrl = /href="(\/fonts\/[^"]+)"/.exec(preloadTags[0] ?? '')?.[1]
  ?? /url\(\\?"(\/fonts\/[^"\\]+)/.exec(html)?.[1];
if (!fontUrl) {
  check(false, 'no /fonts/ URL anywhere in the document — cannot check delivery');
} else {
  const asset = await fetch(`${B}${fontUrl}`);
  const bytes = (await asset.arrayBuffer()).byteLength;
  const cc = asset.headers.get('cache-control') ?? '';
  check(asset.status === 200, `the font serves (${fontUrl})`);
  check(bytes < 300 * 1024, `and is small — ${Math.round(bytes / 1024)} KB (a full TTF was 1842 KB)`);
  check(cc.includes('immutable'), `and is immutable, so a warm view revalidates nothing (${cc})`);
  check(/max-age=\d{7,}/.test(cc), 'with a long max-age');
}

/*
 * The DOCUMENT's own faces: every /fonts file its served head names. The app
 * page around it sets its own chrome in the shell's faces, which are /fonts
 * files too (one file per face, shared with any story that uses the family) —
 * those are the shell's to fetch, not this document's, so the counts and
 * orderings below are about these.
 */
const docFontUrls = new Set([...html.matchAll(/\/fonts\/[\w.-]+\.woff2/g)].map((m) => m[0]));
check(docFontUrls.size > 0, `the served document names its own faces (${docFontUrls.size} files)`);
const isDocFont = (url) => docFontUrls.has(new URL(url, B).pathname);

// ── 2. no TTF is reachable any more ────────────────────────────────────────
const ttf = await fetch(`${B}/fonts/NotoSerif-Regular.ttf`);
check(ttf.status === 404, `the unhashed TTF is gone (${ttf.status})`);

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
check(docHead.includes('rel="preload"'), "the preload is in the DOCUMENT's own head, not the app page's");
check(docHead.indexOf('rel="preload"') < docHead.indexOf('@font-face'), 'and it comes before the @font-face that uses it');

// ── 4. the font actually resolves INSIDE the document frame ────────────────
const reqs = [];
p.on('request', (r) => { if (r.url().includes('/fonts/')) reqs.push(r.url()); });
await p.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
const frameEl = await p.waitForSelector('[data-mx-inline-story]', { timeout: 20_000 });
const docFrame = p.mainFrame();
await docFrame.waitForSelector('h1', { timeout: 20_000 });
await p.waitForTimeout(2500);

check(reqs.length > 0, `the font is actually fetched (${reqs.length} request)`);
check(reqs.every((u) => u.endsWith('.woff2')), 'and nothing requests a .ttf');
const docReqs = new Set(reqs.filter(isDocFont));
check(docReqs.size === 2, `and exactly the document's display and body files are needed (${docReqs.size})`);

const inside = await docFrame.evaluate(async (docFonts) => {
  await document.fonts.ready;
  const faces = [...document.fonts].filter((x) => x.family === 'Noto Serif');
  const el = document.querySelector('h1');
  const res = performance.getEntriesByType('resource').filter((x) => docFonts.includes(new URL(x.name).pathname));
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
}, [...docFontUrls]);
check(inside.loaded > 0, `the face LOADS inside the sandboxed document (${inside.loaded}/${inside.declared} — a font-src regression fails here)`);
check(inside.check === true, 'and the document reports it usable');
check(/Cormorant Garamond/.test(inside.rendered), `and the heading asks for the display face (${String(inside.rendered).slice(0, 40)})`);
// The whole point of a preload: discovery at PARSE time, not after hydration.
check(inside.initiator.includes('link'), `the fetch is initiated by a <link>, not by hydration (${inside.initiator.join(',')})`);
check(inside.start !== null && inside.start <= inside.domInteractive,
  `and starts before the document is even interactive (${inside.start}ms vs ${inside.domInteractive}ms)`);

// ── 5. a WARM load spends no round trip (the immutable win) ────────────────
await p.goto(`${B}/a/${st.id}`, { waitUntil: 'load' });
const warmFrame = await artifactDocument(p, { timeout: 20_000 });
await warmFrame.waitForSelector('h1', { timeout: 20_000 });
await p.waitForTimeout(2000);
const warm = await warmFrame.evaluate(() => performance.getEntriesByType('resource')
  .filter((x) => x.name.includes('/fonts/'))
  .map((x) => ({ transfer: x.transferSize, ms: Math.round(x.duration) })));
check(warm.length > 0, 'the warm view still resolves the font');
check(warm.every((r) => r.transfer === 0), `served from cache with no bytes on the wire (${warm.map((r) => r.transfer).join(',')})`);
// This is the header fix, measured: it was 466ms of Georgia on production.
check(warm.every((r) => r.ms < 50), `and with no revalidation round trip (${warm.map((r) => r.ms + 'ms').join(',')})`);

/**
 * ── 6. the reader never sees two typefaces ────────────────────────────────
 *
 * The ORDERING is the property: the font must be ready before the document
 * paints text. Both are measured on the DOCUMENT's own timeline (its
 * navigation is the time origin for both entries), which is the only clock
 * where the comparison means anything.
 */
const FONT_ORDER_PROBE = async (docFonts) => {
  let textAt = null;
  for (let i = 0; i < 200 && textAt === null; i++) {
    const h = document.querySelector('h1');
    if (h?.firstChild?.nodeType === 3) textAt = performance.now();
    await new Promise((r) => setTimeout(r, 20));
  }
  const font = performance.getEntriesByType('resource').filter((x) => docFonts.includes(new URL(x.name).pathname));
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
   * Wait for the frame to be AT the document, not merely to exist. The app mounts
   * the iframe on `about:blank` and points it at /raw a moment later; binding to
   * the context that early means the real navigation destroys it underneath the
   * probe ("Execution context was destroyed"). Locally those moments are close
   * enough to get away with — against a remote server it failed every time.
   * Verified with a frame-navigation log: the document is still fetched exactly
   * ONCE, so this is the gate's timing, not the page's behaviour.
   */
  await p.waitForSelector('[data-mx-inline-story]', { timeout: 30_000 });
  return p.evaluate(FONT_ORDER_PROBE, [...docFontUrls]);
};
let order = null;
for (let attempt = 0; attempt < 3 && order === null; attempt++) {
  try { order = await measure(); } catch (err) {
    if (attempt === 2) throw err;
    console.log(`  …frame navigated mid-measurement, retrying (${String(err).split('\n')[0]})`);
  }
}

check(order.textAt !== null, 'the document paints the heading');
check(order.fontEnd !== null && order.fontEnd < order.textAt,
  `and the font was ready BEFORE it did — font ${order.fontEnd}ms vs text ${order.textAt}ms`);

await p.screenshot({ path: '/tmp/gate-fonts.png' });

/**
 * ── 7. every theme: the head preloads EXACTLY what the first screen paints ──
 *
 * Measured on production before this: an industry document preloaded Inter
 * only, discovered its JetBrains Mono eyebrow from CSS a round trip later, and
 * fetched JetBrains Mono as three files (the story's static 400 and 700 and
 * the shell's variable one); a themeless document preloaded an Inter it never
 * painted. Both directions are checked, on both reader paths, per theme:
 *   - every preloaded file is a face the page actually loaded (a FontFace
 *     whose status is loaded — Chrome's own "preloaded but not used" warning
 *     cannot see this, because an @font-face naming the URL counts as a use);
 *   - every face that paints text in the first viewport was preloaded;
 *   - no font file is fetched twice, and none is a Vite /assets copy.
 */
const { STORY_THEMES } = await tsImport('../../services/app/lib/data/story/story-themes.ts', import.meta.url);
const EVERY_FACE = '<div className="p-10">'
  + '<p className="font-mono text-xs uppercase tracking-widest">Eyebrow · 27 September</p>'
  + '<h1 className="text-4xl font-semibold">Typography holds still</h1>'
  + '<p className="mt-4 text-lg">The body copy a reader starts reading, with <em>emphasis</em> and <strong>strong</strong> words.</p>'
  + '<blockquote>A quoted line.</blockquote>'
  + '<table className="mt-4"><tbody><tr><td>1,234.50</td></tr></tbody></table>'
  + '</div>';

/** In the page: preloads, loaded faces by URL, the faces first-viewport text paints, and every font fetch. */
const FIRST_SCREEN_PROBE = async () => {
  await document.fonts.ready;
  const span = (range) => (range || 'U+0-10FFFF').split(',').map((part) => {
    const t = part.trim().replace(/^u\+/i, '');
    const [lo, hi = lo] = t.includes('?') ? [t.replace(/\?/g, '0'), t.replace(/\?/g, 'F')] : t.split('-');
    return [parseInt(lo, 16), parseInt(hi, 16)];
  });
  const covers = (range, code) => span(range).some(([lo, hi]) => lo <= code && code <= hi);
  const rules = [];
  const collect = (list) => { for (const r of list) { if (r instanceof CSSFontFaceRule) rules.push(r); else if (r.cssRules) collect(r.cssRules); } };
  for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) { try { collect(sheet.cssRules); } catch { /* cross-origin sheet */ } }
  const norm = (family) => family.trim().replace(/^["']|["']$/g, '');
  const faces = rules.map((r) => {
    const [lo, hi = lo] = (r.style.getPropertyValue('font-weight') || '400').trim().split(/\s+/).map(Number);
    const src = /url\(\s*["']?([^"')]+)/.exec(r.style.getPropertyValue('src'))?.[1];
    return { family: norm(r.style.getPropertyValue('font-family')), style: r.style.getPropertyValue('font-style') || 'normal', lo, hi,
      range: r.style.getPropertyValue('unicode-range'), url: src ? new URL(src, location.href).pathname : null };
  }).filter((f) => f.url);
  // A declared face is LOADED when some text used it: match FontFace objects by their descriptors.
  const loaded = new Set();
  for (const ff of document.fonts) {
    if (ff.status !== 'loaded') continue;
    const [lo, hi = lo] = String(ff.weight).split(/\s+/).map(Number);
    for (const f of faces) if (f.family === norm(ff.family) && f.style === ff.style && f.lo === lo && f.hi === hi
      && span(f.range).join() === span(ff.unicodeRange).join()) loaded.add(f.url);
  }
  // First-viewport text → the latin file its first declared family resolves to.
  const painted = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const text = n.textContent.trim();
    const el = n.parentElement;
    if (!text || !el) continue;
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (box.width === 0 || box.bottom < 0 || box.top > innerHeight || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const family = cs.fontFamily.split(',').map(norm).find((f) => faces.some((x) => x.family === f));
    if (!family) continue;
    const code = [...text].find((c) => c.codePointAt(0) > 32)?.codePointAt(0) ?? 65;
    const weight = Number(cs.fontWeight);
    const candidates = faces.filter((f) => f.family === family && covers(f.range, code));
    const italic = cs.fontStyle !== 'normal' && candidates.some((f) => f.style !== 'normal');
    const styled = candidates.filter((f) => (f.style !== 'normal') === italic);
    const inRange = styled.filter((f) => f.lo <= weight && weight <= f.hi);
    const pick = inRange[0] ?? styled.sort((a, b) => Math.abs(a.lo - weight) - Math.abs(b.lo - weight))[0];
    if (pick) painted.add(pick.url);
  }
  const fetched = performance.getEntriesByType('resource').filter((e) => /\.woff2(\?|$)/.test(e.name)).map((e) => new URL(e.name).pathname);
  return {
    preloads: [...document.querySelectorAll('link[rel=preload][as=font]')].map((l) => ({ url: new URL(l.href).pathname, cors: l.crossOrigin })),
    loaded: [...loaded], painted: [...painted], fetched,
  };
};

const short = (u) => u.split('/').pop();
for (const theme of [null, ...STORY_THEMES.map((t) => t.name)]) {
  const doc = await startDocument(B);
  const published = await fetch(`${B}/api/artifacts/${doc.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${doc.token}` },
    body: JSON.stringify({ title: `Font gate ${theme ?? 'themeless'}`, markup: EVERY_FACE, visibility: 'unlisted', ...(theme ? { theme } : {}) }),
  });
  if (!check(published.ok, `${theme ?? 'themeless'}: the fixture publishes (${published.status})`)) continue;
  for (const path of [`/a/${doc.id}`, `/a/${doc.id}/raw`]) {
    const label = `${theme ?? 'themeless'} ${path.endsWith('/raw') ? '/raw' : '/a'}`;
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const warnings = [];
    await cdp.send('Log.enable');
    cdp.on('Log.entryAdded', ({ entry }) => { if (/preload/i.test(entry.text)) warnings.push(entry.text); });
    await page.goto(`${B}${path}`, { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(FIRST_SCREEN_PROBE);
    const preloaded = r.preloads.map((x) => x.url);
    check(r.preloads.every((x) => x.cors === 'anonymous'), `${label}: every font preload is crossorigin`);
    const unused = preloaded.filter((u) => !r.loaded.includes(u));
    check(unused.length === 0, `${label}: every preloaded face is painted (${preloaded.map(short).join(', ') || 'none'}${unused.length ? `; UNUSED ${unused.map(short).join(', ')}` : ''})`);
    const missed = r.painted.filter((u) => !preloaded.includes(u));
    check(missed.length === 0, `${label}: every face the first screen paints was preloaded (${r.painted.map(short).join(', ') || 'system faces'}${missed.length ? `; MISSED ${missed.map(short).join(', ')}` : ''})`);
    const twice = r.fetched.filter((u, i) => r.fetched.indexOf(u) !== i);
    check(twice.length === 0 && r.fetched.every((u) => u.startsWith('/fonts/')), `${label}: each font file is fetched once, from /fonts (${r.fetched.map(short).join(', ')})`);
    check(warnings.length === 0, `${label}: Chrome reports no preload problem${warnings.length ? ` (${warnings[0].slice(0, 120)})` : ''}`);
    await ctx.close();
  }
}

// The shell's own pages: its face is preloaded, and painted.
for (const path of ['/login', '/docs-human', '/no-such-page']) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${B}${path}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(FIRST_SCREEN_PROBE);
  const preloaded = r.preloads.map((x) => x.url);
  check(preloaded.length > 0 && preloaded.every((u) => r.loaded.includes(u)) && r.preloads.every((x) => x.cors === 'anonymous'),
    `shell ${path}: preloads its face crossorigin, and paints it (${preloaded.map(short).join(', ') || 'none'})`);
  check(r.fetched.every((u) => u.startsWith('/fonts/')) && new Set(r.fetched).size === r.fetched.length, `shell ${path}: each font file once, from /fonts (${r.fetched.map(short).join(', ')})`);
  const missed = r.painted.filter((u) => !preloaded.includes(u));
  if (missed.length) check.note(`shell ${path}: also paints ${missed.map(short).join(', ')} (page-specific, discovered from CSS)`);
  await ctx.close();
}

await b.close();

check.done();
