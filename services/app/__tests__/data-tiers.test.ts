/**
 * The data file tiers: datasets (one flat table), viz
 * recipes (inert spec templates), images — plus the markup tier's `ref:`
 * reference graph: uniform syntax, publish-time resolution, column-binding
 * validation, dependents warnings on refresh.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as getArtifactRoute, PUT as putArtifact } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { getArtifactById, refDataForRow } from '@/lib/artifacts';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';

const BASE = 'http://localhost:3000';
const harness = useAppHarness();

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

const ROWS = [
  { month: 'Jan', mrr: 100, region: 'NA' },
  { month: 'Feb', mrr: 140, region: 'EU' },
  { month: 'Mar', mrr: 180, region: 'NA' },
];

const RECIPE = {
  description: 'Simple bar',
  engine: 'vega-lite',
  bindings: [
    { name: 'x', label: 'X', accepts: ['nominal', 'temporal'] },
    { name: 'y', label: 'Y', accepts: ['quantitative'] },
  ],
  template: {
    mark: 'bar',
    encoding: { x: { field: '{{x}}', type: '{{x:kind}}' }, y: { field: '{{y}}', type: 'quantitative' } },
  },
};

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function create(token: string, body: Record<string, unknown>) {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));
  return { status: res.status, body: await res.json() };
}

describe('dataset tier', () => {
  it('stores rows, infers + echoes columns', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, { title: 'sales', dataset: ROWS });
    expect(status).toBe(201);
    expect(body.format).toBe('dataset');
    expect(body.columns).toEqual([
      { name: 'month', type: 'string' },
      { name: 'mrr', type: 'number' },
      { name: 'region', type: 'string' },
    ]);
    expect(body.rowCount).toBe(3);
  });

  it('declared columns win and rows are validated against them (422 names row+column)', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, {
      title: 'bad',
      dataset: [{ n: 'x' }],
      columns: [{ name: 'n', type: 'number' }],
    });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_dataset');
    expect(JSON.stringify(body.details)).toMatch(/row 0.*n.*number/);
  });

  it('rejects non-flat rows', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, { title: 'nested', dataset: [{ a: { b: 1 } }] });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_dataset');
  });

  it('serves rows as JSON at /a/<id>', async () => {
    const t = await mintToken('t');
    const { body } = await create(t.token, { title: 'sales', dataset: ROWS });
    const res = await serveArtifact(request(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await res.json()).toEqual(ROWS);
  });
});

describe('viz recipe tier', () => {
  it('stores a recipe and echoes its slots', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, { title: 'bar', viz: RECIPE });
    expect(status).toBe(201);
    expect(body.format).toBe('viz');
    expect(body.slots).toEqual([
      { name: 'x', accepts: ['nominal', 'temporal'] },
      { name: 'y', accepts: ['quantitative'] },
    ]);
  });

  it('rejects a template with an undeclared token, naming it', async () => {
    const t = await mintToken('t');
    const bad = { ...RECIPE, template: { mark: 'bar', encoding: { x: { field: '{{mystery}}' } } } };
    const { status, body } = await create(t.token, { title: 'bad', viz: bad });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_viz');
    expect(JSON.stringify(body.details)).toContain('mystery');
  });
});

const SVG = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>',
).toString('base64');

describe('image tier', () => {
  /*
   * An upload is CONVERTED at the door (lib/images/optimise): capped, turned
   * into webp, and measured. So what is served is what was STORED, which is
   * not necessarily what was sent — and the row is the record of that, which
   * is why both are read from the same place rather than from the fixture.
   */
  it('stores a data-url image and serves what it stored', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, { title: 'px', image: PIXEL });
    expect(status).toBe(201);
    expect(body.format).toBe('image');
    const row = await getArtifactById(body.id);
    const stored = (row!.meta as { contentType?: string }).contentType;
    const res = await serveArtifact(request(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(stored);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(20);
  });

  it('records the box the image occupies, so markup can reserve it', async () => {
    const t = await mintToken('t');
    const { body } = await create(t.token, { title: 'px', image: PIXEL });
    const meta = (await getArtifactById(body.id))!.meta as { width?: number; height?: number; placeholder?: string };
    expect([meta.width, meta.height]).toEqual([1, 1]);
    expect(meta.placeholder).toMatch(/^data:image\/webp;base64,/);
  });

  it('keeps the bytes in the object store, not the content column', async () => {
    const t = await mintToken('t');
    const { body } = await create(t.token, { title: 'px', image: PIXEL });
    const row = await getArtifactById(body.id);
    expect(row!.content).toBe(''); // bytes are elsewhere; content is empty by design
    const meta = row!.meta as { objectKey?: string; bytes?: number; contentType?: string };
    expect(meta.objectKey).toMatch(/^image\//);
    expect(meta.bytes).toBeGreaterThan(20);
    // Whatever it became, the row and the store agree on it.
    expect(meta.contentType).toMatch(/^image\//);
  });

  it('dedupes identical images to one object key (content-addressed)', async () => {
    const t = await mintToken('t');
    const a = await create(t.token, { title: 'a', image: PIXEL });
    const b = await create(t.token, { title: 'b', image: PIXEL });
    const [ra, rb] = [await getArtifactById(a.body.id), await getArtifactById(b.body.id)];
    expect((ra!.meta as { objectKey: string }).objectKey).toBe((rb!.meta as { objectKey: string }).objectKey);
  });

  it('serves a bare image URL cacheable and a versioned one immutable', async () => {
    const t = await mintToken('t');
    const { body } = await create(t.token, { title: 'px', image: PIXEL });
    const bare = await serveArtifact(request(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(bare.headers.get('Cache-Control')).toContain('max-age=');
    expect(bare.headers.get('Cache-Control')).not.toContain('immutable');
    const versioned = await serveArtifact(request(`/a/${body.id}/raw?v=1`), params({ id: body.id }));
    expect(versioned.headers.get('Cache-Control')).toContain('immutable');
  });

  it('serves svg images under a locked-down CSP (no scripts on direct nav)', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, { title: 'svg', image: SVG });
    expect(status).toBe(201);
    const res = await serveArtifact(request(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
  });

  it('serves a legacy inline-data-url image row (pre-object-store back-compat)', async () => {
    // A row shaped like the old image tier: bytes in `content`, no objectKey.
    const t = await mintToken('t');
    const { body } = await create(t.token, { title: 'px', image: PIXEL });
    const db = await harness.db();
    await db.query(`UPDATE artifacts SET content = $1, meta = '{"contentType":"image/png"}' WHERE id = $2`, [PIXEL, body.id]);
    const res = await serveArtifact(request(`/a/${body.id}/raw`), params({ id: body.id }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(20);
  });

  it('rejects an image over the size cap (413)', async () => {
    const t = await mintToken('t');
    // Vitest env sets MAX_IMAGE_BYTES=5000; 6 KB of bytes trips it.
    const big = 'data:image/png;base64,' + Buffer.alloc(6000, 1).toString('base64');
    const { status, body } = await create(t.token, { title: 'big', image: big });
    expect(status).toBe(413);
    expect(body.error).toBe('image_too_large');
  });
});

describe('markup tier references', () => {
  /** A dataset read through a <Query> (the only way a document reaches one), bound as `$rows`. */
  const declared = (dsId: string) => `<Helmet><Query name="rows">{\`select * from ref_${dsId}\`}</Query></Helmet>`;
  const chart = (dsId: string, extra = '') => declared(dsId) + `<div data-design="tw" className="@container w-full">
  <Question data="$rows" viz={{ kind: "vega-lite", spec: { mark: "bar",
    encoding: { x: {field: "month"}, y: {field: "mrr", type: "quantitative"} } } }} height="400px" />${extra}
</div>`;

  it('publishes with a valid dataset ref and records it in meta.refs', async () => {
    const t = await mintToken('t');
    const ds = await create(t.token, { title: 'sales', dataset: ROWS });
    const { status, body } = await create(t.token, { title: 'story', markup: chart(ds.body.id) });
    expect(status).toBe(201);
    const got = await (await getArtifactRoute(request(`/api/artifacts/${body.id}`, { token: t.token }), params({ id: body.id }))).json();
    expect(got.refs).toEqual([{ id: ds.body.id, kind: 'dataset' }]);
  });

  it('rejects a missing ref, naming the id', async () => {
    const t = await mintToken('t');
    const { status, body } = await create(t.token, { title: 'story', markup: chart('zzzzzz') });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_refs');
    expect(JSON.stringify(body.details)).toContain('zzzzzz');
  });

  it("rejects another owner's PRIVATE ref (uniform not-found semantics)", async () => {
    // Public/unlisted foreign refs RESOLVE now (refs-readable.test.ts); the
    // uniform refusal holds where it must — private, same answer as missing.
    const owner = await createUser({ email: 'tiers-owner@example.com' });
    const a = await mintToken('a');
    await claimToken(owner.id, a.token);
    const b = await mintToken('b');
    const ds = await create(a.token, { title: 'sales', dataset: ROWS, visibility: 'private' });
    const { status, body } = await create(b.token, { title: 'story', markup: chart(ds.body.id) });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_refs');
  });

  it('validates encoding field bindings against the QUERY result columns', async () => {
    const t = await mintToken('t');
    const ds = await create(t.token, { title: 'sales', dataset: ROWS });
    const bad = declared(ds.body.id) + `<div data-design="tw"><Question data="$rows" viz={{ kind: "vega-lite", spec: { mark: "bar", encoding: { y: { field: "revenue", type: "quantitative" } } } }} height="300px" /></div>`;
    const { status, body } = await create(t.token, { title: 'story', markup: bad });
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_refs');
    const detail = JSON.stringify(body.details);
    expect(detail).toContain('revenue');
    expect(detail).toMatch(/month.*mrr.*region/);
  });

  it('validates recipe slot bindings (all slots bound, columns exist)', async () => {
    const t = await mintToken('t');
    const ds = await create(t.token, { title: 'sales', dataset: ROWS });
    const rc = await create(t.token, { title: 'bar', viz: RECIPE });
    const use = (bindings: string) => declared(ds.body.id) + `<div data-design="tw"><Question data="$rows" viz={{ kind: "recipe", recipe: "ref:${rc.body.id}", bindings: ${bindings} }} height="300px" /></div>`;

    const ok = await create(t.token, { title: 'ok', markup: use('{ x: "month", y: "mrr" }') });
    expect(ok.status).toBe(201);

    const missing = await create(t.token, { title: 'missing-slot', markup: use('{ x: "month" }') });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body.details)).toContain('y');

    const badCol = await create(t.token, { title: 'bad-col', markup: use('{ x: "month", y: "nope" }') });
    expect(badCol.status).toBe(400);
    expect(JSON.stringify(badCol.body.details)).toContain('nope');
  });

  it('image refs pass through URL attrs', async () => {
    const t = await mintToken('t');
    const img = await create(t.token, { title: 'px', image: PIXEL });
    const { status } = await create(t.token, {
      title: 'story',
      markup: `<div data-design="tw"><img src="ref:${img.body.id}" className="rounded" /></div>`,
    });
    expect(status).toBe(201);
  });

  it('resolves an image ref to the /raw bytes URL, not the HTML page', async () => {
    // The interpreter renders <img src={refData[id].url}>. `/a/<id>` is the HTML
    // page — an <img> pointed there loads to 0×0. Only `/a/<id>/raw` is bytes.
    const t = await mintToken('t');
    const img = await create(t.token, { title: 'px', image: PIXEL });
    const story = await create(t.token, {
      title: 'story',
      markup: `<div data-design="tw"><img src="ref:${img.body.id}" className="rounded" /></div>`,
    });
    const row = await getArtifactById(story.body.id);
    const refData = await refDataForRow(row!);
    expect(refData[img.body.id].kind).toBe('image');
    // /raw = bytes (a version query may follow for cache-busting); NOT /a/<id>.
    expect((refData[img.body.id] as { url: string }).url).toMatch(new RegExp(`^/a/${img.body.id}/raw`));
  });

  it('dataset refresh returns warnings naming dependents whose bindings broke', async () => {
    const t = await mintToken('t');
    const ds = await create(t.token, { title: 'sales', dataset: ROWS });
    const story = await create(t.token, { title: 'story', markup: chart(ds.body.id) });

    const res = await putArtifact(
      request(`/api/artifacts/${ds.body.id}`, { method: 'PUT', token: t.token, json: { title: 'sales', dataset: [{ month: 'Jan', revenue: 5 }] } }),
      params({ id: ds.body.id }),
    );
    expect(res.status).toBe(200); // warnings, never blocks
    const body = await res.json();
    expect(JSON.stringify(body.warnings)).toContain(story.body.id);
  });
});
