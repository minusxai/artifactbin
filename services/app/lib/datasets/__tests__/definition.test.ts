import { describe, expect, it } from 'vitest';
import { parseDatasetDefinition, serializeDatasetDefinition } from '../definition';
import type { CatalogInput } from '../types';

describe('the dataset definition is JSON', () => {
  const input: CatalogInput = {
    kind: 'stored', defaultSchema: 'models', refreshSeconds: 0,
    tables: [{ schema: 'models', name: 'items', columns: [{ name: 'total', type: 'number' }, 'region'], rows: [{ region: 'EU', total: 3 }, { region: 'US', total: 4 }] }, { schema: 'models', name: 'revenue', sql: 'SELECT region, sum(total) AS revenue FROM items GROUP BY region' }],
  };
  it('round trips stored tables and SQL models, from the object or its JSON text', () => {
    const json = serializeDatasetDefinition(input);
    expect(JSON.parse(json)).toEqual(input);
    expect(parseDatasetDefinition(json)).toEqual(input);
    expect(parseDatasetDefinition(input)).toEqual(input);
  });
  it('stores one canonical text: fixed key order, indented, one row and one column per line', () => {
    const shuffled = { tables: input.tables.map(t => Object.fromEntries(Object.entries(t).reverse())), refreshSeconds: 0, defaultSchema: 'models', kind: 'stored' } as unknown as CatalogInput;
    expect(serializeDatasetDefinition(parseDatasetDefinition(shuffled))).toBe(serializeDatasetDefinition(input));
    expect(serializeDatasetDefinition(input)).toBe(`{
  "kind": "stored",
  "defaultSchema": "models",
  "refreshSeconds": 0,
  "tables": [
    {
      "schema": "models",
      "name": "items",
      "columns": [
        {"name":"total","type":"number"},
        "region"
      ],
      "rows": [
        {"region":"EU","total":3},
        {"region":"US","total":4}
      ]
    },
    {
      "schema": "models",
      "name": "revenue",
      "sql": "SELECT region, sum(total) AS revenue FROM items GROUP BY region"
    }
  ]
}`);
  });
  it('preserves absent columns, empty rows, and arbitrary SQL string bytes', () => {
    const stored: CatalogInput = { kind: 'stored', tables: [{ schema: 'main', name: 'items', rows: [] }, { schema: 'main', name: 'later' }] };
    expect(parseDatasetDefinition(serializeDatasetDefinition(stored))).toEqual(stored);
    const sql = "SELECT '$value </Table>' AS x, '&' AS amp, '\"' AS q\nFROM public.rows";
    const model: CatalogInput = { kind: 'stored', tables: [{ schema: 'models', name: 'x', sql }] };
    expect(parseDatasetDefinition(serializeDatasetDefinition(model))).toEqual(model);
  });
  it('refuses the retired markup and any text that is not JSON, saying the definition is JSON', () => {
    for (const source of ['<Dataset kind="stored"><Table schema="x" name="x" rows={[]} /></Dataset>', 'kind: stored', '{"kind":"stored",'])
      expect(() => parseDatasetDefinition(source)).toThrow(/the definition is JSON.*<Dataset> markup is not accepted/);
  });
  it('refuses unknown kinds, unknown keys, retired sections and missing fields', () => {
    const table = { schema: 'x', name: 'x', rows: [] };
    expect(() => parseDatasetDefinition({ kind: 'postgres', tables: [table] })).toThrow(/^kind: /);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [table], connection: { host: 'x' } })).toThrow(/connection/);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [table], notebook: { cells: [] } })).toThrow(/notebook/);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [{ ...table, modelCellId: 'm' }] })).toThrow(/tables\.0.*modelCellId/);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [{ ...table, surprise: 'y' }] })).toThrow(/surprise/);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [{ schema: 'x' }] })).toThrow(/tables\.0\.name/);
    expect(() => parseDatasetDefinition({ tables: [table] })).toThrow(/^kind: /);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [{ ...table, rows: [1] }] })).toThrow(/tables\.0\.rows\.0/);
    expect(() => parseDatasetDefinition({ kind: 'stored', tables: [{ ...table, sql: 'select 1' }] })).toThrow(/only one source/);
    expect(() => parseDatasetDefinition([table])).toThrow();
  });
});
