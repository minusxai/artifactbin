import { describe, expect, it } from 'vitest';
import { datasetCreateFields } from '../dataset-usage';
import type { DatasetCatalog } from '@/lib/datasets/types';

const catalog: DatasetCatalog = {
  kind: 'postgres', connectionId: 'owner-connection', defaultSchema: 'sales', refreshSeconds: 60,
  tables: [
    { schema: 'crm', name: 'contacts', columns: [{ name: 'email', type: 'string' }] },
    { schema: 'sales', name: 'orders', columns: [{ name: 'region', type: 'string' }, { name: 'revenue', type: 'number' }] },
  ],
};

describe('canonical dataset authoring hints', () => {
  it('binds the dataset ID in source and the stable default table in SQL, using that table’s columns', () => {
    const result = datasetCreateFields('abc123', [], 2, { catalog });
    expect(result.usage).toContain('<Query name="rows" source="abc123">{`SELECT * FROM "sales"."orders"`}</Query>');
    expect(result.usage).toContain('"field":"revenue"');
    expect(result.usage).not.toContain('ref_abc123');
  });
  it('teaches the normalized public.rows source syntax for legacy row uploads', () => {
    const result = datasetCreateFields('abc123', [{ name: 'id', type: 'number' }], 2);
    expect(result.usage).toContain('<Query name="rows" source="abc123">{`SELECT * FROM "public"."rows"`}</Query>');
    expect(result.ref).toBe('ref:abc123'); // compatibility field stays on the wire
  });
  it('teaches sourced mutations for writable stored catalogs', () => {
    const result = datasetCreateFields('abc123', [], 2, { catalog: { ...catalog, kind: 'stored', connectionId: undefined } }, 'readwrite');
    expect(result.usage).toContain('<Mutation name="add" source="abc123">{`insert into "sales"."orders"');
    expect(result.usage).not.toContain('ref_abc123');
  });
  it('never advertises writes for PostgreSQL even if legacy metadata says readwrite', () => {
    const result = datasetCreateFields('abc123', [], 2, { catalog }, 'readwrite');
    expect(result.access).toBe('read');
    expect(result.usage).not.toContain('<Mutation');
    expect(result.writes).toMatch(/PostgreSQL.*read-only/);
    expect(result.writes).not.toContain('PATCH');
  });
});
