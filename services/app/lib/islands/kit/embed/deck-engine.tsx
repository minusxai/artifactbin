/* @jsxImportSource solid-js */
/**
 * THE `<DeckGL>` ENGINE ON A COMPILED PAGE, loaded lazily by the island (../embed.tsx) once it is mounted:
 * the retired React engine without React. It draws INTO the island's box — the
 * served stand-in, which the island turns into the map's figure — so the element the page was served with
 * is the element the reader keeps. The layers, legend, fitted view and
 * tooltip record come from the shared framework-free half (lib/viz/deck-engine-core); this file is the
 * view — deck.gl's `Deck` in the same wrapper DOM @deck.gl/react's `DeckGL` draws, or, with a basemap,
 * MapLibre with deck drawing into its GL context (interleaved), in the container react-maplibre's `Map`
 * draws. MapLibre needs WebGL2; without it the map keeps the deck-only view and says why.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { Deck } from '@deck.gl/core';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import { loadGeoFeatures } from '@/lib/viz/geo-assets';
import { basemapStyleUrl, basemapTransformRequest, BASEMAP_WORKER_URL } from '@/lib/viz/basemap';
import { createVegaTooltipHandler, hideVegaTooltip } from '@/lib/viz/vega-tooltip-handler';
import {
  ATTRIBUTION, MAP_CLASSES, basemapStyleOf, boundaryKeyOf, buildLayers, compactNumber, extentOf, fittedView, layerSpecs, legendScales, paletteFor, rgbCss, tooltipRecord,
  type ColorScale, type Feature, type MapViewState, type PickingInfo, type Row,
} from '@/lib/viz/deck-engine-core';

// MapLibre may not spawn a blob: worker under the document CSP; it starts this same-origin module worker.
maplibregl.setWorkerUrl(BASEMAP_WORKER_URL);

/** Shown in the attribution's place when the street map cannot draw. */
export const BASEMAP_UNAVAILABLE = 'Street map unavailable: this browser has no WebGL2.';

export interface DeckEngineProps {
  rows: () => readonly Row[];
  layers: unknown;
  basemap?: string;
  colorMode: 'light' | 'dark';
  initialViewState?: Partial<MapViewState>;
  tooltip?: boolean | string[];
  legend?: boolean;
  title?: string;
  height: number;
}

type HoverHandler = (info: PickingInfo, event: { srcEvent: Event }) => void;
interface ViewProps { layers: () => unknown[]; view: () => MapViewState; move(next: MapViewState, byReader: boolean): void; onHover: HoverHandler }

/** deck alone: @deck.gl/react DeckGL's wrapper (`#deckgl-wrapper` > `.deck-events-root` > canvas, `.deck-widgets-root`). */
function DeckView(props: ViewProps) {
  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;
  onMount(() => {
    const deck = new Deck({
      widgets: [], style: null, width: '100%', height: '100%', parent: container, canvas, controller: true,
      layers: props.layers() as never, viewState: props.view(),
      onViewStateChange: ({ viewState, interactionState }) => { props.move(viewState as MapViewState, Object.values(interactionState ?? {}).some(Boolean)); return viewState; },
      onHover: props.onHover as never,
    });
    createEffect(() => deck.setProps({ layers: props.layers() as never, viewState: props.view() }));
    onCleanup(() => deck.finalize());
  });
  return (
    <div id="deckgl-wrapper" ref={container} style={{ position: 'absolute', 'z-index': 0, left: 0, top: 0, width: '100%', height: '100%' }}>
      <div class="deck-events-root" style={{ width: '100%', height: '100%' }}><canvas id="deckgl-overlay" ref={canvas} style={{ left: 0, top: 0 }} /></div>
      <div class="deck-widgets-root" />
    </div>
  );
}

/**
 * MapLibre with deck in its GL context: react-maplibre Map's container (`position:relative`, then `[mapboxgl-children]`).
 * A browser without WebGL2 cannot draw MapLibre at all; `unavailable` hands the box back to the deck-only view.
 */
function BaseMapView(props: ViewProps & { style: 'light' | 'dark'; title: string; unavailable: () => void }) {
  let container!: HTMLDivElement;
  const [mounted, setMounted] = createSignal(false);
  onMount(() => {
    const at = props.view();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container, style: basemapStyleUrl(props.style), center: [at.longitude, at.latitude], zoom: at.zoom, pitch: at.pitch, bearing: at.bearing,
        attributionControl: false,
        // MapLibre names its canvas region "Map"; a document with several maps needs each one's own name.
        locale: { 'Map.Title': props.title },
        transformRequest: basemapTransformRequest,
      });
    } catch (error) {
      if (!(error instanceof maplibregl.GPUInitializationError)) throw error;
      props.unavailable();
      return;
    }
    const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
    let syncing = false;
    map.on('move', (event: { originalEvent?: unknown }) => {
      if (syncing) return;
      const c = map.getCenter();
      props.move({ longitude: c.lng, latitude: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() }, !!event.originalEvent);
    });
    createEffect(() => overlay.setProps({ layers: props.layers() as never, onHover: props.onHover as never }));
    createEffect(() => {
      const v = props.view();
      const c = map.getCenter();
      if (c.lng === v.longitude && c.lat === v.latitude && map.getZoom() === v.zoom && map.getPitch() === v.pitch && map.getBearing() === v.bearing) return;
      syncing = true;
      map.jumpTo({ center: [v.longitude, v.latitude], zoom: v.zoom, pitch: v.pitch, bearing: v.bearing });
      syncing = false;
    });
    setMounted(true);
    onCleanup(() => map.remove());
  });
  return <div ref={container} style={{ position: 'relative', width: '100%', height: '100%' }}><Show when={mounted()}><div mapboxgl-children="" style={{ height: '100%' }} /></Show></div>;
}

const ICON = { width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'aria-hidden': 'true' } as const;
function MapButton(props: { label: string; onClick: () => void; children: JSX.Element }) {
  return <button type="button" aria-label={props.label} on:click={props.onClick} class={MAP_CLASSES.button}>{props.children}</button>;
}

/** Zoom and reset: the map's only chrome, in the document's own theme. */
function MapControls(props: { zoomIn: () => void; zoomOut: () => void; reset: () => void }) {
  return (
    <div class={MAP_CLASSES.controls}>
      <MapButton label="Zoom in" onClick={props.zoomIn}><svg {...ICON}><path d="M12 5v14M5 12h14" /></svg></MapButton>
      <MapButton label="Zoom out" onClick={props.zoomOut}><svg {...ICON}><path d="M5 12h14" /></svg></MapButton>
      <MapButton label="Reset view" onClick={props.reset}><svg {...ICON}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg></MapButton>
    </div>
  );
}

/** One entry per theme-colour scale: a gradient with its range, or swatches per category. */
function MapLegend(props: { scales: readonly ColorScale[] }) {
  return (
    <div class={MAP_CLASSES.legend}>
      <For each={props.scales}>{(scale) => (
        <div class={MAP_CLASSES.legendEntry}>
          <span class={MAP_CLASSES.legendLabel}>{scale.label}</span>
          {scale.kind === 'ramp' ? (
            <div class={MAP_CLASSES.ramp}>
              <span>{compactNumber.format(scale.min)}</span>
              <span class={MAP_CLASSES.rampBar} style={{ background: `linear-gradient(to right, ${scale.colors.map(rgbCss).join(', ')})` }} />
              <span>{compactNumber.format(scale.max)}</span>
            </div>
          ) : (
            <ul class={MAP_CLASSES.swatches}>
              <For each={scale.entries}>{(entry) => (
                <li class={MAP_CLASSES.swatch}>
                  <span class={MAP_CLASSES.dot} style={{ background: rgbCss(entry.color) }} />
                  <span class={MAP_CLASSES.swatchLabel}>{entry.value}</span>
                </li>
              )}</For>
            </ul>
          )}
        </div>
      )}</For>
    </div>
  );
}

/**
 * Draw the map into `box` (the island's figure: its class, role, label and height are the island's) and
 * return its disposer. The engine's own content is the view, the zoom/reset controls, the legend and the
 * basemap attribution, in the former order.
 */
export function mountDeckEngine(box: HTMLElement, props: DeckEngineProps): () => void {
  const leave = () => hideVegaTooltip(box.ownerDocument);
  box.addEventListener('pointerleave', leave);
  const dispose = render(() => <DeckContent box={box} {...props} />, box);
  return () => { box.removeEventListener('pointerleave', leave); dispose(); leave(); };
}

function DeckContent(props: DeckEngineProps & { box: HTMLElement }) {
  const box = props.box;
  const specs = layerSpecs(props.layers);
  const [boundaries, setBoundaries] = createSignal<Record<string, Feature[]>>({});
  for (const id of new Set(boundaryKeyOf(specs).split(',').filter(Boolean))) {
    void loadGeoFeatures(id).then((f) => setBoundaries((b) => ({ ...b, [id]: f as unknown as Feature[] }))).catch(() => {});
  }
  const palette = paletteFor(props.colorMode === 'dark');
  const built = createMemo(() => buildLayers(specs, props.rows(), boundaries(), palette));
  const scales = createMemo(() => legendScales(built(), palette));

  // ── The view: fitted to the data until the reader moves it ──────────────────
  const [width, setWidth] = createSignal(box.clientWidth);
  onMount(() => {
    const observer = new ResizeObserver(() => setWidth(box.clientWidth));
    observer.observe(box);
    onCleanup(() => observer.disconnect());
  });
  const extent = createMemo(() => extentOf(built()));
  const fitted = createMemo(() => fittedView(props.initialViewState, extent(), width(), props.height));
  const [view, setView] = createSignal<MapViewState>(fitted());
  let moved = false;
  createEffect(() => { const f = fitted(); if (!moved) setView(f); });
  // Only a reader's own gesture stops the fit; the engines also report programmatic and resize changes.
  const move = (next: MapViewState, byReader = true) => { if (byReader) moved = true; setView(next); };
  const zoomBy = (delta: number) => move({ ...view(), zoom: Math.max(0, Math.min(20, view().zoom + delta)) });
  const reset = () => { moved = false; setView(fitted()); };

  // ── The tooltip: the same card, styles and dismiss policy as the Vega charts ─
  const tooltip = props.tooltip ?? true;
  const onHover: HoverHandler = (info, event) => {
    if (tooltip === false) return;
    const record = tooltipRecord(info.object, Array.isArray(tooltip) ? tooltip : null);
    if (!record) { hideVegaTooltip(box.ownerDocument); return; }
    createVegaTooltipHandler(box, props.colorMode)(null as never, event.srcEvent as MouseEvent, null as never, record);
  };

  const wanted = basemapStyleOf(props.basemap ?? 'auto', props.colorMode);
  // Set when MapLibre finds no WebGL2: the map draws without its streets and says so where the credit was.
  const [noBasemap, setNoBasemap] = createSignal(false);
  const style = () => (noBasemap() ? null : wanted);
  const title = props.title ?? 'Map';
  const layers = () => built().map((b) => b.layer);
  return <>
    <Show when={style()} fallback={<DeckView layers={layers} view={view} move={move} onHover={onHover} />}>{(basemap) => (
      <BaseMapView style={basemap()} title={title} layers={layers} view={view} move={move} onHover={onHover} unavailable={() => setNoBasemap(true)} />
    )}</Show>
    <MapControls zoomIn={() => zoomBy(1)} zoomOut={() => zoomBy(-1)} reset={reset} />
    <Show when={(props.legend ?? true) && scales().length > 0}><MapLegend scales={scales()} /></Show>
    {wanted ? <p class={MAP_CLASSES.attribution}>{noBasemap() ? BASEMAP_UNAVAILABLE : ATTRIBUTION}</p> : null}
  </>;
}
