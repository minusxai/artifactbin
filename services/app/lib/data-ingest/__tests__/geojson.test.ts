import { describe, expect, it } from 'vitest';
import { geoJsonRows, rowsGeoJson } from '../geojson';

const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const collection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { zone: 'North', code: 7, tags: ['a'] }, geometry: square },
    { type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [2, 3] } },
  ],
};

describe('GeoJSON as dataset rows', () => {
  it('makes one row per feature: its properties as columns plus a geometry column', () => {
    expect(geoJsonRows(collection)).toEqual([
      { zone: 'North', code: 7, tags: '["a"]', geometry: JSON.stringify(square) },
      { geometry: JSON.stringify({ type: 'Point', coordinates: [2, 3] }) },
    ]);
  });
  it('accepts a single Feature', () => {
    expect(geoJsonRows(collection.features[0])).toHaveLength(1);
  });
  it('is null for anything that is not GeoJSON, so plain JSON rows keep their meaning', () => {
    expect(geoJsonRows([{ a: 1 }])).toBeNull();
    expect(geoJsonRows({ type: 'Topology' })).toBeNull();
  });
  it('refuses a property that would shadow the geometry column', () => {
    expect(() => geoJsonRows({ type: 'Feature', properties: { geometry: 'x' }, geometry: square })).toThrow(/geometry/);
  });
  it('round-trips rows back into a FeatureCollection for pull', () => {
    const back = rowsGeoJson(geoJsonRows(collection)!);
    expect(back.type).toBe('FeatureCollection');
    expect(back.features[0]).toEqual({ type: 'Feature', properties: { zone: 'North', code: 7, tags: '["a"]' }, geometry: square });
  });
});
