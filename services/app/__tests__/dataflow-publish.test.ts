/**
 * The dataflow at the publish door: `<Value>`/`<Query>` in <Helmet> and
 * `$name` references in the body are validated on EVERY markup write —
 * create, PUT, preview — with the same rules (a draft that previews must
 * publish). SQL `ref_<id>` tables are real dataset refs: they must resolve to
 * the caller's datasets, and they land in `meta.refs` so dependents warnings
 * and ownership checks keep working.
 */
import { storedMarkup } from '@/test/helpers/echo';
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as getArtifactRoute, PUT as putArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as previewRoute } from '@/app/api/preview/route';
import { getArtifactById } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
const preview = async (token: string, markup: string) =>
  previewRoute(request('/api/preview', { method: 'POST', token: token, json: { markup } }));

const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }];

async function dataset(token: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await create(token, { dataset: ROWS, ...extra });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

const helmet = (ds: string, extra = '') =>
  '<Helmet><title>Sales</title>' +
  '<Value name="region" type="string" />' +
  `<Query name="sales">{\`select region, sum(revenue) revenue from ref_${ds} where $region is null or region = $region group by 1\`}</Query>` +
  extra + '</Helmet>';
const BODY = '<div><select value="$region" options="$sales" /><Question data="$sales" viz={{"kind":"table"}} /></div>';

const details = async (res: Response): Promise<string> => {
  const body = (await res.json()) as { error: string; details: Array<{ message: string } | string> };
  return body.error + ': ' + body.details.map((d) => (typeof d === 'string' ? d : d.message)).join(' | ');
};

describe('dataflow at the publish door', () => {
  it('publishes a document with Value/Query declarations and $name references; SQL refs land in meta.refs', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const res = await create(t.token, { markup: helmet(ds) + BODY });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; markup?: string; markup_changed?: boolean };
    expect(storedMarkup(body, helmet(ds) + BODY)).toContain(`ref_${ds}`);
    const row = await getArtifactById(body.id);
    expect((row!.meta as { refs: Array<{ id: string; kind: string }> }).refs).toEqual([{ id: ds, kind: 'dataset' }]);
  });

  it('rejects an undeclared $name with the token named, on create AND preview', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const src = helmet(ds) + '<Question data="$sale" />';
    const res = await create(t.token, { markup: src });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/invalid_jsx.*\$sale/);
    const pre = await preview(t.token, src);
    expect(pre.status).toBe(400);
    expect(await details(pre)).toMatch(/\$sale/);
  });

  it('rejects a Query whose SQL binds an undeclared $param', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const res = await create(t.token, {
      markup: '<Helmet>' + `<Query name="q">{\`select * from ref_${ds} where region = $nowhere\`}</Query>` + '</Helmet><Question data="$q" />',
    });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/\$nowhere/);
  });

  it('rejects a dependency cycle between queries', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup: '<Helmet><Query name="a">{`select * from b`}</Query><Query name="b">{`select * from a`}</Query></Helmet><Question data="$a" />',
    });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/cycle/i);
  });

  it('rejects a duplicate name across Value and Query', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup: '<Helmet><Value name="x" /><Query name="x">{`select 1`}</Query></Helmet><Question data="$x" />',
    });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/"x".*twice/);
  });

  it('rejects a malformed <Value> inside Helmet with a precise message', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<Helmet><Value name="n" type="number" default="lots" /></Helmet><p>x</p>' });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/default.*number/);
  });

  it('rejects <Value>/<Query> in the body, pointing at Helmet', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, { markup: '<div><Value name="x" /><Query name="q">{`select 1`}</Query></div>' });
    expect(res.status).toBe(400);
    const msg = await details(res);
    expect(msg).toMatch(/<Value>.*Helmet/);
    expect(msg).toMatch(/<Query>.*Helmet/);
  });

  it('rejects SQL that reads a PRIVATE foreign dataset, and a ref that is not a dataset', async () => {
    // Public/unlisted foreign refs RESOLVE (refs-readable.test.ts); the line
    // that holds is private — uniform "does not resolve", never an oracle.
    const mine = await mintToken('mine');
    const owner = await createUser({ email: 'dataflow-owner@example.com' });
    const theirs = await mintToken('theirs');
    await claimToken(owner.id, theirs.token);
    const foreign = await dataset(theirs.token, { visibility: 'private' });
    const res = await create(mine.token, { markup: `<Helmet><Query name="q">{\`select * from ref_${foreign}\`}</Query></Helmet><Question data="$q" />` });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(new RegExp(`invalid_refs.*ref:${foreign}`));

    const doc = await create(mine.token, { markup: '<p>not data</p>' });
    const docId = ((await doc.json()) as { id: string }).id;
    const res2 = await create(mine.token, { markup: `<Helmet><Query name="q">{\`select * from ref_${docId}\`}</Query></Helmet><Question data="$q" />` });
    expect(res2.status).toBe(400);
    expect(await details(res2)).toMatch(/is a markup artifact.*needs a dataset/);
  });

  it('runs the same rules on PUT', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const created = await create(t.token, { markup: helmet(ds) + BODY });
    const id = ((await created.json()) as { id: string }).id;
    const bad = await putArtifactRoute(
      request(`/api/artifacts/${id}`, { method: 'PUT', token: t.token, json: { markup: helmet(ds) + '<Question data="$nope" />' } }),
      params({ id }),
    );
    expect(bad.status).toBe(400);
    expect(await details(bad)).toMatch(/\$nope/);
    // The document is untouched.
    const got = await getArtifactRoute(request(`/api/artifacts/${id}`, { token: t.token }), params({ id }));
    expect(((await got.json()) as { markup: string }).markup).toContain('data="$sales"');
  });

  it('accepts a table Value and a query over it, with no dataset at all', async () => {
    const t = await mintToken('t');
    const res = await create(t.token, {
      markup: '<Helmet><Value name="tiny" type="table" value={[{"a":1},{"a":2}]} /><Query name="q">{`select sum(a) total from tiny`}</Query></Helmet><Number data="$q" col="total" />',
    });
    expect(res.status).toBe(201);
    const row = await getArtifactById(((await res.json()) as { id: string }).id);
    expect((row!.meta as { refs: unknown[] }).refs).toEqual([]);
  });
});

describe('dataflow at publish: the SQL dry run', () => {
  it('rejects SQL that cannot bind against the real dataset columns, naming the query and the column', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const res = await create(t.token, {
      markup: `<Helmet><Query name="q">{\`select revenu from ref_${ds}\`}</Query></Helmet><Question data="$q" />`,
    });
    expect(res.status).toBe(400);
    const msg = await details(res);
    expect(msg).toMatch(/invalid_sql/);
    expect(msg).toMatch(/"q"/);
    expect(msg).toMatch(/revenu/);
    expect(msg).toMatch(/revenue/); // the engine's candidate
  });

  it('rejects a non-SELECT statement', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const res = await create(t.token, {
      markup: `<Helmet><Query name="q">{\`drop table ref_${ds}\`}</Query></Helmet><Question data="$q" />`,
    });
    expect(res.status).toBe(400);
    expect(await details(res)).toMatch(/only SELECT/);
  });

  it('checks a vega-lite encoding against the QUERY result columns', async () => {
    const t = await mintToken('t');
    const ds = await dataset(t.token);
    const bad = await create(t.token, {
      markup: helmet(ds) + '<Question data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region"},"y":{"field":"total","type":"quantitative"}}}}} />',
    });
    expect(bad.status).toBe(400);
    expect(await details(bad)).toMatch(/"total".*sales/);
    const good = await create(t.token, {
      markup: helmet(ds) + '<Question data="$sales" viz={{"kind":"vega-lite","spec":{"mark":"bar","encoding":{"x":{"field":"region"},"y":{"field":"revenue","type":"quantitative"}}}}} />',
    });
    expect(good.status).toBe(201);
  });
});
