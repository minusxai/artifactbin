/**
 * LIVE DATASET TEXT CELLS ON THE PAGE (solid/document/create-framed-story with cell-editing): any reader's frame may
 * ask for a cell (`region-open` under a cell key). A signed-out reader's frame is answered `readonly` with no request
 * and no chunk loaded; a live editor's cell (a signed-in person, or a browser session's scripted browser, which has no
 * account session) is opened with the server and relayed both ways, without the page's regions being enabled; a refusal
 * is `readonly`; and a settling ack reports how many of the frame's updates it covers.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellKey } from '@artifactbin/contracts';
import { STORY_FRAME_BRIDGE_MESSAGE } from '@/lib/html-reader/contract';
import { createFramedStory, type CellEditingLoader } from '../create-framed-story';

const PAGES = 'https://6869.pages.test';
const KEY = cellKey({ dataset: 'tasks', rowId: 'r_abc', column: 'description' });
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** `signed-in`: a person; `scripted`: a browser session's scripted browser (session payload: no account, `liveEditor`). */
function framedPage(state: 'signed-in' | 'signed-out' | 'scripted', options: { refuse?: boolean; load?: CellEditingLoader } = {}) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const posted: Array<{ key: string; payload: { kind: string } & Record<string, unknown> }> = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((data: { key: string; payload: { kind: string } }) => { posted.push(data as never); }) as never);
  const fetch = vi.fn(async (path: string) => {
    if (options.refuse) return Response.json({ error: 'not_found' }, { status: 404 });
    if (path.endsWith('/open')) return Response.json({ regionId: KEY, kind: 'text', clientId: 7, seq: 3, state: 'AAA=', savedVersion: 2 });
    if (path.endsWith('/updates')) return Response.json({ seq: 4 });
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
  const [session] = createSignal({ revision: '1', readOnly: false, uploadSession: { state: state === 'signed-in' ? 'signed-in' as const : 'signed-out' as const } });
  createRoot((dispose) => {
    createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, editId: () => 'e1', source: () => null, htmlContext: session, liveEditor: () => state !== 'signed-out', ...(options.load ? { loadCells: options.load } : {}) });
    cleanups.push(dispose);
  });
  const say = (payload: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, key: posted[0]!.key, payload }, origin: PAGES, source: frame.contentWindow }));
  const regionMessages = () => posted.map((message) => message.payload).filter((payload) => payload.kind.startsWith('region'));
  return { posted, say, fetch, regionMessages };
}

describe('cells on the page', () => {
  it('a signed-out reader is told readonly at once: no request, no chunk', async () => {
    const load = vi.fn<CellEditingLoader>(() => import('../cell-editing'));
    const page = framedPage('signed-out', { load });
    page.say({ kind: 'ready', nonce: 'n1' });
    page.say({ kind: 'region-open', regionId: KEY });
    await vi.waitFor(() => expect(page.regionMessages()).toEqual([{ kind: 'region-closed', regionId: KEY, reason: 'readonly' }]));
    expect(page.fetch).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('a signed-in reader\'s cell opens without page regions, and updates and acks are relayed', async () => {
    const page = framedPage('signed-in');
    page.say({ kind: 'ready', nonce: 'n1' });
    page.say({ kind: 'region-open', regionId: KEY });
    await vi.waitFor(() => expect(page.regionMessages().map((message) => message.kind)).toEqual(['region-session']));
    expect(page.fetch).toHaveBeenCalledWith(`/api/artifacts/doc1/regions/${encodeURIComponent(KEY)}/open`, expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    expect(page.regionMessages()[0]).toMatchObject({ kind: 'region-session', regionId: KEY, regionKind: 'text', clientId: 7, seq: 3 });
    page.say({ kind: 'region-update', regionId: KEY, update: new Uint8Array([0, 0]) });
    await vi.waitFor(() => expect(page.regionMessages().at(-1)).toEqual({ kind: 'region-ack', regionId: KEY, seq: 4, settled: 1 }));
    expect(page.fetch).toHaveBeenCalledWith(`/api/artifacts/doc1/regions/${encodeURIComponent(KEY)}/updates`, expect.objectContaining({ method: 'POST' }));
  });

  it('a browser session\'s scripted browser (no account session) has its cell open relayed, not answered readonly', async () => {
    const page = framedPage('scripted');
    page.say({ kind: 'ready', nonce: 'n1' });
    page.say({ kind: 'region-open', regionId: KEY });
    await vi.waitFor(() => expect(page.regionMessages().map((message) => message.kind)).toEqual(['region-session']));
    expect(page.fetch).toHaveBeenCalledWith(`/api/artifacts/doc1/regions/${encodeURIComponent(KEY)}/open`, expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
  });

  it('a refused cell is readonly', async () => {
    const page = framedPage('signed-in', { refuse: true });
    page.say({ kind: 'ready', nonce: 'n1' });
    page.say({ kind: 'region-open', regionId: KEY });
    await vi.waitFor(() => expect(page.regionMessages()).toEqual([{ kind: 'region-closed', regionId: KEY, reason: 'readonly' }]));
  });

  it('a region id that is not a page region or a cell is never opened', async () => {
    const page = framedPage('signed-in');
    page.say({ kind: 'ready', nonce: 'n1' });
    page.say({ kind: 'region-open', regionId: 'cell:tasks:nope' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.fetch).not.toHaveBeenCalled();
    expect(page.regionMessages()).toEqual([]);
  });
});
