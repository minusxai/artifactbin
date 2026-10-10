/**
 * PREPARE WORK OFF THE REQUEST THREAD (prepare-workers.server, draft-compile-pool). A guest snapshot's
 * server-drawn charts and a version's page compile are CPU-bound and never yield: in production one
 * heavy chart set held the app's only thread ~15 s, so every health check and reader timed out. On the
 * prepare threads the request thread keeps answering, and the answers are the ones it would compute.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { drawSnapshotCharts } from '../charts.server';
import { compilePage } from '@/lib/compiled-page/compiler';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { heavyChartsMarkup } from '@/lib/publish/fixtures/heavy-prepare';
import { prepareStoryParts } from '../prepare-runtime.server';
import { prepareWorkers, usePrepareWorkers } from '../prepare-workers.server';

const ROWS = 2_000;
const rows = Array.from({ length: ROWS }, (_, i) => ({
  i, day: new Date(Date.UTC(2024, 0, 1 + (i % 365))).toISOString().slice(0, 10),
  region: ['north', 'south', 'east', 'west'][i % 4], product: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'][i % 6],
  revenue: (i * 7919) % 1000 + (i % 37) * 3.5, units: (i * 104729) % 97,
}));
const columns = [
  { name: 'i', type: 'number' as const }, { name: 'day', type: 'date' as const }, { name: 'region', type: 'string' as const },
  { name: 'product', type: 'string' as const }, { name: 'revenue', type: 'number' as const }, { name: 'units', type: 'number' as const },
];
const results = { tables: { daily: { rows, columns } }, errors: {} };
const options = { colorMode: 'light' as const, template: 'dashboard' };

/** The longest the event loop went without running a 10 ms timer while `work` ran. */
async function longestStall<T>(work: () => Promise<T>): Promise<{ value: T; stall: number }> {
  let stall = 0;
  let last = performance.now();
  const ticker = setInterval(() => { const now = performance.now(); stall = Math.max(stall, now - last); last = now; }, 10);
  try {
    const value = await work();
    stall = Math.max(stall, performance.now() - last);
    return { value, stall };
  } finally {
    clearInterval(ticker);
  }
}

afterAll(() => usePrepareWorkers(null));

describe('prepare work on worker threads', () => {
  it('a heavy chart set holds the request thread in-process, and not on a prepare thread, with the same drawings', async () => {
    const { runtime } = await prepareStoryParts({ source: heavyChartsMarkup(0, 10), compiledCss: null, theme: null, colorMode: 'light', title: 'heavy', template: 'dashboard', refData: {}, assetUrls: new Set() });
    const nodes = runtime.data.nodes;

    // The control: in-process, the whole set is drawn without the loop running once.
    const inline = await longestStall(() => drawSnapshotCharts(nodes, results, options));
    expect(Object.keys(inline.value).length).toBeGreaterThanOrEqual(3);
    expect(inline.stall).toBeGreaterThan(200);

    await usePrepareWorkers({ url: new URL('../draft-compile-worker-dev.mjs', import.meta.url), execArgv: [], workers: 1 });
    const threads = prepareWorkers()!;
    expect(threads).not.toBeNull();
    // The thread loads vega and the compiler once; that load is not what is measured.
    await threads.drawCharts(nodes, { tables: { daily: { rows: rows.slice(0, 20), columns } }, errors: {} }, options);

    const pooled = await longestStall(() => threads.drawCharts(nodes, results, options));
    expect(pooled.stall).toBeLessThan(200);
    expect(Object.keys(pooled.value).sort()).toEqual(Object.keys(inline.value).sort());
    for (const [key, drawing] of Object.entries(inline.value)) expect(pooled.value[key]!.rows).toBe(drawing.rows);

    // A version's compile on the thread is the compile the request thread would make.
    const build = loadCompilerBuild();
    const input = { nodes, colorMode: 'light' as const, template: 'dashboard', chrome: true, refData: {}, flow: null, build: build.id, authorScript: null };
    const compiled = await longestStall(() => threads.compilePage(input, build));
    expect(compiled.stall).toBeLessThan(200);
    expect(compiled.value.html).toBe((await compilePage(input, build)).html);
  }, 180_000);
});
