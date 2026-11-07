/**
 * examples/codebase-report.html runs as a page over the three tables the codebase command gathers
 * (commits, files, imports): jsdom runs its scripts with the hosted modules stubbed, its one watched
 * request's `_sql` fields run on the real SQLite engine, its findings read the SQL answers, its
 * Vega-Lite specs compile and render with marks in the pinned vega and vega-lite, its Pele
 * flowchart is drawn from the imports query's rows, and its own steps file passes once its
 * [bracketed] text is written and names what is left otherwise.
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
const json = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const HOSTED = new Set(['apollo', ...Object.keys(json('../../libraries/registry.json')),
  ...(json('../../html-components/hosted.json') as {components: string[]}).components]);
const saved = {document: globalThis.document, NodeFilter: (globalThis as {NodeFilter?: unknown}).NodeFilter,
  window: (globalThis as {window?: unknown}).window};
afterEach(() => Object.assign(globalThis, saved));

type Row = Record<string, string | number>;
const table = (columns: string, lines: string[]) => {
  const names = columns.split(',');
  return lines.map((line, i) => Object.fromEntries([['_id', 'r' + i], ...line.split(',').map((value, n) =>
    [names[n]!, /^-?\d+$/.test(value) ? Number(value) : value])]) as Row);
};
const TABLES: Record<string, Row[]> = {
  commits: table('commit,date,author,area,files,added,deleted', ['c1,2026-01-05,Ada,web,3,30,2',
    'c2,2026-01-06,Bo,lib,1,5,0', 'c3,2026-01-13,Ada,web,2,10,1', 'c4,2026-01-14,Ada,lib,1,2,2',
    'c5,2026-01-15,Cy,web,1,1,0']),
  files: table('path,area,language,lines,changes,churn,authors,last_change', [
    'web/app.ts,web,TypeScript,120,3,33,2,2026-01-15', 'lib/math.ts,lib,TypeScript,40,2,9,2,2026-01-14',
    'README.md,(root),Markdown,10,0,0,0,', 'web/empty.ts,web,TypeScript,0,1,0,1,2026-01-05']),
  imports: table('source,target,source_area,target_area', ['web/app.ts,lib/math.ts,web,lib',
    'web/x.ts,lib/y.ts,web,lib', 'lib/math.ts,shared/z.ts,lib,shared', '(root),(root),(root),(root)']),
};
const engine = createSqliteSql({maxRows: 10000, timeoutMs: 5000});
const columns = (rows: Row[]) => Object.keys(rows[0]!).map(name => ({name,
  type: typeof rows[0]![name] === 'number' ? 'number' : 'string'}));
/** `_sql` as the page route answers it: every aliased field's SQL run over the three linked tables. */
async function answer(query: string, variables: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {};
  const tables = Object.fromEntries(Object.entries(TABLES).map(([name, rows]) => [name, {columns: columns(rows), rows}]));
  for (const [, alias, variable] of query.matchAll(/(\w+):_sql\(sql:\$(\w+)\)/g)) {
    const outcome = (await engine.run({tables: tables as never, queries: [{name: 'r', sql: String(variables[variable!])}], params: {}})).r!;
    if ('error' in outcome) return {data: null, errors: [{message: outcome.error}]};
    data[alias!] = {rows: outcome.rows};
  }
  return {data};
}
/** The page with its DATA [bracketed] text written: only the DATA script and <title>, never page code. */
const fill = (html: string) => {
  const end = html.indexOf('</script>');
  return html.slice(0, end).replaceAll(/\[(\$\{[^\]]*|[A-Z][^\]]*|[^\]\n[{]* [^\]\n]*)\]/g, '$1') + html.slice(end);
};

interface Page {dom: JSDOM; queries: string[]; specs: Array<Record<string, any>>; diagrams: string[]; error?: unknown}
async function load(html: string, reply: typeof answer = answer): Promise<Page> {
  const scripts = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]!);
  const dom = new JSDOM(html.replace(/<script type="module"[\s\S]*?<\/script>/g, ''), {runScripts: 'outside-only'});
  const page: Page = {dom, queries: [], specs: [], diagrams: []}, settled: Array<Promise<unknown>> = [];
  Object.assign(dom.window, {structuredClone, stubs: {
    apollo: {gql: (strings: readonly string[]) => strings.join(''), client: {
      watchQuery: ({query, variables}: {query: string; variables?: Record<string, unknown>}) => ({subscribe(next: (result: unknown) => unknown) {
        page.queries.push(query);
        settled.push(reply(query, variables).then(result => next({...result, loading: false})));
        return {unsubscribe() {}};
      }})}},
    compile: (spec: Record<string, unknown>) => { page.specs.push(spec); return {spec}; },
    mount: (host: HTMLElement, source: string, options: {onRender(): void}) => {
      page.diagrams.push(source);
      host.innerHTML = '<svg><g class="edge"></g></svg>';
      queueMicrotask(() => options.onRender());
      return {destroy() {}};
    },
    vega: {parse: (spec: unknown) => spec, expressionInterpreter: {}, interpolate: (vega as unknown as {interpolate: unknown}).interpolate, View: class {
      constructor(private spec: {data?: {values?: unknown[]}}, private options: {container: Element}) {}
      async runAsync() {
        const marks = '<path></path>'.repeat(this.spec.data?.values?.length ?? 0);
        this.options.container.innerHTML = `<svg><g class="mark-rect">${marks}</g></svg>`;
      }
      finalize() {}
    }}}});
  try {
    for (const script of scripts) {
      const body = script.replace(/^import .*$/gm, '');
      await dom.window.eval(`(async()=>{const vega=stubs.vega,{compile,mount}=stubs,{client,gql}=stubs.apollo;${body}})()`);
    }
    await Promise.all(settled);
    await new Promise(resolve => setTimeout(resolve, 0));
  } catch (error) {
    page.error = error;
  }
  return page;
}
/** Runs the steps file over the loaded page with a stub `page`; the passing labels or the first failure. */
async function steps(dom: JSDOM, source: string) {
  const labels: string[] = [];
  Object.assign(globalThis, {document: dom.window.document, NodeFilter: dom.window.NodeFilter, window: dom.window});
  const page = {evaluate: async (fn: () => unknown) => fn(),
    waitForFunction: async (fn: () => unknown) => { if (!fn()) throw Error('timed out'); }};
  const step = async (label: string, fn: () => Promise<void>) => { await fn(); labels.push(label); };
  try {
    await new (Object.getPrototypeOf(async function () {}).constructor)('page', 'step', source)(page, step);
    return {labels, failure: null as string | null};
  } catch (error) {
    return {labels, failure: (error as Error).message};
  }
}
/** The design system's tokens as the platform sets them on the root, light or dark. */
const TOKENS = {light: {background: '#eeede6', 'chart-1': '#2a5bd7'}, dark: {background: '#0f1b2d', 'chart-1': '#8fb4ff'}};
const themed = (html: string, tokens: Record<string, string>) => html.replace('<html lang="en">',
  `<html lang="en" style="${Object.entries(tokens).map(([name, value]) => `--${name}:${value}`).join(';')}">`);
const rgb = (color: string) => color.startsWith('#') ? [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))
  : color.match(/\d+/g)!.map(Number);
const text = (page: Page, id: string) => page.dom.window.document.querySelector(`[data-af-id="${id}"]`)?.textContent;

it('imports only hosted @afbin modules and names its design system, nothing the platform adds', () => {
  expect(read('codebase-report.html')).toContain('<meta name="artifactbin:design-system" content="drafting">');
  expect(read('codebase-report.html')).not.toContain('core.js');
  const names = [...read('codebase-report.html').matchAll(/(?:from|import)\s*['"]@afbin\/([a-z0-9-]+)['"]/g)].map(m => m[1]!);
  expect(names).toEqual(['apollo', 'vega', 'vega-lite', 'pele-flowchart']);
  for (const name of names) expect(HOSTED.has(name), name).toBe(true);
});

it('computes every number with _sql over the three linked tables in one watched request', async () => {
  const page = await load(fill(read('codebase-report.html')));
  expect(page.error).toBeUndefined();
  const data = (page.dom.window as unknown as {DATA: Record<string, any>}).DATA, names = Object.keys(data.queries);
  expect(page.queries).toHaveLength(1);
  for (const name of names) expect(page.queries[0]).toMatch(new RegExp(`${name}:_sql\\(sql:\\$s\\d+\\)`));
  expect(page.queries[0]).not.toMatch(/commits\(|files\(|imports\(/);
  expect(page.dom.window.document.querySelector('#status')!.textContent)
    .toBe(`Computed ${names.length} queries from the linked datasets.`);
  expect(page.dom.window.document.querySelector('#lead')!.textContent)
    .toBe('5 commits by 3 people changed this 4-file codebase since 2026-01-05; most of the risk sits in a handful of files.');
  // Findings first, each from its query's first row: the hottest file, the main author, the busiest
  // import between areas (the (root) placeholder row left out) and the busiest Monday-start week.
  expect(text(page, 'finding-hotspot-text')).toBe('web/app.ts changed in 3 commits and is 120 lines long: review, test and split it first.');
  expect(text(page, 'finding-people-text')).toBe('Ada made 60% of the 5 commits; the grid shows areas only one person knows.');
  expect(text(page, 'finding-coupling-text')).toBe('web imports lib in 2 places, the thickest arrow in the diagram.');
  expect(text(page, 'finding-pace-text')).toBe('The busiest week, from 2026-01-12, had 3 commits.');
  const order = [...page.dom.window.document.querySelectorAll('main h2')].map(h2 => h2.textContent);
  expect(order[0]).toBe('Findings');
  expect(page.dom.window.document.querySelector('#method')!.textContent).toContain('5 commits without merges since 1 year ago (2026-01-05 to 2026-01-15) and 4 tracked text files in 3 areas');
  // One Vega-Lite spec per chart, its values its query's rows; axes titled from labels.
  const [hotspots, grid, weekly] = page.specs;
  expect(hotspots!.data.values.map((row: Row) => [row.path, row.lines, row.changes])).toEqual([['web/app.ts', 120, 3], ['lib/math.ts', 40, 2]]);
  expect(hotspots!.encoding.y.title).toBe('Commits that changed it');
  expect(grid!.data.values.map((row: Row) => `${row.author} ${row.area} ${row.commits}`)).toEqual(['Ada lib 1', 'Ada web 2', 'Bo lib 1', 'Cy web 1']);
  expect(weekly!.data.values).toEqual([{week: '2026-01-05', commits: 2, lines_changed: 37}, {week: '2026-01-12', commits: 3, lines_changed: 16}]);
  for (const spec of page.specs) for (const field of spec.encoding.tooltip) expect(field.title, JSON.stringify(field)).toBeTruthy();
  // The diagram: one node per area, one arrow per imports row, labelled with its count.
  expect(page.diagrams).toEqual(['flowchart LR\n  a0["web"]\n  a1["lib"]\n  a2["shared"]\n  a0 -->|2| a1\n  a1 -->|1| a2']);
  expect(page.dom.window.document.querySelector('[data-af-id="chart-modules-plot"]')!.getAttribute('data-drawn')).toBe('2');
  // Each chart lists its values; the hotspot table is open with the top rows.
  expect([...page.dom.window.document.querySelectorAll('[data-af-id="chart-hotspots-table"] td')].slice(0, 5).map(td => td.textContent))
    .toEqual(['web/app.ts', 'web', '120', '3', '2']);
  expect(page.dom.window.document.querySelector<HTMLDetailsElement>('[data-af-id="chart-hotspots-table-box"]')!.open).toBe(true);
  const ids = [...page.dom.window.document.querySelectorAll('[data-af-id]')].map(node => node.getAttribute('data-af-id'));
  expect(new Set(ids).size).toBe(ids.length);
});

it('hands Vega-Lite specs the pinned libraries render with marks: points, cells and a line', async () => {
  const page = await load(fill(read('codebase-report.html')));
  const marks = [];
  for (const spec of page.specs) {
    const view = new vega.View(vega.parse(compile(spec as never).spec, undefined, {ast: true}),
      {renderer: 'none', expr: expressionInterpreter as never});
    const svg = await view.toSVG();
    view.finalize();
    marks.push(/class="mark-(symbol|rect|line)[^"]*"[^>]*>\s*<path/.exec(svg)?.[1]);
  }
  expect(marks).toEqual(['symbol', 'rect', 'line']);
});

it('passes its own steps once written, and names the starter text, a broken chart and a read failure', async () => {
  const source = read('codebase-report-steps.mjs'), html = fill(read('codebase-report.html'));
  const passed = await steps((await load(html)).dom, source);
  expect(passed.failure).toBeNull();
  expect(passed.labels).toEqual(['page computed its 8 queries from the datasets', 'every finding states a number and links to its evidence',
    'every chart draws marks and the diagram draws its arrows', 'no [placeholders] or stray text left']);
  const template = await steps((await load(read('codebase-report.html'))).dom, source);
  expect(template.failure).toContain('starter text left: "[How this codebase changes]"');
  const broken = await load(html.replace("query:'weekly', spec", "query:'week', spec"));
  expect((await steps(broken.dom, source)).failure).toBe('charts with no data: weekly (0 marks): check each chart\'s query and fields against the dataset columns');
  const failed = await load(html, async () => ({data: null, errors: [{message: 'Dataset not found'}]}));
  expect(failed.dom.window.document.querySelector('#status')!.textContent).toBe('Dataset not found');
  expect((await steps(failed.dom, source)).failure).toBe('no query answered: Dataset not found');
});

it('keeps a [segment] in a file path, which is not starter text', async () => {
  const page = await load(fill(read('codebase-report.html')).replace("'repo name'", "'app/[id]'"));
  expect(page.dom.window.document.querySelector('#kicker')!.textContent).toContain('app/[id]');
  expect((await steps(page.dom, read('codebase-report-steps.mjs'))).failure).toBeNull();
});

it('ramps a count in one hue, from the background tinted toward the first series colour, light and dark', async () => {
  for (const tokens of Object.values(TOKENS)) {
    const page = await load(themed(fill(read('codebase-report.html')), tokens));
    const stops = (page.specs[1]!.config.range.heatmap as string[]).map(rgb);
    const [ground, series] = [rgb(tokens.background), rgb(tokens['chart-1'])];
    expect(stops.at(-1)).toEqual(series);
    // Every stop lies on the line from the background to the series colour, each nearer the series than
    // the last, and the lowest is visibly tinted, so a cell of 1 differs from the page around it.
    const along = (stop: number[]) => stop.map((value, i) => (value - ground[i]!) / (series[i]! - ground[i]!));
    const steps = stops.map(stop => along(stop));
    for (const step of steps) for (const share of step) expect(share).toBeCloseTo(step[2]!, 1);
    for (let i = 1; i < steps.length; i++) expect(steps[i]![2]).toBeGreaterThan(steps[i - 1]![2]!);
    expect(steps[0]![2]).toBeGreaterThanOrEqual(0.15);
  }
});

it('aligns a numeric column header with its numbers and sizes the diagram to its drawing', async () => {
  const page = await load(fill(read('codebase-report.html')));
  const document = page.dom.window.document;
  expect([...document.querySelectorAll('[data-af-id="chart-hotspots-table"] th')].map(th => [th.textContent, th.className]))
    .toEqual([['File', ''], ['Area', ''], ['Lines', 'n'], ['Commits that changed it', 'n'], ['Authors', 'n']]);
  const style = (id: string) => page.dom.window.getComputedStyle(document.querySelector(`[data-af-id="${id}"]`)!);
  expect([style('chart-hotspots-table-0-lines').textAlign, style('chart-hotspots-table-lines').textAlign,
    style('chart-hotspots-table-path').textAlign]).toEqual(['right', 'right', 'left']);
  // A chart keeps room for its plot while it draws; the diagram is as tall as its flowchart, no taller.
  expect(style('chart-hotspots-plot').minHeight).toBe('280px');
  expect(style('chart-modules-plot').minHeight).toBe('0px');
});
