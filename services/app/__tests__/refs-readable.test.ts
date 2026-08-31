/**
 * `ref:` resolution is READABILITY-scoped, not ownership-scoped: a caller may
 * reference their own artifacts AND any link-readable (public/unlisted) one.
 *
 * Why: assets and documents routinely land under different identities — two
 * agent sessions each minting their own anonymous token, or an unclaimed
 * upload referenced from an account-owned document. Anonymous assets are born
 * public, so ownership-scoping made the obvious flow ("publish the image, then
 * reference it") fail with invalid_refs for no reason a user could see.
 *
 * The rule mirrors canReadArtifact for the anonymous viewer: public and
 * unlisted resolve for anyone; PRIVATE stays invisible cross-identity (the
 * same uniform "does not resolve" as a nonexistent id — never an existence
 * oracle). Applied at every altitude: the publish door, the document's own
 * render-time dataflow, and the editor's draft queries.
 */
import { describe, expect, it } from 'vitest';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as draftQueryRoute } from '@/app/api/query/route';
import { dataflowForRow, getArtifactById, refDataForRow } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ROWS = [{ region: 'EU', revenue: 837 }, { region: 'NA', revenue: 1200 }];

const create = async (token: string, body: Record<string, unknown>) =>
  createArtifactRoute(request('/api/artifacts', { method: 'POST', token: token, json: body }));

const queryDoc = (ds: string) =>
  `<Helmet><Query name="sales">{\`select * from ref_${ds}\`}</Query></Helmet><Question data="$sales" viz={{"kind":"table"}} />`;

describe('link-readable refs', () => {
  it('a PUBLIC image published by one token is referenceable by another, and renders', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const img = (await (await create(a.token, { image: PNG })).json()) as { id: string; visibility: string };
    expect(img.visibility).toBe('public');

    const res = await create(b.token, { markup: `<div className="p-4"><img src="ref:${img.id}" alt="x" /></div>` });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as { id: string };

    // Render-time resolution must agree with the door that admitted the ref.
    const row = await getArtifactById(doc.id);
    const refData = await refDataForRow(row!);
    expect(refData[img.id]).toMatchObject({ kind: 'image' });
  });

  it('a PUBLIC dataset published by one token feeds another token\'s <Query>', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const ds = (await (await create(a.token, { dataset: ROWS })).json()) as { id: string };

    const res = await create(b.token, { markup: queryDoc(ds.id) });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as { id: string };

    const flow = await dataflowForRow((await getArtifactById(doc.id))!);
    expect(flow!.state.tables.sales.rows).toEqual(ROWS);
  });

  it('an UNLISTED foreign dataset resolves too — link-readable is the rule', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const created = await create(a.token, { dataset: ROWS, visibility: 'unlisted' });
    expect(created.status).toBe(201);
    const ds = (await created.json()) as { id: string };
    expect((await create(b.token, { markup: queryDoc(ds.id) })).status).toBe(201);
  });

  it('a PRIVATE foreign dataset stays invisible — the uniform "does not resolve"', async () => {
    const owner = await createUser({ email: 'refs-owner@example.com' });
    const t = await mintToken('owner');
    await claimToken(owner.id, t.token);
    const created = await create(t.token, { dataset: ROWS, visibility: 'private' });
    const ds = (await created.json()) as { id: string; visibility: string };
    expect(ds.visibility).toBe('private');

    const stranger = await mintToken('stranger');
    const res = await create(stranger.token, { markup: queryDoc(ds.id) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details: string[] };
    expect(body.error).toBe('invalid_refs');
    expect(body.details.join(' ')).toMatch(/does not resolve/);
  });

  it('the editor\'s draft queries see the same widened scope', async () => {
    const a = await mintToken('a');
    const b = await mintToken('b');
    const ds = (await (await create(a.token, { dataset: ROWS })).json()) as { id: string };
    const res = await draftQueryRoute(request('/api/query', { method: 'POST', token: b.token, json: { markup: queryDoc(ds.id) } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tables: Record<string, { rows: unknown[] }> };
    expect(body.tables.sales.rows).toEqual(ROWS);
  });
});
