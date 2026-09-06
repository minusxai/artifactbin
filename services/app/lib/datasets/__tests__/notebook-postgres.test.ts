import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileDatasetSql } from '../sql';
import { compileNotebookSql } from '../notebook';
import type { DatasetCatalog, DatasetNotebook } from '../types';

const sources: DatasetCatalog = {kind:'postgres',defaultSchema:'public',refreshSeconds:0,tables:[{schema:'sales',name:'orders',source:{schema:'sales',table:'orders'},columns:[{name:'region',type:'string'},{name:'total',type:'number'},{name:'private_note',type:'string'}]}]};
const notebook: DatasetNotebook = {cells:[
  {id:'base',name:'base',sql:'SELECT * FROM sales.orders'},
  {id:'filtered',name:'filtered',sql:"SELECT * FROM base WHERE private_note = 'allowed'"},
  {id:'final',name:'final',sql:'SELECT region, sum(total)::int AS revenue FROM filtered GROUP BY region'},
]};
const catalog: DatasetCatalog = {...sources,defaultSchema:'models',notebook,notebookSources:[{schema:'sales',name:'orders',columns:sources.tables[0].columns}],tables:[
  {schema:'models',name:'revenue',modelCellId:'final',columns:[{name:'region',type:'string'},{name:'revenue',type:'number'}]},
  {schema:'models',name:'rows',modelCellId:'base',columns:sources.tables[0].columns.slice(0,2)},
]};
const dockerAvailable = spawnSync('docker',['image','inspect','postgres:17-alpine'],{stdio:'ignore'}).status === 0;
describe.skipIf(!dockerAvailable)('notebook PostgreSQL isolation (disposable server)', () => {
  let container: string;
  let port: number;
  let admin: pg.Client | undefined;
  let reader: pg.Client | undefined;
  beforeAll(async () => {
    container = execFileSync('docker',['run','--rm','-d','-e','POSTGRES_PASSWORD=notebook-test','-p','127.0.0.1::5432','postgres:17-alpine'],{encoding:'utf8'}).trim();
    port = Number(execFileSync('docker',['port',container,'5432/tcp'],{encoding:'utf8'}).trim().split(':').at(-1));
    for (let attempt = 0; attempt < 100; attempt++) {
      admin = new pg.Client({host:'127.0.0.1',port,user:'postgres',password:'notebook-test',database:'postgres'});
      try { await admin.connect(); break; } catch { await admin.end(); await delay(100); }
    }
    await admin!.query(`CREATE SCHEMA sales;
      CREATE TABLE sales.orders(region text, total int, private_note text);
      INSERT INTO sales.orders VALUES ('EU',10,'allowed'),('EU',20,'hidden'),('US',30,'allowed');
      CREATE TABLE public."Odd "" Table" ("Value "" Name" int);
      INSERT INTO public."Odd "" Table" VALUES (7);
      CREATE ROLE notebook_reader LOGIN PASSWORD 'reader' NOSUPERUSER;
      ALTER ROLE notebook_reader SET default_transaction_read_only = on;
      GRANT USAGE ON SCHEMA sales, public TO notebook_reader;
      GRANT SELECT ON ALL TABLES IN SCHEMA sales, public TO notebook_reader;`);
    reader = new pg.Client({host:'127.0.0.1',port,user:'notebook_reader',password:'reader',database:'postgres'});
    await reader.connect();
  }, 20_000);
  afterAll(async () => {
    try { await reader?.end(); } finally {
      try { await admin?.end(); } finally { if (container) execFileSync('docker',['rm','-f',container],{stdio:'ignore'}); }
    }
  });
  const run = async (sql: string, params = {}, types?: Parameters<typeof compileDatasetSql>[3]) => {
    const compiled = compileDatasetSql(catalog,sql,params,types);
    return (await reader!.query(compiled.sql,compiled.values)).rows;
  };
  it('executes chained models with hidden raw predicates and only final columns', async () => {
    expect(await run('SELECT * FROM revenue ORDER BY region')).toEqual([{region:'EU',revenue:10},{region:'US',revenue:30}]);
    expect(await run('SELECT * FROM rows ORDER BY total')).toEqual([{region:'EU',total:10},{region:'EU',total:20},{region:'US',total:30}]);
  });
  it.each([
    'SELECT private_note FROM rows',
    "SELECT region FROM rows WHERE private_note = 'allowed'",
    'SELECT a.region FROM rows a JOIN rows b ON a.private_note = b.private_note',
    "SELECT region FROM rows a WHERE EXISTS (SELECT 1 FROM rows b WHERE b.region=a.region AND a.private_note='allowed')",
    'SELECT r.* FROM rows r ORDER BY private_note',
    'SELECT (SELECT private_note) FROM rows',
  ])('projects before reader hidden-column expressions: %s', async sql => {
    await expect(run(sql)).rejects.toThrow(/column .* does not exist/);
  });
  it('preserves typed runtime binds when repeated model expansions introduce internal CTEs', async () => {
    const sql = 'SELECT a.region, a.revenue FROM revenue a JOIN revenue b ON a.region=b.region WHERE $region IS NULL OR a.region=$region ORDER BY a.region';
    expect(await run(sql,{region:null},{region:'string'})).toHaveLength(2);
    expect(await run(sql,{region:'EU'},{region:'string'})).toEqual([{region:'EU',revenue:10}]);
  });
  it('does not capture caller CTEs inside the notebook', async () => {
    expect(await run("WITH base AS (SELECT 'fake' AS region, 999 AS total), filtered AS (SELECT * FROM base) SELECT * FROM revenue ORDER BY region")).toEqual([{region:'EU',revenue:10},{region:'US',revenue:30}]);
  });
  it('honors inner WITH shadowing and same-name qualified raw tables', async () => {
    const cells = [
      {id:'orders',name:'orders',sql:'SELECT total FROM sales.orders'},
      {id:'result',name:'result',sql:'WITH orders AS (SELECT 42 AS total), next AS (SELECT * FROM orders) SELECT * FROM next'},
    ];
    const c = compileNotebookSql(sources,{cells},'result');
    expect((await reader!.query(c.sql,c.values)).rows).toEqual([{total:42}]);
    const raw = compileNotebookSql(sources,{cells},'orders');
    expect((await reader!.query(raw.sql,raw.values)).rows).toHaveLength(3);
  });
  it('executes quoted cell/raw identifiers and preserves exact literals', async () => {
    const raw: DatasetCatalog = {...sources,tables:[{schema:'public',name:'Odd " Table',source:{schema:'public',table:'Odd " Table'},columns:[{name:'Value " Name',type:'number'}]}]};
    const cells = [
      {id:'quoted',name:'Odd " Cell',sql:'SELECT "Value "" Name", 9007199254740993 AS exact, $$FROM absent $ignored$$ AS literal FROM "Odd "" Table"'},
      {id:'result',name:'result',sql:'SELECT * FROM "Odd "" Cell" /* FROM nonexistent */'},
    ];
    const c = compileNotebookSql(raw,{cells},'result');
    expect((await reader!.query(c.sql,c.values)).rows).toEqual([{'Value " Name':7,exact:'9007199254740993',literal:'FROM absent $ignored'}]);
  });
  it('retains legacy SQL-model and physical source behavior', async () => {
    const legacy: DatasetCatalog = {...sources,tables:[...sources.tables,{schema:'public',name:'legacy',sql:'SELECT total FROM sales.orders WHERE region=$region',columns:[{name:'total',type:'number'}]}]};
    const c = compileDatasetSql(legacy,'SELECT * FROM legacy ORDER BY total',{region:'EU'});
    expect((await reader!.query(c.sql,c.values)).rows).toEqual([{total:10},{total:20}]);
  });
});
