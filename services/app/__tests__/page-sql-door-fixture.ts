/**
 * The page SQL door suites' shared fixture (page-sql-door*.test.ts): readers, the Staff and Notes datasets under their
 * policies, a page linking both, and the request helpers. Each suite calls useAppHarness itself.
 */
import { expect } from 'vitest';
import { mintAccountToken, request } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { getArtifactById } from '@/lib/artifacts';
import { loadDatasetRows } from '@/lib/datasets';
import { POST as sqlPost } from '@/app/api/artifacts/[id]/sql/route';

export type Person = Awaited<ReturnType<typeof person>>;
export type SqlReply = { columns?: Array<{ name: string; type: string }>; rows?: Array<Record<string, unknown>>; affected?: number; returning?: Array<Record<string, unknown>>; error?: string; message?: string };
export async function person(name: string) {
  const token = await mintAccountToken(`psd_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
export const params = (id: string) => ({ params: Promise.resolve({ id }) });
export async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string } };
}
export async function sql(page: string, who: Person | null, text: string, values: Record<string, unknown> = {}, options: { key?: string; revision?: string; readOnly?: boolean } = {}) {
  const response = await sqlPost(request(`/api/artifacts/${page}/sql`, { method: 'POST', json: { sql: text, params: values, revision: options.revision ?? '1', ...(options.readOnly ? { readOnly: true } : {}) }, ...(who ? { token: who.token } : {}), ...(options.key ? { headers: { 'Idempotency-Key': options.key } } : {}) }), params(page));
  return { status: response.status, body: await response.json() as SqlReply };
}

const STAFF = [{ name: 'ada', team: 'red', salary: 10, page: 'seed', by: 'seed' }, { name: 'bo', team: 'blue', salary: 20, page: 'seed', by: 'seed' }];
export const ROWS = { schema: 'public', name: 'rows' };
/**
 * viewer: red rows without salary, may move any row's team (update filter wider than its select filter);
 * signed_in: every row and column, adds rows stamped with page and self, edits and deletes its own, never to black;
 * anonymous: names only, may add a name and a team it cannot read back (a write-only column).
 */
const NOT_BLACK = { _or: [{ team: { _is_null: true } }, { team: { _neq: 'black' } }] };
export const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'viewer', permission: { columns: ['name', 'team', 'page', 'by'], filter: { team: { _eq: 'red' } }, allow_aggregations: false } },
    { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
    { role: 'anonymous', permission: { columns: ['name'], filter: {} } },
  ],
  insert_permissions: [
    { role: 'signed_in', permission: { columns: ['name', 'team'], check: NOT_BLACK, set: { page: 'X-Hasura-Page-Id', by: 'X-Hasura-User-Id' } } },
    { role: 'anonymous', permission: { columns: ['name', 'team'], check: {}, set: { page: 'X-Hasura-Page-Id', by: 'anon' } } },
  ],
  update_permissions: [
    { role: 'signed_in', permission: { columns: ['team'], filter: { by: { _eq: 'X-Hasura-User-Id' } }, check: NOT_BLACK } },
    { role: 'viewer', permission: { columns: ['team'], filter: {}, check: {} } },
  ],
  delete_permissions: [{ role: 'signed_in', permission: { filter: { by: { _eq: 'X-Hasura-User-Id' } } } }],
}] };
const NOTES_POLICY = { version: 3, tables: [{ table: ROWS, select_permissions: [
  { role: 'signed_in', permission: { columns: '*', filter: {} } },
  { role: 'anonymous', permission: { columns: '*', filter: {} } },
] }] };

export async function fixture() {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const staff = await publish(owner, { dataset: STAFF, title: 'Staff' });
  const notes = await publish(owner, { dataset: [{ note: 'hello' }], title: 'Notes' });
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [staff.body.id, viewer.userId, viewer.email]);
  for (const [id, policy] of [[staff.body.id, POLICY], [notes.body.id, NOTES_POLICY]] as const)
    await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [id, JSON.stringify(policy)]);
  const page = await publish(owner, { html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff.body.id}"><link rel="af-dataset" data-af-name="notes" href="ref:${notes.body.id}"></head><body>Staff</body></html>` });
  expect(page.status, JSON.stringify(page.body)).toBe(201);
  return { owner, viewer, other, staff: staff.body.id, notes: notes.body.id, page: page.body.id };
}
export const stored = async (id: string) => loadDatasetRows((await getArtifactById(id))!);
/** A refusal: an error code, nothing written. */
export async function refused(f: { staff: string; notes: string }, reply: Promise<{ status: number; body: SqlReply }>, code?: string | RegExp) {
  const before = [await stored(f.staff), await stored(f.notes)];
  const { status, body } = await reply;
  expect(status, JSON.stringify(body)).toBeGreaterThanOrEqual(400);
  expect(body.error, JSON.stringify(body)).toBeTruthy();
  if (code) expect(body.error).toMatch(code);
  expect([await stored(f.staff), await stored(f.notes)]).toEqual(before);
  return body;
}
