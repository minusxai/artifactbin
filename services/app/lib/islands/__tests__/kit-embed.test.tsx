/* @jsxImportSource solid-js */
/**
 * THE EMBEDS AS ISLANDS (lib/islands/kit/embed): `<Iframe>` mounts today's managed frame — one sandboxed
 * author realm bound to the document's store — once the island is mounted, and removes it with the island;
 * `<DeckGL>` draws today's loading stand-in, then the lazily loaded engine over the table `data` names.
 * The engines themselves are proven in a browser (gates: dataflow, full-kit, compiled-parity).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Iframe, DeckGL } from '../kit/data';
import type { IslandContext } from '../contract';
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { TableResult } from '@/lib/story/dataflow';

vi.mock('../kit/embed/deck-engine', () => ({
  DeckEngine: (props: { rows: () => readonly Record<string, unknown>[]; title?: string; height: number }) => {
    const el = document.createElement('div');
    el.setAttribute('role', 'figure');
    el.setAttribute('aria-label', props.title ?? 'Map');
    el.dataset.rows = String(props.rows().length);
    el.dataset.height = String(props.height);
    return el;
  },
}));

const until = async (ok: () => boolean) => { for (let i = 0; i < 100 && !ok(); i++) await new Promise((r) => setTimeout(r, 10)); };
let cleanup: (() => void) | null = null;
afterEach(() => { cleanup?.(); cleanup = null; });
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

describe('<DeckGL>', () => {
  it('draws today\'s stand-in, then the engine over the named table', async () => {
    const table: TableResult = { rows: [{ lng: 1, lat: 2 }, { lng: 3, lat: 4 }], columns: [] };
    const island = { ...fakeIsland(), tableSnapshot: (name: string) => (name === 'places' ? table : undefined) };
    const { host } = mount(island, () => <DeckGL id="map" data-mx-ast="1.3" class="rounded" data="$places" title="Places" height="300px" layers={[]} />);
    const outer = host.querySelector('#map')!;
    expect(outer.getAttribute('data-mx-ast')).toBe('1.3');
    const inner = outer.firstElementChild!;
    expect(inner.getAttribute('class')).toBe('rounded');
    const standIn = inner.firstElementChild!;
    expect([standIn.getAttribute('class'), standIn.getAttribute('aria-busy'), standIn.getAttribute('aria-label'), standIn.getAttribute('style')]).toEqual(['w-full rounded-md bg-muted', 'true', 'Places', 'height:300px']);
    await until(() => inner.querySelector('[role="figure"]') !== null);
    const figure = inner.querySelector<HTMLElement>('[role="figure"]')!;
    expect(figure.getAttribute('aria-label')).toBe('Places');
    expect(figure.dataset.rows).toBe('2');
    expect(figure.dataset.height).toBe('300');
    expect(inner.querySelector('[aria-busy]')).toBeNull();
  });
});
