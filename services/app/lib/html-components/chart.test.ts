// @vitest-environment jsdom
/**
 * <af-chart> in a DOM: the page's hosted engines are stood in for by the pinned npm vega and vega-lite (through
 * the element's module seam, counting every View it builds and finalizes) and `@afbin/apollo` by a `sql` whose
 * watches the test answers by hand, so late and superseded answers can be staged.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as vega from 'vega';
import { compile } from 'vega-lite';
import { expressionInterpreter } from 'vega-interpreter';
import { SQL_FAILURES } from '@artifactbin/contracts';
import { chartModules } from './chart-render';
import './chart';

type Chart = HTMLElement & { chart: unknown; rows: unknown; query: unknown; draw: unknown; view: vega.View | null };
type Watch = { text: string; params: Record<string, unknown>; next: (rows: unknown) => void; error: (e: Error) => void; stopped: boolean };
let watches: Watch[] = [], built = 0, finalized = 0, observed: Array<{ fire: () => void; disconnected: boolean }> = [];
class CountingView extends vega.View {
  constructor(runtime: vega.Runtime, options: vega.ViewOptions) { super(runtime, options); built++; }
  override finalize() { finalized++; return super.finalize(); }
}
const statement = (text: string, params: Record<string, unknown> = {}) =>
  ({ text, params, then: (ok: (v: unknown) => unknown) => Promise.resolve([]).then(ok) });
const sql = Object.assign((strings: TemplateStringsArray) => statement(strings.raw.join('')), {
  watch(s: { text: string; params: Record<string, unknown> }, next: (rows: unknown) => void, error: (e: Error) => void) {
    const watch = { text: s.text, params: s.params, next, error, stopped: false };
    watches.push(watch);
    return () => { watch.stopped = true; };
  },
});
const original = { ...chartModules };
const recipes = vi.fn(original.recipes);
beforeEach(() => {
  watches = []; built = 0; finalized = 0; observed = []; recipes.mockClear();
  Object.assign(chartModules, {
    vega: async () => ({ parse: vega.parse, View: CountingView, expressionInterpreter }),
    vegaLite: async () => ({ compile }), apollo: async () => ({ sql }), recipes,
  });
  Object.assign(window, { ResizeObserver: class {
    entry = { fire: () => {}, disconnected: false };
    constructor(callback: () => void) { this.entry.fire = callback; observed.push(this.entry); }
    observe() {} disconnect() { this.entry.disconnected = true; }
  } });
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  // Layout as a browser gives it: a drawing's box fills the plot, whose height the element sets.
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', { configurable: true,
    get(this: HTMLElement) { return parseFloat(this.closest<HTMLElement>('.af-chart-plot')?.style.height ?? '') || 0; } });
});
afterEach(() => { document.body.replaceChildren(); document.documentElement.removeAttribute('data-af-dark'); });

const BAR = { mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' } } };
const ROWS = [{ k: 'a', v: 3 }, { k: 'b', v: 5 }, { k: 'c', v: 1 }];
function mount(attributes: Record<string, string> = {}, props: Partial<Chart> = {}, child = ''): Chart {
  const el = document.createElement('af-chart') as Chart;
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
  el.innerHTML = child;
  Object.assign(el, props);
  document.body.append(el);
  return el;
}
/** Waits on the condition itself; the bound only names what never came, far above any healthy draw. */
async function until(test: () => unknown, what = 'condition') {
  await vi.waitFor(() => { if (!test()) throw Error('timed out waiting for ' + what); }, { timeout: 20_000, interval: 5 });
}
const ready = (el: Chart) => until(() => el.getAttribute('data-af-chart') === 'ready', 'ready');
const status = (el: Chart) => el.querySelector('.af-chart-status')!;
const marks = (el: Chart) => el.querySelectorAll('.af-chart-plot path, .af-chart-plot .mark-rect path').length;

it('draws a Vega-Lite spec over rows: ready marker, event with the live view, label and values table', async () => {
  const el = mount({ label: 'Totals by key' }, { chart: BAR, rows: ROWS });
  const event = new Promise<CustomEvent>(resolve => el.addEventListener('af-chart-ready', e => resolve(e as CustomEvent)));
  expect(el.getAttribute('aria-busy')).toBe('true');
  expect(el.hasAttribute('data-af-chart')).toBe(false);
  await ready(el);
  const { detail } = await event;
  expect(detail.view).toBe(el.view);
  expect(detail.rows).toEqual(ROWS);
  expect(el.hasAttribute('aria-busy')).toBe(false);
  expect(el.querySelectorAll('.mark-rect path')).toHaveLength(3);
  // The element sizes the drawing: its width (640 when unmeasured) and the default height.
  const size = (svg: Element | null) => [svg?.getAttribute('width'), svg?.getAttribute('height')];
  expect(size(el.querySelector('.af-chart-plot svg'))).toEqual(['640', '320']);
  const plot = el.querySelector('.af-chart-plot')!;
  expect([plot.getAttribute('role'), plot.getAttribute('aria-label')]).toEqual(['img', 'Totals by key']);
  const values = el.querySelector('details.af-chart-values') as HTMLDetailsElement;
  expect(values.hidden).toBe(false);
  expect([...values.querySelectorAll('td')].map(td => td.textContent)).toEqual(['a', '3', 'b', '5', 'c', '1']);
  // The theme is the house one with no tokens set; the live view takes the page's own signals and listeners.
  expect(typeof el.view!.signal('width')).toBe('number');
});

it('renders every kind of spec: wrapped, inline values, facet, concat, raw Vega with its own dataset, and a recipe', async () => {
  const wrapped = mount({}, { chart: JSON.stringify({ vegaLite: BAR }), rows: ROWS });
  const inline = mount({ label: 'own values' }, { chart: { ...BAR, data: { values: ROWS } } });
  const facet = mount({}, { chart: { facet: { field: 'g', type: 'nominal' }, columns: 2, spec: BAR },
    rows: [...ROWS.map(r => ({ ...r, g: 'x' })), ...ROWS.map(r => ({ ...r, g: 'y' }))] });
  const concat = mount({}, { chart: { hconcat: [BAR, { ...BAR, mark: 'point' }] }, rows: ROWS });
  const raw = mount({ 'data-name': 'table' }, { rows: ROWS, chart: { $schema: 'https://vega.github.io/schema/vega/v6.json',
    width: 200, height: 100, data: [{ name: 'table' }],
    scales: [{ name: 'x', type: 'band', domain: { data: 'table', field: 'k' }, range: 'width' },
      { name: 'y', type: 'linear', domain: { data: 'table', field: 'v' }, range: 'height' }],
    marks: [{ type: 'rect', from: { data: 'table' }, encode: { enter: { x: { scale: 'x', field: 'k' },
      width: { scale: 'x', band: 1 }, y: { scale: 'y', field: 'v' }, y2: { scale: 'y', value: 0 } } } }] } });
  const script = mount({ label: 'from a script child' }, { rows: ROWS }, `<script type="application/json">${JSON.stringify(BAR)}</script>`);
  for (const el of [wrapped, inline, facet, concat, raw, script]) await ready(el);
  expect(recipes).not.toHaveBeenCalled();
  expect(inline.querySelectorAll('.mark-rect path')).toHaveLength(3);
  expect(facet.querySelectorAll('.mark-rect path')).toHaveLength(6);
  expect(raw.querySelectorAll('.mark-rect path')).toHaveLength(3);
  expect(raw.querySelector('.af-chart-plot svg')!.getAttribute('width')).toBe('200');
  expect(script.querySelectorAll('.mark-rect path')).toHaveLength(3);
  const trend = mount({}, { chart: { recipe: 'trend', bindings: { date: 'week', value: 'n' } },
    rows: [{ week: '2026-01-05', n: 4 }, { week: '2026-01-12', n: 7 }, { week: '2026-01-19', n: 5 }] });
  await ready(trend);
  expect(recipes).toHaveBeenCalledTimes(1);
  expect(trend.querySelector('.af-chart-plot svg')).not.toBeNull();
});

it('reads sql, a linked dataset and a query through sql.watch, redraws on a rerun and drops a superseded answer', async () => {
  const bySql = mount({ sql: 'select k, v from t' }, { chart: BAR });
  const byDataset = mount({ dataset: 'deliveries' }, { chart: BAR });
  await until(() => watches.length === 2, 'two watches');
  expect(watches.map(w => w.text)).toEqual(['select k, v from t', 'select * from "deliveries" limit 10001']);
  watches[0]!.next(ROWS); watches[1]!.next(ROWS.slice(0, 2));
  await ready(bySql); await ready(byDataset);
  expect(byDataset.querySelectorAll('.mark-rect path')).toHaveLength(2);
  // A dataset change reruns the watch: the chart redraws with the new rows.
  watches[0]!.next([...ROWS, { k: 'd', v: 2 }]);
  await until(() => bySql.querySelectorAll('.mark-rect path').length === 4, 'rerun drawn');
  // A filter sets the query again; the old statement's late answer (even one sent after its stop) is dropped.
  const filtered = mount({}, { chart: BAR, query: statement('select k, v from t where k = $p0', { p0: 'a' }) });
  await until(() => watches.length === 3, 'first query');
  filtered.query = statement('select k, v from t where k = $p0', { p0: 'b' });
  await until(() => watches.length === 4, 'second query');
  expect(watches[2]!.stopped).toBe(true);
  watches[3]!.next([{ k: 'b', v: 5 }]);
  await ready(filtered);
  // A taken answer starts a draw at once (a microtask marks the chart busy): once the event loop has turned, the stale
  // answer has started none and the table is the live statement's.
  expect(filtered.getAttribute('aria-busy')).not.toBe('true');
  watches[2]!.next([{ k: 'a', v: 3 }, { k: 'a2', v: 1 }]);
  await new Promise(resolve => setImmediate(resolve));
  expect(filtered.getAttribute('aria-busy')).not.toBe('true');
  expect([...filtered.querySelectorAll('td')].map(td => td.textContent)).toEqual(['b', '5']);
  expect(watches[3]!.params).toEqual({ p0: 'b' });
});

it('shows loading, empty, waiting and failed states, says what to fix and refuses url data', async () => {
  const loading = mount({ sql: 'select 1' }, { chart: BAR });
  expect(status(loading).textContent).toBe('Loading chart…');
  expect(loading.getAttribute('aria-busy')).toBe('true');
  await until(() => watches.length === 1);
  watches[0]!.next([]);
  await until(() => status(loading).textContent === 'No rows', 'empty');
  expect(loading.hasAttribute('data-af-chart')).toBe(false);
  const errors: string[] = [];
  const failing = mount({ sql: 'select nope' }, { chart: BAR });
  failing.addEventListener('af-chart-error', e => errors.push((e as CustomEvent).detail.message));
  await until(() => watches.length === 2);
  watches[1]!.error(new Error('no such column: nope'));
  await until(() => errors.length === 1, 'error event');
  expect(status(failing).textContent).toBe('Could not read the rows: no such column: nope');
  expect(status(failing).getAttribute('role')).toBe('status');
  expect(failing.hasAttribute('data-af-chart')).toBe(false);
  const url = mount({}, { chart: { ...BAR, data: { url: 'https://example.com/x.csv' } } });
  await until(() => /url/.test(status(url).textContent!), 'url refusal');
  expect(status(url).textContent).toMatch(/^Chart not drawn: data\.url: external data and images are refused/);
  const both = mount({ sql: 'select 1' }, { chart: BAR, rows: ROWS });
  await until(() => status(both).textContent!.length > 0);
  expect(status(both).textContent).toBe('Give the chart one data source, not sql and rows');
  const waiting = mount({}, { rows: ROWS });
  await until(() => /^Waiting/.test(status(waiting).textContent!), 'waiting');
  const many = mount({}, { chart: BAR, rows: Array.from({ length: 10_001 }, (_, i) => ({ k: String(i), v: i })) });
  await until(() => /10,000 rows/.test(status(many).textContent!), 'row cap');
  expect(built).toBe(0);
});

it('shows each failed read\'s sentence and code in place of the drawing, never "No rows", and draws a cut-off answer with a note', async () => {
  const kinds = ['permission_denied', 'sign_in_required', 'unavailable', 'validation_failed', 'timeout', 'result_too_large', 'dataset_not_found', 'unknown_query'] as const;
  for (const code of kinds) {
    const notice = SQL_FAILURES[code].notice;
    // As the page runtime's SqlError carries it: the reader's sentence, the code and the server's reason.
    const failure = Object.assign(new Error(notice), { name: 'SqlError', code, detail: `the reason for ${code}` });
    const details: unknown[] = [];
    const el = mount({ sql: `select * from sales -- ${code}` }, { chart: BAR });
    el.addEventListener('af-chart-error', e => details.push((e as CustomEvent).detail));
    await until(() => watches.some(w => w.text.endsWith(code)));
    watches.find(w => w.text.endsWith(code))!.error(failure);
    await until(() => details.length === 1, `${code} event`);
    expect(details[0]).toEqual({ code, message: notice, detail: `the reason for ${code}` });
    expect(status(el).textContent, code).toBe(notice);
    expect(status(el).getAttribute('role')).toBe('status');
    expect(el.getAttribute('data-af-error')).toBe(code);
    expect(el.hasAttribute('data-af-chart')).toBe(false);
    expect(el.querySelector('.af-chart-plot svg')).toBeNull();
  }
  expect(built).toBe(0);
  // The chart's own refusals carry a code from the same list.
  const many = mount({}, { chart: BAR, rows: Array.from({ length: 10_001 }, (_, i) => ({ k: String(i), v: i })) });
  await until(() => many.getAttribute('data-af-error') === 'validation_failed', 'row cap code');
  const bad = mount({ sql: 'select 1' }, { chart: BAR, rows: ROWS });
  await until(() => bad.getAttribute('data-af-error') === 'validation_failed', 'bad source code');
  // A truncated answer still draws, with a note; a whole one has none, and a draw clears a failure's code.
  const cut = mount({ sql: 'select k, v from sales' }, { chart: BAR });
  await until(() => watches.some(w => w.text === 'select k, v from sales'));
  const watch = watches.find(w => w.text === 'select k, v from sales')!;
  watch.error(Object.assign(new Error(SQL_FAILURES.timeout.notice), { code: 'timeout', detail: 'slow' }));
  await until(() => cut.getAttribute('data-af-error') === 'timeout', 'timeout first');
  watch.next(Object.defineProperty([...ROWS], 'truncated', { value: true, enumerable: false }));
  await ready(cut);
  expect(cut.hasAttribute('data-af-error')).toBe(false);
  expect((status(cut) as HTMLElement).hidden).toBe(false);
  expect(status(cut).textContent).toBe(`First ${ROWS.length} rows; the rest was cut off.`);
  const whole = mount({}, { chart: BAR, rows: ROWS });
  await ready(whole);
  expect((status(whole) as HTMLElement).hidden).toBe(true);
});

it('rebuilds on a theme change, resizes in place when the layout plan holds and finalizes on disconnect', async () => {
  const el = mount({}, { chart: BAR, rows: ROWS });
  el.style.setProperty('--chart-1', '#112233');
  await ready(el);
  expect(el.innerHTML).toContain('fill="#112233"');
  expect(built).toBe(1);
  el.style.setProperty('--chart-1', '#445566');
  document.documentElement.setAttribute('data-af-dark', 'true');
  await until(() => built === 2, 'theme rebuild');
  await until(() => el.innerHTML.includes('fill="#445566"'), 'new colour');
  expect(finalized).toBe(1);
  // A wider host resizes the same view: no new build.
  let width = 900;
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  const view = el.view!;
  observed.at(-1)!.fire();
  await until(() => el.querySelector('.af-chart-plot svg')?.getAttribute('width') === '900', 'resized');
  expect(built).toBe(2);
  expect(el.view).toBe(view);
  // A width that changes the planned label angle rebuilds instead.
  const many = mount({}, { chart: { mark: 'bar', encoding: { x: { field: 'k', type: 'nominal' }, y: { field: 'v', type: 'quantitative' } } },
    rows: Array.from({ length: 30 }, (_, i) => ({ k: `category ${i}`, v: i })) });
  await ready(many);
  const before = built;
  width = 200;
  Object.defineProperty(many, 'clientWidth', { configurable: true, get: () => width });
  observed.at(-1)!.fire();
  await until(() => built === before + 1, 'plan rebuild');
  el.remove(); many.remove();
  expect(finalized).toBe(built);
  expect(observed.every(entry => entry.disconnected)).toBe(true);
  expect(el.hasAttribute('data-af-chart')).toBe(false);
});

it('hands a draw function the rows, tokens and size, keeps the states and tears its drawing down', async () => {
  const calls: Array<Record<string, any>> = [], ended: string[] = [];
  const draw = vi.fn((ctx: Record<string, any>) => {
    calls.push(ctx);
    ctx.host.textContent = `${ctx.rows.length} rows`;
    return { finalize: () => ended.push(String(ctx.rows.length)) };
  });
  const el = mount({ height: '200' }, { draw, query: statement('select k, v from t') });
  await until(() => watches.length === 1);
  expect(draw).not.toHaveBeenCalled();
  watches[0]!.next(ROWS);
  await ready(el);
  expect(calls[0]).toMatchObject({ rows: ROWS, columns: ['k', 'v'], width: 640, height: 200 });
  expect(calls[0]!.tokens.category.length).toBeGreaterThan(0);
  expect(el.querySelector('.af-chart-plot')!.textContent).toBe('3 rows');
  expect(el.view).toBeNull();
  watches[0]!.next(ROWS.slice(0, 1));
  await until(() => calls.length === 2, 'redraw');
  expect(calls[0]!.signal.aborted).toBe(true);
  expect(ended).toEqual(['3']);
  el.remove();
  expect(ended).toEqual(['3', '1']);
  expect(calls[1]!.signal.aborted).toBe(true);
  expect(watches[0]!.stopped).toBe(true);
  expect(built).toBe(0);
});

it('lists the first 50 drawn rows with a note, and table="false" hides the list', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ k: `k${i}`, v: i }));
  const el = mount({}, { chart: BAR, rows });
  const hidden = mount({ table: 'false' }, { chart: BAR, rows: ROWS });
  await ready(el); await ready(hidden);
  expect(el.querySelectorAll('.af-chart-values tbody tr')).toHaveLength(50);
  expect(el.querySelector('.af-chart-values p')!.textContent).toBe('First 50 of 120 rows.');
  expect((hidden.querySelector('.af-chart-values') as HTMLElement).hidden).toBe(true);
  hidden.setAttribute('table', 'true');
  expect((hidden.querySelector('.af-chart-values') as HTMLElement).hidden).toBe(false);
  expect(marks(el)).toBeGreaterThan(0);
});

it('labels where its rows came from in its own chrome: Live, Snapshot, paused, and nothing for rows it was given', async () => {
  const sourced = (rows: object[], source: object) => Object.defineProperty([...rows], 'source', { value: source, enumerable: false });
  const read = mount({ sql: 'select k, v from t' }, { chart: BAR });
  await until(() => watches.length === 1, 'watch');
  watches[0]!.next(sourced(ROWS, { kind: 'live', at: '2026-11-18T14:32:00.000Z' }));
  await ready(read);
  const label = () => read.querySelector('.af-data-source button');
  expect(label()!.textContent).toBe('Live');
  expect(label()!.getAttribute('aria-label')).toBe('Data source: Live');
  // Its own attribute: af-tooltip owns data-state (open/closed).
  expect(read.querySelector('.af-data-source')!.getAttribute('data-af-source')).toBe('live');
  expect(read.querySelector('.af-data-source af-tooltip-content')!.textContent).toMatch(/^Read live as you at /);
  // Beside the values disclosure, in the chart's own parts.
  expect(read.querySelector('.af-data-source')!.nextElementSibling).toBe(read.querySelector('details.af-chart-values'));
  watches[0]!.next(sourced(ROWS, { kind: 'snapshot', at: '2026-11-02T09:05:00.000Z', names: ['t'] }));
  await until(() => label()?.textContent?.startsWith('Snapshot · '), 'snapshot label');
  // Live data the reader has not allowed yet: the failure, and the label says paused.
  watches[0]!.error(Object.assign(new Error(SQL_FAILURES.consent_required.notice), { code: 'consent_required', detail: 'wh reads live data' }));
  await until(() => label()?.textContent === 'Live · paused', 'paused label');
  expect(read.getAttribute('data-af-error')).toBe('consent_required');
  expect(status(read).textContent).toBe(SQL_FAILURES.consent_required.notice);
  // An empty rerun takes the label down with the drawing.
  watches[0]!.next(sourced([], { kind: 'live', at: '2026-11-18T14:40:00.000Z' }));
  await until(() => status(read).textContent === 'No rows', 'empty');
  expect(read.querySelector('.af-data-source')).toBeNull();
  // Rows the page wrote into the chart itself carry no source: no label.
  const given = mount({}, { chart: BAR, rows: ROWS });
  await ready(given);
  expect(given.querySelector('.af-data-source')).toBeNull();
});
