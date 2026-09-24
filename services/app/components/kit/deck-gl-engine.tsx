// SPIKE (M0): the lazily loaded deck.gl engine. Throwaway — measures bundle, CSP and export.
import { DeckGL } from '@deck.gl/react';
import { WebMercatorViewport, type MapViewState } from '@deck.gl/core';
import { ScatterplotLayer, ArcLayer, GeoJsonLayer, ColumnLayer, PolygonLayer } from '@deck.gl/layers';
import { HexagonLayer, HeatmapLayer, GridLayer } from '@deck.gl/aggregation-layers';
import { Map as BaseMap, useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { cellToBoundary } from 'h3-js';
// @ts-expect-error SPIKE: the CSP build ships no typings of its own.
import maplibregl from 'maplibre-gl/dist/maplibre-gl-csp';
import { loadGeoFeatures } from '@/lib/viz/geo-assets';
// MapLibre may not spawn a blob: worker under the document CSP; serve it same-origin.
maplibregl.setWorkerUrl('/basemap/worker.js');
import { useEffect, useMemo, useState } from 'react';

type Row = Record<string, unknown>;
type LayerSpec = Record<string, unknown> & { '@@type': string };

// @deck.gl/geo-layers imports loaders.gl code that compiles WebAssembly on load,
// which the document CSP refuses; H3 cells are drawn as polygons from h3-js instead.
class H3HexagonLayer extends PolygonLayer<Row> {
  static override layerName = 'H3HexagonLayer';
  constructor(props: Record<string, unknown>) {
    const getHexagon = props.getHexagon as (d: Row) => string;
    super({ ...props, getPolygon: (d: Row) => cellToBoundary(String(getHexagon(d)), true) } as never);
  }
}
const LAYERS = { ScatterplotLayer, ArcLayer, GeoJsonLayer, ColumnLayer, HexagonLayer, HeatmapLayer, GridLayer, H3HexagonLayer } as const;

// One GL context per map: deck draws INTO MapLibre's context (Chrome caps a page near 16).
function DeckOverlay({ layers }: { layers: unknown[] }) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true, layers: [] }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overlay.setProps({ layers: layers as any, getTooltip: ({ object }: { object?: Row & { properties?: Row } }) => object ? JSON.stringify(object.properties ?? object).slice(0, 200) : null });
  return null;
}

// Spike accessor: `@@=col`, `@@=[a, b]`, `@@ramp=col`, or a literal. The real one is a vetted grammar.
const field = (d: Row, c: string) => d[c] ?? (d as { properties?: Row }).properties?.[c];
const RAMP = [[239, 243, 255], [189, 215, 238], [107, 174, 214], [49, 130, 189], [8, 81, 156]];
function accessor(v: unknown, data: Row[]): unknown {
  if (typeof v !== 'string' || !v.startsWith('@@')) return v;
  if (v.startsWith('@@ramp=')) {
    const col = v.slice(7).trim();
    const vals = data.map(d => Number(field(d, col))).filter(Number.isFinite);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    return (d: Row) => {
      const n = Number(field(d, col));
      if (!Number.isFinite(n)) return [200, 200, 200, 60];
      const t = hi > lo ? (n - lo) / (hi - lo) : 0.5;
      return [...RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))]!, 210];
    };
  }
  const expr = v.slice(3).trim();
  if (expr.startsWith('[')) {
    const cols = expr.slice(1, -1).split(',').map(s => s.trim());
    return (d: Row) => cols.map(c => (/^-?\d/.test(c) ? Number(c) : Number(field(d, c))));
  }
  return (d: Row) => field(d, expr);
}

export function DeckEngine({ rows, layers, basemap, colorMode, initialViewState, height }: {
  rows: Row[]; layers: LayerSpec[]; basemap?: string; colorMode: 'light' | 'dark'; initialViewState?: MapViewState; height: number;
}) {
  const [boundaries, setBoundaries] = useState<Record<string, unknown[]>>({});
  const ids = useMemo(() => layers.map(l => l.data).filter((d): d is string => typeof d === 'string' && d.startsWith('boundary:')).map(d => d.slice(9)), [layers]);
  useEffect(() => {
    for (const id of ids) void loadGeoFeatures(id).then(f => setBoundaries(b => ({ ...b, [id]: f })));
  }, [ids]);

  const deckLayers = useMemo(() => {
    const out: unknown[] = [];
    layers.forEach((spec, i) => {
      const Ctor = LAYERS[spec['@@type'] as keyof typeof LAYERS];
      if (!Ctor) return;
      const d = spec.data;
      let data: Row[] = rows;
      if (typeof d === 'string' && d.startsWith('boundary:')) {
        const features = (boundaries[d.slice(9)] ?? []) as Array<{ properties: Row }>;
        const join = spec['@@join'] as [string, string] | undefined;
        const byKey = join ? new Map(rows.map(r => [String(r[join[1]]), r])) : null;
        data = features.map(f => ({ ...f, properties: { ...f.properties, ...(byKey?.get(String(f.properties[join![0]])) ?? {}) } }));
      }
      const props: Record<string, unknown> = { id: `l${i}`, pickable: true };
      for (const [k, v] of Object.entries(spec)) if (k !== '@@type' && k !== '@@join') props[k] = accessor(v, data);
      props.data = data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out.push(new (Ctor as any)(props));
    });
    return out;
  }, [layers, rows, boundaries]);
  const style = basemap === 'none' ? null : (basemap === 'dark' || (basemap !== 'light' && colorMode === 'dark')) ? 'dark' : 'positron';

  const viewState = useMemo<MapViewState>(() => {
    if (initialViewState) return initialViewState;
    const pts = rows.flatMap(r => [[Number(r.lng), Number(r.lat)], [Number(r.lng2), Number(r.lat2)]]).filter(p => p.every(Number.isFinite));
    if (!pts.length) return { longitude: 0, latitude: 20, zoom: 1 };
    const lngs = pts.map(p => p[0]!), lats = pts.map(p => p[1]!);
    const vp = new WebMercatorViewport({ width: 800, height });
    const { longitude, latitude, zoom } = vp.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 40 });
    return { longitude, latitude, zoom };
  }, [rows, initialViewState, height]);

  return (
    <div style={{ position: 'relative', width: '100%', height }} data-mx-deck-ready={deckLayers.length ? '' : undefined}>
      {style ? (
        <BaseMap mapLib={maplibregl} initialViewState={viewState} mapStyle={`${location.origin}/basemap/styles/${style}`} attributionControl={false}
          onError={(e: { error?: Error }) => console.error('maplibre:', e.error?.message ?? e)}
          transformRequest={(url: string) => ({ url: url.replace('https://tiles.openfreemap.org', `${location.origin}/basemap`) })}>
          <DeckOverlay layers={deckLayers} />
        </BaseMap>
      ) : (
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        <DeckGL initialViewState={viewState} controller layers={deckLayers as any} getTooltip={({ object }) => object ? JSON.stringify(object.properties ?? object).slice(0, 200) : null} />
      )}
      <div style={{ position: 'absolute', right: 4, bottom: 2, fontSize: 10, opacity: 0.7 }}>© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</div>
    </div>
  );
}
