/**
 * The PAGE's half of the write relay (components/ArtifactSurface): the frame
 * asks, the page — which holds the session — calls `POST /a/<id>/mutate` and
 * answers. Same identity rule as the query relay: the frame is known by its
 * SOURCE window, never by origin ("null" for an opaque document), and the
 * answer goes back to the window that asked.
 *
 * Also the DATA channel in the other direction: a dataset under this document
 * changed, heard on the page's live stream and posted INTO the frame — which
 * must never take the document-replacement path, since nothing about the
 * document changed and replacing it would rebuild every chart to announce
 * that one of them has new rows.
 */
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArtifactSurface from '@/components/ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import {
  STORY_DATA_MESSAGE, STORY_MUTATE_MESSAGE, STORY_MUTATE_RESULT_MESSAGE,
} from '@/lib/story-runtime/contract';

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  onmessage: ((e: MessageEvent) => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { FakeEventSource.last = this; }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
}

const posted: Array<Record<string, unknown>> = [];
let fetchCalls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  posted.length = 0;
  fetchCalls = [];
  FakeEventSource.last = null;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes('/mutate')) {
      return new Response(JSON.stringify({ ok: true, dataset: 'k3Pq9z', version: 2, affected: 1 }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const surface = () => render(
  <ArtifactShell role="owner">
    <ArtifactSurface
      id="Ab3xK9" editId="e1" format="markup" title="doc" source="<p>x</p>" content=""
      columns={[]} compiledCss={null} theme={null} colorMode="light" template={null} refs={[]}
      version={1}
    />
  </ArtifactShell>,
);

/**
 * Stand in for the document frame. `source` must be a real MessageEventSource
 * for jsdom to accept it on the event (it is getter-only), so the frame's
 * window is another window object and its postMessage is spied — the same
 * shape query-relay.ui.test.tsx uses.
 */
function frameWindow(container: HTMLElement) {
  const iframe = container.querySelector('iframe') as HTMLIFrameElement;
  const win = window as unknown as Window;
  Object.defineProperty(iframe, 'contentWindow', { value: win, configurable: true });
  vi.spyOn(win, 'postMessage').mockImplementation(((m: unknown) => { posted.push(m as Record<string, unknown>); }) as typeof win.postMessage);
  return win;
}
const ask = (source: Window | null, message: Record<string, unknown>) =>
  window.dispatchEvent(new MessageEvent('message', { data: message, source: source as unknown as MessageEventSource }));

describe('the write relay (page side)', () => {
  it('calls the document\'s mutate endpoint with the name and values, and answers the frame', async () => {
    const { container } = surface();
    const win = frameWindow(container);
    ask(win, { type: STORY_MUTATE_MESSAGE, id: 7, mutation: 'vote', values: { choice: 'tacos' } });

    await waitFor(() => expect(fetchCalls.some((c) => c.url === '/a/Ab3xK9/mutate')).toBe(true));
    expect(fetchCalls.find((c) => c.url === '/a/Ab3xK9/mutate')!.body).toEqual({ mutation: 'vote', values: { choice: 'tacos' } });
    await waitFor(() => expect(posted.some((m) => m.type === STORY_MUTATE_RESULT_MESSAGE)).toBe(true));
    expect(posted.find((m) => m.type === STORY_MUTATE_RESULT_MESSAGE)).toMatchObject({ id: 7, ok: true, dataset: 'k3Pq9z' });
  });

  it('relays a refusal as an error on the same id — never silence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'dataset_read_only', detail: 'this dataset is not open for writes' }), { status: 403 })));
    const { container } = surface();
    const win = frameWindow(container);
    ask(win, { type: STORY_MUTATE_MESSAGE, id: 9, mutation: 'vote', values: {} });
    await waitFor(() => expect(posted.some((m) => m.type === STORY_MUTATE_RESULT_MESSAGE)).toBe(true));
    expect(posted.find((m) => m.type === STORY_MUTATE_RESULT_MESSAGE)).toMatchObject({ id: 9, ok: false, error: 'this dataset is not open for writes' });
  });

  it('ignores a write request from a window that is not the document frame', async () => {
    const { container } = surface();
    frameWindow(container);
    // A message with NO source at all is not the frame.
    ask(null, { type: STORY_MUTATE_MESSAGE, id: 11, mutation: 'vote', values: {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls.some((c) => c.url.includes('/mutate'))).toBe(false);
    expect(posted).toEqual([]);
  });

  it('forwards a live DATA frame into the frame, and never replaces it', async () => {
    const { container } = surface();
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    frameWindow(container);
    const before = iframe.getAttribute('src');
    await waitFor(() => expect(FakeEventSource.last).toBeTruthy());
    FakeEventSource.last!.emitData({ datasets: ['k3Pq9z'], version: 4 });
    await waitFor(() => expect(posted.some((m) => m.type === STORY_DATA_MESSAGE)).toBe(true));
    expect(posted.find((m) => m.type === STORY_DATA_MESSAGE)).toMatchObject({ datasets: ['k3Pq9z'] });
    // The frame is exactly where it was: same element, same src.
    expect(container.querySelector('iframe')).toBe(iframe);
    expect(iframe.getAttribute('src')).toBe(before);
  });
});
