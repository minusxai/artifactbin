/**
 * store.replaceFlow — adopting a new version of the document at runtime.
 *
 * The reader is holding state the document does not own: which region they
 * picked, how far they dragged the slider. An agent rewriting the prose must
 * not reset any of it, and a rewrite that changes the DECLARATIONS must be
 * absorbed without the reader's remaining choices going stale — the server
 * computed the incoming tables from the defaults, so anything they chose has
 * to be re-run.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDataflowStore, type QueryTransport } from '../store';
import type { Dataflow, DataflowState } from '@/lib/story/dataflow';

const flowOf = (values: Dataflow['values'], queries: Dataflow['queries']): Dataflow => ({ values, queries });

const scalar = (name: string, type: 'string' | 'number' = 'string', def: unknown = null) =>
  ({ kind: 'scalar' as const, name, type, default: def } as Dataflow['values'][number]);

const query = (name: string, params: string[] = []) =>
  ({ name, sql: `select 1 where $${params[0] ?? 'x'} is null`, params, refs: [], start: 0, end: 0 } as Dataflow['queries'][number]);

const state = (values: Record<string, unknown>, tables: Record<string, unknown> = {}): DataflowState =>
  ({ values, tables, errors: {} } as DataflowState);

const rows = (n: number) => ({ rows: [{ v: n }], columns: [{ name: 'v', type: 'number' as const }] });

function make(transport?: QueryTransport) {
  const flow = flowOf([scalar('region'), scalar('zoom', 'number', 1)], [query('sales', ['region'])]);
  return createDataflowStore(
    { flow, state: state({ region: null, zoom: 1 }, { sales: rows(1) }) },
    { transport: transport ?? null, debounceMs: 0 },
  );
}

describe('replaceFlow', () => {
  it("keeps the reader's value when the declaration survives", () => {
    const store = make();
    store.setValue('region', 'NA');
    store.replaceFlow({
      flow: flowOf([scalar('region'), scalar('zoom', 'number', 1)], [query('sales', ['region'])]),
      state: state({ region: null, zoom: 1 }, { sales: rows(2) }),
    });
    expect(store.getValue('region')).toBe('NA');
  });

  it('adopts the new tables the server computed', () => {
    const store = make();
    store.replaceFlow({
      flow: flowOf([scalar('region')], [query('sales', ['region'])]),
      state: state({ region: null }, { sales: rows(9) }),
    });
    expect(store.getTable('sales')?.rows).toEqual([{ v: 9 }]);
  });

  it('drops a value whose declaration is gone, and takes the default of a new one', () => {
    const store = make();
    store.setValue('region', 'NA');
    store.replaceFlow({
      flow: flowOf([scalar('era', 'string', 'now')], []),
      state: state({ era: 'now' }),
    });
    expect(store.getValue('region')).toBeNull();
    expect(store.getValue('era')).toBe('now');
  });

  it('resets a value whose TYPE changed — the reader\'s string is not a number', () => {
    const store = make();
    store.setValue('region', 'NA');
    store.replaceFlow({
      flow: flowOf([scalar('region', 'number', 7)], []),
      state: state({ region: 7 }),
    });
    expect(store.getValue('region')).toBe(7);
  });

  it('re-runs the queries a retained choice affects (the server used the defaults)', async () => {
    const run = vi.fn().mockResolvedValue({ tables: { sales: rows(42) }, errors: {} });
    const store = make({ run, page: vi.fn() } as unknown as QueryTransport);
    store.setValue('region', 'NA');
    run.mockClear();

    store.replaceFlow({
      flow: flowOf([scalar('region')], [query('sales', ['region'])]),
      state: state({ region: null }, { sales: rows(2) }),
    });

    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(run.mock.calls[0][0]).toMatchObject({ region: 'NA' }); // re-run with THEIR value
    expect(run.mock.calls[0][1]).toContain('sales');
  });

  it('does NOT re-run when the reader changed nothing', async () => {
    const run = vi.fn().mockResolvedValue({ tables: {}, errors: {} });
    const store = make({ run, page: vi.fn() } as unknown as QueryTransport);
    store.replaceFlow({
      flow: flowOf([scalar('region')], [query('sales', ['region'])]),
      state: state({ region: null }, { sales: rows(2) }),
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps the old rows on screen while a re-run is in flight', () => {
    const store = make({ run: () => new Promise(() => {}), page: vi.fn() } as unknown as QueryTransport);
    store.setValue('region', 'NA');
    store.replaceFlow({
      flow: flowOf([scalar('region')], [query('sales', ['region'])]),
      state: state({ region: null }, { sales: rows(2) }),
    });
    expect(store.getTable('sales')).toBeTruthy();
  });

  it('publishes the new declarations and notifies subscribers', () => {
    const store = make();
    const seen = vi.fn();
    store.subscribe(seen);
    store.replaceFlow({ flow: flowOf([scalar('era')], []), state: state({ era: null }) });
    expect(store.flow.values.map((v) => v.name)).toEqual(['era']);
    expect(seen).toHaveBeenCalled();
  });

  it('routes later writes through the NEW declarations only', () => {
    const store = make();
    store.replaceFlow({ flow: flowOf([scalar('era')], []), state: state({ era: null }) });
    store.setValue('region', 'NA'); // no longer declared
    store.setValue('era', 'past');
    expect(store.getValue('region')).toBeNull();
    expect(store.getValue('era')).toBe('past');
  });

  it('without an incoming state, keeps the rows it has and re-runs them', async () => {
    const run = vi.fn().mockResolvedValue({ tables: { sales: rows(5) }, errors: {} });
    const store = make({ run, page: vi.fn() } as unknown as QueryTransport);
    store.replaceFlow({ flow: flowOf([scalar('region')], [query('sales', ['region'])]) });
    // The rows on screen are the old ones until the run lands — never blank.
    expect(store.getTable('sales')?.rows).toEqual([{ v: 1 }]);
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
  });

  it('drops the rows of a query the new document no longer declares', () => {
    const store = make();
    store.replaceFlow({ flow: flowOf([], []) });
    expect(store.getTable('sales')).toBeUndefined();
  });

  it('survives a document that declares nothing at all', () => {
    const store = make();
    expect(() => store.replaceFlow({ flow: flowOf([], []) })).not.toThrow();
    expect(store.getState().tables).toEqual({});
  });
});
