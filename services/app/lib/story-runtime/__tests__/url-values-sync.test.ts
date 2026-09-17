/**
 * F2 — the DOCUMENT's half of the write-back: when the reader picks, the link
 * they could copy has to change with them.
 *
 * One subscriber, two sinks, chosen by whether this document is framed — and
 * that is the only thing about it that varies. A document served TOP-LEVEL
 * (the reader's) writes its own address through the single narrow capability
 * its frozen history prelude leaves open. A FRAMED one (the owner's shell)
 * cannot: the `location` it can reach is the frame's, so it would rewrite
 * `/a/<id>/raw?edit=1`, which nobody can see or copy. It reports up the signed
 * channel instead and the page writes.
 *
 * Debounced because a slider is a burst, and compared against what was last
 * said because a store notifies for reasons that are not a value change at all
 * (rows landing, a query going busy) — an address rewritten on every one of
 * those is churn nobody asked for.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDataflowStore } from '@/lib/story-runtime/store';
import { syncValuesToUrl } from '@/lib/story-runtime/url-values-sync';
import type { Dataflow, Scalar } from '@/lib/story/dataflow';

const FLOW: Dataflow = {
  values: [
    { kind: 'scalar', name: 'region', type: 'string', default: 'north', start: 0, end: 0 },
    { kind: 'scalar', name: 'zoom', type: 'number', default: 2, start: 0, end: 0 },
  ],
  queries: [],
};

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function harness(seed?: Record<string, Scalar>) {
  const store = createDataflowStore({ flow: FLOW, ...(seed ? { values: seed } : {}) }, { debounceMs: 0 });
  const hook = vi.fn();
  const post = vi.fn();
  return { store, hook, post };
}

describe('syncValuesToUrl, top-level', () => {
  it('writes the changed value — and only what the reader moved', async () => {
    const { store, hook } = harness();
    syncValuesToUrl(store, () => FLOW, { hook }, 5);
    store.setValue('region', 'west');
    await tick(30);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toEqual({ region: 'west', zoom: null });
  });

  it('coalesces a burst into one write', async () => {
    const { store, hook } = harness();
    syncValuesToUrl(store, () => FLOW, { hook }, 20);
    store.setValue('zoom', 3);
    store.setValue('zoom', 4);
    store.setValue('zoom', 5);
    await tick(60);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0][0]).toEqual({ region: null, zoom: '5' });
  });

  it('says nothing when nothing the LINK cares about moved', async () => {
    const { store, hook } = harness({ region: 'west' });
    syncValuesToUrl(store, () => FLOW, { hook }, 5);
    // The store notifies for reasons that are not a value change (rows
    // arriving, a query going busy) — the address must not follow those.
    store.setValue('region', 'west');
    await tick(30);
    expect(hook).not.toHaveBeenCalled();
  });

  it('removes the param when the reader goes back to the default, and empties it for "All"', async () => {
    const { store, hook } = harness({ region: 'west' });
    syncValuesToUrl(store, () => FLOW, { hook }, 5);
    store.setValue('region', 'north');
    await tick(30);
    expect(hook.mock.calls[0][0]).toEqual({ region: null, zoom: null });
    store.setValue('region', null);
    await tick(30);
    expect(hook.mock.calls[1][0]).toEqual({ region: '', zoom: null });
  });

  it('stops when it is torn down', async () => {
    const { store, hook } = harness();
    syncValuesToUrl(store, () => FLOW, { hook }, 5)();
    store.setValue('region', 'west');
    await tick(30);
    expect(hook).not.toHaveBeenCalled();
  });
});

describe('syncValuesToUrl, framed', () => {
  it('reports the scalars to the page and never touches the document\'s own url', async () => {
    const { store, hook, post } = harness();
    syncValuesToUrl(store, () => FLOW, { hook, post }, 5);
    store.setValue('region', 'west');
    await tick(30);
    expect(hook).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({ region: 'west', zoom: 2 });
  });
});
