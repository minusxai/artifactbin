/**
 * `<Mutation>` at the publish door. A document may declare a write only
 * against a dataset that (a) resolves, (b) the publisher OWNS — the
 * link-readable fallback that lets any document READ a public dataset never
 * applies to writes — and (c) is `access: readwrite`. Each refusal names the
 * fix. The SQL is dry-run like a query's: a non-DML statement or an unknown
 * column is a 400 with the engine's message, not a button that fails later.
 */
import { storedMarkup } from '@/test/helpers/echo';
import { describe, expect, it } from 'vitest';
import { PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as previewRoute } from '@/app/api/preview/route';
import { getArtifactById } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
const ROWS = [{ choice: 'ramen', who: 'seed' }];
const dataset = async (token: string, extra: Record<string, unknown> = {}) => {
  const res = await create(token, { dataset: ROWS, ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};
const POLL = (ds: string, sql = `insert into ref_${ds} (choice, who) values ($choice, $who)`) =>
  '<Helmet><Value name="choice" type="string" /><Value name="who" type="string" />'
  + `<Query name="tally">{\`select choice, count(*) votes from ref_${ds} group by 1\`}</Query>`
  + `<Mutation name="vote">{\`${sql}\`}</Mutation></Helmet>`
  + '<div><input value="$who" /><Button run="$vote">Vote</Button><Question data="$tally" viz={{"kind":"table"}} /></div>';
const details = async (res: Response) => {
  const body = (await res.json()) as { error: string; details: Array<string | { message: string }> };
  return `${body.error}: ${body.details.map((d) => (typeof d === 'string' ? d : d.message)).join(' | ')}`;
};

describe('publishing a document with a <Mutation>', () => {
  it('lands against an owned readwrite dataset; the target is a ref in meta.refs', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    const res = await create(t.token, { markup: POLL(ds) });
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { id: string; markup?: string; markup_changed?: boolean };
    expect(storedMarkup(body, POLL(ds))).toContain('<Mutation name="vote">');
    const row = (await getArtifactById(body.id))!;
    expect((row.meta as { refs: Array<{ id: string; kind: string }> }).refs).toEqual([{ id: ds, kind: 'dataset' }]);
  });

  it('refuses a read-only target, naming the toggle', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const res = await create(t.token, { markup: POLL(ds) });
    expect(res.status).toBe(400);
    const text = await details(res);
    expect(text).toMatch(/^invalid_refs/);
    expect(text).toMatch(/read-only/);
    expect(text).toMatch(/access: readwrite/);
  });

  it('refuses a dataset the publisher does not own, even a public readwrite one', async () => {
    const owner = await mintToken('owner');
    const ds = await dataset(owner.token, { access: 'readwrite', visibility: 'public' });
    const other = await mintToken('other');
    // Reading it is fine (the link-readable rule) …
    const reads = await create(other.token, { markup: `<Helmet><Query name="q">{\`select * from ref_${ds}\`}</Query></Helmet><div><Question data="$q" viz={{"kind":"table"}} /></div>` });
    expect(reads.status).toBe(201);
    // … writing it is not.
    const writes = await create(other.token, { markup: POLL(ds) });
    expect(writes.status).toBe(400);
    const text = await details(writes);
    expect(text).toMatch(/^invalid_refs/);
    expect(text).toMatch(/own/);
  });

  it('dry-runs the SQL: a SELECT in a Mutation and an unknown column are invalid_sql with the engine message', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    const select = await create(t.token, { markup: POLL(ds, `select * from ref_${ds}`) });
    expect(select.status).toBe(400);
    expect(await details(select)).toMatch(/^invalid_sql.*INSERT, UPDATE or DELETE/);
    const column = await create(t.token, { markup: POLL(ds, `insert into ref_${ds} (chioce, who) values ($choice, $who)`) });
    expect(column.status).toBe(400);
    expect(await details(column)).toMatch(/^invalid_sql.*chioce/);
  });

  it('a Button bound to a query, and a mutation naming two datasets, are structural errors (preview agrees)', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    const wrong = POLL(ds).replace('run="$vote"', 'run="$tally"');
    const pub = await create(t.token, { markup: wrong });
    expect(pub.status).toBe(400);
    expect(await details(pub)).toMatch(/needs a <Mutation>/);
    const pre = await previewRoute(request('/api/preview', { method: 'POST', token: t.token, json: { markup: wrong } }));
    expect(pre.status).toBe(400);
    expect(await details(pre)).toMatch(/needs a <Mutation>/);
  });

  it('the toggle is checked at every write: a PUT after the dataset went read-only is refused', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    const doc = ((await (await create(t.token, { markup: POLL(ds) })).json()) as { id: string }).id;
    await putArtifactRoute(request(`/api/artifacts/${ds}`, { method: 'PUT', token: t.token, json: { dataset: ROWS, access: 'read' } }), params({ id: ds }));
    const res = await putArtifactRoute(request(`/api/artifacts/${doc}`, { method: 'PUT', token: t.token, json: { markup: POLL(ds) } }), params({ id: doc }));
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/read-only/);
  });
});
