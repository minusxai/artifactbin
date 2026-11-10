import { expect, it, vi } from 'vitest';
import { useAppHarness, mintAccountToken, setDatasetPolicy } from '@/__tests__/harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb, services } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { createResolverSql } from '@/lib/page-operations';
import { planLinkedDatasetTables } from '../sql-read';
useAppHarness();
async function seed() {
  const owner = await mintAccountToken('mxmx_test_sql_selection');
  const actor = identityForUser(owner.userId, owner.id, owner.email) as AccessActor & { tokenId: string };
  const make = async () => {
    const response = await createArtifactFromBody({ dataset: [{ id: 1, hidden: 2 }], visibility: 'public', access: 'readwrite' }, actor, 'http://localhost:3000');
    expect(response.status).toBe(201);
    return (await response.json() as { id: string }).id;
  };
  const tasks = await make(), denied = await make(), inaccessible = await make();
  const db = await getDb();
  for (const [id, allowed] of [[tasks, true], [denied, false]] as const) {
    await setDatasetPolicy(actor, id, { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: ['anonymous', 'signed_in'].map((role) => ({ role, permission: { columns: ['id'], filter: {}, allow_aggregations: allowed } })) }] }, 0);
  }
  // A cold, missing row object makes an eager count/read observable, regardless of row-count caching.
  await db.query(`UPDATE artifacts SET meta=jsonb_set(meta,'{catalog,tables,0,objectKey}','"missing-sql-selection-object"'::jsonb) WHERE id=$1`, [denied]);
  await db.query("UPDATE artifacts SET visibility='private' WHERE id=$1", [inaccessible]);
  const links = [{ kind: 'dataset' as const, name: 'tasks', datasetId: tasks, mode: 'live' as const }, { kind: 'dataset' as const, name: 'id', datasetId: denied, mode: 'live' as const }, { kind: 'dataset' as const, name: 'inaccessible', datasetId: inaccessible, mode: 'live' as const }];
  return { links, tasks, db };
}
it('plans actual retained metadata without opening denied rows, ignores inaccessible links and refuses genuine reads before run', async () => {
  const { links } = await seed();
  const run = vi.fn((input: Parameters<ReturnType<typeof services>['sql']['run']>[0]) => services().sql.run(input));
  const sql = createResolverSql({ links: async () => links, plan: planLinkedDatasetTables, run });
  const call = (statement: string) => sql({ pageId: 'page', caller: { subject: null, role: 'anonymous' }, operation: 'query', args: { sql: statement } });
  await expect(call('SELECT id FROM tasks')).resolves.toMatchObject({ rows: [{ id: 1 }] });
  expect(run).toHaveBeenCalledTimes(1);
  await expect(call('SELECT count(*) FROM "ID"')).rejects.toMatchObject({ code: 'permission_denied' });
  expect(run).toHaveBeenCalledTimes(1);
  await expect(call('SELECT hidden FROM id')).rejects.toMatchObject({ code: 'validation_failed', message: 'validation_failed: SQL statement could not be prepared' });
  expect(run).toHaveBeenCalledTimes(1);
});
it('retains one snapshot and rechecks fresh authorization after rows; canceled plans/reads return no rows', async () => {
  const { links, tasks, db } = await seed();
  const actor = identityForUser(null), controller = new AbortController();
  const plan = await planLinkedDatasetTables(actor, links, { pageId: 'page', maxRows: 10000 }, controller.signal);
  expect(plan.tables.map((t) => t.link)).toEqual(['tasks', 'id']);
  expect(plan.tables[0]!.columns.map((c) => c.name)).toEqual(['_id', 'id']);
  // Moving the authorized head after metadata planning must fence the retained read.
  await db.query('UPDATE artifacts SET policy_revision=policy_revision+1 WHERE id=$1', [tasks]);
  await expect(plan.read(new Set(['tasks']))).rejects.toThrow('dataset_changed');
  controller.abort(Error('stopped'));
  await expect(plan.read(new Set(['tasks']))).rejects.toThrow('stopped');
  await expect(planLinkedDatasetTables(actor, links, { pageId: 'page', maxRows: 10000 }, controller.signal)).rejects.toThrow('stopped');
});
