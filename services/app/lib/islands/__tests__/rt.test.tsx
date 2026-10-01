/* @jsxImportSource solid-js */
// DESTINATION: services/app/lib/islands/__tests__/rt.test.tsx
/**
 * THE ISLAND RUNTIME (docs/phase2-architecture.md §2.3, §4.1; lib/islands/contract IslandContext):
 * the existing react-free store bridged into Solid, reactive markup evaluated as data, `<For>` and
 * conditionals as `Repeat`/`When`, row attributes filtered per row, and in-place hydration that
 * leaves static siblings untouched.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createStore } from 'solid-js/store';
import { createIslandRuntime, Repeat, When, hydrateIsland } from '../rt';
import { rowAttrs } from '../kit/basic';
import { IslandProvider, useIsland } from '../context';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';

const flow: CompiledDataflow = {
  imports: [], mutations: [],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'All' }, { name: 'rows', kind: 'table', type: 'table', default: null, rows: [{ k: 'a', label: 'One', url: 'https://ok.example' }, { k: 'b', label: 'Two', url: 'javascript:alert(1)' }], columns: [{ name: 'k', type: 'string' }, { name: 'label', type: 'string' }, { name: 'url', type: 'string' }] }],
  queries: [],
};
const runtime = () => createIslandRuntime({ dataflow: { flow }, mermaidImages: {}, viewer: null }, (df) => createDataflowStore(df));

describe('createIslandRuntime', () => {
  it('exposes the store through IslandContext, reactively', () => {
    const rt = runtime();
    const host = document.createElement('div');
    function Region() { const island = useIsland(); return <b>{String(island.value('region'))}</b>; }
    const dispose = render(() => <IslandProvider value={rt.context}><Region /></IslandProvider>, host);
    expect(host.innerHTML).toBe('<b>All</b>');
    rt.context.setValue('region', 'West');
    expect(host.innerHTML).toBe('<b>West</b>');
    expect(rt.context.table('rows')?.rows).toHaveLength(2);
    dispose();
  });

  it('Repeat renders one instance per row with durable instance ids, and When follows its expression', () => {
    const rt = runtime();
    const host = document.createElement('div');
    const dispose = render(() => <IslandProvider value={rt.context}>
      <Repeat name="rows" keyBy="k" owner="list" ids={['item']}>{(row, scope) => <li {...rowAttrs({ id: 'item', href: '$_row.url' }, row, scope)}>{String(row.label)}</li>}</Repeat>
      <When test={{ kind: 'signal', name: 'region' }}><i>has region</i></When>
    </IslandProvider>, host);
    const items = [...host.querySelectorAll('li')];
    expect(items.map((li) => li.textContent)).toEqual(['One', 'Two']);
    expect(new Set(items.map((li) => li.id)).size).toBe(2);
    expect(items[0]!.getAttribute('href')).toBe('https://ok.example');
    expect(items[1]!.hasAttribute('href'), 'a dangerous scheme is dropped per row').toBe(false);
    expect(host.querySelector('i')?.textContent).toBe('has region');
    rt.context.setValue('region', '');
    expect(host.querySelector('i')).toBeNull();
    dispose();
  });

  it('keeps a keyed repeat comment target with its row when reconciled row proxies change keys', () => {
    const rt = runtime();
    const host = document.createElement('div');
    const [live, setLive] = createStore({ rows: [{ k: 'a', label: 'Alice' }, { k: 'b', label: 'Bob' }] });
    const context = { ...rt.context, table: () => ({ rows: live.rows, columns: [] }) };
    const dispose = render(() => <IslandProvider value={context}>
      <Repeat name="rows" keyBy="k" owner="list" ids={['item']}>{(row, scope) =>
        <p {...rowAttrs({ id: 'item' }, row, scope)}>{String(row.label)}</p>}
      </Repeat>
    </IslandProvider>, host);
    const target = (label: string) => JSON.parse([...host.querySelectorAll('p')].find(node => node.textContent === label)!.getAttribute('data-mx-comment-target')!);
    expect(target('Alice').scopes[0].key).toBe('a');
    setLive('rows', 0, { k: 'b', label: 'Bob updated' });
    setLive('rows', 1, { k: 'a', label: 'Alice updated' });
    expect(target('Alice updated').scopes[0].key).toBe('a');
    dispose();
  });

  it('hydrateIsland adopts the served island root and hands the static siblings back as the same nodes', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p id="before">static</p><div data-hk="s0-0" id="island">served</div><p id="after">static</p>';
    const before = host.querySelector('#before'), after = host.querySelector('#after');
    const rt = runtime();
    hydrateIsland('s0-', () => <div data-hk="s0-0" id="island">hydrated</div>, rt.context, host);
    expect(host.querySelector('#before')).toBe(before);
    expect(host.querySelector('#after')).toBe(after);
    expect(host.querySelector('#island')?.textContent).toBe('hydrated');
  });
});

describe('IslandContext declarations', () => {
  const declared: CompiledDataflow = {
    imports: [], mutations: [],
    values: [
      { name: 'region', kind: 'scalar', type: 'string', default: 'All' },
      { name: 'limit', kind: 'scalar', type: 'number', default: null },
      { name: 'rows', kind: 'table', type: 'table', default: null, rows: [], columns: [] },
    ],
    queries: [],
  };
  const withQuery: CompiledDataflow = { ...declared, queries: [{ name: 'orders', engine: 'postgres', source: 'DS1', sql: 'select 1 as n', params: [], reads: { imports: [], queries: [], values: [], builtins: [] }, columns: [{ name: 'n', type: 'number' }], start: 0, end: 0 }] };

  it('answers a declared scalar\'s type, whether it may be null, and whether the document runs queries', () => {
    const rt = createIslandRuntime({ dataflow: { flow: declared }, mermaidImages: {}, viewer: null }, (df) => createDataflowStore(df));
    expect([rt.context.valueType('region'), rt.context.valueType('limit'), rt.context.valueType('rows'), rt.context.valueType('missing')]).toEqual(['string', 'number', undefined, undefined]);
    expect([rt.context.nullable('region'), rt.context.nullable('limit'), rt.context.nullable('missing')]).toEqual([false, true, true]);
    expect(rt.context.declaresQueries()).toBe(false);
    const queried = createIslandRuntime({ dataflow: { flow: withQuery }, mermaidImages: {}, viewer: null }, (df) => createDataflowStore(df));
    expect(queried.context.declaresQueries()).toBe(true);
    rt.dispose(); queried.dispose();
  });

  it('without declarations, no value is typed, every bound value may be null and nothing runs', () => {
    const rt = createIslandRuntime({ dataflow: null, mermaidImages: {}, viewer: null }, (df) => createDataflowStore(df));
    expect(rt.context.valueType('region')).toBeUndefined();
    expect(rt.context.nullable('region')).toBe(true);
    expect(rt.context.declaresQueries()).toBe(false);
  });
});

describe('a refreshed table', () => {
  const columns = [{ name: 'k', type: 'string' as const }, { name: 'label', type: 'string' as const }];
  const served = { rows: [{ k: 'a', label: 'One' }, { k: 'b', label: 'Two' }], columns };
  const queried: CompiledDataflow = {
    imports: [], mutations: [],
    values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'west' }],
    queries: [{ name: 'items', engine: 'postgres', source: 'DS1', sql: 'select k, label from items where region=$region', params: ['region'], reads: { imports: [], queries: [], values: ['region'], builtins: [] }, columns, start: 0, end: 0 }],
  };

  it('keeps the same rows mounted when a refresh answers with identical rows, and redraws a changed cell', async () => {
    let answer: typeof served = served;
    const run = vi.fn(async () => ({ tables: { items: answer }, errors: {} }));
    const rt = createIslandRuntime({ dataflow: { flow: queried, values: { region: 'west' }, results: { tables: { items: served }, errors: {} } }, mermaidImages: {}, viewer: null },
      (df) => createDataflowStore(df, { transport: { run, page: vi.fn() }, debounceMs: 0 }));
    const host = document.createElement('div');
    const dispose = render(() => <IslandProvider value={rt.context}>
      <Repeat name="items" keyBy="k" owner="list" ids={[]}>{(row) => <li>{String(row.label)}</li>}</Repeat>
    </IslandProvider>, host);
    rt.store!.start();
    const before = [...host.querySelectorAll('li')];
    const table = rt.context.table('items');
    expect(before.map((li) => li.textContent)).toEqual(['One', 'Two']);

    answer = { rows: [{ k: 'a', label: 'One' }, { k: 'b', label: 'Two' }], columns };
    rt.context.setValue('region', 'east');
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(rt.store!.pending().size).toBe(0));
    expect(rt.context.table('items'), 'an identical answer keeps the same table').toBe(table);
    expect([...host.querySelectorAll('li')], 'and the same row nodes, so their controls stay mounted').toEqual(before);
    expect([...host.querySelectorAll('li')].every((li, i) => li === before[i])).toBe(true);

    answer = { rows: [{ k: 'a', label: 'One' }, { k: 'b', label: 'Two, edited' }], columns };
    rt.context.setValue('region', 'north');
    await vi.waitFor(() => expect(host.querySelectorAll('li')[1]?.textContent).toBe('Two, edited'));
    expect(host.querySelectorAll('li')[0], 'an unchanged row keeps its node').toBe(before[0]);
    dispose();
    rt.dispose();
  });
});
