import { describe, expect, it } from 'vitest';
import { catalogMetadata } from '../migrate';

describe('dataset catalog migration planning', () => {
  it('wraps a stored dataset without copying bytes and is idempotent', () => {
    const meta = { objectKey: 'datasets/a.json', columns: [{ name: 'id', type: 'number' as const }], rowCount: 2, note: 'keep' };
    const next = catalogMetadata(meta);
    expect(next).toEqual({ ...meta, catalog: { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
      tables: [{ schema: 'public', name: 'rows', columns: meta.columns, objectKey: meta.objectKey }] } });
    expect(catalogMetadata(next)).toBe(next);
  });

});
