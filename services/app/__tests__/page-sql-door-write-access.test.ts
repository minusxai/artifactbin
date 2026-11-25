/** Viewer-scoped, read-only edit hints through the real page SQL HTTP door. */
import { beforeEach, expect, it } from 'vitest';
import { POST } from '@/app/api/artifacts/[id]/sql/route';
import { storePolicy } from './artifact-fixtures';
import { request, setSession, useAppHarness } from './harness';
import { services, setServices } from '@/lib/platform';
import { fixture, params, publish, sql, stored, POLICY, type Person } from './page-sql-door-fixture';

useAppHarness();
beforeEach(() => setSession(null));

const access = async (page: string, who: Person | null, writeAccess: object, extra = {}) => {
  const res = await POST(request(`/api/artifacts/${page}/sql`, {
    method: 'POST', json: {revision: '1', writeAccess, ...extra}, ...(who ? {token: who.token} : {}),
  }), params(page));
  expect(res.headers.get('cache-control')).toBe('no-store');
  return {status: res.status, body: await res.json()};
};
const denied = {update: 'denied', delete: false};

it('answers only for the requested operations, columns and viewer-visible rows, without writing', async () => {
  const f = await fixture();
  const added = await sql(f.page, f.other, "insert into staff (name,team) values ('cy','red')");
  const cy = added.body.returning![0]!._id;
  const rows = (await sql(f.page, f.owner, 'select _id from staff order by name')).body.rows!;
  const ids = [...rows.map(row => row._id), 'missing'];
  const before = await stored(f.staff);
  const input = {link: 'staff', insert: ['name', 'team'], update: ['team'], ids};
  expect(await access(f.page, f.other, input)).toEqual({status: 200, body: {writeAccess: {
    insert: 'conditional', rows: [denied, denied, {update: 'conditional', delete: true}, denied],
  }}});
  expect((await access(f.page, f.viewer, input)).body).toEqual({writeAccess: {
    insert: 'denied', rows: [{update: 'allowed', delete: false}, denied, {update: 'allowed', delete: false}, denied],
  }});
  expect((await access(f.page, f.viewer, {...input, update: ['team', 'salary']})).body.writeAccess.rows).toEqual(ids.map(() => denied));
  expect((await access(f.page, f.other, {...input, link: 'notes'})).body.writeAccess).toEqual({insert: 'denied', rows: ids.map(() => denied)});
  expect((await access(f.page, f.owner, input, {readOnly: true})).body.writeAccess).toEqual({insert: 'denied', rows: ids.map(() => denied)});
  expect((await access(f.page, f.other, {...input, ids: Array(101).fill(cy)})).status).toBe(400);
  expect((await access(f.page, f.other, input, {sql: 'delete from staff'})).status).toBe(400);
  expect(await stored(f.staff)).toEqual(before);
});

it('fails closed on hidden filter fields and on revoked writes while leaving ordinary reads available', async () => {
  const f = await fixture();
  const [ada] = (await sql(f.page, f.owner, "select _id from staff where name='ada'")).body.rows!;
  const input = {link: 'staff', update: ['team'], ids: [ada!._id]};
  expect((await access(f.page, f.viewer, input)).body.writeAccess.rows[0].update).toBe('allowed');
  const policy = structuredClone(POLICY);
  const viewer = policy.tables[0]!.update_permissions.find(e => e.role === 'viewer')!;
  Object.assign(viewer.permission, {filter: {salary: {_eq: 10}}});
  await storePolicy(f.staff, policy);
  const unknown = (await access(f.page, f.viewer, input)).body;
  expect(unknown).toEqual({writeAccess: {insert: 'denied', rows: [denied]}});
  policy.tables[0]!.update_permissions = [];
  await storePolicy(f.staff, policy);
  expect((await access(f.page, f.viewer, input)).body).toEqual(unknown);
  expect((await sql(f.page, f.viewer, "update staff set team='blue' where name='ada'")).body.error).toBe('permission_denied');
  expect((await sql(f.page, f.viewer, 'select name from staff')).body.rows).toEqual([{name: 'ada'}]);
});

it('keeps pinned links read-only, even for the owner', async () => {
  const f = await fixture();
  const page = await publish(f.owner, {html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${f.staff}" data-af-mode="pinned" data-af-revision="1"></head><body>Pinned</body></html>`});
  const rows = (await sql(page.body.id, f.owner, 'select _id from staff')).body.rows!;
  expect(rows).toHaveLength(2);
  const input = {link: 'staff', insert: ['name'], update: ['team'], ids: rows.map(r => r._id)};
  expect((await access(page.body.id, f.owner, input)).body.writeAccess).toEqual({insert: 'denied', rows: [denied, denied]});
});

it('withholds positive hints if write access changes during the SQL read', async () => {
  const f = await fixture();
  const [ada] = (await sql(f.page, f.owner, "select _id from staff where name='ada'")).body.rows!;
  const engine = services().sql;
  const policy = structuredClone(POLICY);
  policy.tables[0]!.update_permissions = [];
  let revoked = false;
  setServices({sql: {...engine, async run(input, context) {
    const result = await engine.run(input, context);
    if (input.queries.some(query => query.sql.includes('AS can_update')) && !revoked) {
      revoked = true;
      await storePolicy(f.staff, policy);
    }
    return result;
  }}});
  try {
    const input = {link: 'staff', update: ['team'], ids: [ada!._id]};
    expect(await access(f.page, f.viewer, input)).toEqual({status: 404, body: {error: 'not_found'}});
    expect(revoked).toBe(true);
    expect((await access(f.page, f.viewer, input)).body.writeAccess.rows).toEqual([denied]);
  } finally { setServices({sql: engine}); }
});
