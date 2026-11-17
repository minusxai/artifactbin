/**
 * The query image end to end: the worker draws real PNGs through the page's pipeline; untrusted input is bounded; a
 * slow chart is cut off and the thread replaced; a full queue says busy; and nothing a spec names is ever fetched.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { DESIGN_SYSTEM_VARIABLES } from '@/lib/html-systems/server';
import { parseChartDescription } from '@/lib/html-component-specs/chart-spec';
import { CHART_IMAGE_LIMITS, configureChartRenderer, renderChartImage } from '../chart-image.server';
import { drawChart, imageTokens, inertSvg, type ChartDrawJob } from '../chart-draw.server';
import { createChartView, planChart } from '../chart-plan';
import { SERVER_ENGINES } from '../render-vega';

const bar = { mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' } } };
const rows = [{ k: 'north', v: 3 }, { k: 'south', v: 5 }, { k: 'east', v: 2 }];
const pixel = async (png: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return '#' + [0, 1, 2].map(c => data[i + c]!.toString(16).padStart(2, '0')).join('');
};
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => configureChartRenderer(null));

describe('renderChartImage', () => {
  it('draws a bar chart to a PNG in the house theme, then a dark design-system one on its own surface', async () => {
    const started = performance.now();
    const first = await renderChartImage({ chart: bar, rows });
    const cold = performance.now() - started;
    expect(first).toMatchObject({ ok: true, width: 640, height: 400 });
    if (!first.ok) return;
    expect(first.png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(first.png.length).toBeLessThanOrEqual(CHART_IMAGE_LIMITS.pngBytes);
    expect(await pixel(first.png, 1, 1)).toBe('#ffffff');
    const warmStart = performance.now();
    const dark = await renderChartImage({ chart: { vegaLite: bar }, rows, width: 320, height: 200, theme: 'dark', designSystem: 'volta' }, DESIGN_SYSTEM_VARIABLES);
    const warm = performance.now() - warmStart;
    expect(dark).toMatchObject({ ok: true, width: 320, height: 200 });
    if (dark.ok) expect(await pixel(dark.png, 1, 1)).toBe(imageTokens(DESIGN_SYSTEM_VARIABLES.variables('volta', 'dark'), 'dark').surface);
    console.info(`chart image: cold ${cold.toFixed(0)} ms, warm ${warm.toFixed(0)} ms, ${first.png.length} B`);
  });

  it('draws a recipe and a raw Vega spec, keeping a native spec its own size within the box', async () => {
    const recipe = await renderChartImage({ chart: { recipe: 'trend', bindings: { date: 'day', value: 'n' } },
      rows: [{ day: '2026-01-01', n: 3 }, { day: '2026-01-02', n: 6 }, { day: '2026-01-03', n: 4 }] });
    expect(recipe).toMatchObject({ ok: true });
    const vega = await renderChartImage({ chart: { $schema: 'https://vega.github.io/schema/vega/v6.json', width: 300, height: 150,
      data: [{ name: 'main' }], scales: [{ name: 'x', type: 'band', domain: { data: 'main', field: 'k' }, range: 'width' }],
      axes: [{ orient: 'bottom', scale: 'x' }],
      marks: [{ type: 'text', from: { data: 'main' }, encode: { enter: { x: { scale: 'x', field: 'k' }, y: { value: 50 }, text: { field: 'k' } } } }] }, rows });
    expect(vega).toMatchObject({ ok: true });
    if (vega.ok) expect([vega.width, vega.height]).toEqual([expect.any(Number), expect.any(Number)]);
    if (vega.ok) expect(vega.width).toBeLessThan(400);
  });

  it('refuses untrusted input with the code and status that name the fix', async () => {
    const refused = async (input: Record<string, unknown>) => {
      const result = await renderChartImage(input, DESIGN_SYSTEM_VARIABLES);
      return result.ok ? null : [result.status, result.code, result.message];
    };
    expect(await refused({ chart: { data: { url: 'https://example.test/x.csv' }, mark: 'bar' }, rows })).toEqual([400, 'invalid_chart', expect.stringMatching(/^data\.url: external data/)]);
    expect(await refused({ chart: { recipe: 'nope', bindings: {} }, rows })).toEqual([400, 'invalid_chart', expect.stringContaining('unknown recipe')]);
    expect(await refused({ chart: bar, rows: 'x' })).toEqual([400, 'invalid_request', expect.any(String)]);
    expect(await refused({ chart: bar, rows: [1, 2] })).toEqual([400, 'invalid_request', expect.any(String)]);
    expect(await refused({ chart: bar, rows: Array.from({ length: 5001 }, (_, v) => ({ v })) })).toEqual([413, 'too_large', '5001 rows, past 5000']);
    for (const size of [{ width: 159 }, { width: 1601 }, { height: 119 }, { height: 1201 }, { width: 640.5 }, { width: '640' }]) {
      expect(await refused({ chart: bar, rows, ...size }), JSON.stringify(size)).toEqual([400, 'invalid_request', expect.stringContaining('160 to 1600')]);
    }
    expect(await refused({ chart: bar, rows, theme: 'sepia' })).toEqual([400, 'invalid_request', 'theme is light or dark']);
    expect(await refused({ chart: bar, rows, designSystem: 'nope' })).toEqual([400, 'invalid_request', expect.stringContaining('volta')]);
    // A runtime failure inside the engine is the chart's to fix, not the server's.
    expect(await refused({ chart: { ...bar, transform: [{ calculate: 'unknownFn(datum.v)', as: 'w' }] }, rows })).toEqual([400, 'invalid_chart', expect.stringContaining('could not be drawn')]);
  });

  it('refuses a PNG past the cap with a hint, after trying a palette PNG', async () => {
    await configureChartRenderer({ maxPngBytes: 600 });
    const result = await renderChartImage({ chart: bar, rows });
    await configureChartRenderer(null);
    expect(result).toMatchObject({ ok: false, status: 422, code: 'image_too_large', hint: expect.stringContaining('smaller width') });
  });

  it('cuts off a chart past its deadline, replaces the thread and draws the next one', async () => {
    await configureChartRenderer({ renderMs: 1 });
    expect(await renderChartImage({ chart: bar, rows })).toMatchObject({ ok: false, status: 504, code: 'render_timeout' });
    await configureChartRenderer({ renderMs: 20_000 });
    expect(await renderChartImage({ chart: bar, rows })).toMatchObject({ ok: true });
    await configureChartRenderer(null);
  });

  it('draws one chart at a time and answers busy past the waiting room', async () => {
    await configureChartRenderer({ waiting: 1 });
    const results = await Promise.all([1, 2, 3].map(() => renderChartImage({ chart: bar, rows })));
    await configureChartRenderer(null);
    expect(results.map(r => r.ok ? 'ok' : r.code)).toEqual(['ok', 'ok', 'render_busy']);
    expect(results[2]).toMatchObject({ status: 503 });
  });

  it('fails closed without a renderer thread, and answers a thread that dies mid-chart', async () => {
    await configureChartRenderer({ workerUrl: new URL('file:///nonexistent/chart-image-worker.mjs') });
    expect(await renderChartImage({ chart: bar, rows })).toMatchObject({ ok: false, status: 503, code: 'render_unavailable' });
    const dying = "import {parentPort} from 'node:worker_threads';parentPort.postMessage({ready:true});parentPort.on('message',()=>process.exit(1));";
    await configureChartRenderer({ workerUrl: new URL('data:text/javascript,' + encodeURIComponent(dying)) });
    expect(await renderChartImage({ chart: bar, rows })).toMatchObject({ ok: false, status: 422, code: 'render_failed', hint: expect.stringContaining('fewer marks') });
    await configureChartRenderer(null);
    expect(await renderChartImage({ chart: bar, rows })).toMatchObject({ ok: true });
  });
});

describe('nothing a chart names is fetched', () => {
  const job = (spec: Record<string, unknown>): ChartDrawJob => ({ description: { kind: 'vega', spec }, rows: [], width: 320, height: 200, mode: 'light', variables: null, maxPngBytes: 140_000 });
  const signalUrl = { name: 'remote', url: { signal: "'https://example.test/' + 'rows.json'" } };

  it('refuses every url at the parse: data, a signal-valued url, file:// and an image mark', () => {
    for (const chart of [
      { data: { url: 'https://example.test/rows.csv' }, mark: 'point' },
      { $schema: 'https://vega.github.io/schema/vega/v6.json', data: [signalUrl], marks: [] },
      { data: { url: 'file:///etc/passwd' }, mark: 'text' },
      { marks: [{ type: 'image', encode: { enter: { url: { value: 'https://example.test/a.png' } } } }] },
      { mark: 'image', encoding: { url: { field: 'src' } } },
    ]) expect(parseChartDescription(chart)).toMatchObject({ ok: false, error: expect.stringContaining('url: external data and images are refused') });
  });

  it('below the parse, the loader reads no file and makes no request, and librsvg is handed no external href', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'chart-loader-')), secret = path.join(root, 'secret.json');
    try {
      await writeFile(secret, JSON.stringify([{ text: 'TOP-SECRET' }]));
      const fetched = vi.spyOn(globalThis, 'fetch');
      for (const data of [[{ name: 'remote', url: `file://${secret}` }], [{ name: 'remote', url: secret }], [signalUrl], [{ name: 'remote', url: 'https://example.test/rows.json' }]]) {
        const spec = { width: 200, height: 100, data, marks: [{ type: 'text', from: { data: 'remote' }, encode: { enter: { text: { field: 'text' } } } }] };
        const plan = planChart(SERVER_ENGINES, { spec, engine: 'vega' }, [], { width: 200, height: 100 }, 'light');
        const view = createChartView(SERVER_ENGINES, plan.vegaSpec, [], { renderer: 'none', parserConfig: plan.parserConfig! });
        view.logLevel(0);
        await view.runAsync().catch(() => {});
        expect(view.data('remote')).toEqual([]);
        expect(await view.toSVG()).not.toContain('TOP-SECRET');
        view.finalize();
        expect(await drawChart(job(spec))).toMatchObject({ ok: expect.any(Boolean) });
      }
      const image = { width: 100, height: 100, marks: [{ type: 'image', encode: { enter: { url: { value: `file://${secret}` }, width: { value: 50 }, height: { value: 50 } } } },
        { type: 'image', encode: { enter: { url: { value: 'https://example.test/a.png' }, width: { value: 50 }, height: { value: 50 } } } }] };
      expect(await drawChart(job(image))).toMatchObject({ ok: true });
      expect(fetched).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
    expect(inertSvg('<svg><image xlink:href="file:///etc/passwd"/><image href="https://x.test/a.png"/><a href="https://x.test">x</a><rect fill="url(https://x.test/p)"/><rect fill="url(#g)"/><use href="#m"/><image href="data:image/png;base64,AAAA"/></svg>'))
      .toBe('<svg><image xlink:href=""/><image href=""/><a href="">x</a><rect fill="none"/><rect fill="url(#g)"/><use href="#m"/><image href="data:image/png;base64,AAAA"/></svg>');
  });
});
