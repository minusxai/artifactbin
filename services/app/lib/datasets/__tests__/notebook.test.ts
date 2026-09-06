import { describe, expect, it } from 'vitest';
import { compileNotebookSql } from '../notebook';
import { compileDatasetSql } from '../sql';
import type { DatasetCatalog, DatasetNotebook } from '../types';

const sources: DatasetCatalog = { kind: 'postgres', defaultSchema: 'sales', refreshSeconds: 0, tables: [{schema:'sales',name:'orders',source:{schema:'sales',table:'orders'},columns:[{name:'region',type:'string'},{name:'total',type:'number'},{name:'private_note',type:'string'}]}] };
const notebook: DatasetNotebook = { cells: [{id:'base',name:'base',sql:'SELECT region, total, private_note FROM sales.orders'}, {id:'result',name:'result',sql:'SELECT region, sum(total) AS revenue FROM base GROUP BY region'}] };
describe('notebook execution boundary', () => {
  it('composes earlier named cells before source whitelisting', () => {
    const out = compileNotebookSql(sources, notebook, 'result');
    expect(out.sql).toContain('orders');
    expect(out.sql).toContain('revenue');
    expect(out.values).toEqual([]);
  });
  it('exposes a model while keeping intermediate cells and physical sources inaccessible', () => {
    const catalog: DatasetCatalog = {...sources, notebook, notebookSources:[{schema:'sales',name:'orders',columns:sources.tables[0].columns}], tables:[{schema:'models',name:'revenue',modelCellId:'result',columns:[{name:'region',type:'string'},{name:'revenue',type:'number'}]}]};
    expect(compileDatasetSql(catalog, 'SELECT * FROM models.revenue').sql).toContain('orders');
    expect(() => compileDatasetSql(catalog, 'SELECT * FROM sales.orders')).toThrow();
    expect(() => compileDatasetSql(catalog, 'SELECT * FROM base')).toThrow();
  });
  it('rejects forward references and writes', () => {
    expect(() => compileNotebookSql(sources,{cells:[{id:'one',name:'one',sql:'SELECT * FROM two'},{id:'two',name:'two',sql:'SELECT * FROM sales.orders'}]},'one')).toThrow();
    expect(() => compileNotebookSql(sources,{cells:[{id:'one',name:'one',sql:'DELETE FROM sales.orders RETURNING *'}]},'one')).toThrow();
  });
});
