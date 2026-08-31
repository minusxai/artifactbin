/**
 * The WRITE endpoints:
 *  - POST /a/<id>/mutate { mutation, values? } — the DOCUMENT's door. Anyone
 *    who may read the document may run a mutation it DECLARES, with scalar
 *    values only: the SQL is the stored one, the target is resolved by the
 *    document's OWNER (never the link-readable fallback), `access` is
 *    re-checked on every call, and the answer carries the dataset's new
 *    version. Same viewer as the page (session, then the agent cookie; an
 *    opaque-origin document sends nothing and is anonymous by construction).
 *  - POST /api/artifacts/<id>/mutate { sql, values? } — the OWNER's door: the
 *    same engine run against an owned readwrite dataset, no document needed.
 * Every accepted write is a new version with a fresh edit_id, a new
 * content-addressed blob, and a NOTIFY on the dataset's own channel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POST as mutateDocRoute } from '@/app/a/[id]/mutate/route';
import { GET as queryGet } from '@/app/a/[id]/query/route';
import { GET as rawRoute } from '@/app/a/[id]/raw/route';
import { POST as mutateDatasetRoute } from '@/app/api/artifacts/[id]/mutate/route';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { GET as listVersionsRoute } from '@/app/api/artifacts/[id]/versions/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById } from '@/lib/artifacts';
import { setDatasetRowCap } from '@/lib/story/dataset-mutate';


import { loadDatasetRows } from '@/lib/story/dataset-store';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { agentCookie, useAppHarness, request, type RequestOptions } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = async (token: string, body: Record<string, unknown>) => {
  const res = await createArtifactRoute(request('/api/artifacts?v=2', { method: 'POST', token: token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()) as { id: string; version: number; edit_id: string };
};
const ROWS = [{ choice: 'ramen', who: 'seed' }, { choice: 'tacos', who: 'seed' }];
const POLL = (ds: string) =>
  '<Helmet><Value name="choice" type="string" /><Value name="who" type="string" default="anon" />'
  + `<Query name="tally">{\`select choice, count(*)::int votes from ref_${ds} group by 1 order by 1\`}</Query>`
  + `<Mutation name="vote">{\`insert into ref_${ds} (choice, who) values ($choice, $who)\`}</Mutation>`
  + `<Mutation name="clear">{\`delete from ref_${ds} where who = $who\`}</Mutation></Helmet>`
  + '<div><input value="$who" /><Button run="$vote">Vote</Button><Question data="$tally" viz={{"kind":"table"}} /></div>';
const mutate = (doc: string, body: unknown, init: RequestOptions = {}) =>
  mutateDocRoute(request(`/a/${doc}/mutate`, { method: 'POST', json: body, ...init }), params({ id: doc }));

async function poll(access = 'readwrite', visibility?: string) {
  const t = await mintToken('t');
  const ds = (await create(t.token, { dataset: ROWS, access })).id;
  const doc = (await create(t.token, { markup: POLL(ds), ...(visibility ? { visibility } : {}) })).id;
  return { t, ds, doc };
}

beforeEach(async () => {
  setDatasetRowCap(null);
});

describe('POST /a/<id>/mutate — the document\'s door', () => {
  it('an anonymous reader of a public document runs a declared mutation; the dataset gains a version and its queries see the row', async () => {
    const { ds, doc } = await poll();
    const before = (await getArtifactById(ds))!;
    const res = await mutate(doc, { mutation: 'vote', values: { choice: 'ramen', who: 'jun' } });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { ok: boolean; dataset: string; version: number; affected: number };
    expect(body).toMatchObject({ ok: true, dataset: ds, version: 2, affected: 1 });
    const after = (await getArtifactById(ds))!;
    expect(after.version).toBe(2);
    expect(after.edit_id).not.toBe(before.edit_id);
    expect((after.meta as { objectKey: string }).objectKey).not.toBe((before.meta as { objectKey: string }).objectKey);
    expect((after.meta as { rowCount: number }).rowCount).toBe(3);
    expect(await loadDatasetRows(after)).toEqual([...ROWS, { choice: 'ramen', who: 'jun' }]);
    // The document's own reads now see it.
    const q = await queryGet(request(`/a/${doc}/query?q=${encodeURIComponent(JSON.stringify({ only: ['tally'] }))}`), params({ id: doc }));
    const tables = ((await q.json()) as { tables: Record<string, { rows: unknown[] }> }).tables;
    expect(tables.tally.rows).toEqual([{ choice: 'ramen', votes: 2 }, { choice: 'tacos', votes: 1 }]);
  });

  it('values fall back to the declared defaults; a plain-text body (no preflight) is accepted; unknown names are 400', async () => {
    const { ds, doc } = await poll();
    const res = await mutate(doc, { mutation: 'vote', values: { choice: 'tacos' } }, { headers: { 'Content-Type': 'text/plain' } });
    expect(res.status).toBe(200);
    expect((await loadDatasetRows((await getArtifactById(ds))!)).at(-1)).toEqual({ choice: 'tacos', who: 'anon' });
    const unknown = await mutate(doc, { mutation: 'nope', values: {} });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toBe('unknown_mutation');
    const malformed = await mutate(doc, { values: {} });
    expect(malformed.status).toBe(400);
  });

  it('UPDATE/DELETE mutations apply to the current rows, and each write is one archived version', async () => {
    const { ds, t, doc } = await poll();
    await mutate(doc, { mutation: 'vote', values: { choice: 'ramen', who: 'jun' } });
    const res = await mutate(doc, { mutation: 'clear', values: { who: 'seed' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { affected: number }).affected).toBe(2);
    expect(await loadDatasetRows((await getArtifactById(ds))!)).toEqual([{ choice: 'ramen', who: 'jun' }]);
    const versions = (await (await listVersionsRoute(request(`/api/artifacts/${ds}/versions`, { token: t.token }), params({ id: ds }))).json()) as { versions: unknown[] };
    // Two writes inside the archive window coalesce onto the first snapshot —
    // the same rule text edits follow — so there is at least the pre-write state.
    expect(versions.versions.length).toBeGreaterThanOrEqual(1);
  });

  it('is re-checked on EVERY call: a dataset flipped to read-only refuses with dataset_read_only', async () => {
    const { ds, t, doc } = await poll();
    await putArtifactRoute(request(`/api/artifacts/${ds}?v=2`, { method: 'PUT', token: t.token, json: { dataset: ROWS, access: 'read' } }), params({ id: ds }));
    const res = await mutate(doc, { mutation: 'vote', values: { choice: 'ramen' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('dataset_read_only');
  });

  it('the row cap answers 409 dataset_full and writes nothing', async () => {
    const { ds, doc } = await poll();
    setDatasetRowCap(3);
    expect((await mutate(doc, { mutation: 'vote', values: { choice: 'a' } })).status).toBe(200);
    const full = await mutate(doc, { mutation: 'vote', values: { choice: 'b' } });
    expect(full.status).toBe(409);
    expect(((await full.json()) as { error: string }).error).toBe('dataset_full');
    expect((await getArtifactById(ds))!.version).toBe(2);
  });

  it('CONCURRENT writers all land: a lost compare-and-swap re-reads and re-runs the DML (the rebase is free)', async () => {
    const { ds, doc } = await poll();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => mutate(doc, { mutation: 'vote', values: { choice: 'ramen', who: `w${i}` } })),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const row = (await getArtifactById(ds))!;
    expect(row.version).toBe(7);
    const rows = await loadDatasetRows(row);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.who))).toEqual(new Set(['seed', 'w0', 'w1', 'w2', 'w3', 'w4', 'w5']));
  });

  it('a private document: strangers get the uniform 404, the owner\'s browser writes through the page relay, and a cross-site cookie POST is refused', async () => {
    const t = await mintToken('t');
    const user = await createUser({ email: 'owner@x.com' });
    await claimToken(user.id, t.token);
    const ds = (await create(t.token, { dataset: ROWS, access: 'readwrite' })).id;
    const doc = (await create(t.token, { markup: POLL(ds), visibility: 'private' })).id;
    expect((await mutate(doc, { mutation: 'vote', values: { choice: 'ramen' } })).status).toBe(404);
    const cookie = await agentCookie([t.id]);
    const ok = await mutate(doc, { mutation: 'vote', values: { choice: 'ramen' } }, { cookie, origin: BASE });
    expect(ok.status, await ok.clone().text()).toBe(200);
    const csrf = await mutate(doc, { mutation: 'vote', values: { choice: 'ramen' } }, { cookie, origin: 'https://evil.example' });
    expect(csrf.status).toBe(403);
    expect((await getArtifactById(ds))!.version).toBe(2);
  });

  it('carries no in-process write valve — the proxy\'s MUTATE door is the only count (P2 §H)', async () => {
    // The app handler performs the write; the proxy in front counts the door.
    // Driven in-process (no proxy), no call here is ever refused on a budget.
    const { doc } = await poll();
    // Past the old per-visitor default (60/min) with room to spare: a budget
    // that no longer exists cannot be spent, and a write that IS served past
    // the old cap is the proof the handler refuses on no budget of its own.
    const WRITES = 65;
    for (let i = 0; i < WRITES; i++) {
      const res = await mutate(doc, { mutation: 'vote', values: { choice: 'a' } }, { headers: { 'x-forwarded-for': '9.9.9.9' } });
      expect(res.status, `write ${i + 1} of ${WRITES}`).toBe(200);
    }
  });

  it('answers the document\'s own preflight, and the CSP of the served document admits exactly its mutate path', async () => {
    const { doc, t } = await poll();
    const { OPTIONS } = await import('@/app/a/[id]/mutate/route');
    const pre = await OPTIONS(request(`/a/${doc}/mutate`, { method: 'OPTIONS' }), params({ id: doc }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    const raw = await rawRoute(request(`/a/${doc}/raw`, { token: t.token }), params({ id: doc }));
    const csp = raw.headers.get('content-security-policy') ?? '';
    expect(csp).toContain(`/a/${doc}/mutate`);
    expect(csp).not.toMatch(/connect-src[^;]*'self'/);
    const html = await raw.text();
    expect(html).toContain(`"mutateUrl":"/a/${doc}/mutate"`);
  });
});

describe('POST /api/artifacts/<id>/mutate — the owner\'s door', () => {
  it('runs the owner\'s own DML against a readwrite dataset; foreign is 404, read-only is 403', async () => {
    const { ds, t } = await poll();
    const res = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `update ref_${ds} set who = $w`, values: { w: 'agent' } } }), params({ id: ds }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await res.json()) as object).toMatchObject({ id: ds, version: 2, affected: 2, rowCount: 2 });
    expect((await loadDatasetRows((await getArtifactById(ds))!)).every((r) => r.who === 'agent')).toBe(true);
    const wire = (await (await getArtifactRoute(request(`/api/artifacts/${ds}`, { token: t.token }), params({ id: ds }))).json()) as { rows: unknown[]; version: number };
    expect(wire.version).toBe(2);
    expect(wire.rows).toHaveLength(2);

    const other = await mintToken('o');
    const foreign = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: other.token, json: { sql: `delete from ref_${ds}` } }), params({ id: ds }));
    expect(foreign.status).toBe(404);

    await putArtifactRoute(request(`/api/artifacts/${ds}?v=2`, { method: 'PUT', token: t.token, json: { dataset: ROWS, access: 'read' } }), params({ id: ds }));
    const ro = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `delete from ref_${ds}` } }), params({ id: ds }));
    expect(ro.status).toBe(403);
  });

  it('a bad statement is invalid_sql with the engine\'s message; a document id is not a dataset', async () => {
    const { ds, doc, t } = await poll();
    const bad = await mutateDatasetRoute(request(`/api/artifacts/${ds}/mutate`, { method: 'POST', token: t.token, json: { sql: `select * from ref_${ds}` } }), params({ id: ds }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string; details: string[] })).toMatchObject({ error: 'invalid_sql' });
    const notData = await mutateDatasetRoute(request(`/api/artifacts/${doc}/mutate`, { method: 'POST', token: t.token, json: { sql: 'delete from x' } }), params({ id: doc }));
    expect(notData.status).toBe(400);
  });
});
