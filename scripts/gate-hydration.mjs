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
 * 3. THE READER'S TAKEOVER. The app page (`/a/<id>`, `/@owner/<slug>`) serves
 *    the same document inline, and the reader's runtime HYDRATES that server
 *    story instead of drawing it again (lib/story-runtime/inline-composition).
 *    Every element the server drew must be the element React owns afterwards
 *    — for the page-speed fixtures and the kitchen sink, as every role, in
 *    both color schemes, on an archived version and on the /edit entry — with
 *    no hydration error, no dangling generated id, and a takeover that no
 *    Suspense fallback throttle (300 ms each, twice, before) sits in.
 *
 *   usage: node scripts/gate-hydration.mjs [base]
 */
import { createChecker } from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import { chromium } from 'playwright';
import { STORED_DRAWING_READER, launchStoredDrawingReader } from './lib/mermaid-reader.mjs';
import { becomeAccountOwner, becomeOwner, publishAs, startDocument } from './lib/start-doc.mjs';
import { githubWidgetFixture } from './lib/github-widget-fixture.mjs';
import { loginViaEmail, startMailSink } from './lib/mail-login.mjs';
import { publishPageSpeedFixtures } from './fixtures/page-speed/index.mjs';
import { kitchenSinkMarkup } from './lib/kitchen-sink-doc.mjs';

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

// The reader stored Mermaid drawings are made for (scripts/lib/mermaid-reader): the gate's
// Mermaid fixture is judged as such a reader meets it, on any runner.
const browser = await launchStoredDrawingReader(chromium);

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
 * That is the ENGINE's path (`?mermaid=engine`, what a reader gets until the
 * background harvest has stored the diagram, lib/mermaid-images); once it has,
 * the same document names no diagram code at all and runs none.
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
  // What the reader page names for EVERY document — the hints a Mermaid document adds are the rest.
  const plain = await startDocument(B);
  await publish(plain.id, plain.token, '<Card><CardContent>no diagram</CardContent></Card>', 'mermaid preload baseline');
  const hrefs = (head) => [...head.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
  const plainHead = new Set(hrefs((await (await fetch(`${B}/a/${plain.id}`, { headers: { accept: 'text/html' } })).text()).split('</head>')[0]));
  /*
   * USED means EVALUATED, not fetched: a modulepreload is itself a request, so
   * "requested" is true of every preload whether or not anything imports it.
   * V8's coverage lists a module only once it has run (a preloaded module no
   * one imports is absent), so the check reads that.
   */
  const evaluated = async (page) => new Set((await page.coverage.stopJSCoverage())
    .filter((e) => /^https?:/.test(e.url) && (e.functions[0]?.ranges[0]?.count ?? 0) > 0)
    .map((e) => new URL(e.url).pathname));
  for (const [kind, markup] of [['flowchart', FLOWCHART], ['sequence', SEQUENCE]]) {
    const st = await startDocument(B);
    await publish(st.id, st.token, markup, `mermaid preload ${kind}`);

    // The served document: its head names the kind's closure, and the browser fetches nothing else.
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const scripts = [];
    const warnings = [];
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
    page.on('console', (m) => { if (/preloaded .* not used/i.test(m.text())) warnings.push(m.text()); });
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await page.goto(`${B}/a/${st.id}/raw?mermaid=engine`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    check(await waitFor(page, `!!document.querySelector('[data-mx-mermaid-state=ready]')`, 30000), `${kind}: the diagram draws in the served document`);
    const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel=modulepreload]')].map((l) => new URL(l.href).pathname));
    const closure = manifest.mermaid?.[kind] ?? [];
    check(closure.length > 0 && closure.every((url) => preloads.includes(url)), `${kind}: the head names the kind's whole closure (${closure.length} chunks)`);
    const missed = [...new Set(scripts)].filter((url) => !preloads.includes(url));
    check(missed.length === 0, `${kind}: every script the document runs was preloaded (${missed.join(' ') || 'all'})`);
    await page.waitForTimeout(500);
    const ran = await evaluated(page);
    const unused = preloads.filter((url) => !ran.has(url));
    check(unused.length === 0, `${kind}: every preloaded module is evaluated (${unused.join(' ') || 'all'})`);
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
    const appHead = (await (await fetch(`${B}/a/${st.id}?mermaid=engine`, { headers: { accept: 'text/html' } })).text()).split('</head>')[0];
    if (/<link rel="modulepreload" href="\/assets\//.test(appHead)) {
      check(/rel="modulepreload" href="\/assets\/mermaid-render-[\w-]+\.js"/.test(appHead), `${kind}: the reader page preloads the Mermaid engine`);
      check(/\/assets\/elk-[\w-]+\.js/.test(appHead) === (kind === 'flowchart'), `${kind}: the reader page preloads elk exactly when the kind draws with it`);
      const added = hrefs(appHead).filter((href) => !plainHead.has(href));
      const app = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const appWarnings = [];
      app.on('console', (m) => { if (/preloaded .* not used/i.test(m.text())) appWarnings.push(m.text()); });
      await githubWidgetFixture(app.context());
      await app.coverage.startJSCoverage({ resetOnNavigation: false });
      await app.goto(`${B}/a/${st.id}?mermaid=engine`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      check(await waitFor(app, `!!document.querySelector('[data-mx-mermaid-state=ready]')`, 30000), `${kind}: the diagram draws on the reader page`);
      await app.waitForTimeout(3500);
      check(appWarnings.length === 0, `${kind}: no reader-page preload goes unused (${appWarnings[0] ?? 'clean'})`);
      const appRan = await evaluated(app);
      const idle = added.filter((href) => !appRan.has(href));
      check(added.length > 0 && idle.length === 0, `${kind}: every chunk the reader page adds for this document is evaluated (${added.length} added; unused: ${idle.join(' ') || 'none'})`);
      await app.close();
    }

    // HARVESTED: the stored drawing replaces the engine, so its code is neither named nor run.
    let rawHtml = '';
    for (const end = Date.now() + 60000; Date.now() < end && !rawHtml.includes('"mermaidImages"');) {
      rawHtml = await (await fetch(`${B}/a/${st.id}/raw`, { headers: { 'user-agent': STORED_DRAWING_READER.userAgent } })).text();
      if (!rawHtml.includes('"mermaidImages"')) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (check(rawHtml.includes('"mermaidImages"'), `${kind}: the background harvest stored the diagram`)) {
      const storedHead = rawHtml.split('</head>')[0];
      check(closure.every((url) => !storedHead.includes(url) || manifest.entryDeps?.includes(url)), `${kind}: once stored, the head names none of the kind's closure`);
      check(/<link rel="preload" href="\/assets\/mermaid\/[0-9a-f]{64}\.svg" as="image">/.test(storedHead), `${kind}: once stored, the head asks for the drawing instead`);
      const stored = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const storedScripts = [];
      stored.on('request', (r) => { if (r.resourceType() === 'script') storedScripts.push(new URL(r.url()).pathname); });
      await stored.goto(`${B}/a/${st.id}/raw`, { waitUntil: 'domcontentloaded', timeout: 90000 });
      check(await waitFor(stored, `!!document.querySelector('[data-mx-mermaid-state=ready] img[src^="/assets/mermaid/"]')`, 30000), `${kind}: the stored drawing draws in the served document`);
      const engine = storedScripts.filter((url) => closure.includes(url) && !manifest.entryDeps?.includes(url));
      check(engine.length === 0, `${kind}: once stored, the served document runs no diagram code (${engine.join(' ') || 'none'})`);
      await stored.close();
    }
  }
}

/*
 * THE READER HYDRATES THE SERVER'S STORY.
 *
 * Marked when the HTML has been parsed (readyState `interactive`, before any
 * deferred module runs): every element of the served story. Judged at the
 * story root's FIRST COMMIT — React tells the DevTools hook about every commit,
 * production builds included, and this probe is that hook — which is the
 * hydration commit, before any effect or data has changed the document on
 * purpose (a Radix part re-keying itself, a chart pane arriving):
 *   - the story sits in the app's root and the server's wrapper is gone;
 *   - every served element is still in the story, and React owns it (a fiber);
 *     a discarded server tree (React's client-render fallback) fails both;
 *   - no aria-controls/labelledby/describedby/for names an element that is
 *     missing now and was present in the served markup;
 *   - its time after DOMContentLoaded, the time the runtime takes to own it.
 * A production React reports a mismatch through reportError (a page error);
 * a development React also reports attribute-only mismatches (console.error).
 * Any console error or page error fails the load.
 */
const TAKEOVER_PROBE = () => {
  const refs = ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for'];
  const dangling = (root) => [...root.querySelectorAll(refs.map((a) => `[${a}]`).join(','))]
    .flatMap((el) => refs.flatMap((a) => (el.getAttribute(a) ?? '').split(' ').filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => `${a}=${id}`)));
  const state = (window.__readerHydration = { served: null, story: null, dcl: null, verdict: null });
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive' || state.story) return;
    const story = document.querySelector('[data-mx-initial-story] > [data-mx-inline-story]');
    if (!story) return;
    const where = (n) => { const a = n.parentElement?.closest('[data-mx-ast],[data-slot],[aria-label]'); return a ? `${a.localName}[${a.getAttribute('aria-label') ?? a.getAttribute('data-slot') ?? a.getAttribute('data-mx-ast')}]` : 'the story'; };
    state.story = story;
    // React 19 hoists a resource hint the server rendered (an image preload); it is not part of the tree.
    state.served = [...story.querySelectorAll('*')].filter((n) => !(n.localName === 'link' && n.rel === 'preload')).map((n) => [n, where(n)]);
    state.dangling = dangling(story);
    // What the reader SAW before the runtime ran: a data document's first results are in it (lib/story/served-results.server).
    state.servedText = story.textContent;
  });
  document.addEventListener('DOMContentLoaded', () => { state.dcl = performance.now(); });
  const judge = () => {
    const story = state.story;
    const show = ([n, at]) => `${n.outerHTML.slice(0, 90)} in ${at}`;
    const lost = state.served.filter(([n]) => !story.contains(n));
    // Markup React sets as raw HTML (an <Icon>'s glyph) is kept, never owned node by node.
    const raw = (n) => { for (let e = n.parentElement; e && e !== story; e = e.parentElement) { const k = Object.keys(e).find((key) => key.startsWith('__reactProps$')); if (k && e[k]?.dangerouslySetInnerHTML) return true; } return false; };
    const unowned = state.served.filter(([n]) => story.contains(n) && !Object.keys(n).some((k) => k.startsWith('__reactFiber$')) && !raw(n));
    state.verdict = {
      at: performance.now(), served: state.served.length,
      adopted: !!document.getElementById('root')?.contains(story) && !document.querySelector('[data-mx-initial-story]'),
      lost: lost.slice(0, 3).map(show), lostCount: lost.length,
      unowned: unowned.slice(0, 3).map(show), unownedCount: unowned.length,
      dangling: dangling(story).filter((ref) => !state.dangling.includes(ref)),
    };
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), inject: () => 1,
    onCommitFiberRoot: (_id, root) => { if (!state.verdict && state.story && root.containerInfo === state.story) judge(); },
    onCommitFiberUnmount: () => {}, onPostCommitFiberRoot: () => {}, checkDCE: () => {},
  };
};

/** Open `path` in a fresh page of `context`, the OS in `scheme`, and judge the takeover; returns the takeover time after DOMContentLoaded. */
async function judgeTakeover(context, scheme, path, label, after, servedText) {
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: scheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`page error: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${m.text().slice(0, 300)} (${m.location().url})`); });
  await page.addInitScript(TAKEOVER_PROBE);
  await page.goto(`${B}${path}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  const ready = await waitFor(page, '!!window.__readerHydration?.verdict', 30000);
  // Leave the document running a moment, so an error raised as data and panes land is still this load's.
  await page.waitForTimeout(500);
  await after?.(page);
  const { verdict, dcl, served, text } = await page.evaluate(() => { const h = window.__readerHydration; return { verdict: h.verdict, dcl: h.dcl, served: h.served?.length ?? 0, text: h.servedText ?? '' }; });
  const where = new URL(page.url()).pathname + new URL(page.url()).search;
  await page.close();
  check(ready && served > 0 && verdict.adopted, `${label}: the served story was adopted by the app and hydrated (${where}, ${served} elements)`);
  if (servedText) check(text.includes(servedText), `${label}: the served story already shows its first results (${servedText}) before the runtime ran`);
  if (!ready || !verdict) return null;
  check(verdict.lostCount === 0, `${label}: every served element survived hydration (${verdict.lostCount} lost ${verdict.lost.join(' ') || ''})`);
  check(verdict.unownedCount === 0, `${label}: React owns every served element (${verdict.unownedCount} not ${verdict.unowned.join(' ') || ''})`);
  check(verdict.dangling.length === 0, `${label}: no generated id reference dangles (${verdict.dangling.join(' ') || 'none'})`);
  check(errors.length === 0, `${label}: no hydration error or warning, no page error (${errors.length}: ${errors[0] ?? ''})`);
  return verdict.at - dcl;
}

const publish1 = (doc, markup) => publish(doc.id, doc.token, markup, 'hydration versions');

async function runReaderHydration() {
  const sink = await startMailSink();
  const stamp = Date.now();
  const account = async (role) => {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await githubWidgetFixture(context);
    const page = await context.newPage();
    const email = `mxmx_test_hydration_${role}_${stamp}@example.com`;
    await loginViaEmail(page, B, sink, email);
    return { context, page, email };
  };
  const ownerContext = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(ownerContext);
  const ownerPage = await ownerContext.newPage();
  await becomeAccountOwner(ownerPage, B, { sink, email: `mxmx_test_hydration_owner_${stamp}@example.com` });
  const publish = (body) => publishAs(ownerPage, body);
  const fixtures = await publishPageSpeedFixtures(publish);
  const sinkDoc = await publish({ title: 'Hydration kitchen sink', markup: await kitchenSinkMarkup(publish), theme: 'modernist', colorMode: 'dark', visibility: 'unlisted' });
  // An author's Helmet script runs in its own sandboxed frame; its document still hydrates.
  const scripted = await publish({ title: 'Hydration scripted', markup: '<Helmet><script>{`document.body.dataset.ran = "yes"`}</script></Helmet><article><h1>Scripted</h1><Card><CardContent>with a card</CardContent></Card></article>', visibility: 'unlisted' });
  // The parse-survival shapes of the repaint check below (a div in a <p>, a Button in a trigger, a <For> in an svg).
  const survival = await publish({ title: 'Hydration parse survival', markup: PROSE, visibility: 'unlisted' });
  const kit = fixtures.find((f) => f.key === 'kit');
  // The Mermaid fixture is read as readers meet it once its diagram is stored (lib/mermaid-images):
  // the stored drawing is in the served story and must hydrate as it was served.
  const diagram = fixtures.find((f) => f.key === 'mermaid');
  let storedDiagram = false;
  for (const end = Date.now() + 60000; !storedDiagram && Date.now() < end;) {
    storedDiagram = (await (await fetch(`${B}/api/page/artifact/${diagram.id}`, { headers: { 'user-agent': STORED_DRAWING_READER.userAgent } })).text()).includes('"mermaidImages"');
    if (!storedDiagram) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  check(storedDiagram, 'the mermaid fixture\'s diagram was stored before the reader loads');
  const drawnFromStorage = (who) => async (page) => check(await waitFor(page, `!!document.querySelector('#root [data-mx-mermaid-state=ready] img[src^="/assets/mermaid/"]') && !document.querySelector('#root figure[data-mx-mermaid-palette]')`, 15000),
    `mermaid, ${who}: the hydrated story shows the stored drawing and drew nothing with the engine`);
  // Two versions, so `?version=1` is an ARCHIVED render — which only the owner's history reaches.
  const versioned = await startDocument(B);
  await publish1(versioned, '<article><h1>First version</h1><Tabs defaultValue="a"><TabsList><TabsTrigger value="a">A</TabsTrigger><TabsTrigger value="b">B</TabsTrigger></TabsList><TabsContent value="a">a</TabsContent><TabsContent value="b">b</TabsContent></Tabs><Accordion type="single" collapsible><AccordionItem value="x"><AccordionTrigger>Open</AccordionTrigger><AccordionContent>inside</AccordionContent></AccordionItem></Accordion></article>');
  await publish1(versioned, '<article><h1>Second version</h1></article>');
  const historian = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(historian);
  await becomeOwner(await historian.newPage(), B, versioned.token);
  const editor = await account('editor');
  const commenter = await account('commenter');
  for (const id of [sinkDoc.id, kit.id, fixtures.find((f) => f.key === 'dashboard').id]) {
    const shared = await ownerPage.evaluate(async ({ id, shares }) => (await fetch(`/api/my/artifacts/${id}/sharing`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shares }) })).status,
      { id, shares: [{ email: editor.email, role: 'editor' }, { email: commenter.email, role: 'commenter' }] });
    check(shared === 200, `shared ${id} with an editor and a commenter (${shared})`);
  }
  // A comment thread on the kit fixture, so a load can open the document through its deep link:
  // the pins and the open thread are drawn over the story after it hydrates.
  const thread = await ownerPage.evaluate(async (id) => {
    const head = await (await fetch(`/api/my/artifacts/${id}`)).json();
    const made = await fetch(`/api/my/artifacts/${id}/annotations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '1.1' /* the kit fixture's <h1> */, edit_id: head.edit_id, body: 'Is this heading right?' }) });
    const wire = await (await fetch(`/api/my/artifacts/${id}`)).json();
    return { status: made.status, refusal: made.ok ? '' : (await made.text()).slice(0, 200), id: wire.annotations?.[0]?.id ?? null };
  }, kit.id);
  check(thread.status === 201 && !!thread.id, `the owner left a comment on the kit fixture's heading (${thread.status}${thread.refusal ? ` ${thread.refusal}` : ''})`);
  const anonymous = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await githubWidgetFixture(anonymous);

  const times = [];
  const dashboardId = fixtures.find((f) => f.key === 'dashboard').id;
  // The dashboard fixture's KPI over sales.csv, which its HTML carries (a data fixture WITH results).
  const firstResults = (path) => (path === `/a/${dashboardId}` ? '$744,503' : undefined);
  const load = async (context, scheme, path, label, after) => {
    const t = await judgeTakeover(context, scheme, path, `${label} (${scheme})`, after, firstResults(path));
    if (t !== null) times.push(t);
  };
  // Every fixture and the kitchen sink, anonymous and as the owner (whose address is the pretty /@owner one).
  for (const doc of [...fixtures, { key: 'kitchen sink', id: sinkDoc.id }, { key: 'scripted', id: scripted.id }, { key: 'parse survival', id: survival.id }]) {
    await load(anonymous, 'light', `/a/${doc.id}`, `${doc.key}, anonymous`, doc === diagram ? drawnFromStorage('anonymous') : undefined);
    await load(ownerContext, 'dark', `/a/${doc.id}`, `${doc.key}, owner`, doc === diagram ? drawnFromStorage('owner') : undefined);
  }
  await load(historian, 'dark', `/a/${versioned.id}?version=1`, 'version 1 of 2 (archived), its owner');
  await load(ownerContext, 'light', `/a/${kit.id}/edit`, 'kit, owner entering /edit');
  const threadOpen = (who) => async (page) => check(await page.locator('[aria-label="Reply to annotation"]').first().waitFor({ timeout: 10000 }).then(() => true, () => false),
    `kit, ${who}: the linked comment thread opened over the hydrated story`);
  await load(ownerContext, 'dark', `/a/${kit.id}?comment=${thread.id}`, 'kit with its comment thread open, owner', threadOpen('owner'));
  await load(commenter.context, 'light', `/a/${kit.id}?comment=${thread.id}`, 'kit with its comment thread open, commenter', threadOpen('commenter'));
  for (const [who, context] of [['editor', editor.context], ['commenter', commenter.context]]) {
    await load(context, 'light', `/a/${sinkDoc.id}`, `kitchen sink, ${who}`);
    await load(context, 'dark', `/a/${fixtures.find((f) => f.key === 'dashboard').id}`, `dashboard, ${who}`);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  check.note(`takeover after DOMContentLoaded: median ${Math.round(median)} ms over ${times.length} loads (min ${Math.round(times[0])}, max ${Math.round(times.at(-1))})`);
  // Only a production build is timed: a dev server's unbundled modules are not what readers get.
  const head = (await (await fetch(`${B}/a/${kit.id}`, { headers: { accept: 'text/html' } })).text()).split('</head>')[0];
  if (/<link rel="modulepreload" href="\/assets\//.test(head)) {
    /*
     * Judged on the FASTEST load, not the median: the fault this guards — a
     * Suspense fallback revealed behind React's 300 ms throttle, twice per
     * document before — is a wall-clock FLOOR every load pays, however idle the
     * machine. A shard's parallel gates only ever ADD time (measured: median
     * 180–351 ms across CI runs, min 122–190 ms), so one load under 300 ms is
     * a load no throttle sat in, and a median threshold would be judging the
     * runner's contention instead.
     */
    check(times[0] < 300, `the runtime takes over in under 300 ms after DOMContentLoaded, unthrottled (fastest ${Math.round(times[0])} ms, median ${Math.round(median)} ms)`);
  }
  for (const context of [ownerContext, anonymous, historian, editor.context, commenter.context]) await context.close();
}

try {
  await runReaderHydration();
  await runNoRepaint();
  await runPreload();
  await runMermaidPreload();
  await runCaching();
} finally {
  await browser.close();
}

check.done();
