/**
 * The served document's dataflow at runtime: bound native controls read and
 * write the store, embeds resolve `data="$name"` from it, the author's script
 * reaches the same store through `window.mx`, and the SSR'd tree hydrates
 * against the SAME store state without a mismatch.
 */
import React from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { createDataflowStore } from '../store';
import { createMx } from '../mx';
import type { StoryIslandDataflow } from '../contract';
import type { DataflowState } from '@/lib/story/dataflow';

const HELMET =
  '<Helmet>' +
  '<Value name="region" type="string" />' +
  '<Value name="min_rev" type="number" default={100} />' +
  '<Value name="flag" type="boolean" default={false} />' +
  '<Query name="sales">{`select region, sum(revenue) revenue from ref_abc123 where $region is null or region = $region group by 1`}</Query>' +
  '<Query name="regions">{`select distinct region, region || \'!\' label from ref_abc123`}</Query>' +
  '<Query name="broken">{`select nope from ref_abc123`}</Query>' +
  '</Helmet>';

const STATE: DataflowState = {
  values: { region: null, min_rev: 100, flag: false },
  tables: {
    sales: { rows: [{ region: 'EU', revenue: 840 }, { region: 'NA', revenue: 1200 }], columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] },
    regions: { rows: [{ region: 'EU', label: 'EU!' }, { region: 'NA', label: 'NA!' }], columns: [{ name: 'region', type: 'string' }, { name: 'label', type: 'string' }] },
  },
  errors: { broken: 'Binder Error: Referenced column "nope" not found' },
};

function build(body: string) {
  const parsed = parseJsx(HELMET + body);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content, body: nodes } = splitHelmet(parsed.nodes as JsxNode[]);
  const dataflow: StoryIslandDataflow = { flow: { values: content.values, queries: content.queries }, state: STATE };
  return { nodes, dataflow };
}

const BODY =
  '<div>' +
  '<select aria-label="region" value="$region" options="$regions" />' +
  '<input aria-label="min" type="range" min={0} max={5000} value="$min_rev" />' +
  '<input aria-label="flag" type="checkbox" checked="$flag" />' +
  '<Question data="$sales" viz={{"kind":"table"}} height="300px" />' +
  '<p>Total <Number data="$sales" col="revenue" agg="sum" prefix="$" /></p>' +
  '<Question data="$broken" viz={{"kind":"table"}} height="300px" />' +
  '</div>';

describe('StoryRuntimeApp — dataflow', () => {
  it('renders bound controls from the store: options from the table (values + labels), "All" for a null-default scalar', () => {
    const { nodes, dataflow } = build(BODY);
    const { container } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    const select = container.querySelector('select[aria-label="region"]') as HTMLSelectElement;
    expect([...select.options].map((o) => `${o.value}=${o.textContent}`)).toEqual(['=All', 'EU=EU!', 'NA=NA!']);
    expect(select.value).toBe('');
    const range = container.querySelector('input[aria-label="min"]') as HTMLInputElement;
    expect(range.value).toBe('100');
    const box = container.querySelector('input[aria-label="flag"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
    // The bound attribute never reaches the DOM as a literal string.
    expect(container.innerHTML).not.toContain('"$region"');
    expect(container.innerHTML).not.toContain('$min_rev');
  });

  it('resolves embeds from the store: a table Question, an aggregated Number, and a failed query names its error', () => {
    const { nodes, dataflow } = build(BODY);
    const { container, getByLabelText } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    const table = container.querySelector('[aria-label="Data table"]') as HTMLElement;
    expect(table.textContent).toContain('EU');
    expect(table.textContent).toContain('1,200');
    expect(getByLabelText('Live number').textContent).toBe('$2,040');
    const placeholders = container.querySelectorAll('[aria-label="Chart placeholder"]');
    expect([...placeholders].some((p) => p.textContent?.includes('nope'))).toBe(true);
  });

  it('a control change writes the store with the declared type', () => {
    const { nodes, dataflow } = build(BODY);
    const store = createDataflowStore(dataflow);
    const { container } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />);
    const select = container.querySelector('select[aria-label="region"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'NA' } });
    expect(store.getValue('region')).toBe('NA');
    fireEvent.change(select, { target: { value: '' } });
    expect(store.getValue('region')).toBeNull();
    const range = container.querySelector('input[aria-label="min"]') as HTMLInputElement;
    fireEvent.change(range, { target: { value: '2500' } });
    expect(store.getValue('min_rev')).toBe(2500);
    const box = container.querySelector('input[aria-label="flag"]') as HTMLInputElement;
    fireEvent.click(box);
    expect(store.getValue('flag')).toBe(true);
    // …and the control reflects the store (a store write from elsewhere shows).
    act(() => { store.setValue('region', 'EU'); });
    expect(select.value).toBe('EU');
  });

  it('a store update re-renders the embeds bound to the changed table; stale rows stay visible (aria-busy) while a re-run is pending', async () => {
    const { nodes, dataflow } = build(BODY);
    let resolveRun: ((r: { tables: DataflowState['tables']; errors: DataflowState['errors'] }) => void) | null = null;
    const store = createDataflowStore(dataflow, {
      debounceMs: 0,
      transport: { run: () => new Promise((resolve) => { resolveRun = resolve; }), page: () => Promise.reject(new Error('n/a')) },
    });
    const { container, getByLabelText } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />);
    act(() => { store.setValue('region', 'NA'); });
    const embed = container.querySelector('[aria-label="Question embed"]') as HTMLElement;
    await waitFor(() => expect(embed.getAttribute('aria-busy')).toBe('true'));
    expect(embed.textContent).toContain('EU'); // stale rows stay, no flash
    // …and the refresh is VISIBLE: the wrapper carries the busy class the
    // document's chrome CSS dims and chips ("updating…"), and so does the
    // inline Number over the same table.
    expect(embed.classList.contains('mx-busy')).toBe(true);
    const numberWrap = getByLabelText('Live number').closest('[aria-busy]') as HTMLElement;
    expect(numberWrap.getAttribute('aria-busy')).toBe('true');
    expect(numberWrap.classList.contains('mx-busy-inline')).toBe(true);
    // The author script can see the same thing.
    expect(createMx(store).data.pending()).toEqual(['sales']);
    await act(async () => {
      resolveRun!({ tables: { sales: { rows: [{ region: 'NA', revenue: 1200 }], columns: STATE.tables.sales.columns } }, errors: {} });
      await Promise.resolve();
    });
    await waitFor(() => expect(getByLabelText('Live number').textContent).toBe('$1,200'));
    expect((container.querySelector('[aria-label="Data table"]') as HTMLElement).textContent).not.toContain('EU');
    expect(embed.getAttribute('aria-busy')).toBe('false');
    expect(embed.classList.contains('mx-busy')).toBe(false);
    expect((getByLabelText('Live number').closest('[aria-busy]') as HTMLElement).getAttribute('aria-busy')).toBe('false');
    expect(createMx(store).data.pending()).toEqual([]);
  });

  it('a Question over a TRUNCATED table says so — a chart must never pass a sample off as the set', () => {
    const { nodes, dataflow } = build('<Question data="$sales" viz={{"kind":"table"}} height="300px" />');
    const cut = { ...dataflow, state: { ...STATE, tables: { ...STATE.tables, sales: { ...STATE.tables.sales, truncated: true, totalRows: 7361 } } } };
    const { getByLabelText } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={cut} colorMode="light" chrome={false} />);
    expect(getByLabelText('Sample notice').textContent).toMatch(/first 2 of 7,361 rows/);
    // …and not when the table is whole.
    const whole = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    expect(whole.container.querySelector('[aria-label="Sample notice"]')).toBeNull();
  });

  it('a single_value tile sums the column and honours a d3 format in singleValueConfig', () => {
    const { nodes, dataflow } = build('<Question data="$sales" viz={{"kind":"single_value","yCols":["revenue"],"singleValueConfig":{"label":"Revenue","prefix":"$","format":".2s"}}} />');
    const { getByLabelText } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    const tile = getByLabelText('Single value');
    expect(tile.textContent).toContain('Revenue');
    expect(tile.textContent).toContain('$2.0k'); // d3 ".2s", not the Intl default "2,040"
  });

  it('<DataTable data="$name"> renders the table with its declarative columns, and pages past the cap through the store', async () => {
    const big = { rows: Array.from({ length: 3 }, (_, i) => ({ region: `R${i}`, revenue: i * 10 })), columns: STATE.tables.sales.columns, truncated: true, totalRows: 5000 };
    const { nodes, dataflow } = build(
      '<DataTable data="$sales" height="300px" columns={[{"col":"region","title":"Region"},{"col":"revenue","fmt":"$,.0f","bar":true}]} />',
    );
    const pages: unknown[] = [];
    const store = createDataflowStore(
      { flow: dataflow.flow, state: { ...STATE, tables: { ...STATE.tables, sales: big } } },
      { transport: {
        run: async () => ({ tables: {}, errors: {} }),
        page: async (_v, name, page) => { pages.push({ name, page }); return { rows: [{ region: 'R3', revenue: 30 }], columns: big.columns, truncated: true, totalRows: 5000 }; },
      } },
    );
    const { container, getByLabelText, findByLabelText } = render(
      <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />,
    );
    const grid = getByLabelText('Data grid');
    expect([...grid.querySelectorAll('thead th')].map((th) => th.textContent?.trim())).toEqual(['Region', 'revenue']);
    expect(grid.textContent).toContain('$20');
    expect(getByLabelText('Row count').textContent).toMatch(/3 of 5,000/);
    fireEvent.click(getByLabelText('Load more rows'));
    await waitFor(() => expect(container.textContent).toContain('R3'));
    expect(pages[0]).toEqual({ name: 'sales', page: { offset: 3, limit: 500, sort: undefined } });
    // A remote sort re-reads window 0 with the sort, replacing the rows.
    fireEvent.click(getByLabelText('Sort by revenue'));
    await waitFor(() => expect(pages).toHaveLength(2));
    expect(pages[1]).toEqual({ name: 'sales', page: { offset: 0, limit: 500, sort: { col: 'revenue', dir: 'asc' } } });
    await findByLabelText('Row count');
  });

  it('<DataTable> marks itself busy while its query re-runs', async () => {
    const { nodes, dataflow } = build('<DataTable data="$sales" />');
    const store = createDataflowStore(dataflow, { debounceMs: 0, transport: { run: () => new Promise(() => {}), page: () => Promise.reject(new Error('n/a')) } });
    const { container } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />);
    const embed = container.querySelector('[aria-label="DataTable embed"]') as HTMLElement;
    expect(embed.classList.contains('mx-busy')).toBe(false);
    act(() => { store.setValue('region', 'NA'); });
    await waitFor(() => expect(embed.getAttribute('aria-busy')).toBe('true'));
    expect(embed.classList.contains('mx-busy')).toBe(true);
    expect(embed.textContent).toContain('EU'); // the rows stay while the refresh runs
  });

  it('<DataTable> over a failed query names the error', () => {
    const { nodes, dataflow } = build('<DataTable data="$broken" />');
    const { container } = render(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    expect(container.textContent).toMatch(/query "broken" failed/);
  });

  it('exposes the store to the author script as window.mx', async () => {
    const { dataflow } = build(BODY);
    const store = createDataflowStore(dataflow);
    const mx = createMx(store);
    expect(mx.params.get('min_rev')).toBe(100);
    expect(mx.data.get('sales')?.rows).toHaveLength(2);
    const seen: unknown[] = [];
    const off = mx.params.subscribe((values) => seen.push(values.region));
    mx.params.set('region', 'EU');
    expect(store.getValue('region')).toBe('EU');
    expect(seen).toEqual(['EU']);
    off();
    mx.params.set('region', 'NA');
    expect(seen).toEqual(['EU']);
    // data.subscribe hands the state AND the pending names; pending() reads them any time.
    const pendingSeen: string[][] = [];
    const store2 = createDataflowStore(dataflow, { debounceMs: 0, transport: { run: () => new Promise(() => {}), page: () => Promise.reject(new Error('n/a')) } });
    const mx2 = createMx(store2);
    mx2.data.subscribe((_state, pending) => pendingSeen.push(pending));
    expect(mx2.data.pending()).toEqual([]);
    mx2.params.set('region', 'EU');
    await new Promise((r) => setTimeout(r, 5));
    expect(mx2.data.pending()).toEqual(['sales']);
    expect(pendingSeen.at(-1)).toEqual(['sales']);
  });

  it('signals onMounted exactly once, after the first commit — the moment an author script may run', async () => {
    const { nodes, dataflow } = build(BODY);
    const html = renderToString(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const seen: string[] = [];
    await act(async () => {
      hydrateRoot(host, <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false}
        onMounted={() => { seen.push(host.querySelector('[aria-label="Live number"]')?.textContent ?? 'missing'); }} />);
    });
    expect(seen).toEqual(['$2,040']); // once, and the hydrated tree was there to read
    host.remove();
  });

  it('SSR + hydration agree on the same store state (no mismatch)', async () => {
    const { nodes, dataflow } = build(BODY);
    const html = renderToString(<StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} colorMode="light" chrome={false} />);
    expect(html).toContain('EU!');
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = createDataflowStore(dataflow);
    await act(async () => {
      hydrateRoot(host, <StoryRuntimeApp nodes={nodes} refData={{}} dataflow={dataflow} store={store} colorMode="light" chrome={false} />);
    });
    const mismatch = errors.mock.calls.find((c) => String(c[0]).match(/hydrat|did not match/i));
    expect(mismatch).toBeUndefined();
    errors.mockRestore();
    host.remove();
  });
});
