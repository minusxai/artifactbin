/**
 * RESTORING HISTORY AND READING TO EDIT, before the migration reaches a
 * document (lib/story/data-syntax): a version written for the previous engine
 * is read back converted (lib/migrate/sqlite/stored inCurrentSyntax), so a
 * restore lands the converted, marked document; one that needs a person says
 * it cannot be restored as it stands. An editor's read-back of an unmarked
 * head is the converted head, so an author never edits the previous syntax.
 */
import { describe, expect, it } from 'vitest';
import { agentCookie, request, useAppHarness } from './harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { GET as readRoute } from '@/app/api/artifacts/[id]/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import { GET as versionRoute } from '@/app/api/artifacts/[id]/versions/[version]/route';
import { GET as mineRoute } from '@/app/api/my/artifacts/[id]/route';
import { GET as myVersionRoute } from '@/app/api/my/artifacts/[id]/versions/[version]/route';
import { documentEditBody } from './prepared-document';
import { getArtifactById } from '@/lib/artifacts';
import { graphSource, type DocumentGraph } from '@/lib/story/document-graph';
import { mintToken } from '@/lib/tokens';

const harness = useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const RATIO = '<Helmet><Query name="ratio">{`select 7 / 2 as h`}</Query></Helmet><DataTable data="$ratio" />';
const MANUAL = '<Helmet><Value name="step" type="number" default={0} /><Query name="steps">{`select $step as s`}</Query><Mutation name="next">{`update _signals set step = step + 1`}</Mutation></Helmet><DataTable data="$steps" /><Button run="$next">Next</Button>';

/** Version 1 as the previous engine stored it (`source`, no marker), version 2 the head. */
async function history(version1: string | null) {
  const owner = await mintToken('mxmx_test_unmigrated_revert');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: RATIO, visibility: 'unlisted' } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody((await getArtifactById(id))!, { source: '<p>Version two</p>', whole: true }) }), params({ id }));
  expect(replaced.status, await replaced.clone().text()).toBe(200);
  const db = await harness.db();
  if (version1) await db.query("UPDATE artifact_versions SET source=$2,document=NULL,meta='{}'::jsonb WHERE artifact_id=$1 AND version=1", [id, version1]);
  else await db.query("UPDATE artifact_versions SET meta=meta-'dataSyntax' WHERE artifact_id=$1 AND version=1", [id]);
  return { owner, id, cookie: await agentCookie([owner.id]) };
}

const json = async (response: Response) => { expect(response.status, await response.clone().text()).toBe(200); return (await response.json()) as Record<string, any>; };

describe('an archived version written for the previous engine, read to restore', () => {
  it('reads back converted and marked at the token and browser version doors, leaving history as stored', async () => {
    const { owner, id, cookie } = await history(null);
    for (const body of [
      await json(await versionRoute(request(`/api/artifacts/${id}/versions/1`, { token: owner.token }), params({ id, version: '1' }))),
      await json(await myVersionRoute(request(`/api/my/artifacts/${id}/versions/1`, { cookie }), params({ id, version: '1' }))),
    ]) {
      expect(body.markup).toContain('select 7 * 1.0 / 2 as h');
      expect(body.meta.dataSyntax).toBe(2);
      expect(body.previous_engine).toBeUndefined();
    }
    const db = await harness.db();
    expect((await db.query<{ marked: boolean }>("SELECT meta ? 'dataSyntax' AS marked FROM artifact_versions WHERE artifact_id=$1 AND version=1", [id])).rows).toEqual([{ marked: false }]);
  });

  it('restoring it through a whole replacement (the browser and CLI restore) lands the converted, marked document', async () => {
    const { owner, id } = await history(null);
    const archived = await json(await versionRoute(request(`/api/artifacts/${id}/versions/1`, { token: owner.token }), params({ id, version: '1' })));
    const restored = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody((await getArtifactById(id))!, { source: archived.markup, whole: true }) }), params({ id }));
    expect(restored.status, await restored.clone().text()).toBe(200);
    const head = (await getArtifactById(id))!;
    expect(head.source).toContain('select 7 * 1.0 / 2 as h');
    expect(head.meta.dataSyntax).toBe(2);
    expect(head.version).toBe(3);
  });

  it('says a version that needs a person cannot be restored as it stands', async () => {
    const { owner, id, cookie } = await history(MANUAL);
    for (const body of [
      await json(await versionRoute(request(`/api/artifacts/${id}/versions/1`, { token: owner.token }), params({ id, version: '1' }))),
      await json(await myVersionRoute(request(`/api/my/artifacts/${id}/versions/1`, { cookie }), params({ id, version: '1' }))),
    ]) {
      expect(body.markup).toBe(MANUAL);
      expect(body.previous_engine).toMatch(/^Version 1 was written for the previous query engine .*cannot be restored as it stands/);
    }
  });
});

describe('an unmarked head, read back to edit', () => {
  async function unmarkedHead(markup = RATIO) {
    const owner = await mintToken('mxmx_test_unmigrated_readback');
    const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup, visibility: 'unlisted' } }));
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await created.json()).id as string;
    await (await harness.db()).query("UPDATE artifacts SET meta=meta-'dataSyntax' WHERE id=$1", [id]);
    return { owner, id, cookie: await agentCookie([owner.id]) };
  }

  it('is the converted head for its editor — markup, graph, edit id and version all of it', async () => {
    const { owner, id } = await unmarkedHead();
    const body = await json(await readRoute(request(`/api/artifacts/${id}`, { token: owner.token }), params({ id })));
    expect(body.markup).toContain('select 7 * 1.0 / 2 as h');
    expect(graphSource(body.document as DocumentGraph)).toBe(body.markup);
    const head = (await getArtifactById(id))!;
    expect(head).toMatchObject({ version: 2, edit_id: body.edit_id, meta: { dataSyntax: 2 } });
    expect(body.version).toBe(2);
  });

  it('is the converted head at the browser editor door too', async () => {
    const { id, cookie } = await unmarkedHead();
    const body = await json(await mineRoute(request(`/api/my/artifacts/${id}`, { cookie }), params({ id })));
    expect(body.markup).toContain('select 7 * 1.0 / 2 as h');
    expect((await getArtifactById(id))!.meta.dataSyntax).toBe(2);
  });

  it('is served converted to a reader who cannot edit, without writing anything', async () => {
    const { id } = await unmarkedHead();
    const reader = await mintToken('mxmx_test_unmigrated_reader');
    const body = await json(await readRoute(request(`/api/artifacts/${id}`, { token: reader.token }), params({ id })));
    expect(body.markup).toContain('select 7 * 1.0 / 2 as h');
    expect((await getArtifactById(id))!).toMatchObject({ version: 1, source: expect.stringContaining('select 7 / 2 as h') });
    expect((await getArtifactById(id))!.meta.dataSyntax).toBeUndefined();
  });
});
