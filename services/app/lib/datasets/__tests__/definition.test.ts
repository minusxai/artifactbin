import { describe, expect, it } from 'vitest';
import { parseDatasetDefinition, serializeDatasetDefinition } from '../definition';
import type { CatalogInput } from '../types';

describe('dataset markup source of truth', () => {
  const input: CatalogInput = {
    kind: 'stored', defaultSchema: 'models', refreshSeconds: 0,
    tables: [{ schema: 'models', name: 'items', rows: [{ region: 'EU', total: 3 }] }, { schema: 'models', name: 'revenue', sql: 'SELECT region, sum(total) AS revenue FROM items GROUP BY region' }],
  };
  it('round trips stored tables and SQL models', () => {
    const markup = serializeDatasetDefinition(input);
    expect(markup).toContain('<Dataset');
    expect(parseDatasetDefinition(markup)).toEqual(input);
  });
  it('rejects executable expressions and the retired connected-Postgres sections', () => {
    expect(() => parseDatasetDefinition('<Dataset kind={process.exit()} />')).toThrow();
    expect(() => parseDatasetDefinition('<Dataset kind="postgres"><Table schema="x" name="x" rows={[]} /></Dataset>')).toThrow('invalid kind');
    expect(() => parseDatasetDefinition('<Dataset kind="stored"><Connection host="x" /></Dataset>')).toThrow('unknown child');
    expect(() => parseDatasetDefinition('<Dataset kind="stored"><Notebook /></Dataset>')).toThrow('unknown child');
    expect(() => parseDatasetDefinition('<Dataset kind="stored"><Table schema="x" name="x" modelCellId="m" /></Dataset>')).toThrow('does not allow modelCellId');
  });
  it('preserves absent columns, stored rows, and arbitrary SQL string bytes',()=>{
    const stored:CatalogInput={kind:'stored',tables:[{schema:'main',name:'items',rows:[{id:1}]}]};expect(parseDatasetDefinition(serializeDatasetDefinition(stored))).toEqual(stored);
    const sql="SELECT '$value </Table>' AS x, '&' AS amp\nFROM public.rows";const model:CatalogInput={kind:'stored',tables:[{schema:'models',name:'x',sql}]};expect(parseDatasetDefinition(serializeDatasetDefinition(model))).toEqual(model);
  });
  it('rejects duplicate attributes and nested leaf elements',()=>{
    for(const source of ['<Dataset kind="stored" kind="stored"><Table schema="x" name="x" rows={[]} /></Dataset>','<Dataset kind="stored"><Table schema="x" name="x"><Table schema="y" name="y" /></Table></Dataset>'])expect(()=>parseDatasetDefinition(source)).toThrow();
  });
});
