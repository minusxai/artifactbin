/**
 * The `<DeckGL>` engine — the lazily loaded chunk behind components/kit/deck-gl.
 * Every layer is built from the lib/viz/deck-spec contract (allowlisted types
 * and props, interpreted accessors), never from the authored JSON directly, so
 * stored content that predates validation still cannot reach deck.gl.
 *
 * With a basemap, MapLibre draws the OpenFreeMap style and deck draws INTO its
 * GL context (interleaved): Chrome caps a page near 16 contexts, and a document
 * may hold many maps. Without one, deck draws alone.
 */
import { DeckGL } from '@deck.gl/react';
import { Map as BaseMap, useControl } from 'react-map-gl/maplibre';
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

type HoverHandler = (info: PickingInfo, event: { srcEvent: Event }) => void;
/** deck draws into MapLibre's own GL context: one context per map. */
function DeckOverlay({ layers, onHover }: { layers: unknown[]; onHover: HoverHandler }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true, layers: [] }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overlay.setProps({ layers: layers as any, onHover: onHover as never });
  return null;
}

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
        <BaseMap mapLib={maplibregl} {...view} onMove={e => move(e.viewState as MapViewState, !!e.originalEvent)} attributionControl={false}
          // MapLibre names its canvas region "Map"; a document with several maps needs each one's own name.
          locale={{ 'Map.Title': title }}
          mapStyle={basemapStyleUrl(style)} transformRequest={basemapTransformRequest}>
          <DeckOverlay layers={layerList} onHover={onHover} />
        </BaseMap>
      ) : (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <DeckGL viewState={view} controller onViewStateChange={({ viewState, interactionState }) => move(viewState as MapViewState, Object.values(interactionState ?? {}).some(Boolean))} layers={layerList as any} onHover={onHover as never} />
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
