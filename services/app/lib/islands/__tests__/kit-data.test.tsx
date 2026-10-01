/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/kit-data.test.tsx
/**
 * THE DATA KIT (lib/islands/kit/data: Number, Select, DataTable, Question), bound to the island's tables: a Number aggregates and formats, a Select offers a
 * table's rows and writes its value, a DataTable renders rows and sorts, a Question shows its
 * server-drawn chart until its table changes and loads Vega only then.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Number as KitNumber, Select, DataTable, Question } from '../kit/data';
import type { TableResult } from '@/lib/story/data/dataflow';
import { rowsDigest } from '../digest';
import { DRAWING_CLASS } from '../chart';
import { createIslandRuntime } from '../rt';
import { createDataflowStore, type DataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import { Button } from '../kit/basic';
import { compiledOf } from '@/test/helpers/compiled';
import { initialTables, initialValues } from '@/lib/story/data/compiled-flow';
import { runDataflow } from '@/lib/sql/run-dataflow';
import { runLocalStateMutation } from '@/lib/story/datasets/local-state';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { loadSqlite } from '@artifactbin/sql/core';
import { createPageEngine } from '@/lib/story-runtime/page-engine';

const monthly: TableResult = { rows: [{ month: '2025-01-01', revenue: 120, units: 3 }, { month: '2025-02-01', revenue: 160, units: 4 }], columns: [{ name: 'month', type: 'date' }, { name: 'revenue', type: 'number' }, { name: 'units', type: 'number' }] };
const regions: TableResult = { rows: [{ region: 'East' }, { region: 'West' }], columns: [{ name: 'region', type: 'string' }] };
const island = () => { const i = fakeIsland({ region: 'West' }); i.table = (n) => (n === 'monthly' ? monthly : n === 'regions' ? regions : undefined); i.tableSnapshot = i.table; return i; };
const mount = (ctx = island(), view: () => import('solid-js').JSX.Element) => { const host = document.createElement('div'); document.body.append(host); const unmount = render(() => <IslandProvider value={ctx}>{view()}</IslandProvider>, host); return { host, dispose: () => { unmount(); host.remove(); } }; };
beforeEach(() => document.documentElement.setAttribute('data-mx-ready', ''));
afterEach(() => document.documentElement.removeAttribute('data-mx-ready'));

describe('Number', () => {
  it('aggregates and formats like today\'s InlineNumber', () => {
    const { host } = mount(undefined, () => <KitNumber data="$monthly" col="revenue" agg="sum" prefix="$" format=",.0f" id="n" />);
    expect(host.textContent).toContain('$280');
    const root = host.querySelector('#n')!;
    expect(root.getAttribute('aria-busy')).toBe('false');
    expect(root.querySelector('[aria-label="Live number"]')?.textContent).toBe('$280');
  });
});

describe('Select', () => {
  it('keeps one placeholder and an opaque popup for a nullable options table', () => {
    const ctx = fakeIsland({ department: null as unknown as string });
    ctx.table = () => ({ rows: [{ value: null, label: 'All' }, { value: 'Police', label: 'Police' }], columns: [{ name: 'value', type: 'string' }, { name: 'label', type: 'string' }] });
    const { host, dispose } = mount(ctx, () => <Select label="Department" value="$department" options="$departments" placeholder="All departments" />);
    host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.getAttribute('aria-label'))).toEqual(['All departments', 'Police']);
    expect(document.querySelector('[role="listbox"]')?.parentElement?.className).toContain('bg-popover');
    dispose();
  });
  it('adds no null choice without a placeholder, so a document\'s own "All" row is the only one', () => {
    const ctx = fakeIsland({ department: 'All departments' });
    ctx.table = () => ({ rows: [{ value: 'All departments', label: 'All departments' }, { value: 'Police', label: 'Police' }], columns: [{ name: 'value', type: 'string' }, { name: 'label', type: 'string' }] });
    const { host, dispose } = mount(ctx, () => <Select label="Department" value="$department" options="$department_options" />);
    host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.getAttribute('aria-label'))).toEqual(['All departments', 'Police']);
    dispose();
  });
  it('closes on another select, outside pointer, and Escape, restoring trigger focus', () => {
    const ctx = fakeIsland({ department: null as unknown as string, job: null as unknown as string });
    const { host, dispose } = mount(ctx, () => <><Select label="Department" value="$department" options={['Police']} /><Select label="Job title" value="$job" options={['Officer']} /></>);
    const department = host.querySelector<HTMLButtonElement>('[aria-label="Department"]')!;
    const job = host.querySelector<HTMLButtonElement>('[aria-label="Job title"]')!;
    department.click(); job.click();
    expect(department).toHaveAttribute('aria-expanded', 'false');
    expect(job).toHaveAttribute('aria-expanded', 'true');
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(job).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(job);
    department.click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(department).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(department);
    dispose();
  });
  it('writes a chosen literal option immediately', () => {
    const ctx = fakeIsland({ region: 'West' }); ctx.setValue = vi.fn();
    const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West','East']} />);
    (host.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement).click();
    ([...document.querySelectorAll('[role="option"]')].find(x => x.textContent === 'East') as HTMLButtonElement).click();
    expect(ctx.setValue).toHaveBeenCalledWith('region', 'East', undefined);
    dispose();
  });
  it('writes a chosen option through the bound Value\'s declared type, like NativeBoundControl', () => {
    const ctx = fakeIsland({ minimum: 0 as unknown as string }); ctx.setValue = vi.fn();
    ctx.valueType = (name) => (name === 'minimum' ? 'number' : undefined);
    const { host, dispose } = mount(ctx, () => <Select label="Minimum" value="$minimum" options={[{ label: 'All', value: 0 }, { label: 'Above fifteen', value: 15 }]} />);
    (host.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement).click();
    ([...document.querySelectorAll('[role="option"]')].find(x => x.textContent === 'Above fifteen') as HTMLButtonElement).click();
    expect(ctx.setValue).toHaveBeenCalledWith('minimum', 15, undefined);
    dispose();
  });
  it('opens a searchable list', () => {
    const ctx = fakeIsland({ region: 'West' }); ctx.setValue = vi.fn();
    const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West','East']} />);
    (host.querySelector('[aria-haspopup="listbox"]') as HTMLButtonElement).click();
    expect(document.querySelector('[role="searchbox"]')).toBeTruthy();
    dispose();
  });
  it('places its popup in a trusted portal, or in place when none exists', () => {
    for (const portal of [null, document.createElement('div')]) {
      const ctx = fakeIsland({ region: 'West' }); ctx.trustedPortal = () => portal;
      const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West','East']} />);
      host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
      expect((portal ?? host).querySelector('[role="listbox"]')).toBeTruthy();
      if (portal) expect(host.querySelector('[role="listbox"]')).toBeNull();
      (portal ?? host).querySelector<HTMLButtonElement>('[role="option"]')!.click();
      expect((portal ?? host).querySelector('[role="listbox"]')).toBeNull();
      dispose();
    }
  });
  it('keeps compiled popups in the document that owns their story CSS', () => {
    const story = document.createElement('div'); story.setAttribute('data-mx-inline-story', '');
    const css = document.createElement('style'); css.setAttribute('data-mx-story-css', ''); css.textContent = '.bg-popover { background-color: white; }';
    const portal = document.createElement('div');
    document.body.append(story, css);
    const ctx = fakeIsland({ region: 'West' }); ctx.trustedPortal = () => portal;
    const { host, dispose } = mount(ctx, () => <Select label="Region" value="$region" options={['West', 'East']} />);
    try {
      host.querySelector<HTMLButtonElement>('[aria-haspopup="listbox"]')!.click();
      expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();
      expect(portal.querySelector('[role="listbox"]')).toBeNull();
    } finally { dispose(); story.remove(); css.remove(); }
  });
  it('offers the options table and writes the chosen value', () => {
    const ctx = island(); ctx.setValue = vi.fn();
    const { host } = mount(ctx, () => <Select label="Region" value="$region" options="$regions" placeholder="All regions" id="G2uA" />);
    // The live select stamps no binding; its trigger is a labelled, closed listbox button.
    expect(host.firstElementChild?.id).toBe('G2uA');
    expect(host.querySelector('[data-mx-bound]')).toBeNull();
    const select = host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement;
    expect([select.type, select.getAttribute('aria-label'), select.getAttribute('aria-expanded')]).toEqual(['button', 'Region', 'false']);
    expect(select.textContent).toContain('West');
    select.click();
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual(['All regions', 'East', 'West']);
    (options[1] as HTMLButtonElement).click();
    expect(ctx.setValue).toHaveBeenCalledWith('region', 'East', undefined);
  });
});

describe('DataTable', () => {
  it('repaints a server query result through the store bridge', async () => {
    const columns: TableResult['columns'] = [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }];
    const west = { rows: [{ id: 1, region: 'west', amount: 120 }, { id: 3, region: 'west', amount: 30 }], columns };
    const east = { rows: [{ id: 2, region: 'east', amount: 90 }], columns };
    const flow: CompiledDataflow = { imports: [], mutations: [], values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'west' }], queries: [{ name: 'orders', engine: 'postgres', source: 'DS1', sql: 'select id, region, amount from orders where region=$region', params: ['region'], reads: { imports: [], queries: [], values: ['region'], builtins: [] }, columns, start: 0, end: 0 }] };
    const run = vi.fn(async () => ({ tables: { orders: east }, errors: {} }));
    const rt = createIslandRuntime({ dataflow: { flow, values: { region: 'west' }, results: { tables: { orders: west }, errors: {} } } }, input => createDataflowStore(input, { transport: { run, page: vi.fn() }, debounceMs: 0 }));
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    try {
      const { host, dispose } = mount(rt.context, () => <DataTable data="$orders" />);
      rt.store!.start();
      expect(host.querySelector('tbody')?.textContent).toContain('120');
      rt.context.setValue('region', 'east');
      await vi.waitFor(() => expect(host.querySelector('tbody')?.textContent).toContain('90'));
      expect(host.querySelector('tbody')?.textContent).not.toContain('120');
      expect(run).toHaveBeenCalledTimes(1);
      dispose();
    } finally {
      rt.dispose();
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  it('shows the matching row when a filter shrinks a scrolled virtual table', async () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('overflow-auto') ? 420 : 0; } });
    try {
      const ctx = fakeIsland();
      const all: TableResult = { rows: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, item: `Item ${i + 1}` })), columns: [{ name: 'id', type: 'number' }, { name: 'item', type: 'string' }] };
      const [table, setTable] = createSignal(all);
      ctx.table = ctx.tableSnapshot = () => table();
      const { host, dispose } = mount(ctx, () => <DataTable data="$tasks" rowKey="id" height={420} />);
      const scroll = host.querySelector<HTMLElement>('.overflow-auto')!;
      scroll.scrollTop = 16117; scroll.dispatchEvent(new Event('scroll'));
      setTable({ ...all, rows: [all.rows[499]!] });
      await vi.waitFor(() => expect(host.querySelector('tbody')?.textContent).toContain('Item 500'));
      await vi.waitFor(() => expect(scroll.scrollTop).toBe(0));
      dispose();
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });
  it('shows a user card that arrives after the row, then follows its updated handle', async () => {
    const ctx = fakeIsland();
    const [people, setPeople] = createSignal<Record<string, { name: string; handle: string; image: null }>>({});
    ctx.people = () => people();
    ctx.table = ctx.tableSnapshot = () => ({ rows: [{ id: 1, assignee: 'usr_1' }], columns: [{ name: 'id', type: 'number' }, { name: 'assignee', type: 'user' }] });
    const { host, dispose } = mount(ctx, () => <DataTable data="$tasks" rowKey="id" />);
    expect(host.querySelector('tbody')?.textContent).toContain('Unknown person');
    setPeople({ usr_1: { name: 'Native User', handle: 'mxmx_test_native_user', image: null } });
    await vi.waitFor(() => expect(host.querySelector('tbody')?.textContent).toContain('@mxmx_test_native_user'));
    setPeople({ usr_1: { name: 'Native User', handle: 'new_handle', image: null } });
    await vi.waitFor(() => expect(host.querySelector('tbody')?.textContent).toContain('@new_handle'));
    dispose();
  });
  it('replaces an initially empty user cell after a write updates the row in place', async () => {
    const ctx = fakeIsland();
    const [rows, setRows] = createStore([{ id: 1, completed_by: null as string | null }]);
    ctx.people = () => ({ usr_1: { name: 'Native User', handle: 'mxmx_test_native_user', image: null } });
    ctx.table = ctx.tableSnapshot = () => ({ rows, columns: [{ name: 'id', type: 'number' }, { name: 'completed_by', type: 'user' }] });
    const { host, dispose } = mount(ctx, () => <DataTable data="$tasks" rowKey="id" />);
    setRows(0, 'completed_by', 'usr_1');
    await vi.waitFor(() => expect(host.querySelector('tbody')?.textContent).toContain('@mxmx_test_native_user'));
    dispose();
  });
  it('renders the rows and sortable headers of its table inside its author wrapper', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" height="300px" id="dIQl" />);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
    // Today's DataTableAdapter wrapper holds the author identity; the kit table inside it is the helper's bare kit render.
    const wrapper = host.firstElementChild!;
    expect(Object.fromEntries([...wrapper.attributes].map((a) => [a.name, a.value]))).toEqual({ id: 'dIQl', 'aria-label': 'DataTable embed', 'aria-busy': 'false', style: 'width:100%' });
    const grid = wrapper.querySelector('[data-slot="data-table"]')!;
    expect([grid.getAttribute('aria-label'), grid.hasAttribute('id')]).toEqual(['Data grid', false]);
    expect((grid.firstElementChild as HTMLElement).style.maxHeight).toBe('300px');
    expect([...grid.querySelectorAll('th')].map((th) => [th.getAttribute('scope'), th.getAttribute('aria-label'), th.getAttribute('aria-sort'), th.style.textAlign]))
      .toEqual([['col', 'Sort by month', 'none', 'left'], ['col', 'Sort by revenue', 'none', 'right'], ['col', 'Sort by units', 'none', 'right']]);
    expect([...grid.querySelectorAll('tbody tr')].map((tr) => [tr.getAttribute('data-index'), [...tr.querySelectorAll('td')].map((td) => td.textContent)]))
      .toEqual([['0', ['2025-01-01', '120', '3']], ['1', ['2025-02-01', '160', '4']]]);
  });
});

describe('Question', () => {
  it('keeps the server drawing while the visible chart loads after reader readiness', async () => {
    const ctx = island();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ update() {}, destroy() {} }) }));
    const { host } = mount(ctx, () => <Question title="Revenue by month" data="$monthly" height="300px" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} id="AVkX" drawn={{ svg: '<svg data-drawn="1"></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    expect(host.querySelector('[data-mx-chart-state="pending"] svg[data-drawn]')).toBeTruthy();
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
    expect(host.querySelector('svg[data-drawn]')).toBeTruthy();
  });
  it('announces slow chart loading, ignores early input, and clears the indicator when Vega is ready', async () => {
    const mountChart = vi.fn(({ element }: { element: HTMLElement }) => ({ destroy() {}, element }));
    const loadChart = vi.fn(async () => ({ mountChart }));
    const { host, dispose } = mount(undefined, () => <Question data="$monthly" viz={chart} drawn={{ svg: '<svg data-drawn="1"></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    const slot = host.querySelector('[role="graphics-document"]') as HTMLElement;
    expect(slot.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('[role="status"]')).toBeNull();
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
    slot.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    slot.click();
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(host.querySelector('svg[data-drawn]')).toBeTruthy();
    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Chart loading; interactions available when ready');
    expect(host.querySelector('[role="status"] [aria-hidden="true"]')?.getAttribute('class')).toContain('motion-reduce:animate-none');
    expect(loadChart).toHaveBeenCalledTimes(1);
    expect(mountChart).toHaveBeenCalledTimes(1);
    slot.setAttribute('data-mx-chart-state', 'ready');
    await vi.waitFor(() => expect(slot.getAttribute('aria-busy')).toBe('false'));
    expect(host.querySelector('[role="status"]')).toBeNull();
    dispose();
  });
  it('loads after a new table snapshot lands after boot', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    mount(ctx, () => <Question data="$monthly" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r1' }} chart={loadChart} />);
    expect(loadChart).not.toHaveBeenCalled();
    setSnapshot({ ...monthly, rows: [...monthly.rows, { month: '2025-03-01', revenue: 10, units: 1 }] });
    // The new rows are checked against the drawing's digest (SubtleCrypto, asynchronous).
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });
  it('uses the context loader by default after interaction and destroys its chart on dispose', async () => {
    const ctx = island();
    const destroy = vi.fn();
    const mountChart = vi.fn(() => ({ destroy }));
    ctx.loadChart = vi.fn(async () => ({ mountChart }));
    const { host, dispose } = mount(ctx, () => <Question data="$monthly" viz={{ kind: 'vega-lite', spec: { mark: 'line' } }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r1' }} />);
    expect(ctx.loadChart).not.toHaveBeenCalled();
    host.querySelector('[data-mx-chart-state]')!.dispatchEvent(new Event('pointerenter', { bubbles: true }));
    await vi.waitFor(() => expect(ctx.loadChart).toHaveBeenCalledTimes(1));
    expect(mountChart).toHaveBeenCalledWith({
      element: host.querySelector('[role="graphics-document"]'),
      envelope: { version: 2, source: { kind: 'vega-lite', grammar: 'vega-lite@6', spec: { mark: 'line' } }, dataBindings: null, viewParams: null, interactions: null, assets: null },
      rows: monthly.rows,
    });
    dispose();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('DataTable behavior', () => {
  it('removes a row in the DOM after a remote local-table mutation answers', async () => {
    const flow = await compiledOf(
      '<Value name="flags" type="table" value={[{"reverse":false}]}/>'
      + '<Value name="orders" type="table" value={[{"order_id":"order-101","customer":"Alice"},{"order_id":"order-102","customer":"Bob"}]}/>'
      + '<Query name="ordered">{`select o.* from orders o, flags f order by case when f.reverse then o.customer end desc, o.customer asc`}</Query>'
      + '<Mutation name="reverseRows">{`update flags set reverse = not reverse`}</Mutation>'
      + '<Mutation name="renameAlice">{`update orders set customer=\'Alice updated\' where order_id=\'order-101\'`}</Mutation>'
      + '<Mutation name="removeAlice">{`delete from orders where order_id=\'order-101\'`}</Mutation>',
    );
    const engine = createSqliteSql();
    const tables = initialTables(flow);
    const initial = await runDataflow(flow, {}, { only: ['ordered'], localTables: { orders: tables.orders!.rows, flags: tables.flags!.rows } });
    const transport: QueryTransport = {
      run: async (values, only, localTables) => {
        const answer = await runDataflow(flow, {}, { values, only, localTables });
        return { tables: answer.tables, errors: answer.errors, mutationAccess: {} };
      },
      page: async () => ({ columns: [], rows: [] }),
      mutate: async (request) => {
        const source = initialTables(flow);
        for (const [name, rows] of Object.entries(request.localTables ?? {})) source[name] = { ...source[name]!, rows };
        return { dataset: '', local: await runLocalStateMutation(flow, flow.mutations.find(item => item.name === request.mutation)!, { tables: source }, engine, { params: {}, paramTypes: {} }) };
      },
    };
    const runtime = createIslandRuntime({ dataflow: { flow, state: { values: initialValues(flow), tables: { ...tables, ...initial.tables }, errors: {}, mutationAccess: {} } }, viewer: null }, input => createDataflowStore(input, { transport, debounceMs: 0 }));
    const { host, dispose } = mount(runtime.context, () => <><Button run="$reverseRows">Reverse</Button><Button run="$renameAlice">Rename</Button><Button run="$removeAlice">Remove</Button><DataTable data="$ordered" rowKey="order_id" id="orders" /></>);
    runtime.store!.start();
    for (const name of ['Reverse', 'Rename', 'Remove']) {
      const button = [...host.querySelectorAll('button')].find(node => node.textContent === name)!;
      button.click();
      await vi.waitFor(() => expect(runtime.store!.mutating().size).toBe(0));
    }
    await vi.waitFor(() => expect(runtime.store!.getTable('ordered')?.rows).toHaveLength(1));
    expect(host.querySelector('tbody')?.textContent).not.toContain('Alice');
    dispose(); runtime.dispose();
  });
  it('removes an annotated table row after clicking successive local mutations', async () => {
    const flow = await compiledOf(
      '<Value name="orders" type="table" value={[{"order_id":"order-101","customer":"Alice"},{"order_id":"order-102","customer":"Bob"}]}/>'
      + '<Query name="ordered">{`select * from orders order by customer`}</Query>'
      + '<Mutation name="renameAlice">{`update orders set customer=\'Alice updated\' where order_id=\'order-101\'`}</Mutation>'
      + '<Mutation name="removeAlice">{`delete from orders where order_id=\'order-101\'`}</Mutation>',
    );
    const engine = createSqliteSql();
    const initialAnswer = await runDataflow(flow, {}, { only: ['ordered'], localTables: { orders: initialTables(flow).orders!.rows } });
    expect(initialAnswer.errors).toEqual({});
    expect(initialAnswer.tables.ordered?.rows).toHaveLength(2);
    const transport: QueryTransport = {
      run: async (values, only, localTables) => {
        const answer = await runDataflow(flow, {}, { values, only, localTables: { orders: localTables?.orders ?? initialTables(flow).orders!.rows } });
        return { tables: answer.tables, errors: answer.errors };
      },
      page: async () => ({ columns: [], rows: [] }),
      mutate: async (request) => {
        const tables = initialTables(flow);
        tables.orders = { ...tables.orders!, rows: request.localTables?.orders ?? tables.orders!.rows };
        return { dataset: '', local: await runLocalStateMutation(flow, flow.mutations.find(item => item.name === request.mutation)!, { tables }, engine, { params: {}, paramTypes: {} }) };
      },
    };
    const pageEngine = createPageEngine({ load: () => loadSqlite(), fetch: async () => ({}) });
    pageEngine.prepare(flow, []);
    await vi.waitFor(() => expect(pageEngine.ready(flow, [])).toBe(true));
    const runtime = createIslandRuntime({ dataflow: { flow, hold: [], state: { values: initialValues(flow), tables: { ...initialTables(flow), ...initialAnswer.tables }, errors: {}, mutationAccess: {} } }, mermaidImages: {}, viewer: null }, input => createDataflowStore(input, { transport, page: { engine: pageEngine, userId: null }, debounceMs: 0 }));
    const { host, dispose } = mount(runtime.context, () => <><Button run="$renameAlice">Rename</Button><Button run="$removeAlice">Remove</Button><DataTable data="$ordered" rowKey="order_id" id="orders" /></>);
    runtime.store!.start();
    await vi.waitFor(() => expect(host.textContent).toContain('Alice'));
    (host.querySelectorAll('button')[0] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(host.textContent).toContain('Alice updated'));
    (host.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(host.textContent).not.toContain('Alice updated'));
    dispose();
    runtime.dispose();
    pageEngine.close();
  });
  it('drops a removed row after the runtime bridges a local mutation result', () => {
    const columns = [{ name: 'key', type: 'string' as const }, { name: 'customer', type: 'string' as const }];
    let rows = [{ key: 'a', customer: 'Alice' }, { key: 'b', customer: 'Bob' }];
    let notify = () => {};
    const store = {
      getState: () => ({ values: {}, tables: { orders: { columns, rows } }, errors: {}, people: {} }),
      pending: () => [], subscribe: (fn: () => void) => { notify = fn; return () => {}; },
      dispose: () => {},
    } as unknown as DataflowStore;
    const runtime = createIslandRuntime({ dataflow: { flow: { imports: [], values: [], queries: [], mutations: [] } }, mermaidImages: {}, viewer: null }, () => store);
    const { host, dispose } = mount(runtime.context, () => <DataTable data="$orders" rowKey="key" id="orders" />);
    expect(host.textContent).toContain('Alice');
    rows = [{ key: 'b', customer: 'Bob' }];
    notify();
    expect(host.textContent).not.toContain('Alice');
    dispose();
    runtime.dispose();
  });
  it('updates a comment target when a reconciled row proxy changes its key', () => {
    const ctx = island();
    const [state, setState] = createStore({ rows: [{ key: 'a', customer: 'Alice' }, { key: 'b', customer: 'Bob' }] });
    ctx.table = () => ({ rows: state.rows, columns: [{ name: 'key', type: 'string' }, { name: 'customer', type: 'string' }] });
    const { host, dispose } = mount(ctx, () => <DataTable data="$monthly" rowKey="key" id="orders" />);
    const target = (name: string) => {
      const cell = [...host.querySelectorAll('td')].find(node => node.textContent === name)!;
      return JSON.parse(cell.getAttribute('data-mx-comment-target')!).rowKey;
    };
    expect(target('Alice')).toBe('a');
    setState('rows', reconcile([{ key: 'b', customer: 'Bob updated' }, { key: 'a', customer: 'Alice updated' }], { merge: true }));
    expect([...host.querySelectorAll('td')].map(node => node.textContent)).toContain('Alice updated');
    expect(target('Alice updated')).toBe('a');
    setState('rows', reconcile([{ key: 'b', customer: 'Bob updated' }], { merge: true }));
    expect(host.textContent).not.toContain('Alice updated');
    dispose();
  });
  it('switches a measured long table from static rows to a virtual window after hydration', async () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    try {
      const ctx = island();
      ctx.table = () => ({ rows: Array.from({ length: 200 }, (_, i) => ({ row: i })), columns: [{ name: 'row', type: 'number' }] });
      const { host } = mount(ctx, () => <DataTable data="$long" />);
      await vi.waitFor(() => expect(host.querySelector('tbody')?.style.position).toBe('relative'));
      expect(host.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
      expect(host.querySelectorAll('tbody tr').length).toBeLessThan(50);
    } finally {
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });
  it('sorts the complete local rows on header clicks', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" />);
    const header = host.querySelector('th[aria-label="Sort by revenue"]') as HTMLElement;
    header.click();
    expect([...host.querySelectorAll('tbody tr')].map(row => row.querySelectorAll('td')[1]?.textContent)).toEqual(['120', '160']);
    header.click();
    expect([...host.querySelectorAll('tbody tr')].map(row => row.querySelectorAll('td')[1]?.textContent)).toEqual(['160', '120']);
  });
  it('loads a sorted remote window instead of sorting a truncated sample', async () => {
    const ctx = island();
    const sample = { ...monthly, truncated: true, totalRows: 1000 };
    ctx.table = () => sample;
    const fetchPage = vi.fn(async () => ({ ...monthly, rows: [{ month: 'remote', revenue: 900, units: 1 }] }));
    ctx.store = () => ({ fetchPage }) as unknown as ReturnType<typeof ctx.store>;
    const { host } = mount(ctx, () => <DataTable data="$monthly" />);
    (host.querySelector('th[aria-label="Sort by revenue"]') as HTMLElement).click();
    await Promise.resolve();
    expect(fetchPage).toHaveBeenCalledWith('monthly', { offset: 0, limit: 500, sort: { col: 'revenue', dir: 'asc' } });
    expect(host.querySelector('tbody')?.textContent).toContain('900');
    (host.querySelector('button[aria-label="Load more rows"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(fetchPage).toHaveBeenLastCalledWith('monthly', { offset: 1, limit: 500, sort: { col: 'revenue', dir: 'asc' } });
    expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
  });
  it('renders image copies, timestamps and authored cell templates', () => {
    const ctx = island();
    ctx.table = () => ({ rows: [{ photo: 'https://example.test/a.png', when: '2025-01-01T00:00:00Z', label: 'raw' }], columns: [{ name: 'photo', type: 'string' }, { name: 'when', type: 'timestamp' }, { name: 'label', type: 'string' }] });
    const { host } = mount(ctx, () => <DataTable data="$rich" templates={[{ col: 'photo', props: { col: 'photo', kind: 'image' }, nodes: [], path: '0' }, { col: 'when', props: { col: 'when' }, nodes: [], path: '1' }, { col: 'label', props: { col: 'label' }, nodes: [{ type: 'text', value: 'template' }], path: '2' }]} renderCell={() => <strong>templated</strong>} resolveSrc={() => '/copy/a.png'} />);
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/copy/a.png');
    expect(host.querySelector('time')?.getAttribute('datetime')).toBe('2025-01-01T00:00:00Z');
    expect(host.querySelector('strong')?.textContent).toBe('templated');
  });
  it('uses the resolved person card and hides an unknown user id', () => {
    const ctx = island();
    ctx.table = () => ({ rows: [{ owner: 'usr_known' }, { owner: 'usr_hidden' }], columns: [{ name: 'owner', type: 'user' }] });
    ctx.people = () => ({ usr_known: { name: 'Ada', handle: 'ada', image: null } });
    const { host } = mount(ctx, () => <DataTable data="$people" />);
    expect(host.querySelector('a[data-slot="user-handle"]')?.textContent).toBe('@ada');
    expect(host.textContent).toContain('Unknown person');
    expect(host.textContent).not.toContain('usr_hidden');
  });
});

/*
 * PARITY WITH TODAY'S LIVE READER (scripts/gate-compiled-parity.mjs): the adapters' wrappers, the
 * chart slot around the drawing box only, and a served drawing kept while it is current.
 */
const attrsOf = (el: Element | null | undefined) => Object.fromEntries([...(el?.attributes ?? [])].map((a) => [a.name, a.value]));
const chart = { kind: 'vega-lite', spec: { mark: 'line' } };
const drawnFor = async (rows: TableResult['rows']) => ({ svg: '<svg data-drawn="1" height="303"></svg>', table: 'monthly', rows: await rowsDigest(rows) });

describe('data widget parity with the live reader', () => {
  it('Number carries no class and no binding stamp; Select writes no static binding stamp and today\'s trigger classes', () => {
    const { host } = mount(undefined, () => <><KitNumber data="$monthly" col="revenue" id="n" /><Select label="Region" value="$region" options="$regions" id="s" /></>);
    expect(attrsOf(host.querySelector('#n'))).toEqual({ id: 'n', 'aria-busy': 'false' });
    expect(host.querySelector('#s')?.hasAttribute('data-mx-bound')).toBe(false);
    // The retired React SelectControl's trigger classes, as it rendered them.
    const trigger = 'inline-flex w-full items-center justify-between gap-2 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 h-9 min-w-36 border border-input bg-background px-3 shadow-xs hover:bg-muted/40';
    expect(host.querySelector('#s button')?.getAttribute('class')).toBe(trigger);
  });

  it('Question: the adapter wrapper holds the identity, the chart slot marker never reaches the root, and the title sits outside the drawing box', () => {
    const { host } = mount(undefined, () => <Question title="Revenue by month" data="$monthly" height="300px" viz={chart} id="AVkX" data-mx-ast="1.5" {...{ 'data-mx-chart-slot': 'AVkX' }} drawn={{ svg: '<svg></svg>', table: 'monthly', rows: 'r' }} chart={async () => ({ mountChart: () => ({ destroy() {} }) })} />);
    const root = host.firstElementChild!;
    expect(attrsOf(root)).toEqual({ id: 'AVkX', 'data-mx-ast': '1.5', 'aria-label': 'Question embed', 'aria-busy': 'false', style: 'width:100%;height:340px' });
    expect(host.querySelector('[data-mx-chart-slot]')).toBeNull();
    const body = root.firstElementChild!;
    expect(attrsOf(body)).toEqual({ class: 'flex h-full w-full flex-col', 'aria-label': 'Question embed body' });
    const slot = host.querySelector('[role="graphics-document"]')!;
    expect(slot.textContent).not.toContain('Revenue by month');
    expect(body.firstElementChild?.textContent).toBe('Revenue by month');
    expect(attrsOf(slot)).toEqual({ 'data-mx-chart-state': 'pending', 'aria-label': 'Vega visualization', 'aria-busy': 'true', class: 'h-full w-full overflow-hidden [&_.vega-embed]:block [&_svg]:block', role: 'graphics-document', 'aria-roledescription': 'visualization', style: 'cursor: default;' });
    expect(slot.parentElement?.getAttribute('class')).toBe('relative min-h-0 w-full flex-1 overflow-hidden');
  });

  it('Question in a grid cell fills the cell, and a table viz renders today\'s plain table', () => {
    const { host } = mount(undefined, () => <><Question data="$monthly" viz={chart} inGridItem id="g" chart={async () => ({ mountChart: () => ({ destroy() {} }) })} /><Question data="$monthly" id="t" /></>);
    expect(host.querySelector('#g')?.getAttribute('style')).toBe('width:100%;height:100%');
    expect(host.querySelector('#t')?.getAttribute('style')).toBe('width:100%;height:430px');
    expect(host.querySelector('#t [aria-label="Data table"] thead')?.textContent).toBe('monthrevenueunits');
    expect(host.querySelectorAll('#t [aria-label="Data table"] tbody tr')).toHaveLength(2);
  });

  it('Question draws a chart the server did not draw after readiness', async () => {
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    mount(undefined, () => <Question data="$monthly" viz={chart} chart={loadChart} />);
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });

  it('Question leaves the placeholder and keeps Vega unloaded until reader readiness', async () => {
    document.documentElement.removeAttribute('data-mx-ready');
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    const { host } = mount(undefined, () => <Question data="$monthly" viz={chart} chart={loadChart} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(loadChart).not.toHaveBeenCalled();
    expect(host.querySelector('[data-mx-chart-state]')?.getAttribute('data-mx-chart-state')).toBe('pending');
    document.documentElement.setAttribute('data-mx-ready', '');
    document.dispatchEvent(new Event('mx:ready'));
    await vi.waitFor(() => expect(loadChart).toHaveBeenCalledTimes(1));
  });

  it('Question keeps the served drawing during load and feeds changed rows to the mounted chart', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const update = vi.fn();
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ update, destroy() {} }) }));
    const drawn = await drawnFor(monthly.rows);
    const { host } = mount(ctx, () => <Question data="$monthly" viz={chart} drawn={drawn} chart={loadChart} />);
    const slot = host.querySelector('[role="graphics-document"]')!;
    const served = slot.firstElementChild;
    setSnapshot({ ...monthly, rows: monthly.rows.map((r) => ({ ...r })) });
    await new Promise((r) => setTimeout(r, 20));
    expect(loadChart).toHaveBeenCalledTimes(1);
    expect(slot.getAttribute('data-mx-chart-state')).toBe('pending');
    expect(slot.firstElementChild).toBe(served);
    setSnapshot({ ...monthly, rows: [...monthly.rows, { month: '2025-03-01', revenue: 10, units: 1 }] });
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(loadChart).toHaveBeenCalledTimes(1);
  });

  it('Question leaves a responsive served drawing at the same size while the engine loads', async () => {
    const loadChart = vi.fn(async () => ({ mountChart: () => ({ destroy() {} }) }));
    const drawn = { ...(await drawnFor(monthly.rows)), svg: `<svg class="marks ${DRAWING_CLASS}" width="640" height="303" viewBox="0 0 640 303"></svg>` };
    // A box smaller than the nominal drawing (a fixed-height card): the drawing already fills it from the first paint.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 249, width: 515 } as DOMRect);
    try {
      const { host } = mount(undefined, () => <Question data="$monthly" viz={chart} drawn={drawn} chart={loadChart} />);
      const svg = host.querySelector('[role="graphics-document"] > svg')!;
      expect(svg.hasAttribute('style')).toBe(false);
    } finally { rect.mockRestore(); }
    await new Promise((r) => setTimeout(r, 20));
    expect(loadChart).toHaveBeenCalledTimes(1);
  });

  it('Question feeds a chart drawn here the rows of every later result', async () => {
    const ctx = island();
    const [snapshot, setSnapshot] = createSignal(monthly);
    ctx.tableSnapshot = () => snapshot();
    const update = vi.fn();
    mount(ctx, () => <Question data="$monthly" viz={chart} chart={async () => ({ mountChart: () => ({ update, destroy() {} }) })} />);
    await new Promise((r) => setTimeout(r, 0));
    const next = [{ month: '2025-03-01', revenue: 10, units: 1 }];
    setSnapshot({ ...monthly, rows: next });
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(next));
  });

  it('DataTable takes the compiler\'s columns and column identities, and writes no style before it measures', () => {
    const { host } = mount(undefined, () => <DataTable data="$monthly" id="t" columns={[{ col: 'month', title: 'Month' }, { col: 'revenue', title: 'Revenue' }]} templates={[{ col: 'month', id: 'cm', path: '1.1' }, { col: 'revenue', path: '1.3' }]} />);
    const heads = [...host.querySelectorAll('thead th')];
    expect(heads.map((th) => [th.textContent, th.getAttribute('id'), th.getAttribute('data-mx-ast')])).toEqual([['Month', 'cm', '1.1'], ['Revenue', null, '1.3']]);
    expect(host.querySelectorAll('tbody tr td')).toHaveLength(4);
    for (const el of host.querySelectorAll('table, thead, thead tr, tbody, tbody tr')) expect(el.hasAttribute('style'), el.tagName).toBe(false);
    expect(host.querySelector('td')?.getAttribute('style')).toBe('text-align: left;');
    expect(host.querySelector('[data-slot="data-table"] > div')?.getAttribute('style')).toBe('max-height: 420px;');
  });

  it('DataTable becomes a virtual window after measurement, whatever its row count, and keeps the rows it rendered', async () => {
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 300; } });
    const host = document.createElement('div'); document.body.append(host);
    const removed: Node[] = [];
    const observer = new MutationObserver(() => {});
    observer.observe(host, { childList: true, subtree: true });
    try {
      const unmount = render(() => <IslandProvider value={island()}><DataTable data="$monthly" /></IslandProvider>, host);
      await vi.waitFor(() => expect(host.querySelector('table')?.getAttribute('style')).toBe('display: block;'));
      for (const record of observer.takeRecords()) removed.push(...record.removedNodes);
      expect(host.querySelector('tbody')?.getAttribute('style')).toMatch(/^display: block; height: \d+px; position: relative;$/);
      expect(host.querySelector('tbody tr')?.getAttribute('style')).toMatch(/position: absolute; top: 0px; left: 0px; transform: translateY\(0px\);$/);
      expect(host.querySelectorAll('tbody tr')).toHaveLength(2);
      expect(removed.filter((n) => n.nodeName === 'TR' || n.nodeName === 'TD'), 'the static rows are the virtual rows').toEqual([]);
      unmount();
    } finally {
      observer.disconnect(); host.remove();
      if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height);
      else Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  it('DataTable says why it has no table, inside today\'s adapter wrapper', () => {
    const ctx = island(); ctx.table = () => undefined; ctx.error = (n) => (n === 'monthly' ? 'boom' : undefined);
    const { host } = mount(ctx, () => <DataTable data="$monthly" id="t" />);
    expect(attrsOf(host.firstElementChild)).toMatchObject({ id: 't', 'aria-label': 'DataTable embed', style: 'width:100%' });
    expect(host.textContent).toBe('query "monthly" failed: boom');
  });
});

// The compiler writes these classes before hydration; the live root must render the same, or it flips on hydration.
import { RECIPES } from '../kit/recipes/data';

describe('data class recipes', () => {
  const flat = (value: string | null | undefined) => (value ?? '').split(/\s+/).filter(Boolean).sort().join(' ');
  const views = {
    Select: (className: string) => <Select label="Region" className={className} />,
    DataTable: (className: string) => <DataTable data="$monthly" className={className} />,
  };
  for (const tag of ['Select', 'DataTable'] as const) {
    it(`${tag}: the compile-time root class is the class the live component renders, with and without an author class`, () => {
      for (const author of ['', 'ring-2 px-4']) {
        const { host, dispose } = mount(undefined, () => views[tag](author));
        // DataTable's recipe styles the grid inside the adapter wrapper; the wrapper carries no class.
        const root = tag === 'DataTable' ? host.querySelector('[data-slot="data-table"]') : host.firstElementChild;
        try { expect(flat(RECIPES[tag]?.({ className: author }))).toBe(flat(root?.getAttribute('class'))); } finally { dispose(); }
      }
    });
  }
});
