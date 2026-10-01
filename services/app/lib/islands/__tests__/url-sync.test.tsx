/* @jsxImportSource solid-js */
/**
 * THE LINK FOLLOWS THE READER ON A COMPILED PAGE (lib/islands/boot + lib/islands/url-sync): a top-level
 * page rewrites its own address when a `<Value>` moves — its `$` params only (never a `url={false}`
 * draft), the other params and the hash kept, the old selection replaced rather than a history entry
 * pushed. Debounced (a slider is a burst) and compared (a store notifies for things that are not a
 * value change), so the reader's back button never sees churn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiledOf } from '@/test/helpers/compiled';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { Scalar } from '@/lib/story/dataflow';
import { boot } from '../boot';
import { useIsland } from '../context';
import type { IslandDocument } from '../contract';
import { startUrlSync } from '../url-sync';

const FLOW = await compiledOf('<Value name="region" type="string" /><Value name="draft" type="string" url={false} />');
const SYNC_FLOW = await compiledOf('<Value name="region" default="north" /><Value name="zoom" type="number" default={2} /><Value name="draft" url={false} />');
function Region() { const island = useIsland(); return <div id="island">{String(island.value('region'))}</div>; }

const page = (values: Record<string, unknown>) => {
  document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root"><div data-hk="s0-0" id="island">…</div></div>'
    + `<script type="application/json" id="mx-story-data">${JSON.stringify({ values, results: null, signedIn: false, hold: [], mermaidImages: {}, readOnly: null })}</script>`;
};

let booted: IslandDocument | null = null;
const start = window.location.href;
afterEach(() => { booted?.dispose(); booted = null; window.history.replaceState(null, '', start); });

describe('the compiled page\'s address', () => {
  it('follows a value the reader moves, replacing the old selection and keeping the other params', async () => {
    window.history.replaceState(null, '', '/a/abc?$region=west&reader=compiled#top');
    const length = window.history.length;
    page({ region: 'west' });
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW });
    booted.context.setValue('region', 'east');
    await vi.waitFor(() => expect(window.location.search).toContain('$region=east'));
    expect(window.location.search).not.toContain('west');
    expect(window.location.search).toContain('reader=compiled');
    expect(window.location.pathname).toBe('/a/abc');
    expect(window.location.hash).toBe('#top');
    expect(window.history.length, 'replaced, not pushed').toBe(length);

    booted.context.setValue('draft', 'secret');
    booted.context.setValue('region', null);
    await vi.waitFor(() => expect(window.location.search).not.toContain('region'));
    expect(window.location.search, 'a url={false} value never travels').not.toContain('secret');
  });
});

describe('startUrlSync', () => {
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let stop: (() => void) | null = null;
  afterEach(() => { stop?.(); stop = null; vi.restoreAllMocks(); });
  const sync = (seed?: Record<string, Scalar>) => {
    const store = createDataflowStore({ flow: SYNC_FLOW, ...(seed ? { values: seed } : {}) }, { debounceMs: 0 });
    const replace = vi.spyOn(window.history, 'replaceState');
    stop = startUrlSync(window, store, 5);
    return { store, replace };
  };

  it('coalesces a burst into one write', async () => {
    window.history.replaceState(null, '', '/a/abc');
    const { store, replace } = sync();
    store.setValue('zoom', 3);
    store.setValue('zoom', 4);
    store.setValue('zoom', 5);
    await tick(40);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?$zoom=5');
  });

  it('writes nothing when the store notifies without a change the link carries', async () => {
    window.history.replaceState(null, '', '/a/abc?$region=west');
    const { store, replace } = sync({ region: 'west' });
    store.setValue('region', 'west');
    store.setValue('draft', 'a private draft');
    await tick(40);
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain('draft');
  });

  it('keeps the hash and every foreign param, and never carries a url={false} value', async () => {
    window.history.replaceState(null, '', '/a/abc?ref=mail&$region=west#chart');
    const { store } = sync({ region: 'west' });
    store.setValue('draft', 'secret');
    store.setValue('region', 'east');
    await tick(40);
    const url = new URL(window.location.href);
    expect(url.searchParams.get('ref')).toBe('mail');
    expect(url.searchParams.get('$region')).toBe('east');
    expect(url.hash).toBe('#chart');
    expect(url.search).not.toContain('secret');
  });

  it('writes at once when a value moved before it started, and stops when torn down', async () => {
    window.history.replaceState(null, '', '/a/abc');
    const store = createDataflowStore({ flow: SYNC_FLOW, values: { region: 'south' } }, { debounceMs: 0 });
    stop = startUrlSync(window, store, 5);
    expect(window.location.search).toBe('?$region=south');
    stop();
    stop = null;
    store.setValue('region', 'west');
    await tick(40);
    expect(window.location.search).toBe('?$region=south');
  });
});
