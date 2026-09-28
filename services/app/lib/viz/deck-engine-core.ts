/**
 * THE `<DeckGL>` ENGINE'S FRAMEWORK-FREE HALF: everything the map draws that is not a view. Every layer
 * is built from the lib/viz/deck-spec contract (allowlisted types and props, interpreted accessors),
 * never from the authored JSON directly. Two views draw it: today's React engine
 * (components/kit/deck-gl-engine) and the compiled page's Solid island (lib/islands/kit/embed), so a
 * map is the same map on either reader.
 *
 * Browser-only (deck.gl and h3-js): imported by the lazily loaded engines, never by a first paint.
 */
import { WebMercatorViewport, type MapViewState, type PickingInfo } from '@deck.gl/core';
import { ScatterplotLayer, ArcLayer, GeoJsonLayer, ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import { HexagonLayer, HeatmapLayer, GridLayer } from '@deck.gl/aggregation-layers';
import { cellToBoundary, cellToLatLng, isValidCell } from 'h3-js';
import { colorScales, compileAccessor, layerBoundary, GEOMETRY_COLUMN, DECK_LAYERS, type ColorScale, type DeckPalette } from '@/lib/viz/deck-spec';
import { COLOR_PALETTE } from '@/lib/chart/chart-theme';

export type Row = Record<string, unknown>;
type Rgb = [number, number, number];
export type Feature = { type: 'Feature'; properties: Row; geometry: unknown };
export interface Built { spec: Row; data: readonly unknown[]; accessors: Row; layer: unknown }
export type { ColorScale, MapViewState, PickingInfo };
export { ATTRIBUTION, MAP_CLASSES } from './deck-chrome';

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
export const LAYER_CLASSES: Record<keyof typeof DECK_LAYERS, new (props: any) => unknown> = {
  ScatterplotLayer, ArcLayer, GeoJsonLayer, ColumnLayer, HexagonLayer, HeatmapLayer, GridLayer, H3HexagonLayer,
};
const POSITION_PROPS = ['getPosition', 'getSourcePosition', 'getTargetPosition'];

const hexRgb = (hex: string): Rgb => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => a.map((v, i) => Math.round(v + (b[i]! - v) * t)) as Rgb;
/** The chart palette for category(), and a ramp from the surface towards the chart blue for ramp(). */
export function paletteFor(dark: boolean): DeckPalette {
  const low: Rgb = dark ? [30, 41, 59] : [226, 236, 246];
  const high = hexRgb(COLOR_PALETTE[1]!);
  return { sequential: Array.from({ length: 7 }, (_, i) => mix(low, high, i / 6)), categorical: COLOR_PALETTE.map(hexRgb) };
}

/** Query rows that carry an author's GeoJSON, as features: the geometry column parsed, the rest as properties. */
export function rowsAsFeatures(rows: readonly Row[]): Feature[] {
  return rows.flatMap(({ [GEOMETRY_COLUMN]: geometry, ...properties }) => {
    try {
      const parsed = typeof geometry === 'string' ? JSON.parse(geometry) : geometry;
      return parsed && typeof parsed === 'object' ? [{ type: 'Feature' as const, properties, geometry: parsed }] : [];
    } catch { return []; }
  });
}

/** The authored layer specs deck can draw (allowlisted types only). */
export function layerSpecs(layers: unknown): Row[] {
  return (Array.isArray(layers) ? layers : []).filter((l): l is Row => !!l && typeof l === 'object' && String((l as Row)['@@type']) in LAYER_CLASSES);
}

/** The boundary sets the specs join to (`boundary:<id>`), as one stable key. */
export const boundaryKeyOf = (specs: readonly Row[]): string => specs.map(layerBoundary).filter(Boolean).join(',');

/** Each spec as a deck layer over its data: rows, a boundary's features (joined to rows), or rows as GeoJSON features. */
export function buildLayers(specs: readonly Row[], rows: readonly Row[], boundaries: Readonly<Record<string, Feature[]>>, palette: DeckPalette): Built[] {
  return specs.flatMap((spec, i) => {
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
  });
}

/** The legend: one entry per distinct ramp()/category() the colour accessors use. */
export function legendScales(built: readonly Built[], palette: DeckPalette): ColorScale[] {
  const seen = new Map<string, ColorScale>();
  for (const { spec, data } of built) for (const [key, value] of Object.entries(spec)) {
    if (!key.startsWith('get') || !key.endsWith('Color') || typeof value !== 'string' || !value.startsWith('@@=')) continue;
    try { for (const scale of colorScales(value.slice(3), data, palette)) seen.set(`${scale.kind}:${scale.label}`, scale); } catch { /* validation reports it */ }
  }
  return [...seen.values()];
}

/** Every [lng, lat] the built layers draw — the extent the view fits to. */
export function extentOf(layers: readonly Built[]): [[number, number], [number, number]] | null {
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

export const WORLD: MapViewState = { longitude: 0, latitude: 20, zoom: 1, pitch: 0, bearing: 0 };

/** The view fitted to the data (or the author's own), for a box of this size. */
export function fittedView(initialViewState: Partial<MapViewState> | undefined, extent: ReturnType<typeof extentOf>, width: number, height: number): MapViewState {
  if (initialViewState) return { ...WORLD, ...initialViewState };
  if (!extent || !width) return WORLD;
  const [[x0, y0], [x1, y1]] = extent;
  const padding = Math.max(8, Math.min(40, width / 10, height / 10));
  const { longitude, latitude, zoom } = new WebMercatorViewport({ width, height }).fitBounds(
    [[x0, y0], [x1 === x0 ? x0 + 0.01 : x1, y1 === y0 ? y0 + 0.01 : y1]], { padding });
  return { longitude, latitude, zoom: Math.min(zoom, 14), pitch: 0, bearing: 0 };
}

/** The tooltip record for a picked object: a feature's properties, a bin's count, or the row itself. */
export function tooltipRecord(object: unknown, columns: readonly string[] | null): Row | null {
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

/** Which basemap style a map draws: none, or the light/dark one (auto follows the document). */
export const basemapStyleOf = (basemap: string, colorMode: 'light' | 'dark'): 'light' | 'dark' | null =>
  basemap === 'none' ? null : basemap === 'light' ? 'light' : basemap === 'dark' ? 'dark' : colorMode;

/** The legend's compact number format and colour swatch. */
export const compactNumber = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
export const rgbCss = (c: readonly number[]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
