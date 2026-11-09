import { expect, it, vi } from 'vitest';
import { createResolverSql, type ResolverSqlPorts, type ResolverSqlTable } from '../sql';

it('observes column id selecting a restricted link id, plus genuine-reference denial and clean control', async () => {
  const links = ['tasks', 'id'].map((name) => ({ kind: 'dataset' as const, name, datasetId: name, mode: 'live' as const }));
  const read = vi.fn(async (_actor: unknown, named: typeof links) => named.map((link): ResolverSqlTable => ({
    link: link.name, table: null, columns: [{ name: 'id', type: 'number' }], rows: [{ id: 1 }], runsSql: link.name !== 'id',
  })));
  const run = vi.fn<ResolverSqlPorts['run']>(async () => ({ result: { columns: [{ name: 'n', type: 'number', choices: [1] }], rows: [{ n: 1 }] } }));
  const sql = createResolverSql({ links: async () => links, plan: async (actor, named) => ({ tables: named.map((l) => ({ link: l.name, table: null, columns: [{ name: 'id', type: 'number' as const }], runsSql: l.name !== 'id' })), read: (selected) => read(actor, links.filter((l) => selected.has(l.name))) }), run });
  const call = (statement: string) => sql({ pageId: 'probe', caller: { subject: 'viewer', role: 'viewer' }, operation: 'query', args: { sql: statement } });
  await expect(call('SELECT id FROM tasks')).resolves.toMatchObject({ rows: [{ n: 1 }] });
  expect(read.mock.calls[0]![1].map(link => link.name)).toEqual(['tasks']);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(call('SELECT * FROM id')).rejects.toMatchObject({ code: 'permission_denied' });
  expect(read).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(call('SELECT count(*) AS n FROM tasks')).resolves.toMatchObject({ rows: [{ n: 1 }] });
  expect(read.mock.calls[1]![1].map(link => link.name)).toEqual(['tasks']);
  expect(run).toHaveBeenCalledTimes(2);
});
