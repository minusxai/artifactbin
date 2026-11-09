/**
 * caps.sql AS THE CALLER: read-only SQL over the datasets a page links, on the real SQL service, with every row and
 * column the caller could read through caps.query and nothing more. In process the caller is the admitted request's
 * principal; remotely the signed runner pin.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { attachActor } from '@artifactbin/utils';
import type { Actor, RunStart } from '@artifactbin/contracts';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { readHtmlPage } from '@/lib/html-publication';
import { getHtmlBackendVersion } from '@/lib/html-backends';
import { localPageBackendCapability, pageBackendOperation } from '@/lib/page-operations';
import { resolverDatasets } from '@/lib/page-graphql';

/** Dataset executions caps.sql makes (its reads select `_id`), optionally held so concurrent calls overlap. */
const reads = vi.hoisted(() => ({ count: 0, holdMs: 0 }));
vi.mock('@/lib/datasets', async (original) => {
  const datasets = await original<typeof import('@/lib/datasets')>();
  return { ...datasets, executeCatalog: (async (...args: Parameters<typeof datasets.executeCatalog>) => {
    if (args[1].includes('AS "_id"')) { reads.count++; if (reads.holdMs) await new Promise((resolve) => setTimeout(resolve, reads.holdMs)); }
    return datasets.executeCatalog(...args);
  }) as typeof datasets.executeCatalog };
});
vi.mock('@/lib/page-operations', async (original) => ({
  ...await original<typeof import('@/lib/page-operations')>(),
  compilePageBackend: async (source: string) => ({ typeDefs: 'type Query { totals: Int }', compiled: source, secretBindings: [], secretHosts: {} }),
}));
useAppHarness();
beforeEach(() => { setSession(null); reads.count = 0; reads.holdMs = 0; });

type Person = Awaited<ReturnType<typeof person>>;
async function person(name: string) {
  const token = await mintAccountToken(`rs_${name}`);
  return { ...token, actor: identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string } };
}
async function publish(owner: Person, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, owner.actor, 'http://localhost:3000');
  expect(created.status, await created.clone().text()).toBe(201);
  return (await created.json()).id as string;
}

const STAFF = [
  { name: 'ada', team: 'red', salary: 10, hired: '2026-01-15' },
  { name: 'bo', team: 'blue', salary: 20, hired: '2026-02-03' },
  { name: 'cy', team: 'red', salary: 30, hired: '2026-02-20' },
];
/** Viewers see red rows without salary and may aggregate; other accounts see 2 whole rows and may not; anonymous nothing. */
const POLICY = { version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [
  { role: 'viewer', permission: { columns: ['name', 'team', 'hired'], filter: { team: { _eq: 'red' } }, allow_aggregations: true } },
  { role: 'signed_in', permission: { columns: '*', filter: {}, limit: 2, allow_aggregations: false } },
] }] };

/** A page linking `staff` and `teams` (multi-table, `teams.leads` and `teams.budgets`) with a resolver. */
async function fixture(policy: unknown = POLICY) {
  const owner = await person('owner'), viewer = await person('viewer'), other = await person('other');
  const staff = await publish(owner, { dataset: STAFF, title: 'Staff' });
  const teams = await publish(owner, { dataset: { kind: 'stored', defaultSchema: 'public', tables: [
    { schema: 'public', name: 'leads', rows: [{ team: 'red', lead: 'ada' }, { team: 'blue', lead: 'bo' }] },
    { schema: 'public', name: 'budgets', rows: [{ team: 'red', budget: 100 }, { team: 'blue', budget: 50 }] },
  ] }, title: 'Teams' });
  const db = await getDb();
  await db.query("INSERT INTO artifact_shares(artifact_id,user_id,email,role) VALUES($1,$2,$3,'viewer')", [staff, viewer.userId, viewer.email]);
  await db.query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [staff, JSON.stringify(policy)]);
  const pageId = await publish(owner, {
    html: `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff}"><link rel="af-dataset" data-af-name="teams" href="ref:${teams}"><link rel="af-resolver" data-af-name="totals" href="./totals.ts"></head><body>Totals</body></html>`,
    resolverSources: { totals: 'export default {}' },
  });
  const page = await readHtmlPage(owner.actor, pageId);
  const link = page.links.find((l) => l.kind === 'backend');
  if (link?.kind !== 'backend') throw Error('missing resolver link');
  const backend = (await getHtmlBackendVersion(link.backendId, link.version))!;
  return { owner, viewer, other, staff, teams, pageId, backend };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Caller = { subject: string | null; role: string };

const admitted = (f: Fixture, caller: Caller): RunStart => ({
  requestId: 'r', userId: f.backend.ownerId, pageBackendOperation: 'query', artifactId: f.backend.backendId, artifactVersion: f.backend.version,
  program: { source: f.backend.compiled, language: 'javascript' }, input: { kind: 'invoke', principal: { tenant: f.pageId, subject: caller.subject, role: caller.role } },
});
const sql = (f: Fixture, caller: Caller, args: unknown) => localPageBackendCapability(admitted(f, caller), 'artifactbin.pageBackend.sql', args as never, undefined, resolverDatasets) as Promise<any>;
const gql = (f: Fixture, caller: Caller, query: string) => localPageBackendCapability(admitted(f, caller), 'artifactbin.pageBackend.query', { query }, undefined, resolverDatasets) as Promise<any>;
const refusal = (promise: Promise<unknown>) => promise.then(() => null, (e: Error & { code?: string }) => e.message);
const owner = (f: Fixture) => ({ subject: f.owner.userId, role: 'owner' });

it('runs GROUP BY, joins across links, window functions, CTEs and the engine\'s date functions', async () => {
  const f = await fixture();
  expect((await sql(f, owner(f), { sql: 'SELECT team, count(*) AS n, sum(salary) AS total FROM staff GROUP BY team ORDER BY team' })).rows)
    .toEqual([{ team: 'blue', n: 1, total: 20 }, { team: 'red', n: 2, total: 40 }]);
  expect((await sql(f, owner(f), { sql: 'SELECT s.name, l.lead, b.budget FROM staff s JOIN teams.leads l ON l.team = s.team JOIN teams.budgets b USING (team) WHERE s.salary >= $min ORDER BY s.name', params: { min: 20 } })).rows)
    .toEqual([{ name: 'bo', lead: 'bo', budget: 50 }, { name: 'cy', lead: 'ada', budget: 100 }]);
  expect((await sql(f, owner(f), { sql: 'SELECT name, rank() OVER (ORDER BY salary DESC) AS r, sum(salary) OVER (PARTITION BY team) AS team_total FROM staff ORDER BY name' })).rows)
    .toEqual([{ name: 'ada', r: 3, team_total: 40 }, { name: 'bo', r: 2, team_total: 20 }, { name: 'cy', r: 1, team_total: 40 }]);
  const monthly = await sql(f, owner(f), { sql: "WITH m AS (SELECT date_trunc('month', to_date(hired)) AS month, salary FROM staff) SELECT date_format(month, '%Y-%m') AS month, sum(salary) AS total FROM m WHERE salary > (SELECT min(salary) FROM staff) GROUP BY 1 ORDER BY 1" });
  expect(monthly.rows).toEqual([{ month: '2026-02', total: 50 }]);
  expect(monthly.columns.map((c: { name: string }) => c.name)).toEqual(['month', 'total']);
  // `_id` is each row's generated-API id: the same one caps.query answers, for a mutation to name.
  const ids = (await gql(f, owner(f), '{ staff(order_by: {name: asc}) { _id } }')).staff.map((r: { _id: string }) => r._id);
  expect((await sql(f, owner(f), { sql: 'SELECT _id FROM staff ORDER BY name' })).rows.map((r: { _id: string }) => r._id)).toEqual(ids);
});

it('the batched form: inline typed tables, a later query reading an earlier one, a failure per query', async () => {
  const f = await fixture();
  const answer = await sql(f, owner(f), {
    queries: [
      { name: 'byTeam', sql: 'SELECT team, sum(salary) AS total FROM staff GROUP BY team' },
      { name: 'vsGoal', sql: 'SELECT b.team, b.total, g.goal, b.total >= g.goal AS met FROM byTeam b JOIN goals g USING (team) WHERE g.since <= $day ORDER BY b.team' },
      { name: 'broken', sql: 'SELECT nope FROM goals' },
    ],
    params: { day: '2026-06-01' }, paramTypes: { day: 'date' },
    tables: { goals: { columns: [{ name: 'team', type: 'string' }, { name: 'goal', type: 'number' }, { name: 'since', type: 'date' }], rows: [{ team: 'red', goal: 50, since: '2026-01-01' }, { team: 'blue', goal: 10, since: '2026-01-01' }] } },
  });
  expect(answer.vsGoal.rows).toEqual([{ team: 'blue', total: 20, goal: 10, met: 1 }, { team: 'red', total: 40, goal: 50, met: 0 }]);
  expect(answer.broken).toEqual({ error: 'SQL statement could not be prepared' });
});

it('works with zero linked datasets: pure expressions and inline tables', async () => {
  const f = await fixture();
  const anonymous = { subject: null, role: 'anonymous' };
  expect(await sql(f, anonymous, { sql: "SELECT 1 + 1 AS two, date_trunc('year', '2026-05-04') AS y" })).toEqual({ columns: [{ name: 'two', type: 'number' }, { name: 'y', type: 'date' }], rows: [{ two: 2, y: '2026-01-01' }] });
  expect((await sql(f, anonymous, { queries: [{ name: 'q', sql: 'SELECT sum(v) AS n FROM t' }], tables: { t: { columns: [{ name: 'v', type: 'number' }], rows: [{ v: 2 }, { v: 3 }] } } })).q.rows).toEqual([{ n: 5 }]);
});

it('reads the caller\'s role view: filtered rows and hidden columns are absent from the input', async () => {
  const f = await fixture();
  const viewer = { subject: f.viewer.userId, role: 'viewer' };
  const all = await sql(f, viewer, { sql: 'SELECT * FROM staff ORDER BY name' });
  expect(all.rows.map((r: { name: string }) => r.name)).toEqual(['ada', 'cy']);
  expect(all.columns.map((c: { name: string }) => c.name)).toEqual(['_id', 'name', 'team', 'hired']);
  // Not even a count of what the rule filters out, nor any way to name the hidden column.
  expect((await sql(f, viewer, { sql: 'SELECT count(*) AS n FROM staff' })).rows).toEqual([{ n: 2 }]);
  expect(await refusal(sql(f, viewer, { sql: 'SELECT sum(salary) FROM staff' }))).toBe('validation_failed: SQL statement could not be prepared');
  // The page role never picks the dataset role: a viewer claiming owner still reads as the dataset decides.
  expect((await sql(f, { subject: f.viewer.userId, role: 'owner' }, { sql: 'SELECT name FROM staff ORDER BY name' })).rows).toEqual([{ name: 'ada' }, { name: 'cy' }]);
});

it('refuses the call when the caller\'s rule for a mounted table does not allow SQL (allow_aggregations)', async () => {
  const f = await fixture();
  const other = { subject: f.other.userId, role: 'viewer' };
  expect(await refusal(sql(f, other, { sql: 'SELECT name FROM staff' }))).toMatch(/^permission_denied: .*staff.*does not allow SQL \(allow_aggregations\)/);
  // Linked datasets the SQL does not name are not mounted; the owner of both may aggregate everything.
  expect((await sql(f, other, { sql: 'SELECT count(*) AS n FROM teams.leads' })).rows).toEqual([{ n: 2 }]);
});

it('sees exactly what caps.query sees, for every caller, on an unlisted and on a private dataset', async () => {
  const aggregating = { ...POLICY, tables: [{ ...POLICY.tables[0]!, select_permissions: POLICY.tables[0]!.select_permissions.map((r) => ({ ...r, permission: { ...r.permission, allow_aggregations: true } })) }] };
  const seen: Array<[string, number | null]> = [];
  for (const visibility of ['unlisted', 'private']) {
    const f = await fixture(aggregating);
    await (await getDb()).query('UPDATE artifacts SET visibility=$2 WHERE id=$1', [f.staff, visibility]);
    for (const [who, caller] of [['owner', owner(f)], ['viewer', { subject: f.viewer.userId, role: 'viewer' }], ['other', { subject: f.other.userId, role: 'viewer' }], ['anonymous', { subject: null, role: 'anonymous' }]] as const) {
      const label = `${visibility} ${who}`;
      const viaGraphql = await gql(f, caller, '{ staff(order_by: {_id: asc}) { _id name team } }').then((d) => d.staff as unknown[], () => null);
      const viaSql = await sql(f, caller, { sql: 'SELECT _id, name, team FROM staff ORDER BY _id' }).then((d) => d.rows as unknown[], () => null);
      expect(viaSql, label).toEqual(viaGraphql);
      seen.push([label, viaSql?.length ?? null]);
    }
  }
  // Each door's answer, so the comparison above is never two empty refusals: rows, a rule's limit, or absence.
  expect(seen).toEqual([['unlisted owner', 3], ['unlisted viewer', 2], ['unlisted other', 2], ['unlisted anonymous', null], ['private owner', 3], ['private viewer', 2], ['private other', null], ['private anonymous', null]]);
});

it('admits reads only: a write, DDL or ATTACH statement is refused and nothing changes', async () => {
  const f = await fixture();
  for (const statement of ["DELETE FROM staff", "UPDATE staff SET salary = 0", "INSERT INTO staff(name) VALUES ('x')", 'CREATE TABLE t(x)', 'DROP TABLE staff', "ATTACH DATABASE 'x.db' AS x", 'PRAGMA writable_schema = 1'])
    expect(await refusal(sql(f, owner(f), { sql: statement })), statement).toMatch(/^validation_failed: /);
  expect((await sql(f, owner(f), { sql: 'SELECT count(*) AS n FROM staff' })).rows).toEqual([{ n: 3 }]);
});

it('trips the input and result limits', async () => {
  const f = await fixture();
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ v: i }));
  const inline = (n: number) => ({ queries: [{ name: 'q', sql: 'SELECT count(*) AS n FROM t' }], tables: { t: { columns: [{ name: 'v', type: 'number' }], rows: rows(n) } } });
  expect((await sql(f, owner(f), inline(10000))).q.rows).toEqual([{ n: 10000 }]);
  expect(await refusal(sql(f, owner(f), inline(10001)))).toMatch(/^input_too_large: /);
  // Inline rows and dataset rows share the 10k input rows.
  expect(await refusal(sql(f, owner(f), { ...inline(9998), queries: [{ name: 'q', sql: 'SELECT count(*) FROM t, staff' }] }))).toMatch(/^input_too_large: /);
  expect((await sql(f, owner(f), { ...inline(9997), queries: [{ name: 'q', sql: 'SELECT count(*) AS n FROM t, staff' }] })).q.rows).toEqual([{ n: 9997 * 3 }]);
  // A result past the row cap, or past the resolver's 4 MiB answer.
  expect(await refusal(sql(f, owner(f), { sql: 'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 10001) SELECT i FROM n' }))).toMatch(/^result_too_large: /);
  expect(await refusal(sql(f, owner(f), { sql: "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 5000) SELECT i, printf('%.1000c', 'x') AS pad FROM n" }))).toMatch(/^result_too_large: /);
});

it('remote callback: the caller comes from the signed pin, and a refusal reaches the runner as its code', async () => {
  const f = await fixture();
  const pin = (caller?: { subject: string | null; role: 'owner' | 'viewer' | 'anonymous' }): Actor => ({ credential: 'session', userId: f.backend.ownerId,
    runner: { pageBackendOperation: 'query', runId: 'run1', callId: 1, artifactId: f.backend.backendId, version: f.backend.version, editId: f.backend.version, sourceHash: createHash('sha256').update(f.backend.compiled).digest('hex'), ...(caller ? { caller } : {}) } });
  const call = async (actor: Actor, input: Record<string, unknown>) => {
    const response = await pageBackendOperation(attachActor(request('/api/runner/operations', { method: 'POST' }), actor), 'pageBackend.sql', input as never, f.backend.compiled, resolverDatasets);
    return { status: response.status, body: await response.json() };
  };
  const names = { sql: 'SELECT name FROM staff ORDER BY name' };
  expect((await call(pin({ subject: f.viewer.userId, role: 'viewer' }), { ...names, principal: { subject: f.owner.userId, role: 'owner' } })).body.rows).toEqual([{ name: 'ada' }, { name: 'cy' }]);
  expect((await call(pin({ subject: f.owner.userId, role: 'owner' }), names)).body.rows).toHaveLength(3);
  expect(await call(pin(), names)).toEqual({ status: 400, body: { error: 'caller_unavailable: the run does not attest who called' } });
  expect(await call(pin({ subject: f.owner.userId, role: 'owner' }), { sql: 'DELETE FROM staff' })).toEqual({ status: 400, body: { error: expect.stringMatching(/^validation_failed: /) } });
});

it('shares one in-flight read of a revision under one role view between concurrent calls, never across callers', async () => {
  const f = await fixture();
  reads.holdMs = 300;
  const query = { sql: 'SELECT count(*) AS n FROM staff' };
  const [a, b] = await Promise.all([sql(f, owner(f), query), sql(f, owner(f), query)]);
  expect([a.rows, b.rows]).toEqual([[{ n: 3 }], [{ n: 3 }]]);
  expect(reads.count).toBe(1);
  reads.count = 0;
  const [mine, theirs] = await Promise.all([sql(f, owner(f), query), sql(f, { subject: f.viewer.userId, role: 'viewer' }, query)]);
  expect([mine.rows, theirs.rows]).toEqual([[{ n: 3 }], [{ n: 2 }]]);
  expect(reads.count).toBe(2);
});
