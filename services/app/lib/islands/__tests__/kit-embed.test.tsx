/* @jsxImportSource solid-js */
/**
 * THE EMBEDS AS ISLANDS (lib/islands/kit/embed): `<Iframe>` mounts today's managed frame — one sandboxed
 * author realm bound to the document's store — once the island is mounted, and removes it with the island;
 * `<DeckGL>` draws today's loading stand-in, then the lazily loaded engine over the table `data` names.
 * The engines themselves are proven in a browser (gates: dataflow, full-kit, compiled-parity).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Iframe, DeckGL } from '../kit/embed';
import * as dataFamily from '../kit/data';
import { KIT_FAMILIES } from '../contract';
import type { IslandContext } from '../contract';
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { TableResult } from '@/lib/story/dataflow';
import { pageAssetDoor } from '../kit/embed/frame-engine';
import { ISLAND_DATA_ID } from '@/lib/compiled-page/contract';
import { STORY_ASSET_MESSAGE } from '@/lib/story-runtime/contract';

vi.mock('../kit/embed/deck-engine', () => ({
  mountDeckEngine: (box: HTMLElement, props: { rows: () => readonly Record<string, unknown>[]; height: number }) => {
    const view = document.createElement('div');
    view.className = 'engine-view';
    view.dataset.rows = String(props.rows().length);
    view.dataset.height = String(props.height);
    box.append(view);
    return () => view.remove();
  },
}));

const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };
let cleanup: (() => void) | null = null;
beforeEach(() => document.documentElement.setAttribute('data-mx-ready', ''));
afterEach(() => { cleanup?.(); cleanup = null; document.documentElement.removeAttribute('data-mx-ready'); document.getElementById(ISLAND_DATA_ID)?.remove(); vi.unstubAllGlobals(); });
const mount = (island: IslandContext, view: () => import('solid-js').JSX.Element) => {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => <IslandProvider value={island}>{view()}</IslandProvider>, host);
  cleanup = () => { dispose(); host.remove(); };
  return { host, dispose: () => { dispose(); cleanup = null; host.remove(); } };
};

/** A store with the surface the author bridge subscribes to. */
const store = (): DataflowStore => ({
  flow: { imports: [], values: [], queries: [], mutations: [] },
  subscribe: () => () => {},
  subscribeWrites: () => () => {},
  getState: () => ({ values: {}, tables: {}, errors: {} }),
  pending: () => new Set(),
}) as unknown as DataflowStore;

describe('the embed family', () => {
  it('is its own kit family: the data family no longer carries the embeds', () => {
    expect(KIT_FAMILIES).toContain('embed');
    expect(Object.keys(dataFamily)).not.toContain('Iframe');
    expect(Object.keys(dataFamily)).not.toContain('DeckGL');
  });
});

describe('<Iframe>', () => {
  it('draws today\'s managed frame box, then mounts one sandboxed author realm in it, and removes it with the island', async () => {
    const island = { ...fakeIsland(), store: () => store() };
    const { host, dispose } = mount(island, () => <Iframe id="f" class="my-4" data-mx-ast="1.2" title="Gallery" height={120} compiled={{ html: '<p>Hello</p>', scripts: [] }} />);
    const box = host.querySelector('#f')!;
    expect(box.getAttribute('data-mx-managed-frame')).toBe('');
    expect(box.getAttribute('aria-label')).toBe('Gallery');
    expect(box.getAttribute('style')).toBe('height:120px;width:100%');
    await until(() => !!box.querySelector('iframe'));
    const frame = box.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.title).toBe('Gallery');
    expect(frame.parentElement).toBe(box.firstElementChild);
    dispose();
    expect(frame.isConnected).toBe(false);
  });

  it('shows a refusal to start as today\'s frame does (role="alert")', async () => {
    const island = { ...fakeIsland(), store: () => store() };
    // A script source outside the managed asset door, with no asset door configured: the preparation refuses.
    const { host } = mount(island, () => <Iframe title="x" height={100} compiled={{ html: '<img src="https://img.example/a.png">', scripts: [] }} />);
    await until(() => !!host.querySelector('[role="alert"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/assets are not configured/);
  });
});

/** The page's data island (contract IslandPageData), as the assembler writes it. */
const pageData = (extra: Record<string, unknown>) => {
  const script = document.createElement('script');
  script.type = 'application/json';
  script.id = ISLAND_DATA_ID;
  script.textContent = JSON.stringify({ values: {}, results: null, signedIn: false, mermaidImages: {}, readOnly: null, ...extra });
  document.body.append(script);
};
const DOOR = { origin: 'https://assets.example.test', resolveUrl: 'https://app.example.test/a/Abc123/assets' };
const HASHED = `https://assets.example.test/assets/${'a'.repeat(64)}`;

describe('the frame\'s asset door (IslandPageData.managedAssets)', () => {
  it('top-level, resolves the author content\'s assets through the page\'s own door with the page\'s credentials', async () => {
    pageData({ managedAssets: DOOR });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ url: HASHED }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const island = { ...fakeIsland(), store: () => store() };
    const { host } = mount(island, () => <Iframe title="Gallery" height={100} compiled={{ html: '<img src="https://img.example/a.png">', scripts: [] }} />);
    await until(() => !!host.querySelector('iframe') || !!host.querySelector('[role="alert"]'));
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('iframe')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${DOOR.resolveUrl}?u=${encodeURIComponent('https://img.example/a.png')}&kind=image`);
    expect(init).toMatchObject({ credentials: 'same-origin', redirect: 'error' });
  });

  it('reads the door from the page, not from the island: a page without one refuses, as today\'s frame does', async () => {
    pageData({ assetsUrl: '/a/Abc123/assets' });
    const island = { ...fakeIsland(), store: () => store() };
    const { host } = mount(island, () => <Iframe title="x" height={100} assetsOrigin="https://assets.example.test" compiled={{ html: '<img src="https://img.example/a.png">', scripts: [] }} />);
    await until(() => !!host.querySelector('[role="alert"]'));
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/assets are not configured/);
  });

  it('framed, asks the parent page through the relay (document-transport\'s rule: present exactly when framed)', async () => {
    pageData({ managedAssets: DOOR });
    const posted: unknown[] = [];
    const parent = { postMessage: (message: unknown, origin: string) => posted.push([message, origin]) };
    const listeners: Array<(e: MessageEvent) => void> = [];
    const framed = { parent, self: null, addEventListener: (_type: string, listener: (e: MessageEvent) => void) => listeners.push(listener) } as unknown as Window;
    const door = pageAssetDoor(document, framed, 'https://app.example.test');
    expect(door.assets).toEqual(DOOR);
    expect(door.importAsset).toBeTypeOf('function');
    const answer = door.importAsset!('https://img.example/a.png', 'image');
    expect(posted).toEqual([[{ type: STORY_ASSET_MESSAGE, id: 1, url: 'https://img.example/a.png', kind: 'image' }, 'https://app.example.test']]);
    for (const listener of listeners) listener({ source: parent, origin: 'https://app.example.test', data: { type: 'mx:asset-result', id: 1, url: HASHED } } as unknown as MessageEvent);
    await expect(answer).resolves.toEqual({ url: HASHED, image: undefined });
    // Top-level there is no relay: the resolver fetches the door itself.
    expect(pageAssetDoor(document, window, 'https://app.example.test').importAsset).toBeUndefined();
  });
});

describe('<DeckGL>', () => {
  it('does not fetch the map engine before the compiled reader is ready', async () => {
    document.documentElement.removeAttribute('data-mx-ready');
    const { host } = mount(fakeIsland(), () => <DeckGL title="Deferred map" height={120} layers={[]} />);
    const box = host.querySelector('[aria-busy="true"]');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(box?.querySelector('.engine-view')).toBeNull();
    expect(box?.getAttribute('aria-busy')).toBe('true');
    document.documentElement.setAttribute('data-mx-ready', '');
    document.dispatchEvent(new Event('mx:ready'));
    await until(() => !!box?.querySelector('.engine-view'));
    expect(box?.querySelector('.engine-view')).not.toBeNull();
  });

  it('draws today\'s stand-in, then turns that same element into the map\'s figure with the engine drawing into it over the named table', async () => {
    const table: TableResult = { rows: [{ lng: 1, lat: 2 }, { lng: 3, lat: 4 }], columns: [] };
    const island = { ...fakeIsland(), tableSnapshot: (name: string) => (name === 'places' ? table : undefined) };
    const { host } = mount(island, () => <DeckGL id="map" data-mx-ast="1.3" class="rounded" data="$places" title="Places" height="300px" layers={[]} />);
    const outer = host.querySelector('#map')!;
    expect(outer.getAttribute('data-mx-ast')).toBe('1.3');
    const inner = outer.firstElementChild!;
    expect(inner.getAttribute('class')).toBe('rounded');
    const box = inner.firstElementChild as HTMLElement;
    expect([box.getAttribute('class'), box.getAttribute('aria-busy'), box.getAttribute('aria-label'), box.getAttribute('style'), box.getAttribute('role')]).toEqual(['w-full rounded-md bg-muted', 'true', 'Places', 'height:300px', null]);
    await until(() => box.getAttribute('role') === 'figure');
    // Today's engine figure (components/kit/deck-gl-engine), on the element the page was served with.
    expect(inner.firstElementChild).toBe(box);
    expect([box.getAttribute('class'), box.getAttribute('aria-busy'), box.getAttribute('aria-label'), box.style.height]).toEqual(['relative w-full overflow-hidden rounded-md', null, 'Places', '300px']);
    const view = box.querySelector<HTMLElement>('.engine-view')!;
    expect(view.dataset.rows).toBe('2');
    expect(view.dataset.height).toBe('300');
  });
});
