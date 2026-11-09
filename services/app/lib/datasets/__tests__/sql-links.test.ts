import { expect, it } from 'vitest';
import { selectSqlLinks } from '../sql-links';
const relations = ['tasks', 'id', 'İd', 'odd"name'].map((table) => ({ link: table, schema: 'main', table, columns: [{ name: 'id', type: 'number' as const }] }));
relations.push({ link: 'restricted', schema: 'restricted', table: 'rows', columns: [{ name: 'id', type: 'number' }] });
it.each([
  ['SELECT id FROM tasks', ['tasks']],
  ['SELECT id AS id FROM tasks AS id WHERE id = $id', ['tasks']],
  ["SELECT 'id' FROM tasks -- id", ['tasks']],
  ['WITH id AS (SELECT id FROM tasks) SELECT * FROM id', ['tasks']],
  ['WITH RECURSIVE id(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM id WHERE n<2) SELECT * FROM tasks JOIN id', ['tasks']],
  ['SELECT * FROM tasks WHERE EXISTS (WITH id AS (SELECT 1) SELECT * FROM id)', ['tasks']],
  ['WITH id AS (SELECT 1) SELECT * FROM main.id', ['id']],
  ['SELECT count(*) FROM "ID"', ['id']],
  ['SELECT * FROM [id]', ['id']],
  ['SELECT * FROM `id`', ['id']],
  ['SELECT * FROM "odd""name"', ['odd"name']],
  ['SELECT * FROM "İd"', ['İd']],
  ['SELECT * FROM "restricted"."rows"', ['restricted']],
  ['SELECT * FROM tasks WHERE EXISTS (SELECT 1 FROM id)', ['id', 'tasks']],
] as const)('selects relations via SQLite: %s', async (sql, wanted) => {
  const result = await selectSqlLinks(relations, { tables: {}, queries: [{ name: 'q', sql }], paramNames: ['id'] });
  expect(result.errors).toEqual({});
  expect([...result.selected].sort()).toEqual(wanted);
});
it('uses engine-derived prior output schemas and inline shapes without selecting names in columns', async () => {
  const result = await selectSqlLinks(relations, { tables: { inline: { columns: [{ name: 'id', type: 'number' }] } }, queries: [
    { name: 'base', sql: 'SELECT id AS value FROM tasks' },
    { name: 'total', sql: 'SELECT value + inline.id AS id FROM base JOIN inline' },
  ], paramNames: [] });
  expect(result.errors).toEqual({});
  expect([...result.selected]).toEqual(['tasks']);
});
it.each(['DELETE FROM id', 'UPDATE tasks SET id = 2', 'SELECT * FROM tasks; SELECT * FROM id', 'SELECT secret FROM id', 'nonsense'])('returns a validation failure, never success or metadata, for %s', async (sql) => {
  const result = await selectSqlLinks(relations, { tables: {}, queries: [{ name: 'q', sql }], paramNames: [] });
  expect(result.errors).toEqual({ q: { error: 'SQL statement could not be prepared' } });
  expect([...result.selected]).toEqual([]);
});
it('honors canceled metadata planning and interrupts empty-schema computation within the caller deadline', async () => {
  const controller = new AbortController();
  controller.abort(Error('canceled'));
  const input = { tables: {}, queries: [{ name: 'q', sql: 'SELECT 1' }], paramNames: [] };
  await expect(selectSqlLinks(relations, input, { signal: controller.signal, deadline: performance.now() + 1000 })).rejects.toThrow('canceled');
  await expect(selectSqlLinks(relations, { ...input, queries: [{ name: 'q', sql: 'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x WHERE n<1000000000) SELECT sum(n) FROM x' }] }, { signal: new AbortController().signal, deadline: performance.now() + 20 })).rejects.toThrow('sql_deadline');
});
it('does not confuse an unrelated link with a query output of the same name', async () => {
  const result = await selectSqlLinks(relations, { tables: {}, queries: [
    { name: 'id', sql: 'SELECT id FROM tasks' }, { name: 'q', sql: 'SELECT id FROM id' },
  ], paramNames: [] });
  expect(result.errors).toEqual({});
  expect([...result.selected]).toEqual(['tasks']);
});
