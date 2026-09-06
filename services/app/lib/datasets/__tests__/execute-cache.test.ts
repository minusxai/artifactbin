import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatasetCatalog } from '../types';
const fixture = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../postgres', () => ({ queryPostgres: fixture.query }));
vi.mock('../secrets', () => ({ resolveDatasetConnection: async () => ({ host: 'db.example.com',port:5432,database:'app',username:'reader',ssl:true,password: 'fixture' }) }));
vi.mock('../catalog', () => ({ storedTables: vi.fn() }));
vi.mock('@/lib/sql/engine', () => ({ runQueries: vi.fn(), isQueryFailure: () => false }));
import { executeCatalog } from '../execute';
const catalog: DatasetCatalog = { kind: 'postgres', connection:{host:'db.example.com',port:5432,database:'app',username:'reader',ssl:true,passwordSecretId:'secret'}, refreshSeconds: 60, defaultSchema: 'public', tables: [{ schema: 'public', name: 'rows', source: { schema: 'public', table: 'rows' }, columns: [{ name: 'payload', type: 'string' }] }] };
const run = (key: number, refresh = false) => executeCatalog(catalog, 'select payload from rows where $key > 0', { key }, { refresh });
let clock = Date.now();
beforeEach(() => {
  vi.useFakeTimers(); clock += 120000; vi.setSystemTime(clock);
  fixture.query.mockReset().mockImplementation(async () => ({ rows: [{ payload: 'x'.repeat(7 * 1024 * 1024) }], columns: catalog.tables[0].columns }));
});
afterEach(() => vi.useRealTimers());
it('evicts oldest results to keep total retained cache bytes within 32 MiB', async () => {
  for (let key = 1; key <= 5; key++) await run(key);
  expect(fixture.query).toHaveBeenCalledTimes(5);
  await run(5); expect(fixture.query).toHaveBeenCalledTimes(5);
  await run(1); expect(fixture.query).toHaveBeenCalledTimes(6);
});
it('accounts for refreshed replacements without charging the previous result twice', async () => {
  await run(10); await run(11); await run(12); await run(13);
  for (let count = 0; count < 5; count++) await run(13, true);
  expect(fixture.query).toHaveBeenCalledTimes(9);
  await run(10); expect(fixture.query).toHaveBeenCalledTimes(9);
});
it('retains the existing entry-count bound and expires cached results', async () => {
  fixture.query.mockResolvedValue({ rows: [{ payload: 'small' }], columns: catalog.tables[0].columns });
  for (let key = 100; key < 201; key++) await run(key);
  await run(100); expect(fixture.query).toHaveBeenCalledTimes(102);
  await run(100); expect(fixture.query).toHaveBeenCalledTimes(102);
  vi.setSystemTime(clock + 61000);
  await run(100); expect(fixture.query).toHaveBeenCalledTimes(103);
});
