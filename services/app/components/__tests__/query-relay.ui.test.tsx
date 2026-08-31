/**
 * The page's half of the query relay: a `mx:query` from the DOCUMENT FRAME is
 * answered by calling /a/<id>/query with the page's session and posting the
 * result back to the window that asked. Identity is the source window (the
 * frame's origin is "null"); a stranger's message is ignored; a failed fetch
 * is relayed as an error, never dropped.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';


import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import { STORY_QUERY_MESSAGE, STORY_QUERY_RESULT_MESSAGE } from '@/lib/story-runtime/contract';

class FakeEventSource {
  /** The named `data` channel (a dataset under the document changed). */
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

let fetchCalls: Array<{ url: string; body: unknown }> = [];
let fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

beforeEach(() => {
  localStorage.clear();
  fetchCalls = [];
  fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} }) });
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return fetchImpl(String(url));
  }) as unknown as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const props = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'story1', editId: 'edit_1', format: 'markup', title: 'doc', source: '<p>Hello</p>', template: null, refs: [], version: 1, content: '', columns: [], compiledCss: null, theme: null, colorMode: null,
  ...over,
});

const frame = () => screen.getByTitle('artifact') as HTMLIFrameElement;

/** Post as a given window, capturing what the page posts back to it. */
function ask(source: Window, data: unknown) {
  const posted: unknown[] = [];
  const spy = vi.spyOn(source, 'postMessage').mockImplementation((m: unknown) => { posted.push(m); });
  act(() => { window.dispatchEvent(new MessageEvent('message', { data, source: source as unknown as MessageEventSource })); });
  return { posted, spy };
}

describe('the query relay', () => {
  it('answers the frame with the rows /a/<id>/query returns', async () => {
    render(<ArtifactSurface {...props()} />);
    const win = frame().contentWindow!;
    const { posted } = ask(win, { type: STORY_QUERY_MESSAGE, id: 7, values: { region: 'EU' }, only: ['sales'] });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(fetchCalls[0].url).toBe('/a/story1/query');
    expect(fetchCalls[0].body).toEqual({ values: { region: 'EU' }, only: ['sales'] });
    expect(posted[0]).toEqual({ type: STORY_QUERY_RESULT_MESSAGE, id: 7, tables: { sales: { rows: [{ a: 1 }], columns: [] } }, errors: {} });
  });

  it('ignores a request from a window that is not the document frame', async () => {
    render(<ArtifactSurface {...props()} />);
    const stranger = document.createElement('iframe');
    document.body.appendChild(stranger);
    const { posted } = ask(stranger.contentWindow!, { type: STORY_QUERY_MESSAGE, id: 1, values: {}, only: [] });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalls).toHaveLength(0);
    expect(posted).toHaveLength(0);
    stranger.remove();
  });

  it('relays a failed fetch as an error on the same id, never silence', async () => {
    fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
    render(<ArtifactSurface {...props()} />);
    const { posted } = ask(frame().contentWindow!, { type: STORY_QUERY_MESSAGE, id: 3, values: {}, only: ['sales'] });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ type: STORY_QUERY_RESULT_MESSAGE, id: 3, error: 'query failed (404)' });
  });

  it('leaves the paint/hello protocol untouched (a string message is not a query)', async () => {
    render(<ArtifactSurface {...props()} />);
    const { posted } = ask(frame().contentWindow!, 'mx:painted');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchCalls).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });
});
