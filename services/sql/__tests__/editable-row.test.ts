import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';
const local = createSql({ maxRows: 100, timeoutMs: 2000 });
const server = serveSql(local);
const remote = sqlClient(server.listen(5210).url);
afterAll(() => server.close());
const columns = [{ name: 'id', type: 'number' as const }, { name: 'status', type: 'string' as const }];
describe.each([['local', local], ['HTTP', remote]] as const)('editable row %s', (_, service) => {
  it('binds typed row snapshot and commits one matching record', async () => {
    const result = await service.mutate({ table: { name: 'ref_tasks', columns, rows: [{id: 1, status: 'backlog'}] }, sql: 'update ref_tasks set status=$_value where id=$_row.id and status is not distinct from $_row.status', params: { _value: 'active' }, row: { columns, values: {id: 1, status: 'backlog'} }, expectedAffected: 1 });
    expect(result).toMatchObject({ affected: 1, rows: [{id: 1, status: 'active'}] });
  });
  it('refuses stale and duplicate-key updates instead of returning changed rows', async () => {
    const base = { table: {name: 'ref_tasks', columns, rows: [{id: 1, status: 'active'}]}, sql: 'update ref_tasks set status=$next where id=$id and status is not distinct from $old', params: {next: 'done', id: 1, old: 'backlog'}, expectedAffected: 1 };
    expect(await service.mutate(base)).toMatchObject({code: 'row_changed'});
    expect(await service.mutate({...base, table: {...base.table, rows: [{id: 1,status:'backlog'}, {id:1,status:'backlog'}]}})).toMatchObject({code: 'row_not_unique'});
  });
});
