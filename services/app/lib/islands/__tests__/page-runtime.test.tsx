/* @jsxImportSource solid-js */
/**
 * THE AUTHOR SCRIPT'S RUNTIME (lib/islands/page-runtime) on Solid: the bindings a script takes from `page`, over a
 * real store, and an exported Solid component mounted where the markup placed it, re-rendering on store changes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEffect, createRoot, For } from 'solid-js';
import { bindPage, mountComponents, type PageBindings } from '../page-runtime';
import { createDataflowStore, type DataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { RunAnswer } from '@/lib/story-runtime/dataflow-core';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';
import type { Row } from '@/lib/story/data/dataflow';

const reads = (imports: string[], values: string[] = []) => ({ imports, queries: [], values, builtins: [] });
const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'month', type: 'string' }] }] }],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'west' }],
  queries: [{ name: 'monthly', engine: 'sqlite', sql: 'select month from d.rows where region = $region', params: ['region'], reads: reads(['d'], ['region']), columns: [{ name: 'month', type: 'string' }], start: 0, end: 0 }],
  mutations: [],
};
const ROWS: Record<string, Row[]> = { west: [{ month: 'Jan' }, { month: 'Feb' }], east: [{ month: 'Mar' }] };

let store: DataflowStore | null = null;
let bindings: PageBindings | null = null;
afterEach(() => { bindings?.dispose(); store?.dispose(); store = null; bindings = null; document.body.innerHTML = ''; });

function setup() {
  let release: (() => void) | null = null;
  const transport: QueryTransport = {
    run: vi.fn((values: Record<string, unknown>) => new Promise<RunAnswer>((resolve) => {
      const answer = () => resolve({ tables: { monthly: { rows: ROWS[String(values.region)] ?? [], columns: [{ name: 'month', type: 'string' }] } }, errors: {} });
      release = answer;
    })),
    page: vi.fn(),
  };
  store = createDataflowStore({ flow, results: { tables: { monthly: { rows: ROWS.west!, columns: [{ name: 'month', type: 'string' }] } }, errors: {} } }, { transport, debounceMs: 0 });
  bindings = bindPage(store);
  return { store, bindings, land: () => { const r = release; release = null; r?.(); } };
}

describe('the page bindings', () => {
  it('binds a Value as [accessor, setter] over the store, and a Query as tracked rows with loading, error and ready', async () => {
    const { store, bindings, land } = setup();
    const [region, setRegion] = bindings.signal('$region');
    const monthly = bindings.query('$monthly');
    expect(region()).toBe('west');
    expect(monthly()).toEqual(ROWS.west);
    expect(monthly.loading()).toBe(false);
    expect(monthly.error()).toBeNull();

    const seen: string[] = [];
    const stop = createRoot((dispose) => { createEffect(() => seen.push(`${region()}:${monthly().length}:${monthly.loading()}`)); return dispose; });
    setRegion('east');
    expect(store.getState().values.region, 'the setter writes the store').toBe('east');
    expect(region()).toBe('east');
    await vi.waitFor(() => expect(monthly.loading()).toBe(true));
    expect(monthly(), 'the old rows stay while the re-run is in flight').toEqual(ROWS.west);
    const ready = monthly.ready;
    land();
    await expect(ready).resolves.toEqual(ROWS.east);
    expect(monthly()).toEqual(ROWS.east);
    expect(seen[0]).toBe('west:2:false');
    expect(seen.at(-1)).toBe('east:1:false');
    expect(setRegion((current) => `${current}!`), 'the setter takes a function of the current value, as Solid does').toBe('east!');
    stop();
  });

  it('throws loudly on an undeclared name or a name of the wrong kind', () => {
    const { bindings } = setup();
    expect(() => bindings.signal('$nope')).toThrow(/signal\("\$nope"\) names no declared Value/);
    expect(() => bindings.signal('$monthly')).toThrow(/names no declared Value/);
    expect(() => bindings.query('$region')).toThrow(/names no declared Query/);
    expect(() => bindings.mutation('$region')).toThrow(/names no declared Mutation/);
  });
});

describe('a mounted component', () => {
  it('renders where the markup placed it, receives a $name prop as the tracked value and a literal as a value, re-renders on a store change and restores the fallback on unmount', async () => {
    const { bindings, land } = setup();
    document.body.innerHTML = `<div id="root"><div data-mx-mount="Months" data-mx-props='{"color":"teal"}' data-mx-bind='{"rows":"monthly","region":"region"}'><p id="fallback">Loading…</p></div></div>`;
    const kinds: string[] = [];
    const Months = (props: { rows: Row[]; region: string; color: string }) => {
      kinds.push(typeof props.rows, typeof props.color);
      return <ul data-color={props.color} data-region={props.region}><For each={props.rows}>{(r) => <li>{String(r.month)}</li>}</For></ul>;
    };
    const unmount = mountComponents(document.getElementById('root')!, { Months }, bindings);
    const months = () => [...document.querySelectorAll('li')].map((li) => li.textContent);
    expect(document.getElementById('fallback')).toBeNull();
    expect(months()).toEqual(['Jan', 'Feb']);
    expect(kinds, 'props.rows is the rows array, not a function; color is a plain value').toEqual(['object', 'string']);
    expect(document.querySelector('ul')?.dataset.color).toBe('teal');

    const [, setRegion] = bindings.signal('$region');
    setRegion('east');
    expect(document.querySelector('ul')?.dataset.region, 'a Value change re-renders the bound prop').toBe('east');
    await vi.waitFor(() => expect(bindings.query('$monthly').loading()).toBe(true));
    land();
    await vi.waitFor(() => expect(months()).toEqual(['Mar']));
    expect(kinds, 'the component body ran once: Solid updates in place').toHaveLength(2);

    unmount();
    expect(document.querySelector('ul')).toBeNull();
    expect(document.getElementById('fallback')?.textContent).toBe('Loading…');
  });

  it('leaves the fallback in place for a name the script does not export', () => {
    const { bindings } = setup();
    document.body.innerHTML = `<div id="root"><div data-mx-mount="Missing"><p id="fallback">Loading…</p></div></div>`;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mountComponents(document.getElementById('root')!, {}, bindings);
    expect(document.getElementById('fallback')).not.toBeNull();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('exports no component named Missing'));
    error.mockRestore();
  });
});
