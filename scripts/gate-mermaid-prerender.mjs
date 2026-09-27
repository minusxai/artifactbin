/**
 * Gate: a published Mermaid diagram is drawn from stored SVG — and the stored
 * drawing IS the one the engine draws in the reader's own page.
 *
 * After publish the app harvests every diagram to SVG in the background
 * (lib/mermaid-images); a reader is then served the stored drawing and loads
 * no Mermaid code. That is only a speed-up if nothing changes for the reader,
 * so this gate proves it where fonts are the CI runner's: for every kind in
 * scripts/fixtures/mermaid/kinds.mjs, on both reader surfaces (the served
 * document `/a/<id>/raw` and the app's reader `/a/<id>`), in both colour modes,
 * with author CSS overriding the theme, and inside a grid tile, the page drawn
 * with the engine (`?mermaid=engine`, what every reader got before) and the
 * page drawn from storage must show BYTE-IDENTICAL SVG once the per-page ids
 * (`mx-mermaid-N`) are normalized. Kinds that are not stored must not be, for
 * the reason the fixture gives (gantt's "today" line is never stored, so it is
 * never compared), and a page whose diagrams are all stored must request no
 * Mermaid, elk, cytoscape or langium code.
 *
 * THE READER IT IS FOR (lib/mermaid-images/match, scripts/lib/mermaid-reader):
 * stored drawings are made for Blink on macOS or Windows — unhinted text — and
 * the harvest measures that way on any OS. The comparisons above run as that
 * reader (Chromium launched unhinted, a macOS user agent); on a Linux runner a
 * byte-identical stored drawing and a page with no engine code prove the
 * harvest's browser measured unhinted too. Then the decision on the other side:
 * a reader whose Chromium hints text (Linux) is served the engine's page — no
 * stored drawing, no image preload, the engine drawing every diagram — and a
 * diagram drawn in a system font is never stored, so even the reader it is
 * for draws it with the engine.
 *
 *   usage: node scripts/gate-mermaid-prerender.mjs [base]
 */
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { startDocument } from './lib/start-doc.mjs';
import { MERMAID_KIND_SAMPLES } from './fixtures/mermaid/kinds.mjs';
import { LINUX_READER_USER_AGENT, STORED_DRAWING_READER, launchStoredDrawingReader } from './lib/mermaid-reader.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('mermaid-prerender');

const diagram = (sample) => `<Mermaid title=${JSON.stringify(sample.kind)} code={${JSON.stringify(sample.code)}} />`;
const STORED = MERMAID_KIND_SAMPLES.filter((s) => s.stored);
const UNSTORED = MERMAID_KIND_SAMPLES.filter((s) => !s.stored);
/** Every kind that is stored, in prose; the engine should never load for this one. */
const KINDS_DOC = `<div data-design="tw" className="p-10"><h1>Every kind</h1>${STORED.map(diagram).join('')}</div>`;
/** The kinds that must stay with the engine — beside one that is stored, so the gate can see the harvest has run. */
const SENTINEL = STORED.find((s) => s.kind === 'pie');
const UNSTORED_DOC = `<div data-design="tw" className="p-10"><h1>Engine kinds</h1>${[SENTINEL, ...UNSTORED].map(diagram).join('')}</div>`;
/** Author CSS overriding the theme's colours, a dark document, and a diagram in a grid tile. */
const CONTEXT = [
  { kind: 'styled flowchart', code: 'flowchart LR\n  a[Styled] --> b{Theme?}\n  b -->|override| c[Author CSS]' },
  { kind: 'tiled sequence', code: 'sequenceDiagram\n  Tile->>Grid: fits\n  Grid-->>Tile: scaled' },
];
const CONTEXT_DOC = '<Helmet><style>{`:root { --primary: #c2410c; --card: #fff7ed; --muted: #ffedd5; --border: #fb923c; } .dark { --primary: #fdba74; --card: #431407; --muted: #7c2d12; }`}</style></Helmet>'
  + `<div data-design="tw" className="p-10"><h1>Context</h1>${diagram(CONTEXT[0])}`
  + `<Grid><GridItem x={0} y={0} w={6} h={4}>${diagram(CONTEXT[1])}</GridItem></Grid></div>`;

/** A diagram in a system font beside a stored one (the pie, in the theme's web fonts): the harvest ran, and kept only the pie. */
const SYSTEM_FONT = [
  { kind: 'system-font flowchart', code: 'flowchart LR\n  a[System] --> b{Font?}\n  b -->|yes| c[Engine]' },
  { kind: 'system-font sequence', code: 'sequenceDiagram\n  Reader->>Server: page\n  Server-->>Reader: engine' },
];
const SYSTEM_FONT_DOC = '<Helmet><style>{`.system-font { font-family: ui-sans-serif, system-ui, sans-serif; --font-mono: ui-monospace, Menlo, monospace; }`}</style></Helmet>'
  + `<div data-design="tw" className="p-10"><h1>System font</h1>${diagram(SENTINEL)}<div className="system-font">${SYSTEM_FONT.map(diagram).join('')}</div></div>`;

const publish = async (markup, title, extra = {}) => {
  const st = await startDocument(B);
  const res = await fetch(`${B}/api/artifacts/${st.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${st.token}` },
    body: JSON.stringify({ title, markup, theme: 'modernist', ...extra }),
  });
  if (!res.ok) throw new Error(`publish failed (${res.status}): ${await res.text()}`);
  return st.id;
};

/** The harvest writes a version's drawings at once; wait until the served document carries them. */
async function harvested(id, ms = 170_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const html = await (await fetch(`${B}/a/${id}/raw`, { headers: { 'user-agent': STORED_DRAWING_READER.userAgent } })).text();
    if (html.includes('"mermaidImages"')) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

const ENGINE_CODE = (path) => /mermaid-render|mermaid\.core|mermaid-core|^(elk|cytoscape|langium)[\w.-]*\.js$/i.test(path.split('/').pop() ?? '')
  || /node_modules\/(\.vite\/deps\/)?(mermaid|elkjs|cytoscape|langium|@mermaid-js)/.test(path);
const normalize = (svg) => svg.replace(/mx-mermaid-\d+/g, 'mx-mermaid-N');

const browser = await launchStoredDrawingReader(chromium);
/** A reader whose Chromium hints text, as Linux's does by default; its user agent says Linux on any runner. */
const hinted = await chromium.launch();

/**
 * One page, every diagram drawn: title → { src, svg (decoded when the engine
 * drew it), palette }, and the script paths the page asked for. `mode` is the
 * reader's own override, carried the way the reader toggle carries it.
 */
async function drawings(url, mode = null, reader = browser, userAgent = undefined) {
  const page = await reader.newPage({ viewport: { width: 1440, height: 1000 }, ...(userAgent ? { userAgent } : {}) });
  const scripts = [];
  const images = [];
  page.on('request', (r) => {
    if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname);
    if (new URL(r.url()).pathname.startsWith('/assets/mermaid/')) images.push(new URL(r.url()).pathname);
  });
  if (mode) await page.addInitScript((m) => { window.name = `mx:doc:${JSON.stringify({ mode: m })}`; }, mode);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const drawn = await page.waitForFunction(() => {
    const figures = [...document.querySelectorAll('figure[data-mx-mermaid-state]')];
    // Before the app's reader takes over, its server copy is a sibling that never draws.
    return figures.length > 0 && !document.querySelector('[data-mx-initial-story]') && figures.every((f) => f.getAttribute('data-mx-mermaid-state') !== 'pending');
  }, null, { timeout: 90_000 }).then(() => true, () => false);
  await page.waitForTimeout(500);
  const figures = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('figure[data-mx-mermaid-state]')].map((f) => {
    const src = f.querySelector('img')?.getAttribute('src') ?? '';
    const prefix = 'data:image/svg+xml;charset=utf-8,';
    return [f.querySelector('figcaption')?.textContent ?? '', { state: f.getAttribute('data-mx-mermaid-state'), src, svg: src.startsWith(prefix) ? decodeURIComponent(src.slice(prefix.length)) : null, palette: f.getAttribute('data-mx-mermaid-palette') }];
  })));
  const head = await page.evaluate(() => document.head.innerHTML);
  await page.close();
  return { drawn, figures, scripts, images, head };
}

/**
 * THE OTHER SIDE OF THE DECISION: a reader that cannot use the stored drawings
 * is served the engine's page. It downloads no stored drawing (none is named,
 * none preloaded), and the engine draws every diagram.
 */
async function engineServed(label, url, samples, reader, userAgent) {
  const served = await drawings(url, null, reader, userAgent);
  check(served.drawn, `${label}: every diagram draws`);
  check(served.images.length === 0, `${label}: no stored drawing is requested (${served.images.slice(0, 2).join(' ') || 'none'})`);
  check(!/rel="preload" href="\/assets\/mermaid\//.test(served.head), `${label}: no stored drawing is preloaded`);
  for (const sample of samples) check(served.figures[sample.kind]?.src.startsWith('data:'), `${label} ${sample.kind}: drawn by the engine`);
  check(served.scripts.some(ENGINE_CODE), `${label}: the engine's code is loaded`);
}

/** Engine vs storage for one page and mode: every stored kind identical, every unstored kind left to the engine. */
async function compare(label, url, samples, mode = null, { allStored = false } = {}) {
  const sep = url.includes('?') ? '&' : '?';
  // Both pages at once: fresh contexts share nothing, and the gate's budget is the shard's.
  const [engine, served] = await Promise.all([drawings(`${url}${sep}mermaid=engine`, mode), drawings(url, mode)]);
  check(engine.drawn && served.drawn, `${label}: every diagram draws, with the engine and from storage`);
  for (const sample of samples) {
    const drawnByEngine = engine.figures[sample.kind];
    const shown = served.figures[sample.kind];
    if (!drawnByEngine?.svg || !shown) { check(false, `${label} ${sample.kind}: drawn on both pages`); continue; }
    if (sample.stored === false) {
      check(shown.src.startsWith('data:'), `${label} ${sample.kind}: stays with the engine (${sample.why})`);
      continue;
    }
    if (!check(shown.src.startsWith('/assets/mermaid/'), `${label} ${sample.kind}: served as a stored drawing`)) continue;
    const stored = await (await fetch(new URL(shown.src, B).toString())).text();
    const same = normalize(stored) === normalize(drawnByEngine.svg);
    check(same, `${label} ${sample.kind}: the stored drawing is byte-identical to the engine's in this page (${stored.length} B)`);
  }
  if (allStored) {
    const loaded = served.scripts.filter(ENGINE_CODE);
    check(loaded.length === 0, `${label}: no Mermaid, elk, cytoscape or langium code is requested (${loaded.slice(0, 3).join(' ') || 'none'})`);
  }
}

try {
  const kinds = await publish(KINDS_DOC, 'prerender: every kind');
  const unstored = await publish(UNSTORED_DOC, 'prerender: engine kinds');
  const context = await publish(CONTEXT_DOC, 'prerender: context', { colorMode: 'dark' });
  const systemFont = await publish(SYSTEM_FONT_DOC, 'prerender: system font');
  for (const id of [kinds, unstored, context, systemFont]) check(await harvested(id), `${id}: the harvest stored this version's drawings`);

  // Every comparison is its own pair of pages; they run side by side.
  await Promise.all([
    compare('raw light', `${B}/a/${kinds}/raw`, STORED, null, { allStored: true }),
    compare('raw dark (reader toggle)', `${B}/a/${kinds}/raw`, STORED, 'dark', { allStored: true }),
    compare('app light', `${B}/a/${kinds}`, STORED, null, { allStored: true }),
  ]);
  await Promise.all([
    compare('raw engine kinds', `${B}/a/${unstored}/raw`, [SENTINEL, ...UNSTORED]),
    compare('raw dark document with author CSS and a grid tile', `${B}/a/${context}/raw`, CONTEXT, null, { allStored: true }),
    compare('raw author CSS toggled light', `${B}/a/${context}/raw`, CONTEXT, 'light', { allStored: true }),
    compare('app dark document with author CSS and a grid tile', `${B}/a/${context}`, CONTEXT, null, { allStored: true }),
  ]);
  await Promise.all([
    // Drawn in a system font: never stored, so the reader it is for draws it with the engine (its sentinel stays stored).
    compare('raw system font', `${B}/a/${systemFont}/raw`, [SENTINEL, ...SYSTEM_FONT.map((s) => ({ ...s, stored: false, why: 'drawn in a system font' }))]),
    // A Linux reader (hinted text): the engine's page, on both surfaces.
    engineServed('raw, hinted Linux reader', `${B}/a/${kinds}/raw`, STORED, hinted, LINUX_READER_USER_AGENT),
    engineServed('app, hinted Linux reader', `${B}/a/${kinds}`, STORED, hinted, LINUX_READER_USER_AGENT),
  ]);
} finally {
  await browser.close();
  await hinted.close();
}
check.done();
