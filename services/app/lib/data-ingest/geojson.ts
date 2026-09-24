/**
 * An author's own GeoJSON, as dataset rows. A dataset is rows, so a
 * FeatureCollection becomes one row per feature — its properties as columns, its
 * geometry as a JSON string in the `geometry` column — and is queried, joined
 * and filtered like any other rows. `<DeckGL>`'s GeoJsonLayer reads that column
 * back (lib/viz/deck-spec GEOMETRY_COLUMN). Pure: the CLI ingests with it.
 */
import { GEOMETRY_COLUMN } from '@/lib/viz/deck-spec';

type Row = Record<string, unknown>;
interface Feature { type: 'Feature'; properties: Row | null; geometry: unknown }

const isFeature = (v: unknown): v is Feature =>
  !!v && typeof v === 'object' && (v as Row).type === 'Feature' && 'geometry' in (v as Row);

/**
 * Rows for a GeoJSON FeatureCollection or Feature; null when `value` is not
 * GeoJSON, so an ordinary JSON array of rows keeps its meaning. Nested property
 * values become JSON strings: a dataset cell is a scalar.
 */
export function geoJsonRows(value: unknown): Row[] | null {
  const features = isFeature(value) ? [value]
    : value && typeof value === 'object' && (value as Row).type === 'FeatureCollection' && Array.isArray((value as Row).features)
      ? (value as { features: unknown[] }).features : null;
  if (!features) return null;
  return features.map((feature, i) => {
    if (!isFeature(feature)) throw new Error(`features[${i}] is not a GeoJSON Feature`);
    const row: Row = {};
    for (const [key, v] of Object.entries(feature.properties ?? {})) {
      if (key === GEOMETRY_COLUMN) throw new Error(`features[${i}] has a "${GEOMETRY_COLUMN}" property, which would shadow the geometry column; rename it`);
      row[key] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    }
    row[GEOMETRY_COLUMN] = JSON.stringify(feature.geometry);
    return row;
  });
}

/** The inverse, for writing a pulled dataset back to a `.geojson` file. */
export function rowsGeoJson(rows: readonly Row[]): { type: 'FeatureCollection'; features: Feature[] } {
  return {
    type: 'FeatureCollection',
    features: rows.map(({ [GEOMETRY_COLUMN]: geometry, ...properties }) => ({
      type: 'Feature',
      properties,
      geometry: typeof geometry === 'string' ? JSON.parse(geometry) : geometry ?? null,
    })),
  };
}
