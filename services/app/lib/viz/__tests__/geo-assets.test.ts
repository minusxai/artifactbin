import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetFeatures, boundaryFile, GEO_ASSETS, isBoundary } from '../geo-assets';

const read = (file: string) =>
  JSON.parse(readFileSync(resolve(process.cwd(), `public/geojson/${file}.json`), 'utf8'));

describe('geo asset feature extraction', () => {
  it('converts the us-atlas TopoJSON into named state features', () => {
    const features = assetFeatures('us-states', read(GEO_ASSETS['us-states'].file));
    const names = features.map(f => (f.properties as { name: string }).name);
    expect(names).toContain('California');
    expect(names).toContain('Alaska'); // clean antimeridian geometry
    expect(names).toContain('Hawaii');
    // Every feature carries a name for the choropleth lookup.
    expect(features.every(f => typeof (f.properties as { name?: unknown })?.name === 'string')).toBe(true);
  });

  it('converts the us-atlas counties TopoJSON into named county features', () => {
    const features = assetFeatures('us-counties', read(GEO_ASSETS['us-counties'].file));
    expect(features.length).toBeGreaterThan(3000); // ~3231 counties
    expect(features.every(f => typeof (f.properties as { name?: unknown })?.name === 'string')).toBe(true);
  });

  it('converts the world-atlas TopoJSON into named country features', () => {
    const features = assetFeatures('world', read(GEO_ASSETS['world'].file));
    const names = features.map(f => (f.properties as { name: string }).name);
    expect(features.length).toBeGreaterThan(150);
    expect(names).toContain('Tanzania');
  });

  it('passes GeoJSON assets (India) through untouched', () => {
    const features = assetFeatures('india-states', read(GEO_ASSETS['india-states'].file));
    expect(features.length).toBeGreaterThan(0);
    expect(typeof (features[0].properties as { name?: unknown })?.name).toBe('string');
  });
});

describe('the <DeckGL> boundary registry', () => {
  const props = (id: string) => assetFeatures(id, read(boundaryFile(id)!)).map(f => f.properties as Record<string, unknown>);

  it('names the bundled sets, and nothing else', () => {
    expect(isBoundary('countries')).toBe(true);
    expect(isBoundary('us-states')).toBe(true);
    expect(isBoundary('admin1-de')).toBe(false); // other geography is the author's own GeoJSON
    expect(isBoundary('../secrets')).toBe(false);
  });

  it('gives countries ISO codes to join on', () => {
    const india = props('countries').find(p => p.name === 'India');
    expect(india).toMatchObject({ iso_a2: 'IN', iso_a3: 'IND' });
  });

  it('gives India\'s states ISO 3166-2 codes', () => {
    expect(props('india-states').find(p => p.name === 'Karnataka')).toMatchObject({ code: 'IN-KA', postal: 'KA' });
  });

  it('gives the US sets FIPS codes, and states their postal codes', () => {
    expect(props('us-states').find(p => p.name === 'California')).toMatchObject({ fips: '06', postal: 'CA' });
    expect(props('us-counties').every(p => typeof p.fips === 'string' && (p.fips as string).length === 5)).toBe(true);
  });
});
