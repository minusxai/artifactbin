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
import { prepareStoryParts } from '@/lib/story/prepare-runtime.server';

const rows = [{ month: '2025-01-01', revenue: 120 }, { month: '2025-02-01', revenue: 160 }];
const columns = [{ name: 'month', type: 'date' as const }, { name: 'revenue', type: 'number' as const }];
const spec = { mark: 'line', encoding: { x: { field: 'month', type: 'temporal' }, y: { field: 'revenue', type: 'quantitative' } } };

describe('drawChart', () => {
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

describe('drawSnapshotCharts', () => {
  it('draws every <Question> whose table the snapshot answered, keyed by node id, and skips the rest', async () => {
    const source = readFileSync(path.resolve(process.cwd(), '../../scripts/fixtures/page-speed/dashboard.jsx'), 'utf8').replaceAll('{{sales}}', 'SALES1');
    const { runtime } = await prepareStoryParts({ source, compiledCss: null, theme: null, colorMode: 'light', title: 'dash', template: 'dashboard', refData: {}, assetUrls: new Set() });
    const drawings = await drawSnapshotCharts(runtime.data.nodes, { tables: { monthly: { rows: [{ month: '2025-01-01', revenue: 1, units: 1 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] } }, errors: {} }, { colorMode: 'light' });
    expect(Object.keys(drawings)).toEqual(['AVkX']);
    expect(drawings.AVkX!.table).toBe('monthly');
    expect(drawings.AVkX!.svg).toMatch(/^<svg/);
  });
});
