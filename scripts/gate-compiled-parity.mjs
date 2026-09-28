/**
 * Gate: the compiled reader renders what today's renderer renders — element by element.
 *
 * Phase 2 (docs/phase2-architecture.md) compiles each published version to static
 * HTML plus Solid islands. "Identical" is defined HERE, not in the compiler:
 *
 *  - Both pages: a fresh context, 1440x1000, light scheme; the raw document
 *    (`/a/<id>/raw`) with `?reader=legacy` and with `?reader=compiled`; loaded,
 *    data settled (no `[data-mx-chart-state=pending]`, no `[aria-busy=true]` in
 *    the story) plus 1.5 s.
 *  - Walk `#mx-story-root` on both sides in parallel, element children only.
 *    Comments are ignored; text is compared as each element's direct text nodes
 *    concatenated (React splits adjacent text with `<!-- -->`, Solid does not).
 *  - Attributes as sets. `data-hk` (Solid's hydration key) is dropped. Generated
 *    ids (radix-*, «r*», _R_*_, Solid's cl-*) are mapped to G1, G2… by order of
 *    first appearance on each side, and every idref (aria-controls/-labelledby/
 *    -describedby, for) is checked for the SAME dangling/resolved status. The one accepted
 *    difference (lib/compiled-parity-diff, the unit helper's rule): an aria-controls/-labelledby
 *    whose legacy value is a single id absent from the legacy page (a dangling Radix id).
 *  - Computed style on a fixed property list and the border box (0.5 px grid).
 *  - Excluded subtrees: drawn charts (children of `[data-mx-chart-state=ready]`),
 *    Mermaid drawings (children of svg under `[data-mx-mermaid-state]`), canvases.
 *  - A structural mismatch (tag or element-child count) is reported and that
 *    subtree is not descended.
 *  - Served-element survival and DOM mutations during hydration are reported for
 *    both sides; the compiled side must keep every served element except an undrawn
 *    Mermaid figure's placeholder, which both pages replace with the drawing
 *    (lib/compiled-parity-diff survivalOf, the one exemption).
 *  - One interaction sequence on the kit fixture (a tab, an accordion), compared again.
 *
 * Fixtures: the page-speed set (scripts/fixtures/page-speed) and the kitchen sink
 * (scripts/lib/kitchen-sink-doc), published through one bearer token.
 *
 * Until a server serves the compiled path (`FLAG__COMPILED_READER` off, or no
 * compile stored yet), the first compiled response carries no `x-mx-reader:
 * compiled` header: the gate records that as its one check and exits 0, so it
 * can sit in the manifest before the compiler exists.
 *
 *   usage: node scripts/gate-compiled-parity.mjs [base] [--only=kit,deck] [--verbose]
 */
import { chromium } from 'playwright';
import { createChecker } from './lib/assert.mjs';
import { startDocument, pageHeaders } from './lib/start-doc.mjs';
import { publishPageSpeedFixtures } from './fixtures/page-speed/index.mjs';
import { kitchenSinkMarkup } from './lib/kitchen-sink-doc.mjs';
import { diffTrees as diff, survivalOf } from './lib/compiled-parity-diff.mjs';

const B = process.argv[2] ?? 'http://localhost:3030';
const check = createChecker('compiled-parity');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)?.split(',');
/** `--verbose`: every difference as a note, not only the first three per kind. */
const verbose = process.argv.includes('--verbose');

/** The response header the assembler sets (lib/compiled-page/contract READER_MODE_HEADER). */
const READER_HEADER = 'x-mx-reader';
const STYLE = ['display', 'position', 'box-sizing', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-color', 'border-top-width', 'border-bottom-width', 'border-left-width', 'border-right-width', 'visibility', 'opacity', 'text-align', 'white-space'];

/** Installed before page scripts: tag every parsed story element; count mutations after DOMContentLoaded. */
const PROBE = () => {
  // Mutations are counted from the FIRST parsed byte, not from DOMContentLoaded: a module script
  // (hydration) runs before DCL. The parser only ever INSERTS, so attribute, text and removal
  // records are always script work; insertions count only after DCL.
  const s = (window.__sv = { served: [], mutations: 0, mutated: [], dcl: false });
  // An undrawn Mermaid figure's placeholder, noted as parsed (lib/compiled-parity-diff survivalOf: the one exemption).
  const undrawn = (n) => { const p = n.closest('p[role="status"]'); return !!p && !!p.parentElement?.matches('figure[data-mx-mermaid-state="pending"]'); };
  const mark = (n) => { n.__served = true; n.__undrawnMermaid = undrawn(n); s.served.push(n); };
  const tag = (n) => { if (n.nodeType !== 1 || n.__served) return; mark(n); for (const c of n.querySelectorAll('*')) if (!c.__served) mark(c); };
  const inStory = (t) => t.closest?.('#mx-story-root') || t.parentElement?.closest?.('#mx-story-root');
  new MutationObserver((l) => {
    for (const m of l) {
      if (!inStory(m.target)) continue;
      if (m.type === 'childList' && !s.dcl) { for (const n of m.addedNodes) if (n.nodeType === 1) tag(n); if (!m.removedNodes.length) continue; }
      s.mutations++;
      if (s.mutated.length < 8) s.mutated.push(`${m.type}:${m.target.nodeName}${m.attributeName ? '@' + m.attributeName : ''}`);
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  document.addEventListener('DOMContentLoaded', () => { s.dcl = true; }, { once: true });
};

/** Serialize the story tree (in the page) into a comparable form. */
const SNAPSHOT = (STYLE) => {
  const GEN = /^(radix-[^\s]*|«r[^»]*»|_R_[^\s]*_|cl-[\w-]+)$/;
  const ids = new Map();
  const norm = (v) => v.split(/\s+/).map((t) => (GEN.test(t) ? (ids.has(t) || ids.set(t, `G${ids.size + 1}`), ids.get(t)) : t)).join(' ');
  const skipKids = (el) => el.matches('[data-mx-chart-state="ready"]') || (el.tagName === 'svg' && el.closest('[data-mx-mermaid-state]')) || el.matches('canvas');
  const walk = (el) => {
    const attrs = {};
    for (const a of el.attributes) {
      if (a.name === 'data-hk') continue;
      attrs[a.name] = ['id', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'for'].includes(a.name) ? norm(a.value) : a.value;
    }
    const refs = {};
    for (const a of ['aria-controls', 'aria-labelledby', 'aria-describedby', 'for']) { const v = el.getAttribute(a); if (v) refs[a] = v.split(/\s+/).every((id) => document.getElementById(id)) ? 'resolved' : 'dangling'; }
    const cs = getComputedStyle(el);
    const style = Object.fromEntries(STYLE.map((p) => [p, cs.getPropertyValue(p)]));
    const r = el.getBoundingClientRect();
    const box = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 2) / 2);
    const text = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('');
    const kids = skipKids(el) ? [] : [...el.children].map(walk);
    return { tag: el.tagName.toLowerCase(), attrs, refs, style, box, text, kids };
  };
  const root = document.getElementById('mx-story-root');
  // React 19 hoists resource hints (<link rel=preload as=image>) into the root it renders; not document content.
  return root ? [...root.children].filter((c) => c.tagName !== 'LINK').map(walk) : [];
};

const settle = async (page) => {
  await page.waitForFunction(() => { const r = document.getElementById('mx-story-root'); return r && !r.querySelector('[data-mx-chart-state="pending"],[aria-busy="true"]'); }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
};

/** What a reader does on the kit fixture: opens the second tab and the first accordion item. */
const INTERACTIONS = {
  kit: async (page) => {
    await page.getByRole('tab', { name: 'Two' }).click();
    await page.getByRole('button', { name: 'Question one' }).click();
    await page.waitForTimeout(400);
  },
};

/** Publish through the bearer door (`POST /api/artifacts`), the way the CLI does; the refs belong to this token. */
const publisher = (token) => async (body) => {
  const res = await fetch(`${B}/api/artifacts`, { method: 'POST', headers: { ...pageHeaders(B), 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ visibility: 'unlisted', ...body }) });
  if (!res.ok) throw new Error(`publish failed (${res.status}): ${await res.text()}`);
  return res.json();
};

const { token, id: probeId } = await startDocument(B);
// Does this server serve the compiled path at all? One request answers before anything is published.
const probe = await fetch(`${B}/a/${probeId}/raw?reader=compiled`, { headers: pageHeaders(B) });
if (probe.headers.get(READER_HEADER) !== 'compiled') {
  check(true, `compiled reader is not served by this server (${READER_HEADER}: ${probe.headers.get(READER_HEADER) ?? 'absent'}; FLAG__COMPILED_READER off or nothing compiled yet): comparison skipped`);
  check.done();
}

const publish = publisher(token);
const fixtures = await publishPageSpeedFixtures(publish);
const kitchen = await publish({ title: 'Perf G kitchen sink', markup: await kitchenSinkMarkup(publish) });
fixtures.push({ key: 'kitchen', id: kitchen.id, painted: { charts: 1 } });
const chosen = fixtures.filter((f) => !only || only.includes(f.key));

const browser = await chromium.launch();
try {
  for (const f of chosen) {
    const snaps = {};
    for (const route of ['legacy', 'compiled']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
      await context.addInitScript(PROBE);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      const response = await page.goto(`${B}/a/${f.id}/raw?reader=${route}`, { waitUntil: 'load' });
      const served = response?.headers()[READER_HEADER] ?? 'absent';
      await settle(page);
      const survival = await page.evaluate(() => { const s = window.__sv; const root = document.getElementById('mx-story-root'); return { records: s.served.map((n) => ({ kept: n.isConnected && root.contains(n), undrawnMermaid: !!n.__undrawnMermaid })), mutations: s.mutations, mutated: s.mutated }; });
      Object.assign(survival, survivalOf(survival.records));
      delete survival.records;
      const tree = await page.evaluate(SNAPSHOT, STYLE);
      let after = null;
      if (INTERACTIONS[f.key]) { await INTERACTIONS[f.key](page); after = await page.evaluate(SNAPSHOT, STYLE); }
      snaps[route] = { served, tree, after, survival, errors: errors.filter((e) => !/favicon|GPU stall|Canvas2D/.test(e)) };
      await context.close();
    }
    check(snaps.compiled.served === 'compiled', `${f.key}: the compiled route is served by the compiled reader (${READER_HEADER}: ${snaps.compiled.served})`);
    check(snaps.legacy.served !== 'compiled', `${f.key}: the legacy route is served by today's renderer (${READER_HEADER}: ${snaps.legacy.served})`);
    const d = diff(snaps.legacy.tree, snaps.compiled.tree);
    check(d.elements > 0, `${f.key}: the story has elements to compare (${d.elements})`);
    for (const kind of ['structure', 'text', 'style', 'box', 'attrs', 'refs']) {
      if (verbose) for (const line of d[kind]) check.note(`${f.key} ${kind}: ${line}`);
      check(d[kind].length === 0, `${f.key}: no ${kind} differences (${d[kind].length}${d[kind].length ? `: ${d[kind].slice(0, 3).join(' | ')}` : ''})`);
    }
    const s = snaps.compiled.survival;
    check(s.ok, `${f.key}: every served element survives hydration on the compiled page (${s.survived}/${s.served}${s.exempt ? `, ${s.exempt} in an undrawn Mermaid placeholder` : ''})`);
    check.note(`${f.key}: DOM mutations during hydration — legacy ${snaps.legacy.survival.mutations}, compiled ${s.mutations}${s.mutated.length ? ` (${s.mutated.join(', ')})` : ''}`);
    check(snaps.compiled.errors.length === 0, `${f.key}: no page errors on the compiled page (${snaps.compiled.errors[0] ?? 'clean'})`);
    if (snaps.legacy.after && snaps.compiled.after) {
      const da = diff(snaps.legacy.after, snaps.compiled.after);
      if (verbose) for (const line of [...da.structure, ...da.attrs, ...da.text, ...da.style, ...da.box]) check.note(`${f.key} after: ${line}`);
      const total = da.structure.length + da.text.length + da.style.length + da.box.length + da.attrs.length;
      check(total === 0, `${f.key}: identical after interaction (${total}${total ? `: ${[...da.structure, ...da.attrs, ...da.text, ...da.style, ...da.box].slice(0, 3).join(' | ')}` : ''})`);
    }
  }
} finally {
  await browser.close();
}
check.done();
