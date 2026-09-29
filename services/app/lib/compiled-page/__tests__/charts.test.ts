// DESTINATION: services/app/lib/compiled-page/__tests__/charts.test.ts
/**
 * CHARTS DRAWN ON THE SERVER (docs/phase2-architecture.md §1, §5; contract DrawnChart): a `<Question>`
 * drawn to SVG from a snapshot's rows with vega on the server, so the reader sees the chart in the
 * HTML and Vega loads in the browser only on interaction. Deterministic, script-free SVG.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { drawChart, drawSnapshotCharts } from '../charts.server';
import { DRAWING_CLASS } from '@/lib/islands/chart';
import { STORY_UI_RECIPE_BASE, STORY_UI_RECIPE_CLASSES } from '@/lib/story-ui/recipe-classes';
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';
import { questionEnvelope } from '@/lib/viz/chart-envelope';
import { inferVizColumnsFromRows } from '@/lib/viz/query-data';
import { computeFacetLayoutPlan, computeLegendPlan, computeXLabelAngle, createVegaView, resolveEnvelopeSpec, toVegaSpec } from '@/lib/viz/render-vega';

const rows = [{ month: '2025-01-01', revenue: 120 }, { month: '2025-02-01', revenue: 160 }];
const columns = [{ name: 'month', type: 'date' as const }, { name: 'revenue', type: 'number' as const }];
const spec = { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } };

describe('drawChart', () => {
  it('uses the same first-run Vega axis labels at full, 4/6/8-column, and fixed-tile sizes', async () => {
    for (const [width, height] of [[1376, 303], [452, 303], [682, 303], [911, 303], [452, 215]]) {
      const drawn = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width, height, colorMode: 'light' });
      const envelope = questionEnvelope({ kind: 'vega-lite', spec }, columns);
      if ('error' in envelope) throw new Error(envelope.error);
      const resolved = resolveEnvelopeSpec(envelope, inferVizColumnsFromRows(rows));
      if (!resolved.ok || resolved.engine !== 'vega-lite') throw new Error('spec did not resolve');
      const legendPlan = computeLegendPlan(resolved.spec, rows, width);
      const xLabelAngle = computeXLabelAngle(resolved.spec, rows, width);
      const facetLayout = computeFacetLayoutPlan(resolved.spec, rows, width, height);
      const { vegaSpec, parserConfig } = toVegaSpec(resolved, 'light', { legendPlan, xLabelAngle, facetLayout, categoryRange: null });
      for (const signal of vegaSpec.signals ?? []) {
        if ('init' in signal && typeof signal.init === 'string' && signal.init.includes('containerSize()')) {
          if (signal.name === 'width') signal.init = String(width);
          if (signal.name === 'height') signal.init = String(height);
        }
      }
      const view = createVegaView(vegaSpec, rows, { renderer: 'none', width, height, facetLayout, ...(parserConfig ? { parserConfig } : {}) });
      try {
        await view.runAsync();
        const labels = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
        expect(labels(drawn.svg), `${width} × ${height}`).toEqual(labels(await view.toSVG()));
      } finally { view.finalize(); }
    }
  });
  it('draws a vega-lite spec over rows to a script-free SVG of the requested size', async () => {
    const drawn = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' });
    expect(drawn.svg).toMatch(/^<svg[^>]*>/);
    expect(drawn.svg).not.toMatch(/<script|on[a-z]+=/i);
    expect(drawn.svg).toMatch(/width="600"/);
    expect(drawn.svg).toMatch(/height="300"/);
    expect(drawn.rows).toMatch(/^[0-9a-f]{16}$/);
  });
  it('is deterministic for the same input and changes with the rows', async () => {
    const a = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' });
    const b = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' });
    const c = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows: rows.slice(0, 1), columns }, width: 600, height: 300, colorMode: 'light' });
    expect(a.svg).toBe(b.svg);
    expect(c.rows).not.toBe(a.rows);
  });
  it('draws in the document\'s colour mode (dark text on light, light text on dark)', async () => {
    const light = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' });
    const dark = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width: 600, height: 300, colorMode: 'dark' });
    expect(light.svg).not.toBe(dark.svg);
  });
});

describe('drawChart fits the box it is served in', () => {
  it('draws a responsive SVG: out of flow and the full size of its chart box, scaled by its viewBox, so it never sizes the box', async () => {
    const drawn = await drawChart({ viz: { kind: 'vega-lite', spec }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' });
    const root = /^<svg[^>]*>/.exec(drawn.svg)![0];
    expect(root).toMatch(/viewBox="0 0 600 300"/);
    expect(/\bclass="([^"]*)"/.exec(root)?.[1]?.split(' ')).toEqual(expect.arrayContaining(['marks', ...DRAWING_CLASS.split(' ')]));
    expect(DRAWING_CLASS.split(' ')).toEqual(['absolute', 'inset-0', 'size-full']);
  });
  it('uses only utilities every reader sheet keeps (the recipe base, whatever tags the document uses)', () => {
    const base = STORY_UI_RECIPE_BASE.map((i) => STORY_UI_RECIPE_CLASSES[i]);
    for (const token of DRAWING_CLASS.split(' ')) expect(base, token).toContain(token);
  });
});

describe('drawChart leaves its input alone', () => {
  it('draws a native vega spec without mutating the viz it was handed (the prepared page\'s shared JSON)', async () => {
    const viz = { kind: 'vega', spec: {
      width: 300, height: 200, data: [{ name: 'main' }],
      scales: [{ name: 'x', type: 'band', domain: { data: 'main', field: 'product' }, range: 'width' }, { name: 'y', type: 'linear', domain: { data: 'main', field: 'revenue' }, range: 'height' }],
      marks: [{ type: 'rect', from: { data: 'main' }, encode: { enter: { x: { scale: 'x', field: 'product' }, width: { scale: 'x', band: 1 }, y: { scale: 'y', field: 'revenue' }, y2: { scale: 'y', value: 0 } } } }],
    } };
    const before = JSON.stringify(viz);
    const drawn = await drawChart({ viz, table: { rows: [{ product: 'a', revenue: 1 }, { product: 'b', revenue: 2 }], columns: [] }, width: 300, height: 200, colorMode: 'light' });
    expect(drawn.svg).toMatch(/^<svg/);
    expect(JSON.stringify(viz)).toBe(before);
  });
});

describe('drawChart refuses what it cannot draw safely or faithfully', () => {
  const bar = { mark: 'bar', encoding: { x: { field: 'product', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } };
  const barColumns = [{ name: 'product', type: 'string' as const }, { name: 'revenue', type: 'number' as const }];
  it('escapes hostile row text: no script, no element or handler attribute an author string could smuggle in', async () => {
    const hostile = [{ product: '<script>alert(1)</script>', revenue: 1 }, { product: '"><img src=x onerror=alert(1)>', revenue: 2 }, { product: "' onload='alert(1)", revenue: 3 }];
    const drawn = await drawChart({ viz: { kind: 'vega-lite', spec: bar }, table: { rows: hostile, columns: barColumns }, width: 600, height: 300, colorMode: 'dark' });
    expect(drawn.svg).not.toMatch(/<script|<img|<foreignObject/i);
    // vega escapes `<` and `>` in text and attributes and `"` in attributes: every `<…>` is one tag, and with its values blanked what is left is the tag's own structure.
    const tags = drawn.svg.match(/<[^<>]*>/g) ?? [];
    expect(tags.length).toBe(drawn.svg.split('<').length - 1);
    for (const tag of tags) {
      expect(tag).toMatch(/^<\/?(svg|g|path|rect|line|text|defs|clipPath)[\s/>]/);
      expect(tag.replace(/"[^"]*"/g, '""')).not.toMatch(/\son[a-z]+\s*=/i);
    }
    expect(drawn.svg).toContain('&lt;script&gt;');
  });
  it('refuses a chart whose marks are links (the href channel), so no author URL reaches the HTML', async () => {
    const linked = { ...bar, encoding: { ...bar.encoding, href: { field: 'url', type: 'nominal' } } };
    const table = { rows: [{ product: 'a', revenue: 1, url: 'javascript:alert(1)' }], columns: [...barColumns, { name: 'url', type: 'string' as const }] };
    await expect(drawChart({ viz: { kind: 'vega-lite', spec: linked }, table, width: 600, height: 300, colorMode: 'light' })).rejects.toThrow(/linked marks/);
  });
  it('refuses a spec that needs the page\'s CSS tokens, a non-chart kind and a vega error, instead of drawing them wrong', async () => {
    const themed = { mark: { type: 'line', color: 'var(--foreground)' }, encoding: spec.encoding };
    await expect(drawChart({ viz: { kind: 'vega-lite', spec: themed }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' })).rejects.toThrow(/CSS custom property/);
    await expect(drawChart({ viz: { kind: 'table' }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' })).rejects.toThrow();
    const broken = { ...spec, transform: [{ calculate: 'datum.revenue +* (', as: 'bad' }] };
    await expect(drawChart({ viz: { kind: 'vega-lite', spec: broken }, table: { rows, columns }, width: 600, height: 300, colorMode: 'light' })).rejects.toThrow();
  });
});

describe('drawSnapshotCharts', () => {
  it('draws a full-width chart and 4/6/8-column flow cells at their desktop slot widths', async () => {
    const chart = (id: string) => `<Question id="${id}" data="$monthly" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} />`;
    const source = `<div className="@container px-4 @2xl:px-8">${chart('full')}<Grid mode="flow"><GridItem w={4}>${chart('four')}</GridItem><GridItem w={6}>${chart('six')}</GridItem><GridItem w={8}>${chart('eight')}</GridItem></Grid></div>`;
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 'widths', template: 'dashboard', refData: {}, assetUrls: new Set() });
    const results = { tables: { monthly: { rows, columns } }, errors: {} };
    const drawings = await drawSnapshotCharts(runtime.data.nodes, results, { colorMode: 'light', template: 'dashboard' });
    expect(Object.fromEntries(Object.entries(drawings).map(([id, drawing]) => [id, Number(/<svg[^>]*\bwidth="(\d+)"/.exec(drawing.svg)?.[1])]))).toEqual({ full: 1376, four: 452, six: 682, eight: 911 });
  });

  it('uses a positioned tile height and width for a chart that fills the tile', async () => {
    const source = '<div className="@container px-4 @2xl:px-8"><Grid><GridItem w={4} h={3}><Question id="fixed" title="Sales" data="$monthly" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} /></GridItem></Grid></div>';
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 'tile', template: 'dashboard', refData: {}, assetUrls: new Set() });
    const drawing = (await drawSnapshotCharts(runtime.data.nodes, { tables: { monthly: { rows, columns } }, errors: {} }, { colorMode: 'light', template: 'dashboard' })).fixed!;
    expect(drawing.svg).toMatch(/<svg[^>]*width="452"[^>]*height="215"/);
  });

  it('accounts for a bounded plan column and card content padding', async () => {
    const source = '<div className="p-10"><Card><CardContent><Question id="inside" data="$monthly" viz={{"kind":"vega-lite","spec":{"mark":"line","encoding":{"x":{"field":"month","type":"temporal"},"y":{"field":"revenue","type":"quantitative"}}}}} /></CardContent></Card></div>';
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 'plan', template: 'plan', refData: {}, assetUrls: new Set() });
    const drawing = (await drawSnapshotCharts(runtime.data.nodes, { tables: { monthly: { rows, columns } }, errors: {} }, { colorMode: 'light', template: 'plan' })).inside!;
    expect(drawing.svg).toMatch(/<svg[^>]*width="990"/);
  });

  it('draws every <Question> whose table the snapshot answered, keyed by node id, and skips the rest', async () => {
    const source = readFileSync(path.resolve(process.cwd(), '../../scripts/fixtures/page-speed/dashboard.jsx'), 'utf8').replaceAll('{{sales}}', 'SALES1');
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 'dash', template: 'dashboard', refData: {}, assetUrls: new Set() });
    const drawings = await drawSnapshotCharts(runtime.data.nodes, { tables: { monthly: { rows: [{ month: '2025-01-01', revenue: 1, units: 1 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] } }, errors: {} }, { colorMode: 'light' });
    expect(Object.keys(drawings)).toEqual(['AVkX']);
    expect(drawings.AVkX!.table).toBe('monthly');
    expect(drawings.AVkX!.svg).toMatch(/^<svg/);
  });

  it('draws both dashboard charts when both tables are answered, the same string twice, and keys them in document order', async () => {
    const source = readFileSync(path.resolve(process.cwd(), '../../scripts/fixtures/page-speed/dashboard.jsx'), 'utf8').replaceAll('{{sales}}', 'SALES1');
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 'dash', template: 'dashboard', refData: {}, assetUrls: new Set() });
    const results = { tables: {
      monthly: { rows: [{ month: '2025-01-01', revenue: 120, units: 3 }, { month: '2025-02-01', revenue: 160, units: 4 }, { month: '2025-03-01', revenue: 90, units: 2 }], columns: [{ name: 'month', type: 'date' as const }, { name: 'revenue', type: 'number' as const }, { name: 'units', type: 'number' as const }] },
      by_product: { rows: [{ product: 'Widget', revenue: 200 }, { product: 'Gadget', revenue: 170 }], columns: [{ name: 'product', type: 'string' as const }, { name: 'revenue', type: 'number' as const }] },
    }, errors: {} };
    const a = await drawSnapshotCharts(runtime.data.nodes, results, { colorMode: 'light' });
    const b = await drawSnapshotCharts(runtime.data.nodes, results, { colorMode: 'light' });
    expect(Object.keys(a)).toEqual(['AVkX', 'EPuJ']);
    expect(a.AVkX!.svg).toBe(b.AVkX!.svg);
    expect(a.EPuJ!.svg).toBe(b.EPuJ!.svg);
    // Both SVGs sit in one HTML document: their clip-path ids must not collide.
    const ids = (svg: string) => [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(a.EPuJ!.svg).length).toBeGreaterThan(0);
    expect(ids(a.EPuJ!.svg).filter((id) => ids(a.AVkX!.svg).includes(id))).toEqual([]);
    expect(ids(a.EPuJ!.svg).every((id) => a.EPuJ!.svg.includes(`url(#${id})`))).toBe(true);
    expect(a.EPuJ!.table).toBe('by_product');
    expect(a.AVkX!.svg).toMatch(/width="682"/);
  });
});
