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
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { createDataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import type { Dataflow, DataflowState, Scalar } from '@/lib/story/dataflow';

const flowOf = (helmetChildren: string): Dataflow => {
  const parsed = parseJsx(`<Helmet>${helmetChildren}</Helmet>`);
  if (!parsed.ok) throw new Error(parsed.error);
  const { content } = splitHelmet(parsed.nodes as JsxNode[]);
  return { values: content.values, queries: content.queries, mutations: content.mutations };
};

const FLOW = flowOf(
  '<Value name="choice" type="string" default="ramen" />'
  + '<Query name="tally">{`select choice, count(*) votes from ref_abc123 group by 1`}</Query>'
  + '<Query name="top">{`select * from tally limit 1`}</Query>'
  + '<Query name="elsewhere">{`select * from ref_zzzzzz`}</Query>'
  + '<Mutation name="vote">{`insert into ref_abc123 (choice) values ($choice)`}</Mutation>',
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

describe('store.invalidateDatasets', () => {
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
