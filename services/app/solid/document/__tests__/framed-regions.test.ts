/**
 * ONLY EDITORS EDIT REGIONS (solid/document/create-framed-story `regions`): a reader with edit access gets region
 * editing once the frame's controller runs, and its frame is told the saved page's regions; a viewer's or commenter's
 * page never loads region editing, never tells its frame of a region and never opens a session, whatever the frame says.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_FRAME_BRIDGE_MESSAGE } from '@/lib/html-reader/contract';
import { createFramedStory, type FramedStory, type RegionEditingLoader } from '../create-framed-story';

const PAGES = 'https://6869.pages.test';
const PAGE = '<html><body><article data-af-id="notes" data-af-editable="rich"><p data-af-id="n1">x</p></article><p data-af-id="out">y</p></body></html>';
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function framedPage(enabled: () => boolean, load?: RegionEditingLoader, autoOpen?: boolean) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const posted: Array<{ key: string; payload: { kind: string } & Record<string, unknown> }> = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((data: { key: string; payload: { kind: string } }) => { posted.push(data as never); }) as never);
  const fetch = vi.fn(async (path: string) => path.endsWith('/open')
    ? Response.json({ regionId: 'notes', kind: 'rich', clientId: 7, seq: 0, state: 'AAA=', savedVersion: 2 })
    : Response.json({ version: 3 }));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
  const loadHtml = vi.fn(async () => PAGE);
  let story!: FramedStory;
  createRoot((dispose) => {
    story = createFramedStory({ id: 'doc1', framed: { frame, origin: PAGES }, editId: () => 'e1', source: () => null, regions: { enabled, loadHtml, ...(load ? { load } : {}), ...(autoOpen ? { autoOpen } : {}) } });
    cleanups.push(dispose);
  });
  const say = (payload: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_FRAME_BRIDGE_MESSAGE, key: posted[0]!.key, payload }, origin: PAGES, source: frame.contentWindow }));
  const regionKinds = () => posted.map((message) => message.payload.kind).filter((kind) => kind.startsWith('region'));
  return { story, frame, posted, say, fetch, loadHtml, regionKinds };
}

describe('region editing on the page', () => {
  it('an editor\'s frame is told its regions once its controller runs, and a region it opens gets a session', async () => {
    const page = framedPage(() => true);
    expect(page.loadHtml).not.toHaveBeenCalled();
    page.say({ kind: 'ready', nonce: 'n1' });
    await vi.waitFor(() => expect(page.regionKinds()).toEqual(['regions-enabled']));
    expect(page.posted.at(-1)!.payload).toEqual({ kind: 'regions-enabled', regionIds: ['notes'] });
    page.say({ kind: 'region-open', regionId: 'notes' });
    await vi.waitFor(() => expect(page.regionKinds()).toEqual(['regions-enabled', 'region-session']));
    expect(page.fetch).toHaveBeenCalledWith('/api/artifacts/doc1/regions/notes/open', expect.objectContaining({ method: 'POST', credentials: 'same-origin' }));
    // A comment inside the region saves first; one outside does not.
    const outside = { anchor: { kind: 'html-node' as const, v: 1 as const, revision: '2', nodeId: 'out', quote: 'y' } };
    expect(await page.story.beforeComment(outside)).toBe(outside);
    const inside = await page.story.beforeComment({ anchor: { ...outside.anchor, nodeId: 'n1' } });
    expect(inside.anchor.revision).toBe('3');
    expect(page.fetch).toHaveBeenLastCalledWith('/api/artifacts/doc1/regions/flush', expect.objectContaining({ method: 'POST' }));
  });

  it('a doc opens its region for its editor as the frame\'s controller runs, with the page\'s focus moved into the frame', async () => {
    const page = framedPage(() => true, undefined, true);
    const focus = vi.spyOn(page.frame, 'focus');
    page.say({ kind: 'ready', nonce: 'n1' });
    await vi.waitFor(() => expect(page.regionKinds()).toEqual(['regions-enabled', 'region-session', 'region-command']));
    expect(page.fetch).toHaveBeenCalledWith('/api/artifacts/doc1/regions/notes/open', expect.objectContaining({ method: 'POST' }));
    expect(page.posted.at(-1)!.payload).toEqual({ kind: 'region-command', regionId: 'notes', name: 'focus' });
    expect(focus).toHaveBeenCalledOnce();
  });

  it('a doc\'s viewer opens nothing and keeps the focus where it is', async () => {
    const page = framedPage(() => false, undefined, true);
    const focus = vi.spyOn(page.frame, 'focus');
    page.say({ kind: 'ready', nonce: 'n1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(page.regionKinds()).toEqual([]);
    expect(page.fetch).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
  });

  it('a viewer\'s page never loads region editing, never tells its frame of a region and opens nothing', async () => {
    const load = vi.fn<RegionEditingLoader>();
    const page = framedPage(() => false, load);
    page.say({ kind: 'ready', nonce: 'n1' });
    page.say({ kind: 'region-open', regionId: 'notes' });
    page.say({ kind: 'region-update', regionId: 'notes', update: new Uint8Array([1]) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(load).not.toHaveBeenCalled();
    expect(page.regionKinds()).toEqual([]);
    expect(page.fetch).not.toHaveBeenCalled();
    const subject = { anchor: { kind: 'html-node' as const, v: 1 as const, revision: '2', nodeId: 'n1', quote: 'x' } };
    expect(await page.story.beforeComment(subject)).toBe(subject);
  });

  it('losing edit access ends region editing', async () => {
    const [enabled, setEnabled] = createSignal(true);
    const dispose = vi.fn(), attached = vi.fn();
    const load: RegionEditingLoader = async () => ({ startRegionEditing: () => ({ attached, dispose, membership: () => ({ inside: new Set(), known: new Set() }), save: async () => 1 }) });
    const page = framedPage(enabled, load);
    page.say({ kind: 'ready', nonce: 'n1' });
    await vi.waitFor(() => expect(attached).toHaveBeenCalledOnce());
    setEnabled(false);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
