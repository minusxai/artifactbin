/* @jsxImportSource solid-js */
/**
 * THE COMPILED PAGE RUNS THE VERSION'S AUTHOR SCRIPT EXACTLY AS TODAY (lib/islands/author-host,
 * loaded by boot): the page data island names the script, boot loads the lazy host only then, and
 * the host starts today's author-script session (lib/story-runtime/author-script) against the
 * island store — a hidden `sandbox="allow-scripts"` frame on the fixed HTTP wrapper, the code sent as
 * data over a MessagePort after load, never executed in this document.
 *
 * Ported from lib/story-runtime/__tests__/author-script.ui.test.ts, author-script-bridge.test.ts and
 * author-frame.ui.test.ts, onto the compiled page's boot and its island store.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../boot';
import { useIsland } from '../context';
import type { IslandDocument } from '../contract';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { AUTHOR_FRAME_PATH } from '@/lib/story-runtime/author-frame';
import { AUTHOR_SCRIPT_DOCUMENT } from '@/lib/story-runtime/author-script-bootstrap';
import { AUTHOR_SCRIPT_FRAME_TITLE } from '@/lib/story-runtime/author-script-contract';

const reads = (imports: string[]) => ({ imports, queries: [], values: [], builtins: [] });
const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
  values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'All' }],
  queries: [{ name: 'total', engine: 'sqlite', sql: 'select count(*) as n from d.rows', params: [], reads: reads(['d']), columns: [{ name: 'n', type: 'number' }], start: 0, end: 0 }],
  mutations: [],
};

function Region() {
  const island = useIsland();
  return <div id="island"><i>{String(island.value('region'))}</i></div>;
}

const SCRIPT = 'window.__authorEscaped = true; mx.set({region: "East"});';
const page = (data: Record<string, unknown> | null) => {
  document.documentElement.removeAttribute('data-mx-ready');
  document.body.innerHTML = '<div data-mx-inline-story="" data-mx-story-root="" id="mx-story-root">'
    + '<div data-hk="s0-0" id="island"><i>West</i></div></div>'
    + (data ? `<script type="application/json" id="mx-story-data">${JSON.stringify(data)}</script>` : '');
};
const data = (over: Record<string, unknown> = {}) => ({
  values: { region: 'West' }, results: { tables: { total: { rows: [{ n: 41 }], columns: [{ name: 'n', type: 'number' }] } }, errors: {} },
  signedIn: false, mermaidImages: {}, readOnly: null, authorScript: SCRIPT, ...over,
});

type Listener = (event: { data: unknown }) => void;
interface FakePort { postMessage: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; onmessage: Listener | null }
/** Every MessageChannel the host opens, as the fake port the parent keeps (port1). */
function stubChannels(): FakePort[] {
  const ports: FakePort[] = [];
  vi.stubGlobal('MessageChannel', class {
    port1: FakePort = { postMessage: vi.fn(), start: vi.fn(), close: vi.fn(), onmessage: null };
    port2 = {};
    constructor() { ports.push(this.port1); }
  });
  return ports;
}
const authorFrames = () => [...document.querySelectorAll<HTMLIFrameElement>('iframe')].filter((f) => f.title === AUTHOR_SCRIPT_FRAME_TITLE);
const mounted = () => vi.waitFor(() => { expect(authorFrames()).toHaveLength(1); return authorFrames()[0]!; });
/** The wrapper loaded: the host transfers its port and sends the run. */
const load = (frame: HTMLIFrameElement) => frame.dispatchEvent(new Event('load'));
const packets = (port: FakePort, type: string) => port.postMessage.mock.calls.map((c) => c[0] as { type?: string }).filter((m) => m.type === type);
const reply = async (port: FakePort, message: Record<string, unknown>) => {
  const before = port.postMessage.mock.calls.length;
  port.onmessage!({ data: message });
  await vi.waitFor(() => expect(port.postMessage.mock.calls.length).toBeGreaterThan(before));
  return port.postMessage.mock.calls.at(-1)![0] as { id: number; ok: boolean; value?: unknown; error?: unknown };
};

let booted: IslandDocument | null = null;
afterEach(() => {
  booted?.dispose();
  booted = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { __authorEscaped?: boolean }).__authorEscaped;
});

describe('the compiled page\'s author script', () => {
  it('runs only in an opaque, hidden frame on the fixed HTTP wrapper; the code crosses as data after load', async () => {
    const ports = stubChannels();
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    const frame = await mounted();
    expect(frame.parentElement, 'on the body, outside the story root the SPA moves').toBe(document.body);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.hidden).toBe(true);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.srcdoc, 'never an inherited srcdoc').toBe('');
    expect(new URL(frame.src).pathname).toBe(AUTHOR_FRAME_PATH);
    expect(AUTHOR_FRAME_PATH.startsWith('/story/'), 'the wrapper outlives the legacy runtime tree').toBe(false);
    expect([...document.querySelectorAll('script')].filter((s) => s.type !== 'application/json'), 'no script element in this document').toHaveLength(0);
    expect((window as unknown as { __authorEscaped?: boolean }).__authorEscaped).toBeUndefined();

    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    load(frame);
    expect(post).toHaveBeenCalledWith({ type: 'mx:author:init', document: AUTHOR_SCRIPT_DOCUMENT }, '*', [{}]);
    expect(AUTHOR_SCRIPT_DOCUMENT).toContain("connect-src 'none'");
    expect(ports).toHaveLength(1);
    expect(packets(ports[0]!, 'run')).toEqual([{ type: 'run', source: SCRIPT }]);
    expect(ports[0]!.start).toHaveBeenCalled();
  });

  it('is never loaded for a version without one', async () => {
    page(data({ authorScript: undefined }));
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(authorFrames()).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
  });

  it('writes and reads through the island store: a set reaches the islands, a subscription gets coalesced, acknowledged signals', async () => {
    const ports = stubChannels();
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    load(await mounted());
    const port = ports[0]!;

    expect(await reply(port, { id: 1, op: 'describe' })).toMatchObject({ id: 1, ok: true });
    expect(await reply(port, { id: 2, op: 'set', values: { region: 'East' } })).toMatchObject({ id: 2, ok: true });
    expect(booted.context.value('region')).toBe('East');
    expect(document.getElementById('island')?.textContent, 'the island follows the author\'s write').toBe('East');
    expect(await reply(port, { id: 3, op: 'read', names: ['total'] })).toMatchObject({ id: 3, ok: true, value: { signals: { total: { value: { rows: [{ n: 41 }] } } } } });

    await reply(port, { id: 4, op: 'subscribe', names: ['region'] });
    await vi.waitFor(() => expect(packets(port, 'signals')).toHaveLength(1));
    expect(packets(port, 'signals')[0]).toMatchObject({ updates: [{ subscription: 4, snapshot: { signals: { region: { value: 'East', status: 'ready' } } } }] });
    // Unacknowledged: further changes coalesce and wait for the ack.
    booted.context.setValue('region', 'North');
    booted.context.setValue('region', 'South');
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(packets(port, 'signals')).toHaveLength(1);
    port.onmessage!({ data: { type: 'signals-ack' } });
    await vi.waitFor(() => expect(packets(port, 'signals')).toHaveLength(2));
    expect(packets(port, 'signals')[1]).toMatchObject({ updates: [{ subscription: 4, snapshot: { signals: { region: { value: 'South' } } } }] });
  });

  it('refuses what is not a declared data operation, and replays, without changing the store', async () => {
    const ports = stubChannels();
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    load(await mounted());
    const port = ports[0]!;
    const store = booted.store!;
    const mutate = vi.spyOn(store, 'mutate');
    let id = 0;
    for (const message of [
      { op: 'like' }, { op: 'edit', source: '<p>bad</p>' }, { op: 'fetch', url: '/api/my/artifacts' },
      { op: 'set', values: { unknown: 1 } }, { op: 'set', values: { region: 7 } }, { op: 'mutate', name: 'undeclared' },
    ]) {
      const before = store.getState();
      expect(await reply(port, { id: ++id, ...message }), JSON.stringify(message)).toMatchObject({ id, ok: false });
      expect(store.getState(), JSON.stringify(message)).toBe(before);
    }
    expect(mutate, 'the store\'s own permission checks are never bypassed').not.toHaveBeenCalled();
    expect(await reply(port, { id: ++id, op: 'set', values: { region: 'East' } })).toMatchObject({ ok: true });
    expect(await reply(port, { id, op: 'set', values: { region: 'North' } }), 'a replayed id').toMatchObject({ ok: false });
    expect(store.getValue('region')).toBe('East');
  });

  it('a version with a script and no data still gets today\'s empty store', async () => {
    const ports = stubChannels();
    page(data({ values: {}, results: null }));
    booted = boot({ ISLANDS: [] });
    expect(booted.store).toBeNull();
    load(await mounted());
    expect(await reply(ports[0]!, { id: 1, op: 'describe' })).toMatchObject({ id: 1, ok: true });
    expect(await reply(ports[0]!, { id: 2, op: 'set', values: { region: 'x' } })).toMatchObject({ id: 2, ok: false });
  });

  it('restarts its realm when the store\'s declarations change, and keeps it otherwise', async () => {
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    const first = await mounted();
    booted.context.setValue('region', 'East');
    expect(authorFrames()).toEqual([first]);
    booted.store!.replaceFlow({ flow: { ...flow, values: [...flow.values, { name: 'extra', kind: 'scalar', type: 'number', default: 0 }] } });
    expect(first.isConnected).toBe(false);
    expect(authorFrames()).toHaveLength(1);
    expect(authorFrames()[0]).not.toBe(first);
  });

  it('is revoked with the island document: on dispose, on edit mode (the editor starts its own), and on a real pagehide', async () => {
    const ports = stubChannels();
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    load(await mounted());
    booted.dispose();
    expect(authorFrames()).toHaveLength(0);
    expect(ports[0]!.close).toHaveBeenCalledOnce();
    const calls = ports[0]!.postMessage.mock.calls.length;
    ports[0]!.onmessage?.({ data: { id: 1, op: 'describe' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(ports[0]!.postMessage.mock.calls.length, 'a disposed port answers nothing').toBe(calls);
    booted = null;

    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    await mounted();
    booted.setMode('edit');
    expect(authorFrames()).toHaveLength(0);
    booted.dispose();

    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    await mounted();
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
    expect(authorFrames(), 'a page kept in the back/forward cache keeps its realm').toHaveLength(1);
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
    expect(authorFrames()).toHaveLength(0);
  });

  it('never mounts a realm for a document disposed before the host arrived', async () => {
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    booted.dispose();
    booted = null;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(authorFrames()).toHaveLength(0);
  });

  it('fails closed when the wrapper never completes its handshake', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    page(data());
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW: flow });
    await vi.dynamicImportSettled();
    expect(authorFrames()).toHaveLength(1);
    vi.advanceTimersByTime(15_000);
    expect(authorFrames()).toHaveLength(0);
  });
});
