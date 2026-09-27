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
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { startDocument } from './lib/start-doc.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('hydration');

/**
 * The production shapes, reduced: an intro paragraph carrying the measure and
 * the justification, holding the divs the author put inside it — and a dialog
 * trigger holding the author's own <Button>.
 */
const PROSE = '<Helmet><Value name="bars" type="table" value={[{"k":"a","x":0,"h":4},{"k":"b","x":10,"h":7},{"k":"c","x":20,"h":2}]} /></Helmet>'
  + '<div data-design="tw" className="mx-auto max-w-5xl p-10">'
  + '<h1 className="text-4xl">Heading</h1>'
  + '<p id="lede" className="mx-auto mt-6 max-w-md text-justify text-neutral-700">'
  + '<div id="inner" className="text-base">For over a decade now, this paragraph has carried a measure and a justification, and it needs enough words in it to wrap onto several lines so that a change of container width is unmistakable.</div>'
  + '</p>'
  /*
   * The SAME fault in the interactive vocabulary, and the one production
   * actually shipped: a trigger that
   * draws its own <button> around the <Button> the author put inside it. A
   * button may not contain a button, so the parser closes the outer one and
   * PROMOTES the inner to its sibling — #418, and a trigger that is an empty
   * element next to an inert button until React throws the tree away.
   */
  + '<Dialog><DialogTrigger id="trigger"><Button id="add">Add task</Button></DialogTrigger>'
  + '<DialogContent aria-label="Add a task"><DialogClose>Cancel</DialogClose></DialogContent></Dialog>'
  /*
   * And in SVG: a <For> of bars. Its wrapper is a <div> in HTML, which inside
   * <svg> the parser breaks out of — the bars become HTML elements that draw
   * nothing, React's tree still has them in the drawing, #418. In SVG it is a <g>.
   */
  + '<svg id="chart" viewBox="0 0 30 10" className="w-24"><For id="bars" each={$bars} keyBy="k">'
  + '<rect x="$_row.x" y="0" width="8" height="$_row.h" fill="currentColor" /></For></svg>'
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
    // Still inside the trigger, where React's tree says it is.
    triggerHoldsButton: !!document.querySelector('#trigger #add'),
    // The bars still drawn inside the svg, and what groups them there.
    barsInSvg: document.querySelectorAll('svg#chart rect').length,
    barsGroup: document.querySelector('svg#chart > #bars')?.tagName ?? null,
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
  await githubWidgetFixture(page.context());
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text()} (${m.location().url})`); });

  /*
   * Hold the runtime. Without this the window between the document's own paint
   * and hydration is too short to sample, and a gate that samples after
   * hydration cannot tell a document that painted once from one that painted
   * twice.
   */
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(/\/(?:main\.tsx|assets\/[^/]+\.js)(?:\?|$)/, async (route) => { await held; await route.continue(); });

  // Reader path on purpose: the canonical app document mounts the story inline;
  // the document remains the page reached by a shared link.
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
  check(await waitFor(page, '!!document.querySelector("[data-mx-inline-story]")'), 'the app mounted its inline artifact runtime');
  await page.waitForTimeout(600);
  const after = await page.evaluate(PROBE);

  check(before !== null && after !== null, 'the document rendered at both ends');
  check(before.holderTag === 'div', `the paragraph holding a div is served as a div (${before.holderTag})`);
  check(before.holderId === 'lede', `…keeping its id, so its classes still wrap the text (${before.holderId})`);
  check(before.triggerHoldsButton, 'the served dialog trigger still holds the author\'s Button after parsing');
  check(before.barsInSvg === 3, `the served <For> of bars stays inside its svg (${before.barsInSvg} of 3)`);
  check(before.barsGroup === 'g', `…grouped by a <g> (${before.barsGroup})`);
  for (const k of ['holderTag', 'triggerHoldsButton', 'barsInSvg', 'barsGroup', 'width', 'align', 'fontFamily', 'fontSize']) {
    check(before[k] === after[k], `${k} is the same before and after hydration (${before[k]} vs ${after[k]})`);
  }
  check(before.align === 'justify', `the measure and justification actually apply (${before.align})`);
  const mismatch = errors.filter((e) => /418|hydrat/i.test(e));
  check(mismatch.length === 0, `no hydration mismatch (${mismatch[0] ?? 'clean'})`);
  check(errors.length === 0, `no page errors at all (${errors.length}: ${errors[0] ?? ''})`);
  await page.close();
}

/** The runtime and its chart chunk are requested up front, and cached. */
async function runPreload() {
  const st = await startDocument(B);
  await publish(st.id, st.token, CHART, 'preload gate');

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(page.context());
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

  const html = await (await fetch(`${B}/a/${st.id}`)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  const entry = [...head.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m => m[1]).find(h => /\/assets\/[^/]+\.js$/.test(h));
  check(!!entry, `the app module is discoverable in the initial head (${entry ?? 'absent'})`);
  check(/\/assets\/[^/]+-[\w-]+\.js$/.test(entry ?? ''), `…at a content-addressed URL (${entry})`);
  check(started.filter(r => new URL(r.url).pathname === entry).length === 1, 'the browser fetches the app entry exactly once');
  await page.locator('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas').first().waitFor({ timeout: 30_000 });
  check(await page.locator('[aria-label="Question embed"] svg, [aria-label="Question embed"] canvas').count() > 0, 'the lazily loaded artifact runtime renders the actual chart');

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
  check(started.filter(r => /\.js(?:\?|$)/.test(r.url)).length > 1, 'the browser fetched the app and its runtime dependencies');

  // Not a chart: the split has to keep meaning something.
  const prose = await startDocument(B);
  await publish(prose.id, prose.token, PROSE, 'preload gate prose');
  const proseHead = (await (await fetch(`${B}/a/${prose.id}/raw`)).text()).split('</head>')[0];
  // It hydrates (it declares data), so the entry's own static chunks are
  // preloaded with the entry — but nothing only the chart module needs.
  const manifest = await (await fetch(`${B}/story/manifest.json`)).json();
  const chartOnly = manifest.lazy.flatMap((chunk) => [chunk, ...(manifest.lazyDeps?.[chunk] ?? [])])
    .filter((url) => !(manifest.entryDeps ?? []).includes(url));
  check(chartOnly.length > 0 && chartOnly.every((url) => !proseHead.includes(url)),
    `a prose document does not preload the chart chunk or its own dependencies (${chartOnly.filter((url) => proseHead.includes(url)).join(' ') || 'none'})`);

  await page.close();
}

/** The response headers themselves — the config is necessary but not sufficient. */
async function runCaching() {
  const manifest = await (await fetch(`${B}/story/manifest.json`)).json().catch(() => null);
  check(!!manifest?.entry, `the build published a manifest (${manifest?.entry ?? 'none'})`);
  const urls = [manifest.entry, ...(manifest.lazy ?? [])];
  for (const u of urls) {
    const res = await fetch(`${B}${u}`, { method: 'HEAD' });
    const cc = res.headers.get('cache-control') ?? '';
    check(res.status === 200, `${u} is served (${res.status})`);
    check(cc.includes('immutable') && cc.includes('max-age=31536000'), `${u} is immutable for a year (${cc})`);
    // Load-bearing, not hygiene: `import()` is CORS-mode and the document has
    // an opaque origin, so without this every chart silently fails to draw.
    check(res.headers.get('access-control-allow-origin') === '*', `${u} keeps its CORS header`);
  }
}

/**
 * A Mermaid document names exactly the code its diagram kind loads — the
 * engine, the diagram's module, its layout engine — and every one is used.
 *
 * Mermaid discovers that code in a chain (engine → detect → diagram module →
 * layout engine), so without the names a flowchart's elk layout starts four
 * round trips after the document. Mermaid 12 lays flowcharts out with elk BY
 * DEFAULT, so a flowchart's closure includes elk; a sequence diagram's must not.
 */
const FLOWCHART = '<div data-design="tw" className="p-10"><Mermaid title="Pipeline" code={"flowchart LR\\n  a[Request] --> b[Render]\\n  b --> c[Read]"} /></div>';
const SEQUENCE = '<div data-design="tw" className="p-10"><Mermaid title="Hello" code={"sequenceDiagram\\n  A->>B: hi\\n  B-->>A: back"} /></div>';
async function runMermaidPreload() {
  const manifest = await (await fetch(`${B}/story/manifest.json`)).json();
  for (const [kind, markup] of [['flowchart', FLOWCHART], ['sequence', SEQUENCE]]) {
    const st = await startDocument(B);
    await publish(st.id, st.token, markup, `mermaid preload ${kind}`);

    // The served document: its head names the kind's closure, and the browser fetches nothing else.
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const scripts = [];
    const warnings = [];
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
    page.on('console', (m) => { if (/preloaded .* not used/i.test(m.text())) warnings.push(m.text()); });
    await page.goto(`${B}/a/${st.id}/raw`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    check(await waitFor(page, `!!document.querySelector('[data-mx-mermaid-state=ready]')`, 30000), `${kind}: the diagram draws in the served document`);
    const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel=modulepreload]')].map((l) => new URL(l.href).pathname));
    const closure = manifest.mermaid?.[kind] ?? [];
    check(closure.length > 0 && closure.every((url) => preloads.includes(url)), `${kind}: the head names the kind's whole closure (${closure.length} chunks)`);
    const missed = [...new Set(scripts)].filter((url) => !preloads.includes(url));
    check(missed.length === 0, `${kind}: every script the document runs was preloaded (${missed.join(' ') || 'all'})`);
    const unused = preloads.filter((url) => !scripts.includes(url));
    check(unused.length === 0, `${kind}: every preload is used (${unused.join(' ') || 'all'})`);
    const elk = scripts.some((url) => /\/elk-[\w-]+\.js$/.test(url));
    check(elk === (kind === 'flowchart'), `${kind}: elk is fetched exactly when the kind draws with it (${elk})`);
    const other = manifest.mermaid?.[kind === 'flowchart' ? 'sequence' : 'flowchart'] ?? [];
    const foreign = other.filter((url) => !closure.includes(url) && preloads.includes(url));
    check(foreign.length === 0, `${kind}: no other kind's chunks are named (${foreign.join(' ') || 'none'})`);
    await page.waitForTimeout(3500);
    check(warnings.length === 0, `${kind}: no preload goes unused (${warnings[0] ?? 'clean'})`);
    await page.close();

    // The app's reader page: from a production build (a Vite manifest), the
    // same kind's chunks are named in its head. A dev server has no manifest
    // and names none, so there is nothing to assert there.
    const appHead = (await (await fetch(`${B}/a/${st.id}`, { headers: { accept: 'text/html' } })).text()).split('</head>')[0];
    if (/<link rel="modulepreload" href="\/assets\//.test(appHead)) {
      check(/rel="modulepreload" href="\/assets\/mermaid-render-[\w-]+\.js"/.test(appHead), `${kind}: the reader page preloads the Mermaid engine`);
      check(/\/assets\/elk-[\w-]+\.js/.test(appHead) === (kind === 'flowchart'), `${kind}: the reader page preloads elk exactly when the kind draws with it`);
      const app = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const appWarnings = [];
      app.on('console', (m) => { if (/preloaded .* not used/i.test(m.text())) appWarnings.push(m.text()); });
      await githubWidgetFixture(app.context());
      await app.goto(`${B}/a/${st.id}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      check(await waitFor(app, `!!document.querySelector('[data-mx-mermaid-state=ready]')`, 30000), `${kind}: the diagram draws on the reader page`);
      await app.waitForTimeout(3500);
      check(appWarnings.length === 0, `${kind}: no reader-page preload goes unused (${appWarnings[0] ?? 'clean'})`);
      await app.close();
    }
  }
}

try {
  await runNoRepaint();
  await runPreload();
  await runMermaidPreload();
  await runCaching();
} finally {
  await browser.close();
}

check.done();
