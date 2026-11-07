/**
 * The installed starters (skills/artifactbin/examples/*.html) run as pages: each imports only hosted `@afbin/<name>`
 * modules, and the data-driven ones, filled with the sample CSV (examples/repairs.csv) through a stubbed
 * `@afbin/apollo` client whose `_sql` runs on the real SQLite engine, build their queries from their DATA block,
 * take every number from `_sql` (never summing rows in script), hand
 * Vega-Lite a spec naming those values with titled tooltips, and pass their own copy-unchanged steps files. jsdom runs
 * the page scripts with the hosted modules stubbed; every spec a page hands Vega-Lite is then compiled and rendered
 * headless by the pinned vega and vega-lite packages, as the page's no-eval interpreter would.
 */
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {afterEach, expect, it} from 'vitest';
import * as vega from 'vega';
import {compile} from 'vega-lite';
import {expressionInterpreter} from 'vega-interpreter';
import {createSqliteSql} from '@artifactbin/sql/sqlite';

const EXAMPLES = new URL('../../../skills/artifactbin/examples/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, EXAMPLES), 'utf8');
/** The hosted names a page may import: the runtime's apollo, the library registry and the hosted components. */
const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const HOSTED = new Set(['apollo', ...Object.keys(json('../../libraries/registry.json')),
  ...(json('../../html-components/hosted.json') as {components: string[]}).components]);
/** A starter with its [Bracketed text] written in: a capital then a lower-case letter or space, or a `${…}` sentence. */
const fill = (html: string) => html.replaceAll(/\[([A-Z][a-z ][^\]]*|\$\{[^\]]*)\]/g, '$1');
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter,
  window: (globalThis as {window?: unknown}).window};
afterEach(() => Object.assign(globalThis, saved));

/** The sample CSV as the generated API returns it: numbers typed, every row with its `_id`. */
const ROWS = read('repairs.csv').trim().split('\n').slice(1).map((line, index) => {
  const [week, completed, waiting] = line.split(',');
  return {_id: 'r' + index, week, completed: Number(completed), waiting: Number(waiting)};
});

interface Page {dom: JSDOM; queries: string[]; specs: Array<Record<string, any>>; error?: unknown; change?: (names: string[]) => void; settled: Array<Promise<unknown>>}
type Answer = (query: string, variables?: Record<string, unknown>) => unknown;

/**
 * Loads a starter in jsdom: the module scripts run in order with `@afbin/*` imports replaced by stubs. `answer` is
 * what the stubbed `client.query` returns for a query text; each Vega view draws one bar path per value it is given.
 */
async function load(html: string, answer: Answer): Promise<Page> {
  const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
  const dom = new JSDOM(html.replace(/<script type="module"[\s\S]*?<\/script>/g, ''), {runScripts: 'outside-only'});
  const page: Page = {dom, queries: [], specs: [], settled: []};
  Object.assign(dom.window, {IntersectionObserver: class { observe() {} disconnect() {} }, stubs: {
    apollo: {gql: (strings: readonly string[]) => strings.join(''), onResolverChange: (listener: (names: string[]) => void) => { page.change = listener; return {unsubscribe() {}}; },
      client: {query: async ({query, variables}: {query: string; variables?: Record<string, unknown>}) => { page.queries.push(query); return answer(query, variables); },
        // A watch answers once here (no dataset changes in jsdom); the page's handler is awaited by `load`.
        watchQuery: ({query, variables}: {query: string; variables?: Record<string, unknown>}) => ({subscribe(next: (result: unknown) => unknown) {
          page.queries.push(query);
          page.settled.push(Promise.resolve(answer(query, variables)).then((result) => next({...result as object, loading: false})));
          return {unsubscribe() {}};
        }})}},
    compile: (spec: Record<string, unknown>) => { page.specs.push(spec); return {spec}; },
    vega: {parse: (spec: unknown) => spec, expressionInterpreter: {}, View: class {
      constructor(private spec: {data?: {values?: unknown[]}}, private options: {container: Element}) {}
      async runAsync() {
        const marks = '<path></path>'.repeat(this.spec.data?.values?.length ?? 1);
        this.options.container.innerHTML = `<svg><g class="mark-rect">${marks}</g></svg>`;
      }
      finalize() {}
    }}}});
  try {
    for (const script of scripts) {
      const body = script.replace(/^import .*$/gm, '');
      await dom.window.eval(`(async()=>{const vega=stubs.vega,{compile}=stubs,{client,gql,onResolverChange}=stubs.apollo;${body}})()`);
    }
    await Promise.all(page.settled);
  } catch (error) {
    page.error = error;
  }
  return page;
}

/** Runs a steps file over the loaded page with a stub `page`; returns the passing labels or the first failure. */
async function steps(dom: JSDOM, source: string): Promise<{labels: string[]; failure: string | null}> {
  const doc = dom.window.document, labels: string[] = [];
  Object.assign(globalThis, {document: doc, NodeFilter: dom.window.NodeFilter, window: dom.window});
  const locator = (selector: string): Record<string, unknown> => ({count: async () => doc.querySelectorAll(selector).length,
    textContent: async () => doc.querySelector(selector)?.textContent ?? '', click: async () => {}, waitFor: async () => {},
    first: () => locator(selector), nth: () => locator(selector)});
  const evaluate = async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg);
  const page = {evaluate, mainFrame: () => ({evaluate}), locator, getByRole: () => locator('button'), keyboard: {press: async () => {}},
    url: () => 'http://127.0.0.1:4100/index.html', viewportSize: () => ({width: 1280, height: 800}),
    waitForFunction: async (fn: (arg: unknown) => unknown, arg: unknown) => { if (!fn(arg)) throw Error('timed out'); }};
  const step = async (label: string, fn: () => Promise<void>) => { await fn(); labels.push(label); };
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', source)(page, step);
    return {labels, failure: null};
  } catch (error) {
    return {labels, failure: (error as Error).message};
  }
}

const engine = createSqliteSql({maxRows: 10000, timeoutMs: 5000});
const COLUMNS = [{name: '_id', type: 'string'}, {name: 'week', type: 'string'}, {name: 'completed', type: 'number'}, {name: 'waiting', type: 'number'}] as const;
/** `_sql` as the page route answers it: every aliased field's SQL (a variable) run on the SQL engine over the dataset `repairs`. */
const sqlAnswer = (rows: ReadonlyArray<Record<string, unknown>> = ROWS): Answer => async (query, variables = {}) => {
  const data: Record<string, unknown> = {};
  for (const [, alias, variable] of query.matchAll(/(?:(\w+):)?_sql\(sql:\$(\w+)\)/g)) {
    const outcome = (await engine.run({tables: {repairs: {columns: [...COLUMNS], rows: rows as never}}, queries: [{name: 'r', sql: String(variables[variable!])}], params: {}})).r!;
    if ('error' in outcome) return {data: null, errors: [{message: outcome.error}]};
    data[alias ?? '_sql'] = {rows: outcome.rows};
  }
  return {data};
};
const sum = (key: 'completed' | 'waiting') => ROWS.reduce((total, row) => total + row[key], 0);

it('imports only hosted @afbin modules from every starter', () => {
  for (const name of ['csv-dashboard.html', 'deck.html', 'report.html', 'shared-app.html', 'shared-list.html']) {
    const names = [...read(name).matchAll(/(?:from|import)\s*['"]@afbin\/([a-z0-9-]+)['"]/g)].map(m => m[1]!);
    expect(names.length, name).toBeGreaterThan(0);
    for (const imported of names) expect(HOSTED.has(imported), `${name} imports @afbin/${imported}`).toBe(true);
  }
});

it('draws no hand-made SVG chart in any data starter: charts go through Vega-Lite', () => {
  for (const name of ['csv-dashboard.html', 'deck.html', 'shared-app.html']) {
    const html = read(name);
    expect(html, name).toContain("from '@afbin/vega-lite'");
    expect(html, name).not.toMatch(/createElementNS\([^)]*\)[^;]*\b(?:rect|line)\b|['"]rect['"],\{x:/);
  }
});

it('fills the csv dashboard from its DATA queries, each one _sql field of one request', async () => {
  const html = read('csv-dashboard.html').replace('ref:DATASET_ID', 'ref:Ab12Cd34');
  const page = await load(html, sqlAnswer());
  expect(page.error).toBeUndefined();
  const doc = page.dom.window.document, data = (page.dom.window as unknown as {DATA: Record<string, any>}).DATA;
  // One watched request: every DATA query an aliased _sql field, its SQL a variable; no row is paged into script.
  expect(page.queries).toHaveLength(1);
  for (const name of Object.keys(data.queries)) expect(page.queries[0]).toMatch(new RegExp(`${name}:_sql\\(sql:\\$s\\d+\\)`));
  expect(page.queries[0]).not.toMatch(/repairs\(|offset/);
  expect(doc.querySelector('#status')!.textContent).toBe(`Computed ${Object.keys(data.queries).length} queries from the linked dataset.`);
  // Every number on the page comes from the queries.
  expect(doc.querySelector('#title')!.textContent).toBe('[Repair bench capacity]');
  expect(doc.querySelector('#lead')!.textContent).toContain(`${sum('completed')} repairs were completed across ${ROWS.length} weeks`);
  expect(doc.querySelector('[data-af-id="stat-waiting-value"]')!.textContent).toBe(String(ROWS.at(-1)!.waiting));
  // One Vega-Lite spec per DATA chart: its query's rows, titled axes and tooltips, the svg renderer's config.
  expect(page.specs).toHaveLength(data.charts.length);
  data.charts.forEach((chart: {x: string; y: 'completed' | 'waiting'}, n: number) => {
    const spec = page.specs[n]!;
    expect(spec.data.values).toEqual(ROWS.map(row => ({x: row.week, series: '', y: row[chart.y]})));
    expect(spec.encoding.x.title).toBe(data.labels[chart.x]);
    expect(spec.encoding.y.title).toBe(data.labels[chart.y]);
    for (const field of spec.encoding.tooltip) expect(field.title, JSON.stringify(field)).toBeTruthy();
    expect(spec.config.axis.gridDash).toEqual([3, 3]);
  });
  // Each chart's table lists the same values.
  const cells = [...doc.querySelectorAll('[data-af-id="chart-completed-table"] td')].map(td => td.textContent);
  expect(cells).toEqual(ROWS.map(row => String(row.completed)));
  // Script-made nodes carry unique data-af-ids.
  const ids = [...doc.querySelectorAll('[data-af-id]')].map(node => node.getAttribute('data-af-id'));
  expect(new Set(ids).size).toBe(ids.length);
});

it('draws a chart from its query\'s rows as SQL grouped them, split by a series column', async () => {
  const html = read('csv-dashboard.html').replace(/charts: \[[\s\S]*?\n  \],/, `charts: [
    {id:'load', title:'Load', mark:'bar', query:'load', x:'week', y:'waiting', series:'pace'},
  ],`).replace("  queries: {", "  queries: {\n    load: \"select week, case when completed > 20 then 'busy' else 'calm' end as pace,\" +\n      \" avg(waiting) as waiting from repairs group by week, pace order by week\",");
  const doubled = ROWS.flatMap(row => [row, {...row, _id: row._id + 'b', waiting: row.waiting + 2}]);
  const page = await load(html, sqlAnswer(doubled));
  expect(page.error).toBeUndefined();
  expect(page.specs[0]!.data.values).toEqual(ROWS.map(row => ({x: row.week, series: row.completed > 20 ? 'busy' : 'calm', y: row.waiting + 1})));
  expect(page.specs[0]!.encoding.color.title).toBe('pace');
});

it('shows a dataset read failure in the status line instead of figures', async () => {
  const page = await load(read('csv-dashboard.html'), () => ({errors: [{message: 'Dataset not found'}]}));
  expect(page.error).toBeUndefined();
  expect(page.dom.window.document.querySelector('#status')!.textContent).toBe('Dataset not found');
  expect(page.specs).toHaveLength(0);
});

it('passes its own unchanged steps once filled, and names the starter text left in the template', async () => {
  const source = read('csv-dashboard-steps.mjs');
  const filled = fill(read('csv-dashboard.html'));
  const page = await load(filled, sqlAnswer());
  const result = await steps(page.dom, source);
  expect(result.failure).toBeNull();
  expect(result.labels).toEqual(['page computed its 3 queries from the dataset', 'every chart draws marks and lists its values in a table',
    'no [placeholders] or stray text left']);
  const template = await load(read('csv-dashboard.html'), sqlAnswer());
  expect((await steps(template.dom, source)).failure).toContain('replace every [bracketed] part');
  const broken = await load(filled.replace("x:'week',\n      y:'completed'}", "x:'week',\n      y:'done'}"), sqlAnswer());
  expect((await steps(broken.dom, source)).failure).toContain('charts with no data: completed (0 marks, 0 table rows)');
});

it('reads a linked dataset into deck chart slides before drawing, and its steps check it', async () => {
  const withData = (html: string) => html.replace("window.DATA = {dataset: ''};", "window.DATA = {dataset: 'repairs'};")
    .replace("mark:'line', format:'.0f', yTitle:'Customers (cumulative)',\n    data:[{x:'Q1', y:2}, {x:'Q2', y:5}, {x:'Q3', y:9}, {x:'Q4', y:14}]}",
      "mark:'line', format:'.0f', yTitle:'Customers (cumulative)', x:'week', y:'completed'}");
  const html = withData(read('deck.html'));
  expect(html).toContain("x:'week', y:'completed'}");
  const page = await load(html, sqlAnswer());
  expect(page.error).toBeUndefined();
  expect(page.queries).toEqual(['query Sums($sql:String!){_sql(sql:$sql){rows}}']);
  const traction = page.specs.find(spec => spec.data.values[0]?.x === ROWS[0]!.week)!;
  expect(traction.data.values.map((v: {x: string; y: number}) => [v.x, v.y])).toEqual(ROWS.map(row => [row.week, row.completed]));
  // The ask's milestone starts from the dataset's last value, so the two slides agree.
  const ask = page.dom.window.document.querySelector('[data-af-id="slide-ask-stat-1-value"]')!.textContent;
  expect(ask).toBe(`${ROWS.at(-1)!.completed} → [100 customers]`);
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
  expect(specs.length).toBeGreaterThanOrEqual(4);
  for (const spec of specs) {
    const view = new vega.View(vega.parse(compile(spec as never).spec, undefined, {ast: true}),
      {renderer: 'none', expr: expressionInterpreter as never});
    const svg = await view.toSVG();
    view.finalize();
    expect(svg, JSON.stringify(spec.mark)).toMatch(/class="mark-(?:rect|line|symbol)[^"]*"[^>]*>\s*<path/);
  }
});

it('shows the list starter\'s add form, and Edit and Remove only on entries the server lets this viewer change', async () => {
  const entries = [{_id: 'a1', name: 'Ada', choice: 'First choice', note: 'gloves', _can: {update: true, delete: true}},
    {_id: 'b2', name: 'Bo', choice: 'Second choice', note: '', _can: {update: false, delete: false}}];
  const signedIn = await load(fill(read('shared-list.html')),
    () => ({data: {entries, entries_can: {insert: true}, viewer: {signedIn: true}}}));
  expect(signedIn.error).toBeUndefined();
  const doc = signedIn.dom.window.document, ids = (suffix: string) =>
    [...doc.querySelectorAll(`[data-af-id$="${suffix}"]`)].map(n => (n as HTMLElement).dataset.afId);
  expect((doc.querySelector('#add') as HTMLFormElement).hidden).toBe(false);
  expect(ids('-edit')).toEqual(['entry-a1-edit']);expect(ids('-remove')).toEqual(['entry-a1-remove']);
  expect(doc.querySelector('[data-af-id="choice-first-choice-count"]')?.textContent).toBe('1 signed up');
  expect(doc.querySelector('[data-af-id="choice-third-choice-empty"]')?.textContent).toBe('No one yet.');
  expect(doc.querySelector('#status')?.textContent).toBe('2 signed up so far.');
  // Signed out: no form, the sign-in prompt, and no controls even on an entry the owner could change.
  const guest = await load(fill(read('shared-list.html')), () => ({data: {entries: entries.map(e => ({...e,
    _can: {update: false, delete: false}})), entries_can: {insert: false}, viewer: {signedIn: false}}}));
  const g = guest.dom.window.document;
  expect((g.querySelector('#add') as HTMLFormElement).hidden).toBe(true);
  expect((g.querySelector('#signin') as HTMLElement).hidden).toBe(false);
  expect(g.querySelectorAll('[data-af-id$="-edit"],[data-af-id$="-remove"]').length).toBe(0);
});

it('keeps what someone typed into an open list entry when another change refreshes the list', async () => {
  const entries = [{_id: 'a1', name: 'Ada', choice: 'First choice', note: 'gloves', _can: {update: true, delete: true}}];
  const page = await load(fill(read('shared-list.html')), () => ({data: {entries, entries_can: {insert: true}, viewer: {signedIn: true}}}));
  const doc = page.dom.window.document;
  (doc.querySelector('[data-af-id="entry-a1-edit"]') as HTMLButtonElement).click();
  const note = () => doc.querySelector('[data-af-id="entry-a1-note-input"]') as HTMLInputElement | null;
  note()!.value = 'typed, not saved';
  page.change!(['entries']);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(note()?.value).toBe('typed, not saved');
});
