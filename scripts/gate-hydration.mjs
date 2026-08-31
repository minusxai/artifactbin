/**
 * Gate: a document paints once, and its runtime is asked for up front.
 *
 * Two faults, both found on production and both invisible to a unit test.
 *
 * 1. THE REPAINT. A document's markup is rendered twice — to a string on the
 *    server, into a live DOM on the client — and those are only the same tree
 *    if the string survives being PARSED. HTML's content model says otherwise:
 *    `<p><div>x</div></p>` parses as an empty `<p>` and a sibling `<div>`,
 *    while React's client render (DOM APIs, which enforce nothing) produces the
 *    nesting the author wrote. React calls that a hydration mismatch (#418) and
 *    answers it by discarding the whole server tree and re-rendering the root.
 *    The reader watches the document paint with the paragraph's classes
 *    stranded on an empty element — prose full-width and unjustified — and then
 *    repaint correctly. Two of three public documents on production carried it.
 *
 * 2. THE CHAIN. The runtime is not named until the document has arrived, and
 *    its lazy chart chunk not until the runtime has downloaded AND parsed:
 *    three requests, each waiting on the last, over whatever the reader's
 *    latency happens to be. Both URLs are known when the document is built, so
 *    they are preloaded in its head — and everything under /story/ is now
 *    content-addressed and cached for a year instead of revalidating per view.
 *
 * The runtime's response is HELD for the first check, because the interesting
 * window is between the document painting and hydration replacing it — a few
 * hundred milliseconds on a local server, which is exactly why this was easy to
 * ship and hard to see.
 *
 *   usage: node scripts/gate-hydration.mjs [base]
 */
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
let failures = 0;
const ok = (c, l) => { console.log(`${c ? '  ok ' : 'FAIL'} ${l}`); if (!c) failures += 1; return c; };

/**
 * The production shape, reduced: an intro paragraph carrying the measure and
 * the justification, holding the divs the author put inside it.
 */
const PROSE = '<div data-design="tw" className="mx-auto max-w-5xl p-10">'
  + '<h1 className="text-4xl">Heading</h1>'
  + '<p id="lede" className="mx-auto mt-6 max-w-md text-justify text-neutral-700">'
  + '<div id="inner" className="text-base">For over a decade now, this paragraph has carried a measure and a justification, and it needs enough words in it to wrap onto several lines so that a change of container width is unmistakable.</div>'
  + '</p>'
  + '<Card><CardContent>a component, so the document hydrates</CardContent></Card>'
  + '</div>';

/** A chart, with its rows declared inline so the document needs no dataset. */
const CHART =
  '<Helmet><Value name="rows" type="table" value={[{"x":"a","y":1},{"x":"b","y":3}]} /></Helmet>'
  + '<div data-design="tw" className="p-10"><Question data="$rows" height={300}'
  + ' viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"x","type":"nominal"},"y":{"field":"y","type":"quantitative"}}}}} /></div>';

/** What a reader would notice changing under them. */
const PROBE = `(() => {
  const inner = document.querySelector('#inner');
  if (!inner) return null;
  const holder = inner.parentElement;
  const s = getComputedStyle(inner);
  return {
    holderTag: holder.tagName.toLowerCase(),
    holderId: holder.id,
    width: Math.round(inner.getBoundingClientRect().width),
    align: s.textAlign,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
  };
})()`;

/**
 * Poll with `evaluate` rather than `waitForFunction`: the latter installs a
 * polling helper that builds a function from a string INSIDE the page, and the
 * served document's CSP has no `unsafe-eval` — so the wait fails as a CSP
 * violation, which reads exactly like a product bug.
 */
const waitFor = async (page, expr, ms = 20000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline;) {
    if (await page.evaluate(expr)) return true;
    await page.waitForTimeout(100);
  }
  return false;
};

const publish = async (id, token, markup, title) => {
  const res = await fetch(`${B}/api/artifacts/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title, markup, theme: 'modernist' }),
  });
  if (!res.ok) throw new Error(`publish failed (${res.status}): ${await res.text()}`);
};

const browser = await chromium.launch();

/** The document paints its final layout, and React never throws the tree away. */
async function runNoRepaint() {
  const st = await startDocument(B);
  await publish(st.id, st.token, PROSE, 'hydration gate');

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  /*
   * Hold the runtime. Without this the window between the document's own paint
   * and hydration is too short to sample, and a gate that samples after
   * hydration cannot tell a document that painted once from one that painted
   * twice.
   */
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/story/entry-*.js', async (route) => { await held; await route.continue(); });

  // Reader path on purpose: no shell, no iframe — the document IS the page,
  // which is what a shared link opens.
  /*
   * `commit`, not `domcontentloaded`: a module script is deferred, and
   * DOMContentLoaded waits for deferred scripts — so the very hold that makes
   * the pre-hydration DOM observable also stops that event from firing.
   */
  await page.goto(`${B}/a/${st.id}`, { waitUntil: 'commit' });
  /*
   * Generous: the FIRST document a fresh server renders pays for loading the
   * SSR bundle (~1.5 MB of CJS, through createRequire), which on a cold
   * container can take most of a default 30s timeout on its own. Observed
   * flaking exactly once, against a just-started image.
   */
  await page.waitForSelector('#inner', { timeout: 60000 });
  const before = await page.evaluate(PROBE);

  release();
  // `window.mx` is installed by the runtime before it signals ready — the SSR'd
  // body already carries `data-mx-ast`, so the markup itself says nothing about
  // whether hydration has happened.
  ok(await waitFor(page, '!!window.mx'), 'the runtime hydrated the document');
  await page.waitForTimeout(600);
  const after = await page.evaluate(PROBE);

  ok(before !== null && after !== null, 'the document rendered at both ends');
  ok(before.holderTag === 'div', `the paragraph holding a div is served as a div (${before.holderTag})`);
  ok(before.holderId === 'lede', `…keeping its id, so its classes still wrap the text (${before.holderId})`);
  for (const k of ['holderTag', 'width', 'align', 'fontFamily', 'fontSize']) {
    ok(before[k] === after[k], `${k} is the same before and after hydration (${before[k]} vs ${after[k]})`);
  }
  ok(before.align === 'justify', `the measure and justification actually apply (${before.align})`);
  const mismatch = errors.filter((e) => /418|hydrat/i.test(e));
  ok(mismatch.length === 0, `no hydration mismatch (${mismatch[0] ?? 'clean'})`);
  ok(errors.length === 0, `no page errors at all (${errors.length}: ${errors[0] ?? ''})`);
  await page.close();
}

/** The runtime and its chart chunk are requested up front, and cached. */
async function runPreload() {
  const st = await startDocument(B);
  await publish(st.id, st.token, CHART, 'preload gate');

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const started = [];
  page.on('request', (r) => started.push({ url: r.url() }));

  /*
   * `load` waits for every subresource, and a chart document is ~2 MB of
   * JavaScript — fine locally, and over the open internet enough to blow a
   * default 30s. What this run measures is what the HEAD asks for and what the
   * browser then fetches, neither of which needs the load event.
   */
  await page.goto(`${B}/a/${st.id}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(6000);

  const html = await (await fetch(`${B}/a/${st.id}/raw`)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  const links = [...head.matchAll(/<link rel="modulepreload" href="([^"]+)" crossorigin>/g)].map((m) => m[1]);

  const entry = links.find((h) => h.includes('/story/entry-'));
  const chunk = links.find((h) => h.includes('/story/chunks/'));
  ok(!!entry, `the runtime is preloaded in the head (${entry ?? 'absent'})`);
  ok(/\/story\/entry-[A-Z0-9]+\.js$/.test(entry ?? ''), `…at a content-addressed URL (${entry})`);
  ok(!!chunk, `a charting document preloads the chart chunk too (${chunk ?? 'absent'})`);
  ok(head.includes(`<link rel="modulepreload" href="${entry}" crossorigin>`),
    'the preload is crossorigin — matching the script tag, or the bytes are fetched twice');

  /*
   * Deliberately NOT asserted here: that the chunk's request starts earlier in
   * wall-clock than it used to. The saving is one round trip plus the entry's
   * parse, which on a local server is ~26 ms — measured both ways, with and
   * without the preload — so any threshold that passes here would pass without
   * the fix too. On the link this was reported from (235 ms RTT) the same
   * change moves the chart chunk's start from ~2.9 s to ~0. The structural
   * checks above are what can be judged deterministically; the timing is real
   * but not observable from localhost.
   */
  ok(started.some((r) => r.url.includes('/story/chunks/')), 'the chart chunk was actually fetched');

  // Not a chart: the split has to keep meaning something.
  const prose = await startDocument(B);
  await publish(prose.id, prose.token, PROSE, 'preload gate prose');
  const proseHead = (await (await fetch(`${B}/a/${prose.id}/raw`)).text()).split('</head>')[0];
  ok(!/modulepreload href="\/story\/chunks\//.test(proseHead) && !proseHead.includes('/story/chunks/'),
    'a prose document does not preload the chart chunk');

  await page.close();
}

/** The response headers themselves — the config is necessary but not sufficient. */
async function runCaching() {
  const manifest = await (await fetch(`${B}/story/manifest.json`)).json().catch(() => null);
  ok(!!manifest?.entry, `the build published a manifest (${manifest?.entry ?? 'none'})`);
  const urls = [manifest.entry, ...(manifest.lazy ?? [])];
  for (const u of urls) {
    const res = await fetch(`${B}${u}`, { method: 'HEAD' });
    const cc = res.headers.get('cache-control') ?? '';
    ok(res.status === 200, `${u} is served (${res.status})`);
    ok(cc.includes('immutable') && cc.includes('max-age=31536000'), `${u} is immutable for a year (${cc})`);
    // Load-bearing, not hygiene: `import()` is CORS-mode and the document has
    // an opaque origin, so without this every chart silently fails to draw.
    ok(res.headers.get('access-control-allow-origin') === '*', `${u} keeps its CORS header`);
  }
}

try {
  await runNoRepaint();
  await runPreload();
  await runCaching();
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
