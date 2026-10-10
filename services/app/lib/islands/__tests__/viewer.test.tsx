/* @jsxImportSource solid-js */
/**
 * THE VIEWER OVERLAY IN THE PAGE (lib/islands/viewer, docs/phase2-architecture.md §4.1, §6) and the
 * write status indicator (kit/status): a guest page with nothing only a reader can answer never asks
 * the viewer door; a signed-in page asks once after paint, at the page's `$` values, lands the
 * reader's rows over whatever the guest's door still had in flight, then moves `viewer()` from the
 * hint to the identity; a failed overlay keeps the placeholder and retries.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../boot';
import { useIsland } from '../context';
import type { IslandDocument } from '../contract';
import { SAVED_STATUS_TTL_MS } from '../contract';
import { hasViewerScope, VIEWER_OVERLAY_RETRY_MS } from '../viewer';
import { createWriteStatusFeed } from '../writes';
import { installStatus } from '../kit/status';
import { createDataflowStore } from '@/lib/page-store/store';
import type { CompiledDataflow, CompiledQuery } from '@/lib/dataflow';

const query = (name: string, reads: Partial<CompiledQuery['reads']> = {}): CompiledQuery => ({
  name, engine: 'sqlite', sql: `select 1 as ${name}`, params: [],
  reads: { imports: [], queries: [], values: [], builtins: [], ...reads },
  columns: [{ name: 'v', type: 'string' }], start: 0, end: 0,
});
const region = { name: 'region', kind: 'scalar' as const, type: 'string' as const, default: 'All' };
const sharedOnly: CompiledDataflow = { imports: [], values: [region], queries: [query('total')], mutations: [] };
const withMe: CompiledDataflow = { imports: [], values: [region], queries: [query('total'), query('me', { builtins: ['_me.id'], values: ['region'] })], mutations: [] };
const table = (v: string) => ({ rows: [{ v }], columns: [{ name: 'v', type: 'string' as const }] });

function Me() {
  const island = useIsland();
  const who = () => { const v = island.viewer(); return v === null ? 'guest' : 'id' in v ? v.id : 'hinted'; };
  return <div id="island"><b>{String(island.table('me')?.rows[0]?.v ?? '…')}</b><i>{who()}</i></div>;
}

const page = (data: Record<string, unknown>) => {
  document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root"><div data-hk="s0-0" id="island"><b>…</b><i>…</i></div></div>'
    + `<script type="application/json" id="mx-story-data">${JSON.stringify(data)}</script>`;
};
const served = { values: { region: 'West' }, results: { tables: { total: table('41') }, errors: {} }, mermaidImages: {}, readOnly: null, queryUrl: '/a/abc/query', viewerUrl: '/a/abc/viewer' };

/** A fetch whose answers the test releases, by door. */
function doors() {
  const waiting: Array<{ url: string; init: RequestInit | undefined; answer: (body: unknown, status?: number) => void; fail: (e: Error) => void }> = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    waiting.push({ url, init, answer: (body, status = 200) => resolve(Response.json(body, { status })), fail: reject });
  }));
  const take = (door: 'viewer' | 'query') => {
    const at = waiting.findIndex((w) => new URL(w.url, 'http://x').pathname.endsWith(`/${door}`));
    if (at < 0) throw new Error(`no ${door} request waiting (${waiting.map((w) => w.url).join(', ')})`);
    return waiting.splice(at, 1)[0]!;
  };
  return { fetchMock, waiting, take };
}

let booted: IslandDocument | null = null;
afterEach(() => {
  booted?.dispose();
  booted = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const text = () => document.getElementById('island')?.textContent;

describe('the viewer overlay', () => {
  it('a guest page with no viewer-scope query never asks the viewer door; one with a $_me query does', async () => {
    const { fetchMock } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page({ ...served, signedIn: false });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: sharedOnly });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchMock, 'the snapshot answered everything and nothing names the reader').not.toHaveBeenCalled();
    booted.dispose();

    page({ ...served, signedIn: false });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: withMe });
    await vi.waitFor(() => expect(fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/a/abc/viewer'))).toEqual(['/a/abc/viewer?$region=West']));
  });

  it('tells a viewer-scope query from the page\'s own data: $_me transitively, or left out of the guest answers, never a $_tz query', () => {
    const tz = { ...sharedOnly, queries: [query('total'), query('zone', { builtins: ['_tz'] })] };
    expect(hasViewerScope(tz, { tables: { total: table('1') }, errors: {} })).toBe(false);
    const downstream = { ...sharedOnly, queries: [query('me', { builtins: ['_me'] }), query('mine', { queries: ['me'] })] };
    expect(hasViewerScope(downstream, null)).toBe(true);
    const refused = { ...sharedOnly, queries: [query('total'), query('secret')] };
    expect(hasViewerScope(refused, { tables: { total: table('1') }, errors: {} })).toBe(true);
    expect(hasViewerScope(refused, null), 'without guest answers only the reads can tell').toBe(false);
  });

  it('a signed-in page asks once at its $ values, lands the reader\'s rows over the run still in flight, then names the reader', async () => {
    const { fetchMock, take } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page({ ...served, signedIn: true });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: withMe });
    expect(text(), 'the placeholder, never guest content').toBe('…hinted');

    const guestRun = take('query');
    expect(guestRun.init, 'a signed-in page\'s own runs carry the session to the POST door').toMatchObject({ method: 'POST', credentials: 'same-origin' });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/a/abc/viewer'))).toBe(true));
    const overlay = take('viewer');
    expect(overlay.url).toBe('/a/abc/viewer?$region=West');
    expect(overlay.init).toMatchObject({ method: 'GET', credentials: 'same-origin' });

    overlay.answer({ viewer: { id: 'u1' }, results: { tables: { me: table('u1-West') }, errors: {} }, hold: [] });
    await vi.waitFor(() => expect(text()).toBe('u1-Westu1'));
    expect(booted.store?.pending().has('me')).toBe(false);

    guestRun.answer({ tables: { me: table('guest-West') }, errors: {} });
    await new Promise((r) => setTimeout(r, 0));
    expect(text(), 'the guest\'s answer, asked before the overlay landed, does not land over it').toBe('u1-Westu1');
  });

  it('after the overlay, a signed-in page re-runs through the session door, and a guest page through the anonymous one', async () => {
    const { fetchMock, take, waiting } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page({ ...served, signedIn: true });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: withMe });
    take('query').answer({ tables: { me: table('u1-West') }, errors: {} });
    await vi.waitFor(() => expect(waiting.some((w) => w.url.startsWith('/a/abc/viewer'))).toBe(true));
    take('viewer').answer({ viewer: { id: 'u1' }, results: { tables: { me: table('u1-West') }, errors: {} }, hold: [] });
    await vi.waitFor(() => expect(text()).toBe('u1-Westu1'));

    booted.context.setValue('region', 'East');
    const rerun = take('query');
    expect(rerun.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(rerun.init?.body))).toMatchObject({ only: ['me'], values: { region: 'East' } });
    expect(waiting.filter((w) => w.url.startsWith('/a/abc/viewer')), 'the overlay is not asked again').toEqual([]);
    rerun.answer({ tables: { me: table('u1-East') }, errors: {} });
    await vi.waitFor(() => expect(text()).toBe('u1-Eastu1'));
    booted.dispose();

    page({ ...served, signedIn: false });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: withMe });
    const guest = take('query');
    expect(guest.init).toMatchObject({ method: 'GET', credentials: 'omit' });
  });

  it('keeps the placeholder while the overlay fails, and retries after a wait', async () => {
    vi.useFakeTimers();
    const { fetchMock, take, waiting } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page({ ...served, signedIn: true });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: withMe });
    take('query').answer({ tables: { me: table('guest-West') }, errors: {} });
    await vi.advanceTimersByTimeAsync(0);
    take('viewer').fail(new TypeError('network down'));
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toBe('guest-Westhinted');
    expect(waiting.some((w) => w.url.startsWith('/a/abc/viewer')), 'no retry before the wait').toBe(false);

    await vi.advanceTimersByTimeAsync(VIEWER_OVERLAY_RETRY_MS[0]!);
    take('viewer').answer({ viewer: { id: 'u1' }, results: { tables: { me: table('u1-West') }, errors: {} }, hold: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toBe('u1-Westu1');
  });

  it('takes a refusal (4xx) as the answer: no retry, the placeholder stays', async () => {
    vi.useFakeTimers();
    const { fetchMock, take } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page({ ...served, signedIn: true });
    booted = boot({ ISLANDS: [['s0-', Me]], FLOW: withMe });
    await vi.advanceTimersByTimeAsync(0);
    take('viewer').answer({ error: 'not_found' }, 404);
    await vi.advanceTimersByTimeAsync(VIEWER_OVERLAY_RETRY_MS.reduce((a, b) => a + b, 0) + 1);
    expect(fetchMock.mock.calls.filter(([url]) => url.startsWith('/a/abc/viewer'))).toHaveLength(1);
  });
});

describe('island writes', () => {
  const writing: CompiledDataflow = {
    imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
    values: [region], queries: [],
    mutations: [{ name: 'add', sql: 'insert into d.rows values ($region)', target: { import: 'd', table: 'rows' }, args: [{ name: 'region', type: 'string' }], reads: { imports: ['d'], queries: [], values: ['region'], builtins: [] }, start: 0, end: 0 }],
  } as CompiledDataflow;
  const writes = (signedIn: boolean) => ({ ...served, results: { tables: {}, errors: {} }, mutateUrl: '/a/abc/mutate', signedIn });

  it('sends a click made before the write check answers, with the session on a signed-in page, and reports it saved', async () => {
    const { fetchMock, waiting } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page(writes(true));
    booted = boot({ ISLANDS: [], FLOW: writing });
    expect(booted.store?.mutationUnavailable('add'), 'the check has not answered yet').toBe('Checking edit access…');
    const done = booted.context.mutate({ mutation: 'add', args: {} });
    const write = waiting.find((w) => w.url === '/a/abc/mutate');
    expect(write, 'the write was sent, not refused').toBeTruthy();
    expect(write!.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(String(write!.init?.body))).toMatchObject({ mutation: 'add', args: { region: 'West' } });
    expect(booted.context.writes.current().map((w) => w.state)).toEqual(['saving']);
    write!.answer({ ok: true, dataset: 'DS1' });
    await expect(done).resolves.toEqual({ dataset: 'DS1' });
    expect(booted.context.writes.current().map((w) => w.state)).toEqual(['saved']);
  });

  it('keeps a guest page\'s write anonymous', () => {
    const { fetchMock, waiting } = doors();
    vi.stubGlobal('fetch', fetchMock);
    page(writes(false));
    booted = boot({ ISLANDS: [], FLOW: writing });
    void booted.context.mutate({ mutation: 'add', args: {} }).catch(() => {});
    expect(waiting.find((w) => w.url === '/a/abc/mutate')?.init).toMatchObject({ method: 'POST', credentials: 'omit' });
  });
});

describe('the write status indicator', () => {
  const flow: CompiledDataflow = {
    imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
    values: [], queries: [],
    mutations: [{ name: 'add', sql: 'insert into d.rows values (2)', target: { import: 'd', table: 'rows' }, args: [], reads: { imports: ['d'], queries: [], values: [], builtins: [] }, start: 0, end: 0 }],
  };

  it('shows saving, then saved until its TTL, and draws nothing for an empty feed', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    let settle!: (v: { dataset: string }) => void;
    const store = createDataflowStore({ flow }, { transport: { run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }), mutate: () => new Promise((r) => { settle = r; }) } });
    const feed = createWriteStatusFeed(store);
    const stop = installStatus(feed, document.getElementById('root')!);
    expect(document.querySelector('[data-mx-write-status-host]'), 'a page that never writes has no indicator').toBeNull();
    const done = store.mutate({ mutation: 'add', args: {} });
    await vi.waitFor(() => expect(document.querySelector('[data-mx-write-status]')?.getAttribute('data-mx-write-status'), 'the view loads on the first write').toBe('saving'));
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Saving…');
    settle({ dataset: 'DS1' });
    await done;
    expect(document.querySelector('[data-mx-write-status]')?.getAttribute('data-mx-write-status')).toBe('saved');
    vi.advanceTimersByTime(SAVED_STATUS_TTL_MS + 1);
    expect(document.querySelector('[data-mx-write-status]')).toBeNull();
    stop();
    expect(document.querySelector('[data-mx-write-status-host]')).toBeNull();
  });

  it('keeps a failure with the server\'s reason until the reader retries or dismisses it', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const mutate = vi.fn<() => Promise<{ dataset: string }>>()
      .mockRejectedValueOnce(new Error('Sign in to add a row'))
      .mockRejectedValueOnce(new Error('Still refused'))
      .mockResolvedValueOnce({ dataset: 'DS1' });
    const store = createDataflowStore({ flow }, { transport: { run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }), mutate } });
    const feed = createWriteStatusFeed(store);
    const stop = installStatus(feed, document.getElementById('root')!);
    await store.mutate({ mutation: 'add', args: {} }).catch(() => {});
    const status = () => document.querySelector('[data-mx-write-status]');
    await vi.waitFor(() => expect(status()?.getAttribute('data-mx-write-status')).toBe('failed'));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Sign in to add a row');

    document.querySelector<HTMLButtonElement>('button[aria-label="Retry saving add"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Still refused'));
    expect(mutate).toHaveBeenCalledTimes(2);

    document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss the failed save of add"]')!.click();
    expect(status()).toBeNull();
    expect(feed.current()).toEqual([]);
    stop();
  });
});
