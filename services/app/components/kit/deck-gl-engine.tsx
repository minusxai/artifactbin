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
import { WebMercatorViewport, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { ScatterplotLayer, ArcLayer, GeoJsonLayer, ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import { HexagonLayer, HeatmapLayer, GridLayer } from '@deck.gl/aggregation-layers';
import { Map as BaseMap, useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { cellToBoundary, cellToLatLng, isValidCell } from 'h3-js';
// @ts-expect-error The CSP build ships no typings of its own; it is the default build's twin.
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { colorScales, compileAccessor, layerBoundary, GEOMETRY_COLUMN, DECK_LAYERS, type ColorScale, type DeckPalette } from '@/lib/viz/deck-spec';
import { loadGeoFeatures } from '@/lib/viz/geo-assets';
import { basemapStyleUrl, basemapTransformRequest, BASEMAP_WORKER_URL } from '@/lib/basemap';
import { createVegaTooltipHandler, hideVegaTooltip } from '@/lib/viz/vega-tooltip-handler';
import { COLOR_PALETTE } from '@/lib/chart/chart-theme';

// MapLibre may not spawn a blob: worker under the document CSP; it loads a same-origin script.
maplibregl.setWorkerUrl(BASEMAP_WORKER_URL);

type Row = Record<string, unknown>;
type Rgb = [number, number, number];
type Feature = { type: 'Feature'; properties: Row; geometry: unknown };
interface Built { spec: Row; data: readonly unknown[]; accessors: Row; layer: unknown }

// H3 cells drawn from h3-js: @deck.gl/geo-layers imports loaders.gl code that
// compiles WebAssembly on load, which the document CSP refuses.
class H3HexagonLayer extends PolygonLayer<Row> {
  static override layerName = 'H3HexagonLayer';
  constructor(props: Record<string, unknown>) {
    const getHexagon = props.getHexagon as (d: Row) => unknown;
    super({ ...props, getPolygon: (d: Row) => cellToBoundary(String(getHexagon(d)), true) } as never);
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LAYER_CLASSES: Record<keyof typeof DECK_LAYERS, new (props: any) => unknown> = {
  ScatterplotLayer, ArcLayer, GeoJsonLayer, ColumnLayer, HexagonLayer, HeatmapLayer, GridLayer, H3HexagonLayer,
};
const POSITION_PROPS = ['getPosition', 'getSourcePosition', 'getTargetPosition'];

const hexRgb = (hex: string): Rgb => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as Rgb;
/** The chart palette for category(), and a ramp from the surface towards the chart blue for ramp(). */
function paletteFor(dark: boolean): DeckPalette {
  const low: Rgb = dark ? [30, 41, 59] : [226, 236, 246];
  const high = hexRgb(COLOR_PALETTE[1]!);
  return { sequential: Array.from({ length: 7 }, (_, i) => mix(low, high, i / 6)), categorical: COLOR_PALETTE.map(hexRgb) };
}

/** Query rows that carry an author's GeoJSON, as features: the geometry column parsed, the rest as properties. */
function rowsAsFeatures(rows: readonly Row[]): Feature[] {
  return rows.flatMap(({ [GEOMETRY_COLUMN]: geometry, ...properties }) => {
    try {
      const parsed = typeof geometry === 'string' ? JSON.parse(geometry) : geometry;
      return parsed && typeof parsed === 'object' ? [{ type: 'Feature' as const, properties, geometry: parsed }] : [];
    } catch { return []; }
  });
}

/** Every [lng, lat] the built layers draw — the extent the view fits to. */
function extentOf(layers: readonly Built[]): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: unknown, y: unknown) => {
    const lng = Number(x), lat = Number(y);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
    minX = Math.min(minX, lng); maxX = Math.max(maxX, lng); minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
  };
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') add(c[0], c[1]);
    else for (const x of c) walk(x);
  };
  for (const { spec, data, accessors } of layers) {
    if (spec['@@type'] === 'GeoJsonLayer') { for (const f of data as Feature[]) walk((f.geometry as { coordinates?: unknown } | null)?.coordinates); continue; }
    const getHexagon = accessors.getHexagon;
    if (typeof getHexagon === 'function') {
      for (const d of data) { const h = String(getHexagon(d)); if (isValidCell(h)) { const [lat, lng] = cellToLatLng(h); add(lng, lat); } }
      continue;
    }
    for (const prop of POSITION_PROPS) {
      const get = accessors[prop];
      if (typeof get === 'function') for (const d of data) walk(get(d));
    }
  }
  return Number.isFinite(minX) ? [[minX, minY], [maxX, maxY]] : null;
}

type HoverHandler = (info: PickingInfo, event: { srcEvent: Event }) => void;
/** deck draws into MapLibre's own GL context: one context per map. */
function DeckOverlay({ layers, onHover }: { layers: unknown[]; onHover: HoverHandler }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true, layers: [] }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overlay.setProps({ layers: layers as any, onHover: onHover as never });
  return null;
}

/** The tooltip record for a picked object: a feature's properties, a bin's count, or the row itself. */
function tooltipRecord(object: unknown, columns: readonly string[] | null): Row | null {
  if (!object || typeof object !== 'object') return null;
  const o = object as Row;
  const source: Row = o.properties && typeof o.properties === 'object' ? o.properties as Row
    : 'count' in o && 'position' in o ? { count: o.count, ...(o.colorValue !== undefined && o.colorValue !== o.count ? { value: o.colorValue } : {}) }
      : o;
  const keys = columns ?? Object.keys(source).filter(k => k !== GEOMETRY_COLUMN && k !== 'position').slice(0, 8);
  const out: Row = {};
  for (const k of keys) if (source[k] !== undefined && source[k] !== null) out[k] = source[k];
  return Object.keys(out).length ? out : null;
}

const WORLD: MapViewState = { longitude: 0, latitude: 20, zoom: 1, pitch: 0, bearing: 0 };

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
  const specs = useMemo(() => (Array.isArray(layers) ? layers : [])
    .filter((l): l is Row => !!l && typeof l === 'object' && String((l as Row)['@@type']) in LAYER_CLASSES), [layers]);
  const [boundaries, setBoundaries] = useState<Record<string, Feature[]>>({});
  const boundaryKey = specs.map(layerBoundary).filter(Boolean).join(',');
  useEffect(() => {
    for (const id of new Set(boundaryKey.split(',').filter(Boolean))) {
      void loadGeoFeatures(id).then(f => setBoundaries(b => ({ ...b, [id]: f as unknown as Feature[] }))).catch(() => {});
    }
  }, [boundaryKey]);

  const palette = useMemo(() => paletteFor(colorMode === 'dark'), [colorMode]);
  const built = useMemo<Built[]>(() => specs.flatMap((spec, i) => {
    const boundary = layerBoundary(spec);
    let data: readonly unknown[] = rows;
    if (boundary !== null) {
      const features = boundaries[boundary];
      if (!features) return [];
      const join = spec['@@join'] as [string, string] | undefined;
      const byKey = join ? new Map(rows.map(r => [String(r[join[1]]), r])) : null;
      data = join ? features.map(f => ({ ...f, properties: { ...f.properties, ...(byKey!.get(String(f.properties?.[join[0]])) ?? {}) } })) : features;
    } else if (spec['@@type'] === 'GeoJsonLayer') data = rowsAsFeatures(rows);
    const accessors: Row = {};
    const props: Row = { id: `layer-${i}`, pickable: spec['@@type'] !== 'HeatmapLayer', data };
    for (const [key, value] of Object.entries(spec)) {
      if (key === '@@type' || key === '@@join' || key === 'data') continue;
      if (typeof value === 'string' && value.startsWith('@@')) {
        if (!value.startsWith('@@=')) return [];
        try { props[key] = accessors[key] = compileAccessor(value.slice(3), data, palette); } catch { return []; }
      } else props[key] = value;
    }
    return [{ spec, data, accessors, layer: new LAYER_CLASSES[spec['@@type'] as keyof typeof LAYER_CLASSES](props) }];
  }), [specs, rows, boundaries, palette]);

  // ── The legend: one entry per distinct ramp()/category() the colour accessors use ─
  const scales = useMemo(() => {
    const seen = new Map<string, ColorScale>();
    for (const { spec, data } of built) for (const [key, value] of Object.entries(spec)) {
      if (!key.startsWith('get') || !key.endsWith('Color') || typeof value !== 'string' || !value.startsWith('@@=')) continue;
      try { for (const scale of colorScales(value.slice(3), data, palette)) seen.set(`${scale.kind}:${scale.label}`, scale); } catch { /* validation reports it */ }
    }
    return [...seen.values()];
  }, [built, palette]);

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
  const fitted = useMemo<MapViewState>(() => {
    if (initialViewState) return { ...WORLD, ...initialViewState };
    if (!extent || !width) return WORLD;
    const [[x0, y0], [x1, y1]] = extent;
    const padding = Math.max(8, Math.min(40, width / 10, height / 10));
    const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(
      [[x0, y0], [x1 === x0 ? x0 + 0.01 : x1, y1 === y0 ? y0 + 0.01 : y1]], { padding });
    return { longitude, latitude, zoom: Math.min(zoom, 14), pitch: 0, bearing: 0 };
  }, [initialViewState, extent, width, height]);
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

  const style = basemap === 'none' ? null : basemap === 'light' ? 'light' : basemap === 'dark' ? 'dark' : colorMode;
  const layerList = built.map(b => b.layer);
  return (
    <div ref={box} role="figure" aria-label={title} className="relative w-full overflow-hidden rounded-md" style={{ height }}
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
      {style && <p className="pointer-events-none absolute bottom-1 right-2 m-0 text-[10px] leading-none text-muted-foreground">© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</p>}
    </div>
  );
}

function MapButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick}
      className="flex h-7 w-7 cursor-pointer items-center justify-center border-0 bg-background p-0 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
      {children}
    </button>
  );
}

/** Zoom and reset: the map's only chrome, in the document's own theme. */
function MapControls({ onZoomIn, onZoomOut, onReset }: { onZoomIn: () => void; onZoomOut: () => void; onReset: () => void }) {
  const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, 'aria-hidden': true };
  return (
    <div className="absolute right-2 top-2 flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border shadow-sm">
      <MapButton label="Zoom in" onClick={onZoomIn}><svg {...icon}><path d="M12 5v14M5 12h14" /></svg></MapButton>
      <MapButton label="Zoom out" onClick={onZoomOut}><svg {...icon}><path d="M5 12h14" /></svg></MapButton>
      <MapButton label="Reset view" onClick={onReset}><svg {...icon}><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg></MapButton>
    </div>
  );
}

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const css = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** One entry per theme-colour scale: a gradient with its range, or swatches per category. */
function MapLegend({ scales }: { scales: readonly ColorScale[] }) {
  return (
    <div className="absolute bottom-5 left-2 flex max-w-[45%] flex-col gap-2 rounded-md border border-border bg-background/90 px-2 py-1.5 text-[11px] leading-tight text-foreground shadow-sm">
      {scales.map(scale => (
        <div key={`${scale.kind}:${scale.label}`} className="flex flex-col gap-1">
          <span className="font-medium text-muted-foreground">{scale.label}</span>
          {scale.kind === 'ramp' ? (
            <div className="flex items-center gap-1.5">
              <span>{compact.format(scale.min)}</span>
              <span className="h-2 w-24 rounded-sm" style={{ background: `linear-gradient(to right, ${scale.colors.map(css).join(', ')})` }} />
              <span>{compact.format(scale.max)}</span>
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-x-2 gap-y-0.5 p-0">
              {scale.entries.map(entry => (
                <li key={entry.value} className="flex items-center gap-1">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: css(entry.color) }} />
                  <span className="truncate">{entry.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
