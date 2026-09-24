import { describe, it, expect } from 'vitest';
import { colorScales, compileAccessor, deckColumns, validateDeckMap, type DeckPalette } from '../deck-spec';

const PALETTE: DeckPalette = {
  sequential: [[0, 0, 0], [100, 100, 100], [200, 200, 200]],
  categorical: [[255, 0, 0], [0, 255, 0], [0, 0, 255]],
};
const ok = (layers: unknown, extra: Record<string, unknown> = {}) => validateDeckMap({ layers, ...extra });

describe('deck map validation', () => {
  it('accepts every shipped layer type in deck.gl\'s own JSON dialect', () => {
    expect(ok([
      { '@@type': 'ScatterplotLayer', getPosition: '@@=[lng, lat]', getRadius: '@@=value', radiusScale: 100, getFillColor: [234, 88, 12, 160] },
      { '@@type': 'ArcLayer', getSourcePosition: '@@=[lng, lat]', getTargetPosition: '@@=[lng2, lat2]', getWidth: 2 },
      { '@@type': 'GeoJsonLayer', data: 'boundary:india-states', '@@join': ['name', 'state'], getFillColor: '@@=ramp(value)', extruded: true, getElevation: '@@=value' },
      { '@@type': 'ColumnLayer', getPosition: '@@=[lng, lat]', getElevation: '@@=total', radius: 30000 },
      { '@@type': 'HexagonLayer', getPosition: '@@=[lng, lat]', radius: 20000, extruded: true },
      { '@@type': 'GridLayer', getPosition: '@@=[lng, lat]', cellSize: 25000 },
      { '@@type': 'HeatmapLayer', getPosition: '@@=[lng, lat]', getWeight: '@@=value', radiusPixels: 40 },
      { '@@type': 'H3HexagonLayer', getHexagon: '@@=h3', getFillColor: '@@=category(city)' },
    ])).toEqual([]);
  });

  it('refuses a layer type outside the allowlist, naming the shipped set', () => {
    const [error] = ok([{ '@@type': 'Tile3DLayer' }]);
    expect(error).toMatch(/Tile3DLayer/);
    expect(error).toMatch(/ScatterplotLayer/);
  });

  it('refuses a prop the layer does not allow — deck.gl fetches URLs it is handed', () => {
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@=[lng, lat]', image: 'https://evil.example/x.png' }])[0]).toMatch(/image/);
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@=[lng, lat]', loadOptions: {} }])[0]).toMatch(/loadOptions/);
  });

  it('refuses a URL, or any source but the bound query or a bundled boundary', () => {
    expect(ok([{ '@@type': 'GeoJsonLayer', data: 'https://evil.example/x.geojson' }])[0]).toMatch(/data/);
    expect(ok([{ '@@type': 'GeoJsonLayer', data: 'ref:abc123' }])[0]).toMatch(/data/);
    expect(ok([{ '@@type': 'GeoJsonLayer', data: 'boundary:atlantis' }])[0]).toMatch(/atlantis/);
  });

  it('draws an author\'s own GeoJSON from the bound query\'s geometry column', () => {
    expect(ok([{ '@@type': 'GeoJsonLayer', getFillColor: '@@=ramp(value)' }])).toEqual([]);
  });

  it('refuses @@join off a boundary layer, and a malformed one', () => {
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@=[lng, lat]', '@@join': ['name', 'state'] }])[0]).toMatch(/@@join/);
    expect(ok([{ '@@type': 'GeoJsonLayer', data: 'boundary:world', '@@join': 'name' }])[0]).toMatch(/@@join/);
  });

  it('refuses executable accessor forms and unknown functions', () => {
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@function(d) { return [d.lng, d.lat] }' }])[0]).toMatch(/getPosition/);
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@=fetch(url)' }])[0]).toMatch(/fetch/);
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@=constructor.constructor' }])[0]).toMatch(/getPosition/);
  });

  it('allows the theme colour functions only in colour accessors', () => {
    expect(ok([{ '@@type': 'ScatterplotLayer', getPosition: '@@=[lng, lat]', getRadius: '@@=ramp(value)' }])[0]).toMatch(/ramp/);
  });

  it('refuses an accessor expression in a prop that is not an accessor', () => {
    expect(ok([{ '@@type': 'HexagonLayer', getPosition: '@@=[lng, lat]', radius: '@@=value' }])[0]).toMatch(/radius/);
  });

  it('checks the component props: basemap, view state and layers', () => {
    expect(ok([], { basemap: 'satellite' })[0]).toMatch(/basemap/);
    expect(ok([], { initialViewState: { longitude: 0, latitude: 0, zoom: 'far' } })[0]).toMatch(/zoom/);
    expect(validateDeckMap({ layers: 'ScatterplotLayer' })[0]).toMatch(/layers/);
    expect(ok([], { basemap: 'none', initialViewState: { longitude: 77, latitude: 12, zoom: 9, pitch: 40, bearing: -10 } })).toEqual([]);
    expect(ok([], { tooltip: ['city', 'value'] })).toEqual([]);
    expect(ok([], { tooltip: false })).toEqual([]);
    expect(ok([], { tooltip: '{city}' })[0]).toMatch(/tooltip/);
  });
});

describe('deck accessors', () => {
  const row = { lng: 77.5, lat: 12.9, value: 40, city: 'Pune', flag: true };

  it('reads columns, arrays, arithmetic, comparisons and ternaries', () => {
    expect(compileAccessor('[lng, lat]', [row], PALETTE)(row)).toEqual([77.5, 12.9]);
    expect(compileAccessor('value * 2 + 1', [row], PALETTE)(row)).toBe(81);
    expect(compileAccessor('value > 30 ? [255, 0, 0] : [0, 0, 255]', [row], PALETTE)(row)).toEqual([255, 0, 0]);
    expect(compileAccessor("city == 'Pune' && flag", [row], PALETTE)(row)).toBe(true);
    expect(compileAccessor('sqrt(value) * -1', [row], PALETTE)(row)).toBeCloseTo(-Math.sqrt(40));
  });

  it('reads a GeoJSON feature\'s properties as columns', () => {
    const feature = { type: 'Feature', properties: { value: 7 } };
    expect(compileAccessor('value', [feature], PALETTE)(feature)).toBe(7);
  });

  it('maps ramp() over the column\'s domain and category() over its distinct values', () => {
    const rows = [{ v: 0, c: 'a' }, { v: 5, c: 'b' }, { v: 10, c: 'a' }];
    const ramp = compileAccessor('ramp(v)', rows, PALETTE);
    expect(ramp(rows[0]!)).toEqual([0, 0, 0, 255]);
    expect(ramp(rows[2]!)).toEqual([200, 200, 200, 255]);
    const category = compileAccessor('category(c)', rows, PALETTE);
    expect(category(rows[0]!)).toEqual([255, 0, 0, 255]);
    expect(category(rows[1]!)).toEqual([0, 255, 0, 255]);
    expect(category(rows[2]!)).toEqual(category(rows[0]!));
  });

  it('never reaches the prototype chain', () => {
    expect(compileAccessor('constructor', [row], PALETTE)(row)).toBeUndefined();
    expect(compileAccessor('__proto__', [row], PALETTE)(row)).toBeUndefined();
  });
});

describe('deck columns (author GeoJSON)', () => {
  it('requires a geometry column when a GeoJsonLayer draws the query rows', () => {
    expect(deckColumns([{ '@@type': 'GeoJsonLayer', getFillColor: '@@=ramp(value)' }]).sort()).toEqual(['geometry', 'value']);
  });
});

describe('deck columns', () => {
  it('lists the query columns the row layers read, and none from boundary layers', () => {
    expect(deckColumns([
      { '@@type': 'ArcLayer', getSourcePosition: '@@=[lng, lat]', getTargetPosition: '@@=[lng2, lat2]', getSourceColor: '@@=category(city)' },
      { '@@type': 'GeoJsonLayer', data: 'boundary:world', '@@join': ['name', 'country'], getFillColor: '@@=ramp(gdp)' },
    ]).sort()).toEqual(['city', 'country', 'lat', 'lat2', 'lng', 'lng2']);
  });
});

describe('deck legends', () => {
  const rows = [{ v: 0, c: 'a' }, { v: 5, c: 'b' }, { v: 10, c: 'a' }];
  it('describes a ramp by its column, range and colour steps', () => {
    expect(colorScales('ramp(v)', rows, PALETTE)).toEqual([{ kind: 'ramp', label: 'v', min: 0, max: 10, colors: PALETTE.sequential }]);
  });
  it('describes a category by its values in first-seen order, with their colours', () => {
    expect(colorScales('category(c)', rows, PALETTE)).toEqual([{ kind: 'category', label: 'c', entries: [{ value: 'a', color: [255, 0, 0] }, { value: 'b', color: [0, 255, 0] }] }]);
  });
  it('has nothing to say about a literal or a plain column', () => {
    expect(colorScales('[1, 2, 3]', rows, PALETTE)).toEqual([]);
  });
  it('accepts legend and title as component props', () => {
    expect(validateDeckMap({ layers: [], legend: false, title: 'Stores by region' })).toEqual([]);
    expect(validateDeckMap({ layers: [], legend: 'yes' })[0]).toMatch(/legend/);
  });
});
