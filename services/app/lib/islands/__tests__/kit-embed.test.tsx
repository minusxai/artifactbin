/* @jsxImportSource solid-js */
/**
 * THE EMBED AS AN ISLAND (lib/islands/kit/embed): `<DeckGL>` draws today's loading stand-in, then the
 * lazily loaded engine over the table `data` names.
 * The engines themselves are proven in a browser (gates: dataflow, full-kit, compiled-parity).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { DeckGL } from '../kit/embed';
import * as dataFamily from '../kit/data';
import { KIT_FAMILIES } from '../contract';
import type { IslandContext } from '../contract';
import type { TableResult } from '@/lib/dataflow';

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
afterEach(() => { cleanup?.(); cleanup = null; document.documentElement.removeAttribute('data-mx-ready'); });
const mount = (island: IslandContext, view: () => import('solid-js').JSX.Element) => {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => <IslandProvider value={island}>{view()}</IslandProvider>, host);
  cleanup = () => { dispose(); host.remove(); };
  return { host, dispose: () => { dispose(); cleanup = null; host.remove(); } };
};

describe('the embed family', () => {
  it('is its own kit family: the data family no longer carries the embeds', () => {
    expect(KIT_FAMILIES).toContain('embed');
    expect(Object.keys(dataFamily)).not.toContain('DeckGL');
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
    // Today's engine figure, on the element the page was served with.
    expect(inner.firstElementChild).toBe(box);
    expect([box.getAttribute('class'), box.getAttribute('aria-busy'), box.getAttribute('aria-label'), box.style.height]).toEqual(['relative w-full overflow-hidden rounded-md', null, 'Places', '300px']);
    const view = box.querySelector<HTMLElement>('.engine-view')!;
    expect(view.dataset.rows).toBe('2');
    expect(view.dataset.height).toBe('300');
  });
});
