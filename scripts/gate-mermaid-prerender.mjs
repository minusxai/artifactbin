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
 *   usage: node scripts/gate-mermaid-prerender.mjs [base]
 */
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { fixtureFetch as fetch } from './lib/fixture-http.mjs';
import { startDocument } from './lib/start-doc.mjs';
import { MERMAID_KIND_SAMPLES } from './fixtures/mermaid/kinds.mjs';

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
    const html = await (await fetch(`${B}/a/${id}/raw`)).text();
    if (html.includes('"mermaidImages"')) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

const ENGINE_CODE = (path) => /mermaid-render|mermaid\.core|mermaid-core|^(elk|cytoscape|langium)[\w.-]*\.js$/i.test(path.split('/').pop() ?? '')
  || /node_modules\/(\.vite\/deps\/)?(mermaid|elkjs|cytoscape|langium|@mermaid-js)/.test(path);
const normalize = (svg) => svg.replace(/mx-mermaid-\d+/g, 'mx-mermaid-N');

const browser = await chromium.launch();

/**
 * One page, every diagram drawn: title → { src, svg (decoded when the engine
 * drew it), palette }, and the script paths the page asked for. `mode` is the
 * reader's own override, carried the way the reader toggle carries it.
 */
async function drawings(url, mode = null) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
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
  await page.close();
  return { drawn, figures, scripts };
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
  for (const id of [kinds, unstored, context]) check(await harvested(id), `${id}: the harvest stored this version's drawings`);

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
} finally {
  await browser.close();
}
check.done();
