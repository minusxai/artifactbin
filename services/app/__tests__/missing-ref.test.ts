/**
 * Missing-ref runtime degradation, server half: deleting a dataset AFTER a
 * document's <Query> read it must leave the document servable — the query
 * reports the missing table (the embed shows the error) and nothing throws.
 */
import { describe, expect, it } from 'vitest';
import { DELETE as deleteRoute, GET as getArtifactRoute } from '@/app/api/artifacts/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { dataflowForRow, getArtifactById, refDataForRow } from '@/lib/artifacts';


import { mintToken } from '@/lib/tokens';
import { useAppHarness, request } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe('deleted-ref serving', () => {
  it('refDataForRow skips a deleted dataset without throwing; the doc row survives', async () => {
    const t = await mintToken('t');
    const ds = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { dataset: [{ region: 'EU', revenue: 837 }] } }),
      )
    ).json();

    const doc = await (
      await createArtifactRoute(
        request('/api/artifacts', { method: 'POST', token: t.token, json: { markup: `<Helmet><Query name="rows">{\`select * from ref_${ds.id}\`}</Query></Helmet><div data-design="tw" className="p-8"><Question data="$rows" title="Revenue" /></div>` } }),
      )
    ).json();
    expect(doc.format).toBe('markup');

    // The query runs while the dataset lives…
    let row = await getArtifactById(doc.id);
    expect(row).not.toBeNull();
    let flow = await dataflowForRow(row!);
    expect(flow!.state.tables.rows.rows).toEqual([{ region: 'EU', revenue: 837 }]);
    // (a dataset is never page data — refData carries recipes/images only)
    expect(await refDataForRow(row!)).toEqual({});

    // …then the dataset is deleted out from under the document (force: the
    // dependent gives this delete a 409 otherwise — see delete-protection tests).
    const del = await deleteRoute(request(`/api/artifacts/${ds.id}?force=true`, { method: 'DELETE', token: t.token }), params({ id: ds.id }));
    expect(del.status).toBe(200);

    row = await getArtifactById(doc.id);
    flow = await dataflowForRow(row!); // must not throw
    expect(flow!.state.tables.rows).toBeUndefined();
    expect(flow!.state.errors.rows).toMatch(new RegExp(`ref_${ds.id}`)); // the query names the missing table
    expect(await refDataForRow(row!)).toEqual({});

    // The document itself still reads back intact (meta.refs still names the dead id).
    const read = await getArtifactRoute(request(`/api/artifacts/${doc.id}`, { token: t.token }), params({ id: doc.id }));
    expect(read.status).toBe(200);
    expect(((await read.json()) as { refs: Array<{ id: string }> }).refs[0]?.id).toBe(ds.id);
  });
});
