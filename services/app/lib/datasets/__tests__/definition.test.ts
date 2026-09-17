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
  it('preserves absent columns, stored rows, and arbitrary SQL string bytes',()=>{
    const stored:CatalogInput={kind:'stored',tables:[{schema:'main',name:'items',rows:[{id:1}]}]};expect(parseDatasetDefinition(serializeDatasetDefinition(stored))).toEqual(stored);
    const sql="SELECT '$value </SqlCell>' AS x, '&' AS amp\nFROM public.rows";const notebook:CatalogInput={kind:'postgres',connection:input.connection,notebook:{cells:[{id:'x',name:'x',sql}]},tables:[{schema:'models',name:'x',modelCellId:'x',columns:['x']}]};expect(parseDatasetDefinition(serializeDatasetDefinition(notebook))).toEqual(notebook);
  });
  it('rejects duplicate attributes, unknown section attributes, and nested leaf elements',()=>{
    for(const source of ['<Dataset kind="stored" kind="stored"><Table schema="x" name="x" rows={[]} /></Dataset>','<Dataset kind="stored"><Notebook surprise="x" /></Dataset>','<Dataset kind="postgres"><Connection host="x"><SqlCell /></Connection></Dataset>'])expect(()=>parseDatasetDefinition(source)).toThrow();
  });
});
