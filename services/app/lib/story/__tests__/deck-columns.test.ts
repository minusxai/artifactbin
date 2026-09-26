import { describe, expect, it } from 'vitest';
import { checkDocumentData } from '../data-checks';
import type { DatasetColumn } from '../dataset-shape';
import type { RefLoader } from '../refs';

const DS = 'abc123';
const columns: DatasetColumn[] = [
  { name: 'city', type: 'string' },
  { name: 'lat', type: 'number' },
  { name: 'lng', type: 'number' },
];
const load: RefLoader = async (id) => (id === DS ? { id: DS, format: 'dataset', columns } : null);
const doc = (layers: string) =>
  '<Helmet>' +
  `<Import name="points_data" src="ref:${DS}" /><Query name="points">{\`select city, lat, lng from points_data.rows\`}</Query>` +
  '</Helmet>' +
  `<DeckGL data="$points" layers={${layers}} />`;

describe('a <DeckGL> is checked against its query\'s columns at publish', () => {
  it('accepts accessors over columns the query returns', async () => {
    const r = await checkDocumentData(doc('[{"@@type":"ScatterplotLayer","getPosition":"@@=[lng, lat]","getFillColor":"@@=category(city)"}]'), load);
    expect(r.ok).toBe(true);
  });
  it('names a column the query does not return', async () => {
    const r = await checkDocumentData(doc('[{"@@type":"ScatterplotLayer","getPosition":"@@=[lon, lat]"}]'), load);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details.join('\n')).toMatch(/\$points.*"lon"/);
  });
  it('asks for a geometry column when a GeoJsonLayer draws the query rows', async () => {
    const r = await checkDocumentData(doc('[{"@@type":"GeoJsonLayer"}]'), load);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.details.join('\n')).toMatch(/geometry/);
  });
});
