import { describe, expect, it } from 'vitest';
import { compileNotebookSql } from '../notebook';
import { compileDatasetSql } from '../sql';
import type { DatasetCatalog, DatasetNotebook } from '../types';

const sources: DatasetCatalog = { kind: 'postgres', defaultSchema: 'sales', refreshSeconds: 0, tables: [{schema:'sales',name:'orders',source:{schema:'sales',table:'orders'},columns:[{name:'region',type:'string'},{name:'total',type:'number'},{name:'private_note',type:'string'}]}] };
const notebook: DatasetNotebook = { cells: [{id:'base',name:'base',sql:'SELECT region, total, private_note FROM sales.orders'}, {id:'filtered',name:'filtered',sql:"SELECT * FROM base WHERE private_note = 'allowed'"}, {id:'result',name:'result',sql:'SELECT region, sum(total) AS revenue FROM filtered GROUP BY region'}] };
const catalog: DatasetCatalog = {...sources, defaultSchema:'models', notebook, notebookSources:[{schema:'sales',name:'orders',columns:sources.tables[0].columns}], tables:[{schema:'models',name:'revenue',modelCellId:'result',columns:[{name:'region',type:'string'},{name:'revenue',type:'number'}]}]};
const one = (sql: string): DatasetNotebook => ({ cells: [{ id: 'one', name: 'one', sql }] });

describe('notebook execution boundary', () => {
  it('composes earlier named cells before source whitelisting', () => {
    const out = compileNotebookSql(sources, notebook, 'result');
    expect(out.sql).toContain('orders');
    expect(out.sql).toContain('revenue');
    expect(out.values).toEqual([]);
  });
  it('exposes a model while keeping intermediate cells and physical sources inaccessible', () => {
    expect(compileDatasetSql(catalog, 'SELECT * FROM models.revenue').sql).toContain('orders');
    for (const relation of ['sales.orders', 'base', 'filtered', 'result']) {
      expect(() => compileDatasetSql(catalog, `SELECT * FROM ${relation}`)).toThrow('relation is not in the catalog');
    }
  });
  it('preserves runtime typed parameter positions without binding notebook literals', () => {
    const out = compileDatasetSql(catalog, 'SELECT * FROM models.revenue WHERE $region IS NULL OR region = $region', { region: null }, { region: 'string' });
    expect(out.values).toEqual([null]);
    expect(out.sql).toContain('pg_catalog');
    expect(out.sql.match(/\$1/g)).toHaveLength(2);
  });
  it.each([
    ['SELECT * FROM two', 'later'], ['SELECT * FROM one', 'earlier'],
    ['SELECT * FROM missing', 'relation is not in the catalog'],
    ['DELETE FROM sales.orders RETURNING *', 'only read statements'],
    ['SELECT pg_sleep(1)', 'function is not allowed'],
    ['SELECT * FROM pg_catalog.pg_class', 'system schemas'],
    ['SELECT * FROM information_schema.tables', 'system schemas'],
    ['SELECT total::regclass FROM sales.orders', 'cast type'],
    ['SELECT * FROM sales.orders FOR UPDATE', 'locking'],
    ['WITH bad AS (DELETE FROM sales.orders RETURNING *) SELECT * FROM bad', 'only read statements'],
    ['SELECT * FROM sales.orders; SELECT 1', 'exactly one'],
    ['SELECT $region', 'notebook parameters'],
  ])('rejects unsafe cell SQL: %s', (sql, error) => {
    expect(() => compileNotebookSql(sources, { cells: [...one(sql).cells, { id:'two', name:'two', sql:'SELECT * FROM one' }] }, 'one')).toThrow(error);
  });
  it('rejects duplicate ids/names, missing target and invalid SQL identifiers', () => {
    const cell = one('SELECT 1').cells[0];
    expect(() => compileNotebookSql(sources, {cells:[cell, {...cell,name:'two'}]}, 'one')).toThrow('duplicate');
    expect(() => compileNotebookSql(sources, {cells:[cell, {...cell,id:'two'}]}, 'one')).toThrow('duplicate');
    expect(() => compileNotebookSql(sources, one('SELECT 1'), 'missing')).toThrow('unknown notebook cell');
    for (const name of ['', 'x'.repeat(64), 'x\0y']) {
      expect(() => compileNotebookSql(sources, {cells:[{...cell,name}]}, 'one')).toThrow('cell name');
    }
  });
  it('honors authored WITH shadowing instead of discovering false dependencies', () => {
    const out = compileNotebookSql(sources, { cells: [
      {id:'unused', name:'base', sql:'BROKEN UNUSED SQL'},
      {id:'result',name:'result',sql:'WITH base AS (SELECT 3 AS total), later AS (SELECT * FROM base) SELECT * FROM later'},
    ] }, 'result');
    expect(out.sql).not.toContain('orders');
    expect(out.sql).toContain('3');
  });
  it('uses qualified raw references even when a cell has the same name', () => {
    const out = compileNotebookSql(sources, { cells: [{id:'orders',name:'orders',sql:'SELECT * FROM sales.orders'}] }, 'orders');
    expect(out.sql).toContain('sales');
  });
  it('uses public as the raw default independently of reader/default schema', () => {
    const raw = {...sources,defaultSchema:'public',tables:[{...sources.tables[0],schema:'public',source:{schema:'public',table:'orders'}}]};
    expect(compileNotebookSql(raw,one('SELECT * FROM orders'),'one').sql).toContain('public');
    const exposed = {...catalog,notebook:one('SELECT region, total AS revenue FROM orders'),notebookSources:[{schema:'public',name:'orders',columns:sources.tables[0].columns}],tables:[{...catalog.tables[0],modelCellId:'one'}]};
    expect(compileDatasetSql(exposed,'SELECT * FROM revenue').sql).toContain('public');
  });
  it('keeps quoted names, comments, dollar strings and exact numeric literals lexical', () => {
    const cells = [
      {id:'base',name:'Odd " Name',sql:"SELECT $$FROM imaginary $value$$ AS label, 9007199254740993 AS exact /* FROM later */"},
      {id:'result',name:'result',sql:'SELECT * FROM "Odd "" Name" -- FROM unknown\n'},
    ];
    const out = compileNotebookSql(sources,{cells},'result');
    expect(out.sql).toContain('FROM imaginary $value');
    expect(out.sql).toContain('9007199254740993');
    expect(out.values).toEqual([]);
  });
  it('ignores malformed unused drafts but validates all reachable cells', () => {
    const cells = [{id:'broken',name:'broken',sql:'INVALID SQL'}, {id:'good',name:'good',sql:'SELECT 1'}];
    expect(compileNotebookSql(sources,{cells},'good').sql).toContain('1');
    expect(() => compileNotebookSql(sources,{cells},'broken')).toThrow('unsupported or invalid');
  });
  it('composes a deterministic linear-size dependency closure for repeated fanout', () => {
    const cells = Array.from({length:20}, (_, i) => ({id:`c${i}`,name:`c${i}`,sql:i ? `SELECT a.total FROM c${i-1} a JOIN c${i-1} b ON a.total = b.total` : 'SELECT total FROM sales.orders'}));
    const result = compileNotebookSql(sources,{cells},'c19');
    expect(result).toEqual(compileNotebookSql(sources,{cells},'c19'));
    expect(result.sql.match(/sales/g)).toHaveLength(1);
    expect(result.sql.length).toBeLessThan(10_000);
  });
  it('bounds cell count, dependency depth and total authored SQL', () => {
    const cells = Array.from({length:101}, (_,i) => ({id:`c${i}`,name:`c${i}`,sql:i ? `SELECT * FROM c${i-1}` : 'SELECT 1'}));
    expect(() => compileNotebookSql(sources,{cells},'c0')).toThrow('too many notebook cells');
    expect(() => compileNotebookSql(sources,{cells:cells.slice(0,40)},'c39')).toThrow('dependency depth');
    const large = cells.slice(0,20).map(cell => ({...cell,sql:'SELECT 1 /*' + ' '.repeat(60_000) + '*/'}));
    expect(() => compileNotebookSql(sources,{cells:large},'c0')).toThrow('notebook is too large');
  });
  it('fails closed without trusted source metadata or with ambiguous source definitions', () => {
    expect(() => compileDatasetSql({...catalog,notebookSources:undefined},'SELECT * FROM revenue')).toThrow('notebook source metadata');
    expect(() => compileDatasetSql({...catalog,tables:[{...catalog.tables[0],sql:'SELECT 1'}]},'SELECT * FROM revenue')).toThrow('exactly one source');
    expect(() => compileDatasetSql({...catalog,notebook:one('SELECT $region'),tables:[{...catalog.tables[0],modelCellId:'one'}]},'SELECT * FROM revenue',{region:'EU'})).toThrow('notebook parameters');
  });
});
