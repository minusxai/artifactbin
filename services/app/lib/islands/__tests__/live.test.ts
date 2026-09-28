/**
 * THE COMPILED PAGE'S LIVE STREAM (lib/islands/live): it opens from the snapshot's marks (`?since=`),
 * so a dataset written between the snapshot and the page re-runs as soon as the stream connects; a
 * `data` frame goes to the page's data hook; a new version reloads the page.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot } from '../boot';
import { islandLiveUrl, startIslandLive } from '../live';
import { STORY_ADOPT_HOOK, STORY_DATA_HOOK } from '@/lib/story-runtime/contract';
import type { IslandDocument } from '../contract';

class FakeEventSource extends EventTarget {
  static made: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public url: string) { super(); FakeEventSource.made.push(this); }
  close() { this.closed = true; }
}

let booted: IslandDocument | null = null;
afterEach(() => {
  booted?.dispose();
  booted = null;
  FakeEventSource.made = [];
  delete (window as unknown as Record<string, unknown>)[STORY_DATA_HOOK];
  delete (window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK];
  document.body.removeAttribute('data-mx-live-id');
  document.body.removeAttribute('data-mx-live-edit');
  vi.unstubAllGlobals();
});

describe('the island live stream', () => {
  it('names the snapshot\'s marks in the stream address, and nothing when the page was served none', () => {
    expect(islandLiveUrl('abc', 'DS1.aaaaaaaaaaaa~DS2.bbbbbbbbbbbb')).toBe('/a/abc/events?since=DS1.aaaaaaaaaaaa~DS2.bbbbbbbbbbbb');
    expect(islandLiveUrl('abc', null)).toBe('/a/abc/events');
    expect(islandLiveUrl('abc')).toBe('/a/abc/events');
  });

  it('hands a data frame to the page\'s data hook and reloads on a new version', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const invalidate = vi.fn();
    (window as unknown as Record<string, unknown>)[STORY_DATA_HOOK] = invalidate;
    const reload = vi.fn();
    const win = new Proxy(window, { get: (target, key) => (key === 'location' ? { reload } : Reflect.get(target, key, target)) });
    const stop = startIslandLive(win, 'abc', 'e1', 'DS1.aaaaaaaaaaaa');
    const [source] = FakeEventSource.made;
    expect(source!.url).toBe('/a/abc/events?since=DS1.aaaaaaaaaaaa');

    source!.dispatchEvent(new MessageEvent('data', { data: JSON.stringify({ datasets: ['DS1'] }) }));
    expect(invalidate).toHaveBeenCalledWith(['DS1']);
    source!.onmessage!(new MessageEvent('message', { data: JSON.stringify({ editId: 'e1', version: 1 }) }));
    expect(reload, 'the version the page shows is not news').not.toHaveBeenCalled();
    source!.onmessage!(new MessageEvent('message', { data: JSON.stringify({ editId: 'e2', version: 2 }) }));
    expect(reload).toHaveBeenCalledTimes(1);

    stop();
    expect(source!.closed).toBe(true);
  });

  it('leaves a new version to the app once it has adopted the page (no reload under it)', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const reload = vi.fn();
    const win = new Proxy(window, { get: (target, key) => (key === 'location' ? { reload } : Reflect.get(target, key, target)) });
    const stop = startIslandLive(win, 'abc', 'e1');
    const [source] = FakeEventSource.made;
    // components/IslandStory installs the adopt hook when the app takes the page: it holds the stream now.
    (window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK] = () => {};
    source!.onmessage!(new MessageEvent('message', { data: JSON.stringify({ editId: 'e2', version: 2 }) }));
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('does not reload the editor on its own saved version when the page has no island module', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const reload = vi.fn();
    const win = new Proxy(window, { get: (target, key) => (key === 'location' ? { hash: '#edit', reload } : Reflect.get(target, key, target)) });
    const stop = startIslandLive(win, 'abc', 'e1');
    const [source] = FakeEventSource.made;
    source!.onmessage!(new MessageEvent('message', { data: JSON.stringify({ editId: 'e2', version: 2 }) }));
    expect(reload).not.toHaveBeenCalled();
    expect(source!.closed).toBe(true);
    stop();
  });

  it('boot opens the stream from the served snapshot\'s `since`', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root"><p>static</p></div>'
      + `<script type="application/json" id="mx-story-data">${JSON.stringify({ values: {}, results: { tables: {}, errors: {}, since: 'DS1.aaaaaaaaaaaa' }, signedIn: false, mermaidImages: {}, readOnly: null })}</script>`;
    document.body.setAttribute('data-mx-live-id', 'abc');
    document.body.setAttribute('data-mx-live-edit', 'e1');
    booted = boot({ ISLANDS: [] });
    await vi.waitFor(() => expect(FakeEventSource.made.map((s) => s.url)).toEqual(['/a/abc/events?since=DS1.aaaaaaaaaaaa']));
  });
});
