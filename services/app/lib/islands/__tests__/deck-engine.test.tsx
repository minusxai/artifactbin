/**
 * The `<DeckGL>` engine's MapLibre half (lib/islands/kit/embed/deck-engine), with MapLibre and deck's
 * overlay replaced by recorders: the engine starts MapLibre's worker from the same-origin
 * /basemap/ route, draws deck interleaved in MapLibre's GL context, and — since MapLibre 6
 * requires WebGL2 and throws GPUInitializationError without it — falls back to the deck-only
 * view with a visible note instead of failing. Real drawing is proven in a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const maplibre = vi.hoisted(() => {
  class GPUInitializationError extends Error {}
  const state = { fail: null as Error | null, maps: [] as unknown[], controls: [] as unknown[] };
  class Map {
    constructor(options: unknown) {
      if (state.fail) throw state.fail;
      state.maps.push(options);
    }
    addControl(control: unknown) { state.controls.push(control); }
    on() {}
    getCenter() { return { lng: 0, lat: 0 }; }
    getZoom() { return 1; }
    getPitch() { return 0; }
    getBearing() { return 0; }
    jumpTo() {}
    remove() {}
  }
  return { state, module: { GPUInitializationError, Map, setWorkerUrl: vi.fn() } };
});
const decks = vi.hoisted(() => [] as unknown[]);

vi.mock('maplibre-gl', () => maplibre.module);
vi.mock('@deck.gl/maplibre', () => ({
  MapLibreOverlay: class { constructor(public props: unknown) {} setProps() {} },
}));
vi.mock('@deck.gl/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deck.gl/core')>()),
  Deck: class { constructor(props: unknown) { decks.push(props); } setProps() {} finalize() {} },
}));

const { mountDeckEngine, BASEMAP_UNAVAILABLE } = await import('../kit/embed/deck-engine');
const { ATTRIBUTION } = await import('@/lib/viz/deck-chrome');

const rows = [{ lng: -0.13, lat: 51.5, orders: 3 }, { lng: 2.35, lat: 48.86, orders: 5 }];
let stop: (() => void) | null = null;
const mount = () => {
  const box = document.createElement('div');
  document.body.append(box);
  stop = mountDeckEngine(box, {
    rows: () => rows, layers: [{ '@@type': 'ScatterplotLayer', getPosition: '@@=[lng, lat]' }], basemap: 'auto', colorMode: 'light', height: 300, title: 'Stores',
  });
  return box;
};

beforeEach(() => {
  maplibre.state.fail = null;
  maplibre.state.maps.length = 0;
  maplibre.state.controls.length = 0;
  decks.length = 0;
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; });

describe('the <DeckGL> engine over a street basemap', () => {
  it('starts MapLibre’s worker from the same-origin route and draws deck interleaved', () => {
    expect(maplibre.module.setWorkerUrl).toHaveBeenCalledWith('/basemap/worker.mjs');
    const box = mount();
    expect(maplibre.state.maps).toHaveLength(1);
    expect(maplibre.state.maps[0]).toMatchObject({ attributionControl: false, locale: { 'Map.Title': 'Stores' } });
    expect(maplibre.state.controls).toEqual([expect.objectContaining({ props: expect.objectContaining({ interleaved: true }) })]);
    expect(decks).toHaveLength(0);
    expect(box.textContent).toContain(ATTRIBUTION);
  });

  it('without WebGL2 keeps the deck-only view and says the street map is unavailable', () => {
    maplibre.state.fail = new maplibre.module.GPUInitializationError('WebGL2 is not supported');
    let box!: HTMLElement;
    expect(() => { box = mount(); }).not.toThrow();
    expect(maplibre.state.maps).toHaveLength(0);
    expect(decks).toHaveLength(1);
    expect(box.querySelector('#deckgl-wrapper canvas')).not.toBeNull();
    expect(box.textContent).toContain(BASEMAP_UNAVAILABLE);
    expect(box.textContent).not.toContain(ATTRIBUTION);
  });

  it('does not swallow an error that is not about the GPU', () => {
    maplibre.state.fail = new TypeError('a real bug');
    expect(() => mount()).toThrow('a real bug');
  });
});
