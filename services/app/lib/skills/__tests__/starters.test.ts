/**
 * The installed starters (skills/artifactbin/examples/*.html) run as pages: each imports only hosted `@afbin/<name>`
 * modules, and the data-driven ones, filled with the sample CSV (examples/gen-deliveries.mjs) through a stubbed
 * `@afbin/apollo` client whose `_sql` runs on the real SQLite engine, build their queries from their DATA block,
 * take every number from `_sql` (never summing rows in script), hand
 * Vega-Lite a spec naming those values with titled tooltips, and pass their own copy-unchanged steps files. jsdom runs
 * the page scripts with the hosted modules stubbed; every spec a page hands Vega-Lite is then compiled and rendered
 * headless by the pinned vega and vega-lite packages, as the page's no-eval interpreter would.
 */
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {afterEach, expect, it} from 'vitest';
import * as vega from 'vega';
import {compile} from 'vega-lite';
import {expressionInterpreter} from 'vega-interpreter';
import {createSqliteSql} from '@artifactbin/sql/sqlite';
import {trackerFeatures, trackerFiles} from '../../../skills/artifactbin/scripts/toolbox-tracker.mjs';

const EXAMPLES = new URL('../../../skills/artifactbin/examples/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, EXAMPLES), 'utf8');
/** The hosted names a page may import: the runtime's apollo and collab, the library registry and the hosted components. */
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const HOSTED = new Set(['apollo', 'collab', ...Object.keys(json('../../libraries/registry.json')),
  ...(json('../../html-components/hosted.json') as {components: string[]}).components]);
/** A starter with its [Bracketed text] written in: a capital then a lower-case letter or space, or a `${…}` sentence. */
const fill = (html: string) => html.replaceAll(/\[([A-Z][a-z ][^\]]*|\$\{[^\]]*)\]/g, '$1');
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter,
  window: (globalThis as {window?: unknown}).window};
afterEach(() => Object.assign(globalThis, saved));

/** The sample CSV (the generator's output) as the generated API returns it: numbers typed, every row with its `_id`. */
const NUMBERS = new Set(['hour', 'lat', 'lon', 'distance_km', 'minutes', 'amount']);
const [HEADER, ...LINES] = execFileSync(process.execPath, [fileURLToPath(new URL('gen-deliveries.mjs', EXAMPLES))],
  {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim().split('\n');
const ROWS = LINES.map((line, index) => Object.fromEntries([['_id', 'r' + index], ...line.split(',').map((cell, i) => {
  const name = HEADER!.split(',')[i]!;
  return [name, NUMBERS.has(name) ? Number(cell) : cell];
})])) as Array<{_id: string; date: string; hour: number; city: string; lat: number; lon: number; category: string;
  distance_km: number; minutes: number; amount: number}>;

interface Page {dom: JSDOM; queries: string[]; variables: Array<Record<string, any>>; specs: Array<Record<string, any>>; mutations: unknown[];
  error?: unknown; change?: (names: string[]) => void; settled: Array<Promise<unknown>>; clicks: Array<(event: unknown, item: unknown) => void>;
  decks: Array<Record<string, any>>; observers: Array<() => void>}
type Answer = (query: string, variables?: Record<string, unknown>) => unknown;

/** A page's own local module scripts (`<script type="module" src="./x.mjs">`) inlined, as the browser runs them. */
const inline = (html: string) => html.replace(/<script type="module" src="\.\/([\w-]+\.mjs)"><\/script>/g,
  (_, name: string) => `<script type="module">\n${read(name)}</script>`);
/** Everything a starter runs: its HTML and its local modules. */
const source = (name: string) => inline(read(name));

/**
 * Loads a starter in jsdom: the module scripts (local ones inlined) run in order with `@afbin/*` imports replaced by
 * stubs. `answer` is what the stubbed `client.query` returns for a query text; each Vega view draws one bar path per
 * value it is given and keeps its click listener; a deck.gl map draws a canvas and keeps its props.
 */
async function load(html: string, answer: Answer): Promise<Page> {
  html = inline(html);
  const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
  const dom = new JSDOM(html.replace(/<script type="module"[\s\S]*?<\/script>/g, ''), {runScripts: 'outside-only'});
  const page: Page = {dom, queries: [], variables: [], specs: [], mutations: [], settled: [], clicks: [], decks: [], observers: []};
  // jsdom has no canvas (the page then reads tokens as grey) and no ResizeObserver.
  dom.window.HTMLCanvasElement.prototype.getContext = (() => null) as never;
  class Layer { constructor(public props: Record<string, any>) {} }
  Object.assign(dom.window, {IntersectionObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { constructor(callback: () => void) { page.observers.push(callback); } observe() {} disconnect() {} }, stubs: {
    apollo: {gql: (strings: readonly string[]) => strings.join(''), onResolverChange: (listener: (names: string[]) => void) => { page.change = listener; return {unsubscribe() {}}; },
      client: {query: async ({query, variables}: {query: string; variables?: Record<string, unknown>}) => { page.queries.push(query); return answer(query, variables); },
        mutate: async (request: unknown) => { page.mutations.push(request); return {data: {}}; },
        // A watch answers once here (no dataset changes in jsdom), even after unsubscribe: the page must drop a
        // superseded answer itself. The page's handler is awaited by `load` and `settle`.
        watchQuery: ({query, variables}: {query: string; variables?: Record<string, unknown>}) => ({subscribe(next: (result: unknown) => unknown) {
          page.queries.push(query);page.variables.push(variables ?? {});
          page.settled.push(Promise.resolve(answer(query, variables)).then((result) => next({...result as object, loading: false})));
          return {unsubscribe() {}};
        }})}},
    compile: (spec: Record<string, unknown>) => { page.specs.push(spec); return {spec}; },
    deck: {Deck: class { constructor(public props: Record<string, any>) { page.decks.push(props); props.parent.append(dom.window.document.createElement('canvas')); } finalize() {} },
      MapView: class {}, ScatterplotLayer: Layer, TextLayer: Layer,
      WebMercatorViewport: class { fitBounds() { return {longitude: 5, latitude: 52, zoom: 7}; } }},
    // A live text that opens synced and types nothing (collab's own tests drive real sessions).
    collab: {text: () => ({status: 'synced', on() {}, destroy() {}, bind: () => ({destroy() {}})})},
    vega: {parse: (spec: unknown) => spec, expressionInterpreter: {}, View: class {
      constructor(private spec: {data?: {values?: unknown[]}}, private options: {container: Element}) {}
      addEventListener(type: string, listener: (event: unknown, item: unknown) => void) { if (type === 'click') page.clicks.push(listener); }
      async runAsync() {
        const marks = '<path></path>'.repeat(this.spec.data?.values?.length ?? 1);
        this.options.container.innerHTML = `<svg><g class="mark-rect">${marks}</g></svg>`;
      }
      finalize() {}
    }}}});
  try {
    for (const script of scripts) {
      const body = script.replace(/^import .*$/gm, '').replaceAll("import('@afbin/deck-gl')", 'Promise.resolve(stubs.deck)');
      await dom.window.eval(`(async()=>{const vega=stubs.vega,{compile,collab}=stubs,{client,gql,onResolverChange}=stubs.apollo;${body}})()`);
    }
    await settle(page);
  } catch (error) {
    page.error = error;
  }
  return page;
}
/** Waits until every answer the page asked for so far has been handled, including watches a handler started. */
async function settle(page: Page) {
  for (let seen = -1; seen !== page.settled.length;) { seen = page.settled.length; await Promise.all(page.settled); await new Promise(resolve => setTimeout(resolve, 0)); }
}

/** Runs a steps file over the loaded page with a stub `page`; returns the passing labels or the first failure. */
async function steps(dom: JSDOM, source: string): Promise<{labels: string[]; failure: string | null}> {
  const doc = dom.window.document, labels: string[] = [];
  Object.assign(globalThis, {document: doc, NodeFilter: dom.window.NodeFilter, window: dom.window});
  const locator = (selector: string): Record<string, unknown> => ({count: async () => doc.querySelectorAll(selector).length,
    textContent: async () => doc.querySelector(selector)?.textContent ?? '', waitFor: async () => {},
    click: async () => { const target = doc.querySelector(selector) as HTMLElement | null; if (!target) throw Error('no element ' + selector); target.click(); },
    first: () => locator(selector), nth: () => locator(selector)});
  const evaluate = async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg);
  const page = {evaluate, mainFrame: () => ({evaluate}), locator, getByRole: () => locator('button'), keyboard: {press: async () => {}},
    url: () => 'http://127.0.0.1:4100/index.html', viewportSize: () => ({width: 1280, height: 800}),
    // Polls like Playwright's, for a few ticks: a click's answer arrives on a later task.
    waitForFunction: async (fn: (arg: unknown) => unknown, arg: unknown) => {
      for (let tick = 0; tick < 50; tick++) { if (fn(arg)) return; await new Promise(resolve => setTimeout(resolve, 2)); }
      throw Error('timed out');
    }};
  const step = async (label: string, fn: () => Promise<void>) => { await fn(); labels.push(label); };
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', source)(page, step);
    return {labels, failure: null};
  } catch (error) {
    return {labels, failure: (error as Error).message};
  }
}

const engine = createSqliteSql({maxRows: 10000, timeoutMs: 5000});
const COLUMNS = ['_id', ...HEADER!.split(',')].map(name => ({name, type: NUMBERS.has(name) ? 'number' : 'string'}));
/** One SQL read over the sample, as `_sql` runs it (every $parameter it names must be given). */
async function sql(text: string, params: Record<string, unknown> = {}, rows: ReadonlyArray<Record<string, unknown>> = ROWS) {
  const outcome = (await engine.run({tables: {deliveries: {columns: COLUMNS as never, rows: rows as never}}, queries: [{name: 'r', sql: text}], params: params as never})).r!;
  return outcome;
}
/** `_sql` as the page route answers it: every aliased field's SQL and params (variables) run on the SQL engine over the dataset `deliveries`. */
const sqlAnswer = (rows: ReadonlyArray<Record<string, unknown>> = ROWS): Answer => async (query, variables = {}) => {
  const data: Record<string, unknown> = {};
  for (const [, alias, variable, params] of query.matchAll(/(?:(\w+):)?_sql\(sql:\$(\w+)(?:,params:\$(\w+))?\)/g)) {
    const outcome = await sql(String(variables[variable!]), (params ? variables[params] : {}) as Record<string, unknown>, rows);
    if ('error' in outcome) return {data: null, errors: [{message: outcome.error}]};
    data[alias ?? '_sql'] = {rows: outcome.rows};
  }
  return {data};
};
/** Numbers as the page formats them in this locale. */
const fmt = (n: number, digits = 0) => n.toLocaleString(undefined, {minimumFractionDigits: digits, maximumFractionDigits: digits});

it('imports only hosted @afbin modules from every starter', () => {
  for (const name of ['csv-dashboard.html', 'deck.html', 'report.html', 'tracker.html',
    'api-dashboard.html']) {
    const names = [...source(name).matchAll(/(?:from|import)\s*\(?\s*['"]@afbin\/([a-z0-9-]+)['"]/g)].map(m => m[1]!);
    expect(names.length, name).toBeGreaterThan(0);
    for (const imported of names) expect(HOSTED.has(imported), `${name} imports @afbin/${imported}`).toBe(true);
  }
  expect(source('csv-dashboard.html')).toContain("import('@afbin/deck-gl')");
});

it('draws no hand-made SVG chart in any data starter: charts go through Vega-Lite', () => {
  for (const name of ['csv-dashboard.html', 'deck.html']) {
    const html = source(name);
    expect(html, name).toContain("from '@afbin/vega-lite'");
    expect(html, name).not.toMatch(/createElementNS\([^)]*\)[^;]*\b(?:rect|line)\b|['"]rect['"],\{x:/);
  }
});

type Chart = {id: string; mark: string; filter?: string; table?: boolean};
const dataOf = (page: Page) => (page.dom.window as unknown as {DATA: {queries: Record<string, string>; charts: Chart[]}}).DATA;
/** The spec chart `id` was last drawn with (the map is drawn by deck.gl, not Vega-Lite). */
const drawn = (page: Page, id: string) => {
  const charts = dataOf(page).charts.filter(c => c.mark !== 'map');
  return page.specs.slice(-charts.length)[charts.findIndex(c => c.id === id)]!;
};
const total = (values: Array<{y: number}>) => values.reduce((sum, v) => sum + v.y, 0);
const text = (page: Page, id: string) => page.dom.window.document.querySelector(`[data-af-id="${id}"]`)?.textContent;
const countBy = (rows: typeof ROWS, key: 'category' | 'city') => {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
  return counts;
};

it('fills the csv dashboard from its DATA queries, each one _sql field of one request, the filters its params', async () => {
  const page = await load(read('csv-dashboard.html').replace('ref:DATASET_ID', 'ref:Ab12Cd34'), sqlAnswer());
  expect(page.error).toBeUndefined();
  const doc = page.dom.window.document, data = dataOf(page);
  // One watched request: every DATA query an aliased _sql field, its SQL and the filters variables; no row is paged into script.
  expect(page.queries).toHaveLength(1);
  for (const name of Object.keys(data.queries)) expect(page.queries[0]).toMatch(new RegExp(`${name}:_sql\\(sql:\\$s\\d+,params:\\$p\\)`));
  expect(page.queries[0]).not.toMatch(/deliveries\(|offset/);
  expect(page.variables[0]!.p).toEqual({city: null, category: null});
  expect(doc.querySelector('#status')!.textContent).toBe(`Computed ${Object.keys(data.queries).length} queries from the linked dataset.`);
  expect(text(page, 'filters-text')).toMatch(/^Showing everything/);
  // Every number on the page comes from the queries.
  expect(doc.querySelector('#title')!.textContent).toBe('[Courier deliveries, December to May]');
  const onTime = ROWS.filter(row => row.minutes <= 45).length / ROWS.length * 100;
  expect(doc.querySelector('#lead')!.textContent).toContain(`${fmt(ROWS.length)} deliveries; ${fmt(onTime)}%`);
  expect(text(page, 'stat-orders-value')).toBe(fmt(ROWS.length));
  expect(text(page, 'stat-on-time-value')).toBe(fmt(onTime) + '%');
  // A chart for each question: a weekly trend over 26 whole weeks...
  const weekly = drawn(page, 'weekly');
  expect(weekly.mark.type).toBe('line');
  expect(weekly.data.values).toHaveLength(26);
  expect(weekly.data.values[0]).toMatchObject({x: '2025-12-01', series: ''});
  expect(total(weekly.data.values)).toBe(ROWS.length);
  // ...a breakdown, largest first, that picks the category filter...
  const categories = [...countBy(ROWS, 'category')].sort((a, b) => b[1] - a[1]);
  expect(drawn(page, 'categories').data.values.map((v: {x: string; y: number}) => [v.x, v.y])).toEqual(categories);
  expect(drawn(page, 'categories').mark.cursor).toBe('pointer');
  // ...one small panel per city on a shared scale, a day-by-hour heatmap, bins of minutes and one point per delivery.
  const monthly = drawn(page, 'monthly');
  expect(monthly.facet).toMatchObject({field: 'series'});expect(monthly.spec.mark.type).toBe('line');
  expect(monthly.data.values).toHaveLength(8 * 6);expect(total(monthly.data.values)).toBe(ROWS.length);
  const hours = drawn(page, 'hours');
  expect(hours.mark.type).toBe('rect');expect(hours.encoding.y.field).toBe('series');expect(hours.encoding.color.field).toBe('y');
  expect([...new Set(hours.data.values.map((v: {series: string}) => v.series))]).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  expect(total(hours.data.values)).toBe(ROWS.length);
  // Every hour by every day, zero cells included, in hour order.
  const hoursSeen = [...new Set(ROWS.map(row => row.hour))].sort((a, b) => a - b).map(String);
  expect(hours.data.values).toHaveLength(hoursSeen.length * 7);
  expect([...new Set(hours.data.values.map((v: {x: string}) => v.x))]).toEqual(hoursSeen);
  const bins = drawn(page, 'minutes').data.values.map((v: {x: string}) => Number(v.x));
  expect(bins).toEqual([...bins].sort((a, b) => a - b));expect(total(drawn(page, 'minutes').data.values)).toBe(ROWS.length);
  const scatter = drawn(page, 'distance');
  expect(scatter.mark.type).toBe('point');expect(scatter.encoding.x.type).toBe('quantitative');
  expect(scatter.data.values.map((v: {x: number}) => v.x)).toEqual(ROWS.map(row => row.distance_km));
  for (const spec of page.specs) {
    for (const field of spec.encoding?.tooltip ?? spec.spec.encoding.tooltip) expect(field.title, JSON.stringify(field)).toBeTruthy();
    expect(spec.config.axis.gridDash).toEqual([3, 3]);
  }
  // The map: one dot per city at its rows' mean position, sized by its deliveries, named, and a canvas in its host.
  expect(page.decks).toHaveLength(1);
  const [dots, names] = page.decks[0]!.layers as Array<{props: Record<string, any>}>;
  expect(dots!.props.data).toHaveLength(8);expect(total(dots!.props.data)).toBe(ROWS.length);
  const amsterdam = dots!.props.data.find((v: {x: string}) => v.x === 'Amsterdam');
  expect(amsterdam.lat).toBeCloseTo(52.37, 1);expect(amsterdam.lon).toBeCloseTo(4.9, 1);
  expect(names!.props.getText(amsterdam)).toBe('Amsterdam');
  expect(doc.querySelector('[data-af-id="chart-cities-plot"] canvas')).not.toBeNull();
  // Each chart's table lists its values; a picking chart's rows are buttons; the scatter has none.
  const cells = [...doc.querySelectorAll('[data-af-id="chart-weekly-table"] td')].map(td => td.textContent);
  expect(cells).toEqual(weekly.data.values.map((v: {y: number}) => fmt(v.y)));
  const buttons = [...doc.querySelectorAll('[data-af-id="chart-categories-table"] button')];
  expect(buttons.map(b => [b.textContent, b.getAttribute('aria-pressed')])).toEqual(categories.map(([name]) => [name, 'false']));
  expect(doc.querySelector('[data-af-id="chart-distance-table"]')).toBeNull();
  expect(text(page, 'section-reading-text')).toMatch(/^\[Each extra kilometre adds about 3\.\d minutes/);
  // Script-made nodes carry unique data-af-ids.
  const ids = [...doc.querySelectorAll('[data-af-id]')].map(node => node.getAttribute('data-af-id'));
  expect(new Set(ids).size).toBe(ids.length);
});

it('links its charts: a picked category or city reruns every query with it as a _sql parameter, and picking again clears it', async () => {
  const page = await load(fill(read('csv-dashboard.html')), sqlAnswer());
  const doc = page.dom.window.document, meals = ROWS.filter(row => row.category === 'Meals');
  (doc.querySelector('[data-af-id="chart-categories-table-row-Meals-pick"]') as HTMLButtonElement).click();
  expect(doc.querySelector('#status')!.textContent).toBe('Computing…');
  await settle(page);
  expect(page.variables.at(-1)!.p).toEqual({city: null, category: 'Meals'});
  expect(text(page, 'stat-orders-value')).toBe(fmt(meals.length));
  expect(total(drawn(page, 'weekly').data.values)).toBe(meals.length);
  expect(total(drawn(page, 'hours').data.values)).toBe(meals.length);
  // A filtered heatmap keeps its grid: the same cells in the same order, the empty ones zero.
  expect(drawn(page, 'hours').data.values.map((v: {x: string; series: string}) => v.x + v.series))
    .toEqual(page.specs.find(spec => spec.mark?.type === 'rect')!.data.values.map((v: {x: string; series: string}) => v.x + v.series));
  expect(drawn(page, 'hours').data.values.some((v: {y: number}) => v.y === 0)).toBe(true);
  expect(total(page.decks.at(-1)!.layers[0].props.data)).toBe(meals.length);
  // The picking chart still shows every category, the picked one highlighted, its button pressed.
  expect(drawn(page, 'categories').data.values).toHaveLength(4);
  expect(drawn(page, 'categories').encoding.opacity.condition.test).toBe('datum.x==="Meals"');
  expect(doc.querySelector('[data-af-id="chart-categories-table-row-Meals-pick"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(text(page, 'filter-category')).toBe('Category: Meals ✕');
  expect(doc.querySelector('[data-af-id="filter-category"]')!.getAttribute('aria-label')).toBe('Clear Category: Meals');
  // A dot on the map picks its city as well: both filters apply, and the breakdown follows the city only.
  page.decks.at(-1)!.onClick({object: {x: 'Utrecht'}});
  await settle(page);
  expect(page.variables.at(-1)!.p).toEqual({city: 'Utrecht', category: 'Meals'});
  expect(text(page, 'stat-orders-value')).toBe(fmt(meals.filter(row => row.city === 'Utrecht').length));
  const utrecht = countBy(ROWS.filter(row => row.city === 'Utrecht'), 'category');
  expect(drawn(page, 'categories').data.values.map((v: {x: string; y: number}) => v.y).sort()).toEqual([...utrecht.values()].sort());
  // Its chip clears the city; a click on the picked bar clears the category.
  (doc.querySelector('[data-af-id="filter-city"]') as HTMLButtonElement).click();
  await settle(page);
  expect(page.variables.at(-1)!.p).toEqual({city: null, category: 'Meals'});
  page.clicks.at(-1)!(null, {datum: {x: 'Meals', y: meals.length}});
  await settle(page);
  expect(page.variables.at(-1)!.p).toEqual({city: null, category: null});
  expect(text(page, 'stat-orders-value')).toBe(fmt(ROWS.length));
  expect(doc.querySelector('[data-af-id^="filter-c"]')).toBeNull();
});

it('drops a superseded answer: the last pick wins even when an earlier pick answers later', async () => {
  const answer = sqlAnswer();
  const page = await load(fill(read('csv-dashboard.html')), async (query, variables) => {
    if ((variables?.p as {category?: string} | undefined)?.category === 'Meals') await new Promise(resolve => setTimeout(resolve, 30));
    return answer(query, variables);
  });
  const doc = page.dom.window.document;
  (doc.querySelector('[data-af-id="chart-categories-table-row-Meals-pick"]') as HTMLButtonElement).click();
  (doc.querySelector('[data-af-id="chart-categories-table-row-Groceries-pick"]') as HTMLButtonElement).click();
  await settle(page);
  expect(text(page, 'stat-orders-value')).toBe(fmt(ROWS.filter(row => row.category === 'Groceries').length));
  expect(text(page, 'filter-category')).toBe('Category: Groceries ✕');
});

it('draws a chart from its query\'s rows as SQL grouped them, split by a series column', async () => {
  const html = read('csv-dashboard.html').replace(/charts: \[[\s\S]*?\n {2}\],/, `charts: [
    {id:'load', title:'Load', mark:'bar', query:'load', x:'category', y:'orders', series:'reach'},
  ],`).replace('  queries: {', "  queries: {\n    load: \"select category, case when distance_km > 3 then 'far' else 'near' end as reach,\" +\n" +
    "      \" count(*) as orders from deliveries group by category, reach order by category, reach\",");
  const page = await load(html, sqlAnswer());
  expect(page.error).toBeUndefined();
  const expected = [...new Set(ROWS.map(row => row.category))].sort().flatMap(category => ['far', 'near'].map(reach => ({x: category,
    series: reach, y: ROWS.filter(row => row.category === category && (row.distance_km > 3 ? 'far' : 'near') === reach).length})));
  expect(page.specs[0]!.data.values).toEqual(expected);
  expect(page.specs[0]!.encoding.color.title).toBe('reach');
});

it('shows a dataset read failure in the status line instead of figures', async () => {
  const page = await load(read('csv-dashboard.html'), () => ({errors: [{message: 'Dataset not found'}]}));
  expect(page.error).toBeUndefined();
  expect(page.dom.window.document.querySelector('#status')!.textContent).toBe('Dataset not found');
  expect(page.specs).toHaveLength(0);
});

it('passes its own unchanged steps once filled, and names starter text, an empty chart and an unlinked filter', async () => {
  const source = read('csv-dashboard-steps.mjs');
  const filled = fill(read('csv-dashboard.html'));
  const page = await load(filled, sqlAnswer());
  const result = await steps(page.dom, source);
  expect(result.failure).toBeNull();
  expect(result.labels).toEqual(['page computed its 9 queries from the dataset', 'every chart draws marks and lists its values in a table',
    'picking a City filters the other charts; clearing restores them', 'no [placeholders] or stray text left']);
  const template = await load(read('csv-dashboard.html'), sqlAnswer());
  expect((await steps(template.dom, source)).failure).toContain('replace every [bracketed] part');
  const broken = await load(filled.replace("x:'week',\n      y:'orders'", "x:'week',\n      y:'done'"), sqlAnswer());
  expect((await steps(broken.dom, source)).failure).toContain('charts with no data: weekly (0 marks, 0 table rows)');
  // Queries that ignore $city: picking a city changes nothing else, and the step says which parameter to read.
  const unlinked = await load(filled.replaceAll(/\(\$city is null or (d\.)?city = \$city\)/g, '($city is null or 1)'), sqlAnswer());
  expect((await steps(unlinked.dom, source)).failure).toBe('picking Amsterdam changed no other chart: do the other queries read $city?');
});

it('reads a linked dataset into deck chart slides before drawing, and its steps check it', async () => {
  const withData = (html: string) => html.replace("window.DATA = {dataset: ''};", "window.DATA = {dataset: 'deliveries'};")
    .replace("mark:'line', format:'.0f', yTitle:'Customers (cumulative)',\n    data:[{x:'Q1', y:2}, {x:'Q2', y:5}, {x:'Q3', y:9}, {x:'Q4', y:14}]}",
      "mark:'line', format:'.0f', yTitle:'Customers (cumulative)', x:'hour', y:'minutes'}");
  const html = withData(read('deck.html'));
  expect(html).toContain("x:'hour', y:'minutes'}");
  const page = await load(html, sqlAnswer());
  expect(page.error).toBeUndefined();
  expect(page.queries).toEqual(['query Sums($sql:String!){_sql(sql:$sql){rows}}']);
  const byHour = [...new Set(ROWS.map(row => row.hour))].sort((a, b) => a - b)
    .map(hour => [String(hour), ROWS.filter(row => row.hour === hour).reduce((sum, row) => sum + row.minutes, 0)]);
  const traction = page.specs.find(spec => spec.data.values[0]?.x === byHour[0]![0])!;
  expect(traction.data.values.map((v: {x: string; y: number}) => [v.x, v.y])).toEqual(byHour);
  // The ask's milestone starts from the dataset's last value, so the two slides agree.
  const ask = page.dom.window.document.querySelector('[data-af-id="slide-ask-stat-1-value"]')!.textContent;
  expect(ask).toBe(`${byHour.at(-1)![1]} → [100 customers]`);
  const source = read('deck-steps.mjs').replace('PLACEHOLDERS_OK=false', 'PLACEHOLDERS_OK=true');
  const passed = await steps(page.dom, source);
  expect(passed.labels).toContain('1 chart slides read the linked dataset');
  const failed = await load(html, () => ({errors: [{message: 'no field week'}]}));
  expect(failed.dom.window.document.querySelector('[data-af-id="slide-traction-error"]')!.textContent).toBe('Traction: no field week');
  expect((await steps(failed.dom, source)).failure).toContain('no dataset rows on Traction: no field week');
  // Without a dataset the deck sends no query.
  expect((await load(read('deck.html'), sqlAnswer())).queries).toEqual([]);
});

it('hands Vega-Lite specs that the pinned libraries compile and render with marks, in every data starter', async () => {
  const pages = [await load(read('csv-dashboard.html'), sqlAnswer()), await load(read('deck.html'), sqlAnswer())];
  const specs = pages.flatMap(page => page.specs);
  expect(specs.length).toBeGreaterThanOrEqual(8);
  for (const spec of specs) {
    const view = new vega.View(vega.parse(compile(spec as never).spec, undefined, {ast: true}),
      {renderer: 'none', expr: expressionInterpreter as never});
    const svg = await view.toSVG();
    view.finalize();
    expect(svg, JSON.stringify(spec.mark ?? spec.spec?.mark)).toMatch(/class="mark-(?:rect|line|symbol)[^"]*"[^>]*>\s*<path/);
  }
});

/** A tracker preset as new-app.mjs writes it, its [bracketed] text filled. */
const tracker = async (preset: 'tasks' | 'list') =>
  fill((await trackerFiles(trackerFeatures({preset}), {preset}))['index.html']!);
type Entry = {id: string; name: string; grp: string; note: string; can: {update: boolean; delete: boolean}};
/** The tracker's one request as the page route answers it: the rows (aliased id and can, as the page asks), what
 *  this viewer may add, and both `_sql` counts run on the SQL engine over the dataset `entries` with their params. */
const trackerAnswer = (entries: Entry[], {insert, signedIn}: {insert: boolean; signedIn: boolean}): Answer =>
  async (_query, variables = {}) => {
    const rows = entries.map(({id, name, grp, note}) => ({_id: id, name, grp, note}));
    const columns = ['_id', 'name', 'grp', 'note'].map(name => ({name, type: 'string' as const}));
    const run = async (sql: unknown, params = {}) => {
      const out = (await engine.run({tables: {entries: {columns, rows: rows as never}}, queries: [{name: 'r', sql: String(sql)}], params})).r!;
      if ('error' in out) throw Error(out.error);
      return {rows: out.rows};
    };
    return {data: {entries, entries_can: {insert}, viewer: {signedIn},
      groups: await run(variables.groups, variables.p as object), total: await run(variables.total)}};
  };
const can = (yes: boolean) => ({update: yes, delete: yes});

it('shows the tracker\'s add form, and Edit and Remove only on entries the server lets this viewer change', async () => {
  const entries = [{id: 'a1', name: 'Ada', grp: 'First choice', note: 'gloves', can: can(true)},
    {id: 'b2', name: 'Bo', grp: 'Second choice', note: '', can: can(false)},
    {id: 'c3', name: 'Cy', grp: 'A shift since renamed', note: '', can: can(false)}];
  const signedIn = await load(await tracker('list'), trackerAnswer(entries, {insert: true, signedIn: true}));
  expect(signedIn.error).toBeUndefined();
  const doc = signedIn.dom.window.document, ids = (suffix: string) =>
    [...doc.querySelectorAll(`[data-af-id$="${suffix}"]`)].map(n => (n as HTMLElement).dataset.afId);
  expect((doc.querySelector('#add') as HTMLFormElement).hidden).toBe(false);
  expect(ids('-edit')).toEqual(['entry-a1-edit']);expect(ids('-remove')).toEqual(['entry-a1-remove']);
  // Counts are _sql's: one per listed group, and an entry whose group is no longer listed counts under Other.
  expect(doc.querySelector('[data-af-id="group-first-choice-count"]')?.textContent).toBe('1');
  expect(doc.querySelector('[data-af-id="group-third-choice-empty"]')?.textContent).toBe('Nothing yet.');
  expect(doc.querySelector('[data-af-id="group-other-count"]')?.textContent).toBe('1');
  expect(doc.querySelector('#status')?.textContent).toBe('3 so far.');
  expect(signedIn.queries[0]).toMatch(/groups:_sql\(sql:\$groups,params:\$p\)\{rows\} total:_sql\(sql:\$total\)\{rows\}/);
  // Signed out: no form, the sign-in prompt, and no controls even on an entry the owner could change.
  const guest = await load(await tracker('list'), trackerAnswer(entries.map(e => ({...e, can: can(false)})), {insert: false, signedIn: false}));
  const g = guest.dom.window.document;
  expect((g.querySelector('#add') as HTMLFormElement).hidden).toBe(true);
  expect((g.querySelector('#signin') as HTMLElement).hidden).toBe(false);
  expect(g.querySelectorAll('[data-af-id$="-edit"],[data-af-id$="-remove"]').length).toBe(0);
});

it('keeps what someone typed into an open tracker entry when another change refreshes the list', async () => {
  const entries = [{id: 'a1', name: 'Ada', grp: 'First choice', note: 'gloves', can: can(true)}];
  const page = await load(await tracker('list'), trackerAnswer(entries, {insert: true, signedIn: true}));
  const doc = page.dom.window.document;
  (doc.querySelector('[data-af-id="entry-a1-edit"]') as HTMLButtonElement).click();
  const note = () => doc.querySelector('[data-af-id="entry-a1-note-input"]') as HTMLInputElement | null;
  note()!.value = 'typed, not saved';
  page.change!(['entries']);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(note()?.value).toBe('typed, not saved');
});

/** The API starter's two requests: the resolver's items (or its error) and the notes with what this viewer may do. */
const apiAnswer = (items: unknown, notes: Array<Record<string, unknown>>, signedIn = true): Answer => query =>
  /api\s*\{\s*items/.test(query) ? items : {data: {notes, notes_can: {insert: signedIn}, viewer: {signedIn}}};
const DEALS = [{id: 7, name: 'Acme renewal', category: 'Proposal', amount: 1200, owner: 'x'},
  {id: 8, name: 'Globex pilot', category: 'Proposal', amount: 300}, {id: 9, name: 'Initech', category: 'Won', amount: 50},
  {id: 10, name: 'Closed one', category: 'Won', amount: 999, status: 'lost'}];
const NOTES = [{_id: 'n1', item: '7', note: 'Call Tuesday', _can: {delete: true}},
  {_id: 'n2', item: '9', note: 'Signed', _can: {delete: false}}, {_id: 'n3', item: 'gone', note: 'Old deal', _can: {delete: false}}];
/** Money as the page formats it in this locale. */
const usd = (n: number) => new Intl.NumberFormat(undefined, {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(n);
const apiPage = (answer: Answer, edit = (html: string) => html) => load(edit(fill(read('api-dashboard.html'))), answer);

it('groups the API starter\'s items with totals, shows every note on its item and offers a note form to signed-in readers', async () => {
  const page = await apiPage(apiAnswer({data: {api: {items: DEALS}}}, NOTES));
  expect(page.error).toBeUndefined();
  const doc = page.dom.window.document, text = (id: string) => doc.querySelector(`[data-af-id="${id}"]`)?.textContent;
  // Two requests, each its own: the items failing never hides the notes.
  expect(page.queries).toHaveLength(2);
  expect([...doc.querySelectorAll('#board > section')].map(s => (s as HTMLElement).dataset.afId)).toEqual(['group-proposal', 'group-won', 'other-notes']);
  expect(text('group-proposal-total')).toBe(`2 · ${usd(1500)}`);
  expect(text('total-count-value')).toBe('4');expect(text('total-amount-value')).toBe(usd(2549));
  expect(text('item-7-name')).toBe('Acme renewal');expect(text('item-7-amount')).toBe(usd(1200));
  expect(text('item-7-notes')).toContain('Call Tuesday');expect(text('item-9-notes')).toContain('Signed');
  // A note whose item the API no longer lists stays readable, under its item id.
  expect(text('other-notes')).toContain('Old deal');expect(text('other-notes')).toContain('gone');
  // Remove only where the server says this viewer may; a form on every item for a signed-in reader.
  expect([...doc.querySelectorAll('[data-af-id$="-remove"]')].map(n => (n as HTMLElement).dataset.afId)).toEqual(['note-n1-remove']);
  expect(doc.querySelector('[data-af-id="note-n1-remove"]')!.getAttribute('aria-label')).toBe('Remove note: Call Tuesday');
  expect(doc.querySelectorAll('form.add-note')).toHaveLength(4);
  expect((doc.querySelector('#signin') as HTMLElement).hidden).toBe(true);
  expect(doc.querySelector('#board')!.getAttribute('aria-busy')).toBe('false');
  // Script-made nodes carry unique data-af-ids.
  const ids = [...doc.querySelectorAll('[data-af-id]')].map(node => node.getAttribute('data-af-id'));
  expect(new Set(ids).size).toBe(ids.length);
});

it('shows only the items APP.only keeps, and maps the API\'s own field names through APP.fields', async () => {
  const renamed = DEALS.map(({id, name, category, amount, status}) => ({deal_id: id, title: name, stage: category, value: amount, status}));
  const page = await apiPage(apiAnswer({data: {api: {items: renamed}}}, []), html => html.replace(/fields: \{[^}]*\}/,
    "fields: {id:'deal_id', name:'title', group:'stage', amount:'value'}").replace('only: {}', "only: {status: 'lost'}"));
  const doc = page.dom.window.document;
  expect([...doc.querySelectorAll('li.item strong')].map(n => n.textContent)).toEqual(['Closed one']);
  expect(doc.querySelector('[data-af-id="total-amount-value"]')!.textContent).toBe(usd(999));
});

it('says why the API starter\'s items cannot load, still shows the notes, and gives a guest no controls', async () => {
  const failed = {data: {api: null}, errors: [{message: 'Backend execution failed', extensions: {detail: 'secret_unavailable: API_KEY'}}]};
  const page = await apiPage(apiAnswer(failed, NOTES.map(note => ({...note, _can: {delete: false}})), false));
  expect(page.error).toBeUndefined();
  const doc = page.dom.window.document;
  expect(doc.querySelector('#status')!.textContent).toMatch(/Backend execution failed[^]*API_KEY[^]*Resolvers/);
  expect(doc.querySelector('[data-af-id="other-notes"]')!.textContent).toContain('Call Tuesday');
  expect(doc.querySelectorAll('form.add-note,[data-af-id$="-remove"]')).toHaveLength(0);
  expect((doc.querySelector('#signin') as HTMLElement).hidden).toBe(false);
  expect(doc.querySelector('#board')!.getAttribute('aria-busy')).toBe('false');
});

it('reads the API starter\'s list from the body or its first list, keeps only scalar fields and lets an unset key throw', async () => {
  const {declaresResolverTest} = await import('@/lib/page-operations');
  const {secretHostMap} = await import('@/lib/html-backend-secrets');
  const resolver = await import('../../../skills/artifactbin/examples/api-dashboard.ts');
  expect(declaresResolverTest(resolver.typeDefs)).toBe(true);
  expect(secretHostMap(resolver.secrets)).toEqual({API_KEY: 'api.example.com'});
  const sent: Array<{url: string; headers?: Record<string, string>}> = [];
  const caps = (body: unknown, ok = true) => ({fetch: async (url: string, init?: {headers?: Record<string, string>}) => {
    sent.push({url, ...init});
    return {ok, status: ok ? 200 : 401, text: async () => 'bad key', json: async () => body};
  }});
  const row = {id: 1, name: 'Acme', stage: 'Won', amount: 5, open: true, contact: {email: 'x@y'}, tags: ['a']};
  expect(await resolver.default.items({}, null, caps({total: 1, data: [row, 'junk']}))).toEqual([{id: 1, name: 'Acme', stage: 'Won', amount: 5, open: true}]);
  expect(await resolver.default.items({}, null, caps([row]))).toHaveLength(1);
  // The key is a placeholder the host fills, sent only to HOST.
  expect(sent[0]).toEqual({url: 'https://api.example.com/v1/items', headers: {Authorization: 'Bearer {{API_KEY}}', Accept: 'application/json'}});
  expect(await resolver.default.test({}, null, caps([row]))).toBe('Read 1 items from api.example.com/v1/items; fields: id, name, stage, amount, open');
  await expect(resolver.default.items({}, null, caps({}, false))).rejects.toThrow('api.example.com answered 401: bad key');
  await expect(resolver.default.items({}, null, caps({count: 3}))).rejects.toThrow('sent no list');
  const unset = {fetch: async () => { throw Error('secret_unavailable: API_KEY'); }};
  await expect(resolver.default.items({}, null, unset)).rejects.toThrow('secret_unavailable: API_KEY');
});

it('shows each group as N of its limit, and a full group refuses an entry before any write', async () => {
  const entries = Array.from({length: 5}, (_, i) => ({id: 'e' + i, name: 'Task ' + i, grp: 'To do', note: '', can: can(true)}));
  const page = await load(await tracker('tasks'), trackerAnswer(entries, {insert: true, signedIn: true}));
  expect(page.error).toBeUndefined();
  const doc = page.dom.window.document;
  expect(doc.querySelector('[data-af-id="group-to-do-count"]')?.textContent).toBe('5 of 5');
  expect(doc.querySelector('[data-af-id="group-doing-count"]')?.textContent).toBe('0 of 5');
  (doc.querySelector('#add-name') as HTMLInputElement).value = 'One more';
  doc.querySelector('#add')!.dispatchEvent(new page.dom.window.Event('submit', {cancelable: true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(doc.querySelector('#status')?.textContent).toBe('To do is full.');
  expect(page.mutations).toEqual([]);
  // Another group still takes it, through tracker.ts.
  (doc.querySelector('#add-group') as HTMLSelectElement).value = 'Doing';
  doc.querySelector('#add')!.dispatchEvent(new page.dom.window.Event('submit', {cancelable: true}));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.stringify(page.mutations)).toContain('tracker{add(name:$n,grp:$g,note:$note)');
  expect((page.mutations[0] as {variables: unknown}).variables).toEqual({n: 'One more', g: 'Doing', note: ''});
});
