/**
 * Gate: the component KIT and its TYPE, as one walk over one fixture set.
 *
 *   1. a document's own typeface does not arrive after the reader does: small immutable woff2 files the
 *      document's own head preloads, resolved INSIDE the document's frame, warm with no round trip, ready
 *      before the heading paints — and for every theme, on both reader paths, the head preloads exactly what
 *      the first screen paints (was gate-fonts, the timing block run first and alone);
 *   2. every kit component paints and the interactive ones HYDRATE, embeds resolve their data, the document
 *      phones nobody, the chart module stays lazy, a Popover sits beside its trigger (was gate-full-kit);
 *   3. the compiled story served in the frame survives the island boot for an anonymous reader and the owner,
 *      and every page-speed fixture keeps its static nodes through it (was gate-hydration 113–139, 195–212;
 *      its edit-from-compiled leg 145–193 is gate-editor-path's, proposal row 4);
 *   4. a real library (three.js by name, from esm.sh) paints WebGL pixels in a document and after hydration
 *      in a kit Card, and a prose document loads no library (was gate-libraries).
 *
 * Absorbs full-kit, hydration (in part), libraries and fonts (proposal §3 row 14). One guest connection
 * publishes everything; the owner is that connection's browser. After the font timing block the legs run
 * four at a time. Document reads go through lib/page-facts.
 *
 *   usage: node scripts/gates/gate-kit-and-fonts.mjs [base]
 */
import { tsImport } from 'tsx/esm/api';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { artifactDocument } from './lib/artifact-document.mjs';
import { launchChromium, PAGES_HOST } from './lib/browser.mjs';
import { documentFrame, inlineStory, INLINE_STORY } from './lib/page-facts.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';
import { connectAgent } from './lib/cli-connection.mjs';
import { becomeOwner } from '../lib/start-doc.mjs';
import { kitchenSinkMarkup } from '../lib/kitchen-sink-doc.mjs';
import { publishPageSpeedFixtures } from '../fixtures/page-speed/index.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const APP_ORIGIN = new URL(B).origin;
const { port } = new URL(B);
const check = createChecker('kit-and-fonts');
/** A leg of the walk: a thrown error is reported as a failure, and the other legs keep walking. */
const leg = async (name, body) => {
  try { await body(); } catch (error) { check(false, `${name}: the walk stopped — ${String(error?.stack ?? error).split('\n').slice(0, 3).join(' | ').slice(0, 400)}`); }
};
/** Run thunks at most `limit` at a time. */
const pool = async (limit, thunks) => {
  const queue = [...thunks];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => { while (queue.length) await queue.shift()(); }));
};
/**
 * Our own hosts: the app (`app.lvh.me`), each document's origin (`<hex id>.lvh.me`), the pages apex and the
 * managed-assets host (`assets.lvh.me`), all on this server's port. Anything else is a request to a stranger.
 */
const ownHost = (value) => {
  try {
    const url = new URL(value);
    return url.port === port && (url.hostname === PAGES_HOST || url.hostname.endsWith(`.${PAGES_HOST}`));
  } catch { return false; }
};

// ── one connection publishes every fixture ─────────────────────────────────────
const mint = await connectAgent(B);
const send = (body) => fetch(`${B}/api/artifacts`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mint.token}` }, body: JSON.stringify(body) });
const publish = async (body) => {
  const res = await send(body);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
};

// A serif theme on purpose: Noto Serif was both the biggest asset (1.8 MB) and the most jarring swap.
const FONT_MARKUP = '<div data-design="tw" className="p-10">'
  + '<h1 className="text-4xl font-bold">Typography holds still</h1>'
  + '<p className="mt-4 text-lg">The body copy a reader starts reading immediately.</p>'
  + '<table className="mt-4"><tbody><tr><td>1,234.50</td></tr><tr><td>9,876.10</td></tr></tbody></table>'
  + '</div>';
const EVERY_FACE = '<div className="p-10">'
  + '<p className="font-mono text-xs uppercase tracking-widest">Eyebrow · 27 September</p>'
  + '<h1 className="text-4xl font-semibold">Typography holds still</h1>'
  + '<p className="mt-4 text-lg">The body copy a reader starts reading, with <em>emphasis</em> and <strong>strong</strong> words.</p>'
  + '<blockquote>A quoted line.</blockquote>'
  + '<table className="mt-4"><tbody><tr><td>1,234.50</td></tr></tbody></table>'
  + '</div>';
const THREE_SPEC = 'three@0.170.0';
const SCENE_SCRIPT = [
  `import * as THREE from '${THREE_SPEC}';`,
  `import { OrbitControls } from '${THREE_SPEC}/examples/jsm/controls/OrbitControls.js';`,
  'try {',
  `  window.__sameLibrary = THREE === await import('${THREE_SPEC}');`,
  "  const canvas = document.getElementById('scene');",
  '  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });',
  '  renderer.setSize(400, 300, false);',
  "  const scene = new THREE.Scene(); scene.background = new THREE.Color('#101820');",
  '  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 100); camera.position.z = 4;',
  '  const controls = new OrbitControls(camera, canvas); controls.update();',
  '  const geometry = new THREE.BufferGeometry();',
  "  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), 3));",
  "  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#ef3340', side: THREE.DoubleSide })));",
  '  renderer.render(scene, camera);',
  '  const gl = renderer.getContext(); const pixel = new Uint8Array(4);',
  '  gl.readPixels(200, 150, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);',
  "  window.__pixel = Array.from(pixel); window.__painted = true; canvas.setAttribute('data-painted', '');",
  "} catch (error) { window.__sceneError = String(error?.message ?? error); }",
].join('\n');
const SCENE_HELMET = '<Helmet><title>Three.js library gate</title><script>{' + JSON.stringify(SCENE_SCRIPT) + '}</script></Helmet>';
const SCENE_CANVAS = '<canvas id="scene" width="400" height="300" />';

const { STORY_THEMES } = await tsImport('../../services/app/lib/data/story/story-themes.ts', import.meta.url);
const THEMES = [null, ...STORY_THEMES.map((t) => t.name)];
const [kit, prose, popover, fixtures, fontDoc, themeDocs, sceneDoc, sceneProse, sceneCard, redlineStats, redlineBars] = await Promise.all([
  // The kitchen sink's refs, then the document itself (lib/kitchen-sink-doc).
  kitchenSinkMarkup(publish).then((markup) => publish({ markup, theme: 'modernist', colorMode: 'dark', title: 'Kitchen sink (unified)' })),
  publish({ markup: '<Helmet><title>Prose</title></Helmet><h1 className="text-4xl">Just words</h1><p>No charts here.</p>' }),
  publish({ markup: '<h1 className="text-3xl">Popover</h1><p>Some text above.</p><div className="flex justify-end pt-24"><Popover><PopoverTrigger>Open popover</PopoverTrigger><PopoverContent>Popover body<Button id="popover-owner-option">Owner choice</Button></PopoverContent></Popover></div><table className="relative z-10 w-full"><thead className="sticky top-0 z-10"><tr><th className="h-24">Owner table heading</th></tr></thead><tbody><tr><td>Table row</td></tr></tbody></table><p className="pt-24">Text below.</p>', title: 'Popover placement' }),
  publishPageSpeedFixtures(publish),
  publish({ title: 'Font gate', markup: FONT_MARKUP, theme: 'manuscript' }),
  Promise.all(THEMES.map(async (theme) => ({ theme, response: await send({ title: `Font gate ${theme ?? 'themeless'}`, markup: EVERY_FACE, visibility: 'unlisted', ...(theme ? { theme } : {}) }) }))),
  publish({ title: 'Three.js library gate', markup: SCENE_HELMET + SCENE_CANVAS }),
  publish({ markup: '<h1>Ordinary prose</h1>' }),
  publish({ markup: SCENE_HELMET + `<Card><CardContent>${SCENE_CANVAS}</CardContent></Card>` }),
  publish({ title: 'Responsive stat rows', theme: 'redline', markup:
    '<div className="@container px-6"><SlideDeck><Slide><h2>Two and three metrics</h2>'
    + [2, 3].map(count => `<div id="redline-row-${count}" className="rl-stat-row">`
      + Array.from({ length: count }, (_, index) => `<div className="rl-stat"><span className="t-label">Metric ${index + 1}</span><span className="t-numeral">120</span><span className="rl-stat-note">Measured today</span></div>`).join('') + '</div>').join('')
    + '</Slide></SlideDeck></div>' }),
  publish({ title: 'Responsive Redline number bars', theme: 'redline', markup:
    '<Helmet><Query name="bar_values">{`select 11.0 as today, 4.5 as target`}</Query></Helmet>'
    + '<div className="@container max-w-3xl px-8"><div id="redline-number-bar" className="rl-bar">'
    + '<span id="redline-number-today" className="rl-bar-a" style={{"flex":"0 0 71%"}}><Number data="$bar_values" col="today" format=".1f" /> TODAY</span>'
    + '<span id="redline-number-target" className="rl-bar-b" style={{"flex":"0 0 29%"}}><Number data="$bar_values" col="target" format=".1f" /> TARGET</span>'
    + '</div></div>' }),
]);
console.log(`   kit: ${B}/a/${kit.id}`);

const browser = await launchChromium();
// WebGL in a headless Chromium needs SwiftShader; only the library leg's browser gets the flag.
const glBrowser = await launchChromium({ args: ['--enable-unsafe-swiftshader'] });
try {
  // ════ 1. FONTS: the timing block, alone ════════════════════════════════════
  /** The document's frame on the app page (its own origin), once its story is on screen. */
  const storyFrame = async (page, timeout = 20_000) => {
    const frame = await documentFrame(page, { timeout });
    await frame.waitForSelector(INLINE_STORY, { timeout });
    return frame;
  };
  let docFontUrls = new Set();
  await leg('fonts', async () => {
    const p = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
    await becomeOwner(p, B, mint.token);
    // ── the asset itself: the preloads live in the DOCUMENT's head, so that is where they are read from.
    const html = await (await fetch(`${B}/a/${fontDoc.id}/raw`)).text();
    const preloadTags = [...html.matchAll(/<link[^>]+rel="preload"[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('as="font"'));
    check(preloadTags.length > 0, `the served document preloads the font (${preloadTags.length} link)`);
    check(preloadTags.length <= 2, 'and preloads only the display/body faces, not the whole registry');
    check(preloadTags.every((t) => t.includes('crossorigin')), 'each preload is crossorigin (or the font downloads twice)');
    check(preloadTags.every((t) => /href="\/fonts\/[^"]+\.woff2"/.test(t)), 'each preload points at a woff2');
    // Fall back to the surface's own @font-face when there is no preload at all.
    const fontUrl = /href="(\/fonts\/[^"]+)"/.exec(preloadTags[0] ?? '')?.[1] ?? /url\(\\?"(\/fonts\/[^"\\]+)/.exec(html)?.[1];
    if (!fontUrl) {
      check(false, 'no /fonts/ URL anywhere in the document — cannot check delivery');
    } else {
      const asset = await fetch(`${B}${fontUrl}`);
      const bytes = (await asset.arrayBuffer()).byteLength;
      // "the font serves", "immutable" and "a long max-age" moved to vitest: font-cache-headers.test.ts:15–18.
      check(bytes < 300 * 1024, `and is small — ${Math.round(bytes / 1024)} KB (a full TTF was 1842 KB)`);
    }
    // The DOCUMENT's own faces: every /fonts file its served head names (the shell's faces are the shell's).
    docFontUrls = new Set([...html.matchAll(/\/fonts\/[\w.-]+\.woff2/g)].map((m) => m[0]));
    check(docFontUrls.size > 0, `the served document names its own faces (${docFontUrls.size} files)`);
    const isDocFont = (url) => docFontUrls.has(new URL(url, B).pathname);
    const ttf = await fetch(`${B}/fonts/NotoSerif-Regular.ttf`);
    check(ttf.status === 404, `the unhashed TTF is gone (${ttf.status})`);
    // The document is served on its own origin, so its preload lives in its own head, before the @font-face.
    const docHead = html.slice(0, html.indexOf('</head>'));
    check(docHead.includes('rel="preload"'), "the preload is in the DOCUMENT's own head, not the app page's");
    check(docHead.indexOf('rel="preload"') < docHead.indexOf('@font-face'), 'and it comes before the @font-face that uses it');

    // ── the font actually resolves INSIDE the document frame
    const reqs = [];
    p.on('request', (r) => { if (r.url().includes('/fonts/')) reqs.push(r.url()); });
    await p.goto(`${B}/a/${fontDoc.id}`, { waitUntil: 'load' });
    const docFrame = await storyFrame(p);
    await docFrame.waitForSelector('h1', { timeout: 20_000 });
    await p.waitForTimeout(2500);
    check(reqs.length > 0, `the font is actually fetched (${reqs.length} request)`);
    check(reqs.every((u) => u.endsWith('.woff2')), 'and nothing requests a .ttf');
    const docReqs = new Set(reqs.filter((u) => new URL(u).origin !== APP_ORIGIN && isDocFont(u)).map((u) => new URL(u).pathname));
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
    check(inside.initiator.includes('link'), `the fetch is initiated by a <link>, not by hydration (${inside.initiator.join(',')})`);
    check(inside.start !== null && inside.start <= inside.domInteractive,
      `and starts before the document is even interactive (${inside.start}ms vs ${inside.domInteractive}ms)`);

    // ── a WARM load spends no round trip (the immutable win)
    await p.goto(`${B}/a/${fontDoc.id}`, { waitUntil: 'load' });
    const warmFrame = await storyFrame(p);
    await warmFrame.waitForSelector('h1', { timeout: 20_000 });
    await p.waitForTimeout(2000);
    const warm = await warmFrame.evaluate(() => performance.getEntriesByType('resource')
      .filter((x) => x.name.includes('/fonts/'))
      .map((x) => ({ transfer: x.transferSize, ms: Math.round(x.duration) })));
    check(warm.length > 0, 'the warm view still resolves the font');
    check(warm.every((r) => r.transfer === 0), `served from cache with no bytes on the wire (${warm.map((r) => r.transfer).join(',')})`);
    check(warm.every((r) => r.ms < 50), `and with no revalidation round trip (${warm.map((r) => r.ms + 'ms').join(',')})`);

    // ── the reader never sees two typefaces: the font is ready before the document paints text, both read on
    // the DOCUMENT's own timeline.
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
    // Retried: the frame is remounted when the page learns a new `edit_id`, which can land inside the measurement.
    const measure = async () => {
      await p.goto(`${B}/a/${fontDoc.id}`, { waitUntil: 'commit' });
      const frame = await storyFrame(p, 30_000);
      return frame.evaluate(FONT_ORDER_PROBE, [...docFontUrls]);
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
    await p.context().close();
  });

  // ════ 2–4. everything else, four at a time ══════════════════════════════════
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
    const loaded = new Set();
    for (const ff of document.fonts) {
      if (ff.status !== 'loaded') continue;
      const [lo, hi = lo] = String(ff.weight).split(/\s+/).map(Number);
      for (const f of faces) if (f.family === norm(ff.family) && f.style === ff.style && f.lo === lo && f.hi === hi
        && span(f.range).join() === span(ff.unicodeRange).join()) loaded.add(f.url);
    }
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
  // Every theme: the head preloads EXACTLY what the first screen paints, on both reader paths.
  const themeTasks = themeDocs.flatMap(({ theme, response }) => {
    const name = theme ?? 'themeless';
    let id = null;
    const published = (async () => {
      const ok = check(response.ok, `${name}: the fixture publishes (${response.status})`);
      if (ok) id = (await response.json()).id;
      return ok;
    })();
    return ['/a', '/raw'].map((surface) => () => leg(`${name} ${surface}`, async () => {
      if (!(await published)) return;
      const path = surface === '/raw' ? `/a/${id}/raw` : `/a/${id}`;
      const label = `${name} ${surface}`;
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const page = await ctx.newPage();
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        const warnings = [];
        await cdp.send('Log.enable');
        cdp.on('Log.entryAdded', ({ entry }) => { if (/preload/i.test(entry.text)) warnings.push(entry.text); });
        await page.goto(`${B}${path}`, { waitUntil: 'load' });
        // /raw IS the document; /a frames it on its own origin, and the probe reads the document's own head and timeline.
        const target = surface === '/raw' ? page.mainFrame() : await storyFrame(page);
        await page.waitForTimeout(1500);
        const r = await target.evaluate(FIRST_SCREEN_PROBE);
        const preloaded = r.preloads.map((x) => x.url);
        check(r.preloads.every((x) => x.cors === 'anonymous'), `${label}: every font preload is crossorigin`);
        const unused = preloaded.filter((u) => !r.loaded.includes(u));
        check(unused.length === 0, `${label}: every preloaded face is painted (${preloaded.map(short).join(', ') || 'none'}${unused.length ? `; UNUSED ${unused.map(short).join(', ')}` : ''})`);
        const missed = r.painted.filter((u) => !preloaded.includes(u));
        check(missed.length === 0, `${label}: every face the first screen paints was preloaded (${r.painted.map(short).join(', ') || 'system faces'}${missed.length ? `; MISSED ${missed.map(short).join(', ')}` : ''})`);
        const twice = r.fetched.filter((u, i) => r.fetched.indexOf(u) !== i);
        check(twice.length === 0 && r.fetched.every((u) => u.startsWith('/fonts/')), `${label}: each font file is fetched once, from /fonts (${r.fetched.map(short).join(', ')})`);
        check(warnings.length === 0, `${label}: Chrome reports no preload problem${warnings.length ? ` (${warnings[0].slice(0, 120)})` : ''}`);
      } finally { await ctx.close(); }
    }));
  });
  // The shell's own pages: its face is preloaded, and painted.
  const shellTasks = ['/login', '/docs-human', '/no-such-page'].map((path) => () => leg(`shell ${path}`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
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
    } finally { await ctx.close(); }
  }));

  // ── the kitchen sink: breadth, hydration, isolation, the lazy chart module, the font in the frame ──
  const kitContext = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  // Login visits Home, whose showcase thumbnails can finish loading after its DOM is ready: close that page so
  // its requests cannot enter the document's.
  const kitLogin = await kitContext.newPage();
  await becomeOwner(kitLogin, B, mint.token);
  await kitLogin.close();
  const kitTask = () => leg('kit', async () => {
    const page = await kitContext.newPage();
    // The vendor document is deterministic here; no fixture enters the running app.
    await page.route(/^https:\/\/buttons\.github\.io\/buttons\.html(?:\?|$)/, route => route.fulfill({ contentType: 'text/html', body: '<a href="https://github.com/minusxai/artifactbin" target="_blank">Star</a>' }));
    const external = [];
    const requests = [];
    const pageErrors = [];
    page.on('request', (r) => {
      const u = r.url();
      requests.push(u);
      if (!ownHost(u) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective}: ${e.blockedURI}`));
    });
    await page.goto(`${B}/a/${kit.id}`);
    await inlineStory(page, { timeout: 30000 });
    const frame = await documentFrame(page);
    await frame.waitForSelector('h1', { timeout: 30000 });
    // Charts hydrate and draw: wait for a drawn chart (the lazy-module check below) rather than a fixed six seconds.
    const chartDrawn = () => frame.waitForFunction(() => [...document.querySelectorAll('[data-mx-chart-state="ready"]')].some(el => !el.querySelector(':scope > svg.absolute.inset-0') && !!el.querySelector('canvas, svg')), null, { timeout: 20000 }).then(() => true, () => false);
    await chartDrawn();
    await page.waitForTimeout(1000);
    const text = await frame.evaluate('document.body.innerText');
    for (const marker of [
      'The Kitchen Sink', 'Card title', 'Heads up', 'Tab one', 'Accordion section A',
      'Toggle details', 'Definition term', 'A deck inside the gallery', 'Grid-hosted chart',
      // The <File> card's own text: the file's name and the facts under it.
      'kit paper', '2 pages',
    ]) check(text.includes(marker), `renders: ${marker}`);
    // interactive components are HYDRATED, not dead markup
    await frame.click('text=Open dialog');
    await frame.waitForSelector('[aria-label="Kitchen sink dialog"][open]');
    check((await frame.textContent('[aria-label="Kitchen sink dialog"]')).includes('Dialog content opened from the gallery.'), 'Dialog hydrated');
    await frame.locator('[aria-label="Kitchen sink dialog"]').getByRole('button', { name: 'Close', exact: true }).click();
    await frame.waitForSelector('[aria-label="Kitchen sink dialog"]:not([open])', { state: 'attached' });
    await frame.click('text=Tab two');
    await frame.waitForFunction(() => document.body.innerText.includes('Second pane content'), null, { timeout: 3000 }).catch(() => {});
    check((await frame.evaluate('document.body.innerText')).includes('Second pane content'), 'Tabs hydrated');
    await frame.click('text=Accordion section B');
    await frame.waitForFunction(() => document.body.innerText.includes('Collapsed until clicked'), null, { timeout: 3000 }).catch(() => {});
    check((await frame.evaluate('document.body.innerText')).includes('Collapsed until clicked'), 'Accordion hydrated');
    // <Icon> has no text of its own: look at the glyph itself — present, carrying its paths, laid out.
    const icons = await frame.evaluate(`(() => {
      const els = [...document.querySelectorAll('svg.lucide')];
      return {
        count: els.length,
        withPaths: els.filter((e) => e.children.length > 0).length,
        laidOut: els.filter((e) => e.getBoundingClientRect().width > 0).length,
      };
    })()`);
    check(icons.count > 0, `<Icon> drew its glyph (${icons.count})`);
    check(icons.count > 0 && icons.withPaths === icons.count, `every glyph carries its paths (${icons.withPaths}/${icons.count})`);
    check(icons.count > 0 && icons.laidOut === icons.count, `every glyph is laid out (${icons.laidOut}/${icons.count})`);
    check(await frame.evaluate("document.querySelectorAll('canvas, svg.marks').length > 0"), 'charts drew from island data');
    check(/\$\s?[\d,]+/.test(text), 'inline <Number> computed a value');
    check(await frame.evaluate("!!document.querySelector('[aria-label=\"Question embed\"]')"), 'Question embeds mounted');
    const csp = await frame.evaluate('window.__csp || []');
    check(csp.length === 0, `no CSP violations${csp.length ? `: ${csp.join(', ')}` : ''}`);
    check(external.length === 0, `no external requests${external.length ? `: ${external.slice(0, 3).map(value => { const url = new URL(value); return url.origin + url.pathname; }).join(', ')}` : ''}`);
    check(pageErrors.length === 0, `no page errors${pageErrors.length ? `: ${pageErrors[0]}` : ''}`);
    // The chart module is LAZY: the compiled page starts Vega after reader readiness and visibility, without input.
    const islandChunks = () => requests.filter((u) => new URL(u).pathname.startsWith('/islands/'));
    check(await chartDrawn(), `a chart document loaded the lazy chart module after reader readiness without input (${islandChunks().length} island chunks)`);
    // The font resolved INSIDE the opaque frame.
    const fontOk = await frame.evaluate(async () => {
      await document.fonts.ready;
      const body = getComputedStyle(document.body).fontFamily;
      const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
      return { body, loaded };
    });
    check(fontOk.loaded.length > 0, `a platform face loaded inside the frame (${fontOk.loaded.slice(0, 3).join(', ') || 'none'})`);
    // The export set (PNG, JPEG, the 1600×840 card, a byte-identical repeat, ?chrome=0 without navigation chrome)
    // moved to gate-exports.mjs (proposal row 17).
    await page.close();
  });
  // A prose document (no embeds) must not pay for the chart module at all.
  const proseTask = () => leg('prose', async () => {
    const proseRequests = [];
    const prosePage = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await becomeOwner(prosePage, B, mint.token); // a fresh context owns nothing
    prosePage.on('request', (r) => proseRequests.push(r.url()));
    await prosePage.goto(`${B}/a/${prose.id}`);
    const proseFrame = await artifactDocument(prosePage);
    await proseFrame.waitForSelector('h1', { timeout: 20000 });
    await prosePage.waitForTimeout(3000);
    // A compiled prose page loads its own behaviour (@mx/page) and nothing of the islands' runtime or charts.
    const manifest = await (await fetch(`${B}/islands/manifest.json`)).json();
    const closure = (urls, seen = new Set()) => { for (const u of urls) { if (seen.has(u) || !manifest.files[u]) continue; seen.add(u); closure(manifest.files[u].imports, seen); } return seen; };
    const allowed = closure([manifest.manifest['@mx/page']]);
    // The owner's app page attaches to the frame for comments, which loads `@mx/frame-editor` and its lazy chunks.
    const frameEditor = (p) => closure([manifest.manifest['@mx/frame-editor']]).has(p) || p.startsWith('/islands/frame-editor-chunk-');
    const extra = proseRequests.map((u) => new URL(u).pathname).filter((p) => p.startsWith('/islands/') && !allowed.has(p) && !frameEditor(p));
    check(extra.length === 0, `a prose document never fetches the chart chunk (island files beyond its page behaviour: ${extra.join(', ') || 'none'})`);
    await prosePage.close();
  });
  // A Popover opens NEXT TO its trigger: a mid-page trigger on the right of a row, at desktop and phone width.
  const popoverTasks = [{ width: 1200, height: 800 }, { width: 390, height: 800 }].map((viewport) => () => leg(`popover ${viewport.width}px`, async () => {
    const popPage = await browser.newPage({ viewport });
    await popPage.goto(`${B}/a/${popover.id}`);
    const popDoc = await documentFrame(popPage);
    await popDoc.waitForSelector('[data-mx-inline-story] h1', { timeout: 20000 });
    await popDoc.waitForSelector('html[data-mx-ready]', { state: 'attached', timeout: 20000 }).catch(() => {});
    await popPage.waitForTimeout(500);
    await popDoc.getByRole('button', { name: 'Open popover' }).click();
    await popDoc.waitForFunction(() => { const transform = document.querySelector('[data-radix-popper-content-wrapper]')?.style.transform ?? ''; return transform !== '' && !transform.includes('%'); }, null, { timeout: 10000 }).catch(() => {});
    const box = await popDoc.evaluate(() => {
      const t = document.querySelector('[data-slot="popover-trigger"]')?.getBoundingClientRect();
      const c = document.querySelector('[data-slot="popover-content"]')?.getBoundingClientRect();
      return t && c ? { t: { l: t.left, r: t.right, b: t.bottom, w: t.width }, c: { l: c.left, r: c.right, t: c.top, w: c.width }, inStory: !!document.querySelector('[data-mx-inline-story] [data-slot="popover-content"]') } : null;
    });
    const tag = `${viewport.width}px`;
    if (!box) check.note(`${tag}: ${JSON.stringify(await popDoc.evaluate(() => ({ ready: document.documentElement.hasAttribute('data-mx-ready'), expanded: document.querySelector('[data-slot="popover-trigger"]')?.getAttribute('aria-expanded') ?? null, wrappers: document.querySelectorAll('[data-radix-popper-content-wrapper]').length }))) }`);
    check(!!box, `${tag}: the popover opened`);
    if (box) {
      check(Math.abs(box.c.t - (box.t.b + 4)) <= 2, `${tag}: popover sits just under its trigger (content top ${box.c.t}, trigger bottom ${box.t.b})`);
      check(box.c.r > box.t.l && box.c.l < box.t.r && box.c.l >= 0 && box.c.r <= viewport.width, `${tag}: popover overlaps its trigger's columns and stays on screen (${box.c.l}..${box.c.r})`);
      check(box.inStory, `${tag}: popover mounts inside the story root`);
      const ownerOnTop = await popDoc.evaluate(() => {
        const option = document.getElementById('popover-owner-option');
        const rect = option?.getBoundingClientRect();
        return !!option && !!rect && option.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
      });
      check(ownerOnTop, `${tag}: the owner option paints above the overlapping positioned table header`);
    }
    await popPage.close();
  }));

  // Minimum-width system cards wrap within the reader surface on phones.
  const statTasks = [390, 1440].map(width => () => leg(`Redline stats ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(`${B}/a/${redlineStats.id}`);
      const frame = await documentFrame(page);
      await frame.waitForSelector('#redline-row-3');
      const geometry = await frame.evaluate(() => {
        const surface = document.querySelector('.mx-doc');
        const rows = [2, 3].map(count => {
          const row = document.getElementById(`redline-row-${count}`);
          return { width: row.clientWidth, scroll: row.scrollWidth,
            cards: [...row.children].map(card => {
              const rect = card.getBoundingClientRect();
              return { left: rect.left, right: rect.right, top: rect.top };
            }) };
        });
        return { viewport: innerWidth, surface: surface && { width: surface.clientWidth, scroll: surface.scrollWidth }, rows };
      });
      check(!!geometry.surface && geometry.surface.scroll <= geometry.surface.width + 1, `${width}px: stat rows fit the reader surface (${JSON.stringify(geometry.surface)})`);
      for (const row of geometry.rows) {
        check(row.scroll <= row.width + 1 && row.cards.every(card => card.left >= -1 && card.right <= geometry.viewport + 1), `${width}px: all ${row.cards.length} stat cards remain visible`);
        if (width === 1440) check(row.cards.every(card => Math.abs(card.top - row.cards[0].top) <= 1), `desktop: ${row.cards.length} stat cards stay on one row`);
      }
    } finally { await page.close(); }
  }));

  // Number's nested spans must not inherit bar-segment padding; labels stay complete at phone width.
  const redlineBarTasks = [390, 1440].map(width => () => leg(`Redline Number bars ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(`${B}/a/${redlineBars.id}`);
      const frame = await documentFrame(page);
      await frame.waitForSelector('#redline-number-target [aria-label="Live number"]');
      await frame.waitForFunction(() => document.querySelector('#redline-number-today [aria-label="Live number"]')?.textContent?.trim() === '11.0'
        && document.querySelector('#redline-number-target [aria-label="Live number"]')?.textContent?.trim() === '4.5');
      const geometry = await frame.evaluate(() => {
        const surface = document.querySelector('.mx-doc');
        const bar = document.getElementById('redline-number-bar');
        const readText = (node) => {
          const range = document.createRange(); range.selectNodeContents(node);
          return [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }));
        };
        const segments = ['today', 'target'].map((which) => {
          const segment = document.getElementById(`redline-number-${which}`);
          const value = segment.querySelector('[aria-label="Live number"]');
          const label = [...segment.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
          const rect = segment.getBoundingClientRect();
          return { which, value: value.textContent.trim(), label: label.textContent.trim(),
            segment: { left: rect.left, right: rect.right }, valueRects: readText(value), labelRects: readText(label),
            flex: getComputedStyle(segment).flex };
        });
        return { surface: surface && { width: surface.clientWidth, scroll: surface.scrollWidth },
          bar: bar && { width: bar.clientWidth, scroll: bar.scrollWidth }, segments };
      });
      check(!!geometry.surface && geometry.surface.scroll <= geometry.surface.width + 1,
        `${width}px: Number bar fits the reader surface (${JSON.stringify(geometry.surface)})`);
      check(!!geometry.bar && geometry.bar.scroll <= geometry.bar.width + 1,
        `${width}px: Number bar has no internal horizontal overflow (${JSON.stringify(geometry.bar)})`);
      for (const segment of geometry.segments) {
        const value = segment.valueRects[0], label = segment.labelRects[0];
        check(segment.value === (segment.which === 'today' ? '11.0' : '4.5') && segment.label === segment.which.toUpperCase(),
          `${width}px: ${segment.which} value and label render from Number/query data (${segment.value} ${segment.label})`);
        check(segment.flex === (segment.which === 'today' ? '0 0 71%' : '0 0 29%'),
          `${width}px: ${segment.which} keeps its authored proportional bar segment (${segment.flex})`);
        check(segment.valueRects.length === 1 && segment.labelRects.length === 1
          && value.left >= segment.segment.left - 1 && label.right <= segment.segment.right + 1
          && label.left >= value.right + 2,
        `${width}px: ${segment.which} value and label stay visible, on one line, and separated (${JSON.stringify(segment)})`);
      }
    } finally { await page.close(); }
  }));

  // ── the compiled reader handover (was gate-hydration) ───────────────────────
  const READER_HEADER = 'x-mx-reader';
  /**
   * The compiled page as served IN THE DOCUMENT'S FRAME: its story root and every element in it, captured at
   * DOMContentLoaded, before any island can have run. On the app page (which carries no story) it captures nothing.
   */
  const COMPILED_PROBE = () => {
    const state = (window.__compiledTakeover = { story: null, served: [], staticNodes: [], guestSignIn: [] });
    document.addEventListener('DOMContentLoaded', () => {
      const story = document.querySelector('body > [data-mx-inline-story]');
      if (!story) return;
      state.story = story;
      state.served = [...story.querySelectorAll('*')];
      // <SignIn> is server-rendered without the viewer, then intentionally removed for an
      // authenticated reader when the island resolves `viewer()`. Keep that behavior explicit
      // below instead of treating this guest-only control as immutable static markup.
      state.guestSignIn = [...story.querySelectorAll('[data-slot="sign-in"]')];
      state.staticNodes = [...story.querySelectorAll('[data-mx-ast]')]
        // Floating content (a pinned-open tooltip or popover) is positioned at runtime: its style and side are the popper's.
        .filter((node) => !node.closest('[data-slot="sign-in"], [data-hk^="s"], [aria-label="Question embed"], [aria-label="DataTable embed"], [data-mx-mermaid-state], [data-slot="avatar-fallback"], [data-slot="tabs-content"], [data-slot="tooltip-trigger"], [data-story-floating], [aria-busy]'))
        .map((node) => ({ node, attrs: [...node.attributes].map((attr) => [attr.name, attr.value]),
          text: [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('').trim() }));
    });
  };
  /** The verdict, read inside the document's frame: the served story is the one still running there. */
  const COMPILED_VERDICT = () => {
    const { story, served, staticNodes, guestSignIn } = window.__compiledTakeover ?? { story: null, served: [], staticNodes: [], guestSignIn: [] };
    return {
      captured: !!story, served: served.length,
      same: !!story && story.isConnected && document.querySelector('[data-mx-inline-story]') === story,
      lost: story ? served.filter((n) => !story.contains(n)).length : -1,
      staticNodes: staticNodes.length,
      guestSignInServed: guestSignIn.length,
      guestSignInRemaining: story ? guestSignIn.filter((n) => story.contains(n)).length : -1,
      ...(() => {
        const textOf = (node) => [...node.childNodes].filter((child) => child.nodeType === Node.TEXT_NODE).map((child) => child.textContent).join('').trim();
        const changed = staticNodes.filter(({ node, attrs, text }) => !story?.contains(node)
          || JSON.stringify([...node.attributes].map((attr) => [attr.name, attr.value])) !== JSON.stringify(attrs)
          || textOf(node) !== text);
        const first = changed[0];
        const staticChangedFirst = first ? {
          tag: first.node.tagName, inStory: !!story?.contains(first.node),
          served: { attrs: first.attrs, text: first.text.slice(0, 80) },
          now: { attrs: [...first.node.attributes].map((attr) => [attr.name, attr.value]), text: textOf(first.node).slice(0, 80) },
        } : null;
        return { staticChanged: changed.length, staticChangedFirst };
      })(),
      reactOwned: story ? [story, ...served].filter((n) => Object.keys(n).some((k) => k.startsWith('__reactFiber$'))).length : -1,
      mode: story?.__mxIslands?.mode?.() ?? null,
      framed: document.documentElement.classList.contains('mx-framed'),
    };
  };
  /** Serve `path` until it answers compiled (the compile is off the write path), or say what it answered. */
  async function compiledServed(path) {
    let served = null;
    for (const end = Date.now() + 30000; Date.now() < end;) {
      served = (await fetch(`${B}${path}`, { headers: { accept: 'text/html' } })).headers.get(READER_HEADER);
      if (served === 'compiled') return 'compiled';
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return served ?? 'absent';
  }
  const ownerContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(ownerContext);
  const ownerPage = await ownerContext.newPage();
  await becomeOwner(ownerPage, B, mint.token);
  const anonymous = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(anonymous);
  const open = async (context, path) => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`page error: ${String(e).slice(0, 300)}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text().slice(0, 300)} (${m.location().url})`); });
    await page.addInitScript(COMPILED_PROBE);
    const response = await page.goto(`${B}${path}`, { waitUntil: 'load', timeout: 90000 });
    const doc = await documentFrame(page, { timeout: 60000 });
    return { page, doc, errors, served: response?.headers()[READER_HEADER] ?? 'absent' };
  };
  /** Poll the frame's verdict until `want`, or give up: returns the last verdict. */
  const verdictWhen = async (page, want, ms = 30000) => {
    let verdict = null;
    for (const deadline = Date.now() + ms; Date.now() < deadline;) {
      verdict = await (await documentFrame(page)).evaluate(COMPILED_VERDICT).catch(() => null);
      if (verdict && want(verdict)) return verdict;
      await page.waitForTimeout(100);
    }
    return verdict ?? { captured: false, served: 0, same: false, lost: -1, staticNodes: 0, staticChanged: -1, reactOwned: -1, mode: null, framed: false };
  };
  const judge = (label, verdict, errors) => {
    check(verdict.captured && verdict.served > 0, `${label}: the compiled story was served as the framed document's own root (${verdict.served} elements)`);
    check(verdict.framed, `${label}: the document runs in the app page's frame`);
    check(verdict.same, `${label}: the served story element is still the document's story, not a copy`);
    check(verdict.lost === 0, `${label}: every served element is still in the story (${verdict.lost} lost)`);
    check(verdict.reactOwned === 0, `${label}: no React fiber on the island story (a guard against React returning) (${verdict.reactOwned} owned)`);
    check(verdict.mode === 'read', `${label}: the islands are still running, in read mode (${verdict.mode})`);
    check(errors.length === 0, `${label}: no page error (${errors.length}: ${errors[0] ?? ''})`);
  };
  const kitFixture = fixtures.find((fixture) => fixture.key === 'kit');
  const kitPath = `/a/${kitFixture.id}`;
  // The `x-mx-reader` header is also compiled-serve.test.ts's; it is read here because the walk waits on it.
  const takeoverTask = () => leg('compiled takeover', async () => {
    const served = await compiledServed(kitPath);
    if (served !== 'compiled') { check(false, `compiled takeover: expected the compiled page (${READER_HEADER}: ${served})`); return; }
    {
      const { page, errors, served: header } = await open(anonymous, kitPath);
      check(header === 'compiled', `anonymous: ${kitPath} is served compiled (${header})`);
      const verdict = await verdictWhen(page, (v) => v.mode === 'read');
      await page.waitForTimeout(500);
      judge('anonymous', verdict.mode === 'read' ? await (await documentFrame(page)).evaluate(COMPILED_VERDICT) : verdict, errors);
      await page.close();
    }
    // THE OWNER: the islands boot in the frame with no gesture at all, on the same served element.
    {
      const { page, errors } = await open(ownerContext, kitPath);
      const verdict = await verdictWhen(page, (v) => v.mode === 'read');
      check(verdict.mode === 'read', 'owner: the islands booted in the frame without a gesture');
      await page.waitForTimeout(500);
      judge('owner', await (await documentFrame(page)).evaluate(COMPILED_VERDICT), errors);
      await page.close();
    }
  });
  // Every page-speed fixture keeps its server-rendered static AST nodes, attributes and direct text through the
  // compiled island boot in the frame.
  const staticTasks = fixtures.map((fixture) => () => leg(`static hydration ${fixture.key}`, async () => {
    const path = `/a/${fixture.id}`;
    const header = await compiledServed(path);
    check(header === 'compiled', `static hydration ${fixture.key}: compiled response (${header})`);
    if (header !== 'compiled') return;
    const { page, errors } = await open(ownerContext, path);
    // A prose fixture ships no island module (its mode stays null), so the boot is waited for only so long.
    await verdictWhen(page, (v) => v.mode === 'read', 8000);
    await page.waitForTimeout(500);
    const verdict = await (await documentFrame(page)).evaluate(COMPILED_VERDICT);
    check(verdict.captured && verdict.staticNodes > 0 && verdict.staticChanged === 0,
      `static hydration ${fixture.key}: ${verdict.staticNodes} static nodes retained attributes and direct text (${verdict.staticChanged} changed${verdict.staticChangedFirst ? `; first: ${JSON.stringify(verdict.staticChangedFirst)}` : ''})`);
    if (fixture.key === 'kitchen') {
      check(verdict.guestSignInServed === 1 && verdict.guestSignInRemaining === 0,
        `static hydration kitchen: owner hydration removes the server-rendered guest-only SignIn control (${verdict.guestSignInServed} served, ${verdict.guestSignInRemaining} remaining)`);
    }
    check(errors.length === 0, `static hydration ${fixture.key}: no page errors (${errors[0] ?? ''})`);
    await page.close();
  }));

  // ── a real library in a real document (was gate-libraries; needs esm.sh) ───
  // "a cold export of an unvisited WebGL document is a PNG" moved to gate-exports.mjs (proposal row 17).
  const libraryTask = () => leg('libraries', async () => {
    const page = await glBrowser.newPage();
    page.on('pageerror', error => console.error('PAGE', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('CONSOLE', message.text()); });
    const libraries = [];
    page.on('request', req => { if (/\/libraries\/|esm\.sh/.test(req.url())) libraries.push(req.url()); });
    await page.goto(`${B}/a/${sceneProse.id}/raw`);
    await page.waitForTimeout(500);
    check(libraries.length === 0, `an ordinary prose document loads no library at all (${libraries.join(' ')})`);
    const scene = async (id) => {
      await page.goto(`${B}/a/${id}/raw`);
      await page.waitForFunction(() => window.__painted || window.__sceneError, null, { timeout: 30000 }).catch(async error => {
        throw new Error(`${error.message}; body=${(await page.locator('body').innerText()).slice(0, 1000)}`);
      });
      return page.evaluate(() => ({ error: window.__sceneError, pixel: window.__pixel, same: window.__sameLibrary, painted: document.getElementById('scene')?.hasAttribute('data-painted') }));
    };
    const state = await scene(sceneDoc.id);
    check(state.error === undefined, `the scene ran without error (${state.error ?? 'none'})`);
    check(state.same === true, 'a second import of the library is the same module, not a second copy');
    check(state.pixel[0] > state.pixel[1] * 2, `the model painted real WebGL pixels (${state.pixel})`);
    check(state.painted === true, 'the script rendered into the markup\'s own canvas node');
    check(libraries.some(url => url.startsWith('https://esm.sh/three@0.170.0')), `the package came from esm.sh at the pinned version (${libraries.slice(0, 3).join(' ')})`);
    const inCard = await scene(sceneCard.id);
    check(inCard.error === undefined, `the script runs after hydration inside a kit Card too (${inCard.error ?? 'none'})`);
    check(inCard.painted === true && inCard.pixel[0] > inCard.pixel[1] * 2, `and the hydrated copy painted as well (${inCard.pixel})`);
    await page.close();
  });

  // The long legs first, so the short ones fill in around them.
  await pool(4, [kitTask, takeoverTask, libraryTask, ...staticTasks, proseTask, ...popoverTasks, ...statTasks, ...redlineBarTasks, ...themeTasks, ...shellTasks]);
} finally {
  await Promise.allSettled([browser.close(), glBrowser.close()]);
}
check.done();
