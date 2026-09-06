import { describe, expect, it } from 'vitest';
import { parseDatasetDefinition, serializeDatasetDefinition } from '../definition';
import type { CatalogInput } from '../types';

describe('dataset markup source of truth', () => {
  const input: CatalogInput = {
    kind: 'postgres', defaultSchema: 'models', refreshSeconds: 0,
    connection: { host: 'db.example.com', port: 5432, database: 'commerce', username: 'reader', ssl: true, passwordSecretId: 'sec_test' },
    notebook: { cells: [{ id: 'paid', name: 'paid', sql: "SELECT region, total FROM sales.orders WHERE status = 'paid'" }, { id: 'revenue', name: 'revenue', sql: 'SELECT region, sum(total) AS revenue FROM paid GROUP BY region' }] },
    tables: [{ schema: 'models', name: 'revenue', modelCellId: 'revenue', columns: ['region', 'revenue'] }],
  };
  it('round trips a connection reference, hidden intermediate cell and final output whitelist', () => {
    const markup = serializeDatasetDefinition(input);
    expect(markup).toContain('<Dataset');
    expect(parseDatasetDefinition(markup)).toEqual(input);
  });
  it('rejects executable expressions and literal credentials', () => {
    expect(() => parseDatasetDefinition('<Dataset kind={process.exit()} />')).toThrow();
    expect(() => parseDatasetDefinition('<Dataset kind="postgres"><Connection password="never-store-this" /></Dataset>')).toThrow();
  });
});
