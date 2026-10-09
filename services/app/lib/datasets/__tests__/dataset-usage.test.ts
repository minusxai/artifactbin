import { describe, expect, it } from 'vitest';
import { datasetCreateFields } from '../dataset-usage';
import type { DatasetCatalog } from '@/lib/datasets/types';

const catalog: DatasetCatalog = {
  kind: 'postgres', defaultSchema: 'sales', refreshSeconds: 60,
  tables: [
    { schema: 'crm', name: 'contacts', columns: [{ name: 'email', type: 'string' }] },
    { schema: 'sales', name: 'orders', columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] },
  ],
};

describe('canonical dataset authoring hints', () => {
  it('binds the dataset ID in source and the stable default table in SQL, using that table’s columns', () => {
    const result = datasetCreateFields('abc123', [], 2, { catalog });
    expect(result.usage).toContain('<Query name="rows" source="ref:abc123">{`SELECT * FROM "sales"."orders"`}</Query>');
    expect(result.usage).toContain('"field":"revenue"');
    expect(result.usage).not.toContain('ref_abc123');
  });
  it('teaches the Import of a stored upload, read as <import>.rows', () => {
    const result = datasetCreateFields('abc123', [{ name: 'id', type: 'number' }], 2);
    expect(result.usage).toContain('<Import name="data" src="ref:abc123" /><Query name="rows">{`SELECT * FROM data."rows"`}</Query>');
    expect(result.usage).not.toMatch(/source=|public\.rows/);
    expect(result.ref).toBe('ref:abc123');
  });
  it('teaches mutations over the imported default table for writable stored catalogs', () => {
    const result = datasetCreateFields('abc123', [], 2, { catalog: { ...catalog, kind: 'stored' } }, 'readwrite');
    expect(result.usage).toContain('<Import name="data" src="ref:abc123" /><Value name="region" type="string" /><Value name="revenue" type="number" /><Mutation name="add">{`insert into data."orders" ("region", "revenue") values ($region, $revenue)`}</Mutation>');
    expect(result.usage).not.toContain('source=');
    expect(result.usage).not.toContain('ref_abc123');
  });
  it('names the push flag, and the metadata-only PATCH, for opening stored writes', () => {
    const result = datasetCreateFields('abc123', [], 0);
    // Whoever just created this dataset created it from a file: name the command that republishes it writable.
    expect(result.writes).toContain('afbin push <file> --type dataset --access readwrite');
    expect(result.writes).toContain('PATCH /api/my/artifacts/abc123');
  });
  it('never advertises writes for PostgreSQL even if legacy metadata says readwrite', () => {
    const result = datasetCreateFields('abc123', [], 2, { catalog }, 'readwrite');
    expect(result.access).toBe('read');
    expect(result.usage).not.toContain('<Mutation');
    expect(result.writes).toMatch(/PostgreSQL.*read-only/);
    expect(result.writes).toContain('Editors can manage the connection, notebook and whitelist. Viewers can query exposed data.');
    expect(result.writes).not.toContain('PATCH');
  });
});
