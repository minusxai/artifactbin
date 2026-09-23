import {observedRequest} from '@/__tests__/conditional-request';
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
import { PATCH as patchArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { viewersWritePolicy } from '@artifactbin/utils';
import type { DatasetPolicy } from '@artifactbin/contracts';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as previewRoute } from '@/app/api/preview/route';
import { getArtifactById } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const create = (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
const ROWS = [{ choice: 'ramen', who: 'seed' }];
const dataset = async (token: string, extra: Record<string, unknown> = {}) => {
  const res = await create(token, { dataset: ROWS, ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};
const POLL = (ds: string, sql = `insert into public.rows (choice, who) values ($choice, $who)`) =>
  '<Helmet><Value name="choice" type="string" /><Value name="who" type="string" />'
  + `<Query name="tally" source="ref:${ds}">{\`select choice, count(*) votes from public.rows group by 1\`}</Query>`
  + `<Mutation name="vote" source="ref:${ds}">{\`${sql}\`}</Mutation></Helmet>`
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
    expect(storedMarkup(body, POLL(ds))).toContain(`<Mutation name="vote" source="ref:${ds}">`);
    const row = (await getArtifactById(body.id))!;
    expect((row.meta as { refs: Array<{ id: string; kind: string }> }).refs).toEqual([{ id: ds, kind: 'dataset' }]);
  });

  it('refuses a read-only target, naming the push flag that opens it', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'read' });
    const res = await create(t.token, { markup: POLL(ds) });
    expect(res.status).toBe(400);
    const text = await details(res);
    expect(text).toMatch(/^invalid_refs/);
    expect(text).toMatch(/read-only/);
    // The publish-time refusal is the FIRST one an agent meets, so it names the command it can run.
    expect(text).toContain('afbin push <file> --type dataset --access readwrite');
    expect(text).toContain('/api/my/artifacts/');
  });

  it('refuses a dataset the publisher does not own, even a public readwrite one', async () => {
    const owner = await mintToken('owner');
    const ds = await dataset(owner.token, { access: 'readwrite', visibility: 'public' });
    const other = await mintToken('other');
    // Reading it is fine (the link-readable rule) …
    const reads = await create(other.token, { markup: `<Helmet><Query name="q" source="ref:${ds}">{\`select * from public.rows\`}</Query></Helmet><div><Question data="$q" viz={{"kind":"table"}} /></div>` });
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
    const select = await create(t.token, { markup: POLL(ds, `select * from public.rows`) });
    expect(select.status).toBe(400);
    expect(await details(select)).toMatch(/^invalid_sql.*INSERT, UPDATE or DELETE/);
    const column = await create(t.token, { markup: POLL(ds, `insert into public.rows (chioce, who) values ($choice, $who)`) });
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

  /*
   * A DATASET POLICY IS A PUBLISH-TIME CHECK TOO. A `<Mutation>` behind a
   * button is written once and clicked by everyone the policy speaks for, so
   * the analysis a click performs runs HERE, with placeholder bindings — a
   * statement the policy denies, or one that cannot be analyzed at all, is a
   * 400 naming the mutation, not a button that answers 403 to every viewer.
   */
  const setPolicy = async (token: string, id: string, policy: DatasetPolicy) => {
    const res = await patchArtifactRoute(
      await observedRequest(`/api/artifacts/${id}`, { method: 'PATCH', token, json: { policy, expectedPolicyRevision: 0 } }),
      params({ id }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const UPDATES_WHO: DatasetPolicy = {
    version: 1,
    enforcement: 'enabled',
    tables: [{ table: { schema: 'public', name: 'rows' }, update_permissions: [{ role: 'viewer', permission: { columns: ['who'], filter: {}, check: {} } }] }],
  };
  const ROW_ACTION = (ds: string, sql: string) =>
    `<Helmet><Query name="tasks" source="ref:${ds}">{\`select * from public.rows\`}</Query>`
    + `<Mutation name="claim" source="ref:${ds}">{\`${sql}\`}</Mutation></Helmet>`
    + '<For each={$tasks} keyBy="choice"><Button run="$claim">Claim</Button></For>';

  it('refuses a mutation the dataset policy denies, naming the mutation and the reason', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    await setPolicy(t.token, ds, UPDATES_WHO);
    // The policy permits no INSERT at all …
    const inserts = await create(t.token, { markup: POLL(ds) });
    expect(inserts.status, await inserts.clone().text()).toBe(400);
    const text = await details(inserts);
    expect(text).toMatch(/^invalid_sql/);
    expect(text).toContain('<Mutation name="vote">');
    expect(text).toContain('Dataset policy');
    // … and no write to `choice`, even from a row action it can analyze.
    const column = await create(t.token, { markup: ROW_ACTION(ds, `update public.rows set choice='taken' where who=$_row.who`) });
    expect(column.status).toBe(400);
    expect(await details(column)).toContain('<Mutation name="claim">');
  });

  it('publishes a $_row row action a viewers-write policy admits', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    await setPolicy(t.token, ds, viewersWritePolicy());
    const res = await create(t.token, { markup: ROW_ACTION(ds, `update public.rows set who='taken' where choice=$_row.choice`) });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  /*
   * THE STATEMENT THE SKILL REFERENCE HANDS THE AGENT. Every `set_*` example in
   * references/markup-editing.md guards its write with `is not distinct from`,
   * and the word FROM in that operator phrase read as an UPDATE ... FROM clause:
   * a released tracker could not publish its own documented row action.
   */
  it('publishes the documented set_* row action, concurrency guard and all', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    await setPolicy(t.token, ds, viewersWritePolicy());
    const markup = `<Helmet><Query name="tasks" source="ref:${ds}">{\`select * from public.rows\`}</Query>`
      + `<Mutation name="set_who" expectedAffected={1} source="ref:${ds}">{\`update public.rows set who = $_value where choice = $_row.choice and who is not distinct from $_row.who\`}</Mutation></Helmet>`
      + '<DataTable data="$tasks" rowKey="choice"><Column col="choice"/><Column col="who"><Select value="$_row.who" options={["seed","alice"]} run="$set_who"/></Column></DataTable>';
    const res = await create(t.token, { markup });
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it('the toggle is checked at every write: a PUT after the dataset went read-only is refused', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token, { access: 'readwrite' });
    const doc = ((await (await create(t.token, { markup: POLL(ds) })).json()) as { id: string }).id;
    await putArtifactRoute(await observedRequest(`/api/artifacts/${ds}`, { method: 'PUT', token: t.token, json: { dataset: ROWS, access: 'read' } }), params({ id: ds }));
    const res = await putArtifactRoute(await observedRequest(`/api/artifacts/${doc}`, { method: 'PUT', token: t.token, json: { markup: POLL(ds) } }), params({ id: doc }));
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/read-only/);
  });
});
