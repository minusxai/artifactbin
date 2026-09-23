/**
 * The runtime store's WRITE half: `mutate` (perform a declared `<Mutation>`
 * with the current values) and `invalidateDatasets` (a dataset changed
 * elsewhere — re-run what reads it). React-free, like the store.
 *
 * The property that matters most here: the click that writes is the click that
 * redraws. A write invalidates its own target immediately, so the reader never
 * waits for the live stream to tell this document about its own write.
 */
import { describe, expect, it, vi } from 'vitest';
import { type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { createDataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { Dataflow, DataflowState, Scalar } from '@/lib/story/dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const flowOf = (helmetChildren: string): Dataflow => {
  const parsed = parseJsxOrThrow(`<Helmet>${helmetChildren}</Helmet>`);
  const { content } = splitHelmet(parsed.nodes as JsxNode[]);
  return { values: content.values, queries: content.queries, mutations: content.mutations };
};

const FLOW = flowOf(
  '<Value name="choice" type="string" default="ramen" />'
  + '<Query name="tally" source="ref:abc123">{`select choice, count(*) votes from public.rows group by 1`}</Query>'
  + '<Query name="top">{`select * from tally limit 1`}</Query>'
  + '<Query name="elsewhere" source="ref:zzzzzz">{`select * from public.rows`}</Query>'
  + '<Mutation name="vote" source="ref:abc123">{`insert into public.rows (choice) values ($choice)`}</Mutation>',
);
const STATE: DataflowState = {
  mutationAccess: {vote:null},
  values: { choice: 'ramen' },
  tables: { tally: { rows: [{ choice: 'ramen', votes: 1 }], columns: [] }, top: { rows: [], columns: [] }, elsewhere: { rows: [], columns: [] } },
  errors: {},
};

function harness() {
  const runs: Array<{ values: Record<string, Scalar>; only: string[] }> = [];
  const writes: Array<{ values: Record<string, Scalar>; name: string }> = [];
  let resolveWrite: ((r: { dataset: string }) => void) | null = null;
  let rejectWrite: ((e: Error) => void) | null = null;
  const transport: QueryTransport = {
    run: (values, only) => { runs.push({ values, only }); return Promise.resolve({ tables: {}, errors: {} }); },
    page: () => Promise.reject(new Error('unused')),
    mutate: (values, name) => {
      writes.push({ values, name });
      return new Promise((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; });
    },
  };
  const store = createDataflowStore({ flow: FLOW, state: STATE }, { transport, debounceMs: 0 });
  return { store, runs, writes, settle: (id = 'abc123') => resolveWrite!({ dataset: id }), fail: (m: string) => rejectWrite!(new Error(m)) };
}

describe('store.mutate', () => {
  it('sends the mutation NAME and the current values, and marks itself busy meanwhile', async () => {
    const { store, writes, settle } = harness();
    store.setValue('choice', 'tacos');
    const done = store.mutate('vote');
    expect(writes).toEqual([{ name: 'vote', values: { choice: 'tacos' } }]);
    expect([...store.mutating()]).toEqual(['vote']);
    settle();
    await done;
    expect([...store.mutating()]).toEqual([]);
  });

  it('re-runs exactly the queries that read the written dataset — its own write, without the stream', async () => {
    const { store, runs, settle } = harness();
    const done = store.mutate('vote');
    runs.length = 0;
    settle('abc123');
    await done;
    // `tally` reads ref_abc123; `top` reads tally; `elsewhere` reads neither.
    expect(runs).toHaveLength(1);
    expect(runs[0].only).toEqual(['tally', 'top']);
  });

  it('falls back to the DECLARED target when the server names no dataset', async () => {
    const { store, runs, settle } = harness();
    const done = store.mutate('vote');
    runs.length = 0;
    settle('');
    await done;
    expect(runs[0].only).toEqual(['tally', 'top']);
  });

  it('a double click is ONE write', async () => {
    const { store, writes, settle } = harness();
    const a = store.mutate('vote');
    const b = store.mutate('vote');
    expect(writes).toHaveLength(1);
    settle();
    await Promise.all([a, b]);
  });

  it('rejects with the server\'s message, clears busy, and refreshes capabilities', async () => {
    const { store, runs, fail } = harness();
    const done = store.mutate('vote');
    runs.length = 0;
    fail('this dataset is not open for writes');
    await expect(done).rejects.toThrow(/not open for writes/);
    expect([...store.mutating()]).toEqual([]);
    expect(runs.map(r=>r.only)).toEqual([['tally','top']]);
  });

  it('refuses an undeclared name, and a document with no write transport says so plainly', async () => {
    const { store } = harness();
    await expect(store.mutate('nope')).rejects.toThrow(/declares no <Mutation name="nope">/);
    const readOnly = createDataflowStore({ flow: FLOW, state: STATE }, {
      transport: { run: () => Promise.resolve({ tables: {}, errors: {} }), page: () => Promise.reject(new Error('x')) },
      debounceMs: 0,
    });
    await expect(readOnly.mutate('vote')).rejects.toThrow(/cannot write/);
  });

  it('notifies subscribers when busy flips, so a bound Button re-renders', async () => {
    const { store, settle } = harness();
    const seen = vi.fn();
    store.subscribe(seen);
    const done = store.mutate('vote');
    expect(seen).toHaveBeenCalled();
    const before = seen.mock.calls.length;
    settle();
    await done;
    expect(seen.mock.calls.length).toBeGreaterThan(before);
  });
});

/**
 * `reset="…"` — the form a successful write clears.
 *
 * Two properties, and the second is why it lives in the store rather than in
 * the Button: the reset happens AFTER the write is confirmed and BEFORE the
 * dependent queries are re-read, so the click that saves is one re-run and not
 * two, and a refusal leaves everything the person typed exactly where it is.
 */
describe('store.mutate with reset', () => {
  const RESET_FLOW = flowOf(
    '<Value name="desc" type="string" />'
    + '<Value name="amount" type="number" default={0} />'
    + '<Value name="payer" type="string" default="me" />'
    + '<Query name="mine" source="ref:abc123">{`select * from public.rows where payer = $payer`}</Query>'
    + '<Mutation name="add" source="ref:abc123" reset="desc amount">{`insert into public.rows (d, a) values ($desc, $amount)`}</Mutation>',
  );
  const RESET_STATE: DataflowState = {
    mutationAccess: { add: null },
    values: { desc: null, amount: 0, payer: 'me' },
    tables: { mine: { rows: [], columns: [] } },
    errors: {},
  };

  function resetHarness() {
    const runs: Array<{ values: Record<string, Scalar>; only: string[] }> = [];
    let resolveWrite: ((r: { dataset: string }) => void) | null = null;
    let rejectWrite: ((e: Error) => void) | null = null;
    const transport: QueryTransport = {
      run: (values, only) => { runs.push({ values, only }); return Promise.resolve({ tables: {}, errors: {} }); },
      page: () => Promise.reject(new Error('unused')),
      mutate: () => new Promise((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; }),
    };
    const store = createDataflowStore({ flow: RESET_FLOW, state: RESET_STATE }, { transport, debounceMs: 0 });
    // The form, as the person left it: every reset Value away from its default,
    // so a reset that never happens cannot pass by accident.
    store.setValues({ desc: 'Dinner', amount: 500 });
    runs.length = 0;
    return { store, runs, settle: () => resolveWrite!({ dataset: 'abc123' }), fail: (m: string) => rejectWrite!(new Error(m)) };
  }

  it('puts the listed Values back to their declared defaults, and only those', async () => {
    const { store, settle } = resetHarness();
    const done = store.mutate('add');
    expect(store.getState().values).toEqual({ desc: 'Dinner', amount: 500, payer: 'me' });
    settle();
    await done;
    expect(store.getState().values).toEqual({ desc: null, amount: 0, payer: 'me' });
  });

  it('resets before the dependents are re-read, so they run once with the cleared values', async () => {
    const { store, runs, settle } = resetHarness();
    const done = store.mutate('add');
    settle();
    await done;
    expect(runs).toHaveLength(1);
    expect(runs[0].only).toEqual(['mine']);
    expect(runs[0].values).toEqual({ desc: null, amount: 0, payer: 'me' });
  });

  it('resets nothing when the write is refused — the person keeps what they typed', async () => {
    const { store, fail } = resetHarness();
    const done = store.mutate('add');
    fail('this dataset is not open for writes');
    await expect(done).rejects.toThrow(/not open for writes/);
    expect(store.getState().values).toEqual({ desc: 'Dinner', amount: 500, payer: 'me' });
  });

  it('leaves a mutation without reset alone', async () => {
    const plainFlow = flowOf(
      '<Value name="desc" type="string" />'
      + '<Mutation name="add" source="ref:abc123">{`insert into public.rows (d) values ($desc)`}</Mutation>',
    );
    let resolveWrite: ((r: { dataset: string }) => void) | null = null;
    const store = createDataflowStore({
      flow: plainFlow,
      state: { mutationAccess: { add: null }, values: { desc: null }, tables: {}, errors: {} },
    }, {
      transport: {
        run: () => Promise.resolve({ tables: {}, errors: {} }),
        page: () => Promise.reject(new Error('unused')),
        mutate: () => new Promise((resolve) => { resolveWrite = resolve; }),
      },
      debounceMs: 0,
    });
    store.setValue('desc', 'Dinner');
    const done = store.mutate('add');
    resolveWrite!({ dataset: 'abc123' });
    await done;
    expect(store.getState().values).toEqual({ desc: 'Dinner' });
  });
});

describe('store.invalidateDatasets', () => {
  it('refreshes membership-dependent queries and permissions on a membership wakeup', () => {
    const {store,runs}=harness();
    runs.length=0;
    store.invalidateDatasets(['_members']);
    expect(runs).toHaveLength(1);
    expect(runs[0].only).toEqual(['tally','top','elsewhere']);
  });

  it('re-runs the readers of a dataset that changed elsewhere — immediately, not on the debounce', () => {
    const { store, runs } = harness();
    runs.length = 0;
    store.invalidateDatasets(['abc123']);
    expect(runs).toHaveLength(1);
    expect(runs[0].only).toEqual(['tally', 'top']);
  });

  it('runs the reader of a DIFFERENT dataset only for that dataset', () => {
    const { store, runs } = harness();
    runs.length = 0;
    store.invalidateDatasets(['zzzzzz']);
    expect(runs[0].only).toEqual(['elsewhere']);
  });

  it('ignores a dataset this document does not read — a frame for it costs nothing', () => {
    const { store, runs } = harness();
    runs.length = 0;
    store.invalidateDatasets(['nope00']);
    expect(runs).toEqual([]);
  });

  it('carries the READER\'s current values into the re-run, not the defaults', () => {
    const { store, runs } = harness();
    store.setValue('choice', 'salad');
    runs.length = 0;
    store.invalidateDatasets(['abc123']);
    expect(runs[0].values).toEqual({ choice: 'salad' });
  });
});
