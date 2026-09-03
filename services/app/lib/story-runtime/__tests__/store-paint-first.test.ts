/**
 * A document served WITHOUT its rows has to go and get them.
 *
 * The server used to run every `<Query>` before sending a byte and inline the
 * results — 231 KB of a 365 KB page, and ~90ms of a ~100ms render, spent
 * before the reader saw anything at all. Paint-first sends the DECLARATIONS
 * and lets the document fetch its own rows, so the page arrives at final
 * geometry immediately and fills in.
 *
 * That makes "no state" a real arrival shape rather than an edge case, and the
 * constructor has to answer it the way `replaceFlow` already does: everything
 * declared is dirty, and it runs. Without this the document paints its
 * skeletons and keeps them forever — which is worse than what it replaced.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDataflowStore, type QueryTransport } from '../store';
import type { Dataflow } from '@/lib/story/dataflow';

const scalar = (name: string, type: 'string' | 'number' = 'string', def: unknown = null) =>
  ({ kind: 'scalar' as const, name, type, default: def } as Dataflow['values'][number]);

const query = (name: string, params: string[] = []) =>
  ({ name, sql: 'select 1', params, refs: [], start: 0, end: 0 } as Dataflow['queries'][number]);

const rows = (n: number) => ({ rows: [{ v: n }], columns: [{ name: 'v', type: 'number' as const }] });

const FLOW: Dataflow = {
  values: [scalar('region'), scalar('zoom', 'number', 2)],
  queries: [query('sales'), query('costs')],
};

/** A transport that records what it was asked for and answers with rows. */
function recording() {
  const asked: string[][] = [];
  const transport: QueryTransport = {
    run: vi.fn((_values, only: string[]) => {
      asked.push([...only]);
      return Promise.resolve({ tables: Object.fromEntries(only.map((n) => [n, rows(1)])), errors: {} });
    }),
    page: () => Promise.reject(new Error('not used')),
  };
  return { asked, transport };
}

describe('a store built with declarations but no rows', () => {
  it('asks the transport for every query the document declares', async () => {
    const { asked, transport } = recording();
    createDataflowStore({ flow: FLOW }, { transport, debounceMs: 0 }).start();
    await vi.waitFor(() => expect(asked.length).toBe(1));
    expect([...asked[0]].sort()).toEqual(['costs', 'sales']);
  });

  /*
   * The store marks them, the CALLER runs them. A framed document relays its
   * queries through the page, and a message posted before the page is
   * listening is lost — the constructor firing on its own is exactly that bug.
   */
  it('does not run anything until it is started', async () => {
    const { asked, transport } = recording();
    createDataflowStore({ flow: FLOW }, { transport, debounceMs: 0 });
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual([]);
  });

  it('reports them pending meanwhile, so an embed shows busy and not empty', () => {
    const { transport } = recording();
    const store = createDataflowStore({ flow: FLOW }, { transport, debounceMs: 0 });
    expect([...store.pending()].sort()).toEqual(['costs', 'sales']);
  });

  it('has the rows once they land', async () => {
    const { transport } = recording();
    const store = createDataflowStore({ flow: FLOW }, { transport, debounceMs: 0 });
    store.start();
    await vi.waitFor(() => expect(store.getTable('sales')?.rows).toEqual([{ v: 1 }]));
    expect(store.pending().size).toBe(0);
  });

  // The declared defaults are the server's own starting point, so a document
  // that arrives without rows still arrives with the values its controls show.
  it('starts from the declared defaults, not from nothing', () => {
    const { transport } = recording();
    const store = createDataflowStore({ flow: FLOW }, { transport, debounceMs: 0 });
    expect(store.getValue('zoom')).toBe(2);
  });

  /*
   * An inline `<Value type="table">` carries its rows in the DECLARATION —
   * they are written in the document's own source, so they arrive with the
   * flow and cost nothing extra. The server used to copy them into state as
   * part of running the dataflow, which meant that with paint-first they
   * reached nobody: every chart bound to an inline table drew nothing at all.
   */
  const TABLE_FLOW: Dataflow = {
    values: [{
      kind: 'table', name: 'rows',
      rows: [{ x: 'a', y: 1 }, { x: 'b', y: 3 }],
      columns: [{ name: 'x', type: 'string' }, { name: 'y', type: 'number' }],
      start: 0, end: 0,
    } as Dataflow['values'][number]],
    queries: [],
  };

  it('has an inline table immediately, with no transport and nothing to fetch', () => {
    const store = createDataflowStore({ flow: TABLE_FLOW }, { debounceMs: 0 });
    expect(store.getTable('rows')?.rows).toEqual([{ x: 'a', y: 1 }, { x: 'b', y: 3 }]);
    expect(store.pending().size).toBe(0);
  });

  it('keeps that true when a new version of the document is adopted', () => {
    const store = createDataflowStore({ flow: TABLE_FLOW }, { debounceMs: 0 });
    store.replaceFlow({ flow: {
      ...TABLE_FLOW,
      values: [{ ...(TABLE_FLOW.values[0] as unknown as Record<string, unknown>), rows: [{ x: 'c', y: 9 }] } as unknown as Dataflow['values'][number]],
    } });
    expect(store.getTable('rows')?.rows).toEqual([{ x: 'c', y: 9 }]);
  });

  /*
   * `pending()` is a useSyncExternalStore SNAPSHOT, so it must be the SAME
   * OBJECT until something actually changes. Returning a fresh Set per call
   * put every document with a pending query into an infinite render loop —
   * which blocked the frame's own event loop, so timers never fired and
   * promises never settled: the author script stayed parked and the query
   * that started it all never resolved, on a page that otherwise looked fine.
   */
  it('answers the same set object until something changes', async () => {
    const { transport } = recording();
    const store = createDataflowStore({ flow: FLOW }, { transport, debounceMs: 0 });
    const before = store.pending();
    expect(store.pending()).toBe(before);
    store.start();
    const running = store.pending();
    expect(store.pending()).toBe(running);
    expect(running).not.toBe(before);
    await vi.waitFor(() => expect(store.pending().size).toBe(0));
    const settled = store.pending();
    expect(store.pending()).toBe(settled);
  });

  // The old shape must keep working exactly: a capture and the editor's canvas
  // are still served WITH their rows, and must not re-run them on arrival.
  it('runs nothing when the rows came with the document', async () => {
    const { asked, transport } = recording();
    createDataflowStore(
      { flow: FLOW, state: { values: { region: null, zoom: 2 }, tables: { sales: rows(9), costs: rows(9) }, errors: {} } },
      { transport, debounceMs: 0 },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual([]);
  });
});

/*
 * SPIKE S1 (F2 — `<Value>` selections in the URL, risk R3).
 *
 * A URL-carried `<Value>` has to reach the store BEFORE its first run, or the
 * reader's link shows the document's defaults and then flips. The obvious
 * seed — hand the constructor a synthetic `state` holding the values — is the
 * TRAP: `state` present is how a capture and the editor's canvas say "the rows
 * are already computed", so the first run never happens at all and every chart
 * paints its skeleton forever.
 *
 * The seam is therefore a THIRD island field beside `flow` and `state`:
 * values without rows. It folds into the initial values and leaves the
 * `!input.state` rule — the whole of paint-first — untouched.
 */
describe('URL-carried values (spike S1)', () => {
  /** A transport that records the VALUES it was run with, as well as the names. */
  function recordingValues() {
    const calls: { values: Record<string, unknown>; only: string[] }[] = [];
    const transport: QueryTransport = {
      run: vi.fn((values, only: string[]) => {
        calls.push({ values: { ...values }, only: [...only] });
        return Promise.resolve({ tables: Object.fromEntries(only.map((n) => [n, rows(1)])), errors: {} });
      }),
      page: () => Promise.reject(new Error('not used')),
    };
    return { calls, transport };
  }

  // Documents the trap, and is GREEN on arrival: it is the `!input.state` rule
  // working exactly as written. It exists so that a later attempt to seed
  // through `state` fails a test rather than a reader's document.
  it('seeding values through a synthetic state runs nothing', async () => {
    const { calls, transport } = recordingValues();
    const store = createDataflowStore(
      { flow: FLOW, state: { values: { region: 'west' }, tables: {}, errors: {} } },
      { transport, debounceMs: 0 },
    );
    store.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
    expect(store.getValue('region')).toBe('west'); // the value is there…
    expect(store.getTable('sales')).toBeUndefined(); // …and no rows ever will be
  });

  it('URL values seed the store and every query still runs once with them', async () => {
    const { calls, transport } = recordingValues();
    const store = createDataflowStore(
      { flow: FLOW, values: { region: 'west' } },
      { transport, debounceMs: 0 },
    );
    expect(store.getValue('region')).toBe('west');
    store.start();
    await vi.waitFor(() => expect(calls.length).toBe(1));
    expect([...calls[0].only].sort()).toEqual(['costs', 'sales']);
    expect(calls[0].values.region).toBe('west');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(1); // once, not twice
    expect(store.getTable('sales')?.rows).toEqual([{ v: 1 }]);
  });

  // The declared default is still the floor: a URL that names one value does
  // not blank the others.
  it('leaves every value the URL does not name at its declared default', () => {
    const { transport } = recordingValues();
    const store = createDataflowStore({ flow: FLOW, values: { region: 'west' } }, { transport, debounceMs: 0 });
    expect(store.getValue('zoom')).toBe(2);
  });
});
