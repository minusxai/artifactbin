/**
 * The `<DeckGL>` engine — the lazily loaded chunk behind components/kit/deck-gl.
 * Every layer is built from the lib/viz/deck-spec contract (allowlisted types
 * and props, interpreted accessors), never from the authored JSON directly, so
 * stored content that predates validation still cannot reach deck.gl.
 *
 * Draws with `@deck.gl/core` and `maplibre-gl` directly — the same framework-free
 * approach as the compiled page's Solid island (lib/islands/kit/embed/deck-engine):
 * no `@deck.gl/react` or `react-map-gl` wrapper. `DeckView`/`BaseMapView` below hand-build
 * the exact DOM those libraries would have produced, so nothing downstream (styling,
 * captures) sees a different shape.
 *
 * With a basemap, MapLibre draws the OpenFreeMap style and deck draws INTO its
 * GL context (interleaved): Chrome caps a page near 16 contexts, and a document
 * may hold many maps. Without one, deck draws alone.
 */
import { Deck } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
// @ts-expect-error The CSP build ships no typings of its own; it is the default build's twin.
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadGeoFeatures } from '@/lib/viz/geo-assets';
import { basemapStyleUrl, basemapTransformRequest, BASEMAP_WORKER_URL } from '@/lib/basemap';
import { createVegaTooltipHandler, hideVegaTooltip } from '@/lib/viz/vega-tooltip-handler';
import {
  ATTRIBUTION, MAP_CLASSES, basemapStyleOf, boundaryKeyOf, buildLayers, compactNumber, extentOf, fittedView, layerSpecs, legendScales, paletteFor, rgbCss, tooltipRecord,
  type ColorScale, type Feature, type MapViewState, type PickingInfo, type Row,
} from '@/lib/viz/deck-engine-core';

// MapLibre may not spawn a blob: worker under the document CSP; it loads a same-origin script.
maplibregl.setWorkerUrl(BASEMAP_WORKER_URL);

export interface DeckEngineProps {
  rows: Row[];
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
interface ViewProps { layers: unknown[]; view: MapViewState; move: (next: MapViewState, byReader?: boolean) => void; onHover: HoverHandler }

/** deck alone: today's @deck.gl/react `DeckGL` wrapper (`#deckgl-wrapper` > `.deck-events-root` > canvas, `.deck-widgets-root`), hand-built. */
function DeckView({ layers, view, move, onHover }: ViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const deck = useRef<InstanceType<typeof Deck> | null>(null);
  const latest = useRef({ layers, view, move, onHover });
  latest.current = { layers, view, move, onHover };
  useEffect(() => {
    const d = new Deck({
      widgets: [], style: null, width: '100%', height: '100%', parent: container.current!, canvas: canvas.current!, controller: true,
      layers: latest.current.layers as never, viewState: latest.current.view,
      onViewStateChange: ({ viewState, interactionState }) => {
        latest.current.move(viewState as MapViewState, Object.values(interactionState ?? {}).some(Boolean));
        return viewState;
      },
      onHover: ((info: PickingInfo, event: { srcEvent: Event }) => latest.current.onHover(info, event)) as never,
    });
    deck.current = d;
    return () => { deck.current = null; d.finalize(); };
    // Deck is constructed once; prop updates flow through setProps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { deck.current?.setProps({ layers: layers as never, viewState: view }); }, [layers, view]);
  return (
    <div id="deckgl-wrapper" ref={container} style={{ position: 'absolute', zIndex: 0, left: 0, top: 0, width: '100%', height: '100%' }}>
      <div className="deck-events-root" style={{ width: '100%', height: '100%' }}><canvas id="deckgl-overlay" ref={canvas} style={{ left: 0, top: 0 }} /></div>
      <div className="deck-widgets-root" />
    </div>
  );
}

/** MapLibre with deck in its GL context: today's react-map-gl `Map` container (`position:relative`, then `[mapboxgl-children]`), hand-built. */
function BaseMapView({ style, title, layers, view, move, onHover }: ViewProps & { style: 'light' | 'dark'; title: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<InstanceType<typeof maplibregl.Map> | null>(null);
  const overlay = useRef<MapboxOverlay | null>(null);
  const syncing = useRef(false);
  const [mounted, setMounted] = useState(false);
  const latest = useRef({ layers, view, move, onHover });
  latest.current = { layers, view, move, onHover };
  useEffect(() => {
    const at = latest.current.view;
    const m = new maplibregl.Map({
      container: container.current!, style: basemapStyleUrl(style), center: [at.longitude, at.latitude], zoom: at.zoom, pitch: at.pitch, bearing: at.bearing,
      attributionControl: false,
      // MapLibre names its canvas region "Map"; a document with several maps needs each one's own name.
      locale: { 'Map.Title': title },
      transformRequest: basemapTransformRequest,
    });
    const ov = new MapboxOverlay({ interleaved: true, layers: [] });
    m.addControl(ov);
    m.on('move', (event: { originalEvent?: unknown }) => {
      if (syncing.current) return;
      const c = m.getCenter();
      latest.current.move({ longitude: c.lng, latitude: c.lat, zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() }, !!event.originalEvent);
    });
    map.current = m;
    overlay.current = ov;
    setMounted(true);
    return () => { map.current = null; overlay.current = null; m.remove(); };
    // A basemap style swap remounts the map (a new `style` prop is a fresh key upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);
  useEffect(() => { overlay.current?.setProps({ layers: layers as never, onHover: onHover as never }); }, [layers, onHover]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = m.getCenter();
    if (c.lng === view.longitude && c.lat === view.latitude && m.getZoom() === view.zoom && m.getPitch() === view.pitch && m.getBearing() === view.bearing) return;
    syncing.current = true;
    m.jumpTo({ center: [view.longitude, view.latitude], zoom: view.zoom, pitch: view.pitch, bearing: view.bearing });
    syncing.current = false;
  }, [view]);
  return (
    <div ref={container} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {mounted && <div {...{ 'mapboxgl-children': '' }} style={{ height: '100%' }} />}
    </div>
  );
}

export function DeckEngine({ rows, layers, basemap = 'auto', colorMode, initialViewState, tooltip = true, legend = true, title = 'Map', height }: DeckEngineProps) {
  const specs = useMemo(() => layerSpecs(layers), [layers]);
  const [boundaries, setBoundaries] = useState<Record<string, Feature[]>>({});
  const boundaryKey = boundaryKeyOf(specs);
  useEffect(() => {
    for (const id of new Set(boundaryKey.split(',').filter(Boolean))) {
      void loadGeoFeatures(id).then(f => setBoundaries(b => ({ ...b, [id]: f as unknown as Feature[] }))).catch(() => {});
    }
  }, [boundaryKey]);

  const palette = useMemo(() => paletteFor(colorMode === 'dark'), [colorMode]);
  const built = useMemo(() => buildLayers(specs, rows, boundaries, palette), [specs, rows, boundaries, palette]);
  const scales = useMemo(() => legendScales(built, palette), [built, palette]);

  // ── The view: fitted to the data until the reader moves it ──────────────────
  const box = useRef<HTMLDivElement>(null);
  const extent = useMemo(() => extentOf(built), [built]);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const fitted = useMemo<MapViewState>(() => fittedView(initialViewState, extent, width, height), [initialViewState, extent, width, height]);
  const [view, setView] = useState<MapViewState>(fitted);
  const moved = useRef(false);
  useEffect(() => { if (!moved.current) setView(fitted); }, [fitted]);
  // Only a reader's own gesture stops the fit; the engines also report programmatic and resize changes.
  const move = (next: MapViewState, byReader = true) => { if (byReader) moved.current = true; setView(next); };
  const zoomBy = (delta: number) => move({ ...view, zoom: Math.max(0, Math.min(20, view.zoom + delta)) });
  const reset = () => { moved.current = false; setView(fitted); };

  // ── The tooltip: the same card, styles and dismiss policy as the Vega charts ─
  const onHover: HoverHandler = (info, event) => {
    const container = box.current;
    if (!container || tooltip === false) return;
    const record = tooltipRecord(info.object, Array.isArray(tooltip) ? tooltip : null);
    if (!record) { hideVegaTooltip(container.ownerDocument); return; }
    createVegaTooltipHandler(container, colorMode)(null as never, event.srcEvent as MouseEvent, null as never, record);
  };
  useEffect(() => {
    const el = box.current;
    return () => { if (el) hideVegaTooltip(el.ownerDocument); };
  }, []);

  const style = basemapStyleOf(basemap, colorMode);
  const layerList = built.map(b => b.layer);
  return (
    <div ref={box} role="figure" aria-label={title} className={MAP_CLASSES.figure} style={{ height }}
      onPointerLeave={() => { if (box.current) hideVegaTooltip(box.current.ownerDocument); }}>
      {style ? (
        <BaseMapView style={style} title={title} layers={layerList} view={view} move={move} onHover={onHover} />
      ) : (
        <DeckView layers={layerList} view={view} move={move} onHover={onHover} />
      )}
      <MapControls onZoomIn={() => zoomBy(1)} onZoomOut={() => zoomBy(-1)} onReset={reset} />
      {legend && scales.length > 0 && <MapLegend scales={scales} />}
      {style && <p className={MAP_CLASSES.attribution}>{ATTRIBUTION}</p>}
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className={MAP_CLASSES.button}>
      {children}
    </button>
  );
}

/** Zoom and reset: the map's only chrome, in the document's own theme. */
function MapControls({ onZoomIn, onZoomOut, onReset }: { onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }) {
  const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, 'aria-hidden': true };
  return (
    <div className={MAP_CLASSES.controls}>
      <MapButton label="Zoom in" onClick={onZoomIn}><svg {...icon}><path d="M12 5v14M5 12h14" /></svg></MapButton>
      <MapButton label="Zoom out" onClick={onZoomOut}><svg {...icon}><path d="M5 12h14" /></svg></MapButton>
      <MapButton label="Reset view" onClick={onReset}><svg {...icon}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg></MapButton>
    </div>
  );
}


/** One entry per theme-colour scale: a gradient with its range, or swatches per category. */
function MapLegend({ scales }: { scales: readonly ColorScale[] }) {
  return (
    <div className={MAP_CLASSES.legend}>
      {scales.map(scale => (
        <div key={`${scale.kind}:${scale.label}`} className={MAP_CLASSES.legendEntry}>
          <span className={MAP_CLASSES.legendLabel}>{scale.label}</span>
          {scale.kind === 'ramp' ? (
            <div className={MAP_CLASSES.ramp}>
              <span>{compactNumber.format(scale.min)}</span>
              <span className={MAP_CLASSES.rampBar} style={{ background: `linear-gradient(to right, ${scale.colors.map(rgbCss).join(', ')})` }} />
              <span>{compactNumber.format(scale.max)}</span>
            </div>
          ) : (
            <ul className={MAP_CLASSES.swatches}>
              {scale.entries.map(entry => (
                <li key={entry.value} className={MAP_CLASSES.swatch}>
                  <span className={MAP_CLASSES.dot} style={{ background: rgbCss(entry.color) }} />
                  <span className={MAP_CLASSES.swatchLabel}>{entry.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
