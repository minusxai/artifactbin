/**
 * AN ARCHIVED VERSION WRITTEN FOR THE PREVIOUS QUERY ENGINE renders converted
 * (lib/archived-version, lib/migrate/sqlite/stored): history stays as stored,
 * and `?version=N` of an unmarked version runs the migration's converter on
 * the fly — while a version already in the current syntax is never converted.
 */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from '@/__tests__/harness';
import { GET as serveArtifact } from '@/app/a/[id]/raw/route';
import { GET as pageData } from '@/app/api/page/artifact/[id]/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import { documentEditBody } from './prepared-document';
import { dataflowForRow, getArtifactById } from '@/lib/artifacts';
import { archivedVersionForActor, servedRow } from '@/lib/archived-version';
import { PREVIOUS_ENGINE } from '@/lib/story/data-syntax';
import { mintToken } from '@/lib/tokens';

const harness = useAppHarness();
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const RATIO = '<Helmet><Query name="ratio">{`select 7 / 2 as h`}</Query></Helmet><DataTable data="$ratio" />';

/** Version 1 holds RATIO, version 2 is the head; `previous` strips version 1's marker, as the previous engine stored it. */
async function history(previous: boolean) {
  const owner = await mintToken('mxmx_test_archived_syntax');
  const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: RATIO } }));
  expect(created.status, await created.clone().text()).toBe(201);
  const id = (await created.json()).id as string;
  const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody((await getArtifactById(id))!, { source: '<p>Version two</p>', whole: true }) }), params({ id }));
  expect(replaced.status, await replaced.clone().text()).toBe(200);
  if (previous) {
    const db = await harness.db();
    const stripped = await db.query("UPDATE artifact_versions SET meta=meta-'dataSyntax' WHERE artifact_id=$1 AND version=1", [id]);
    expect(stripped.rowCount).toBe(1);
  }
  return { owner, id };
}

describe('?version=N of a version written for the previous engine', () => {
  it('serves the converted document, and leaves the stored version as it was', async () => {
    const { owner, id } = await history(true);
    const html = await (await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id }))).text();
    expect(html).toContain('select 7 * 1.0 / 2 as h');
    expect(html).not.toContain('select 7 / 2 as h');
    const page = JSON.stringify(await (await pageData(request(`/api/page/artifact/${id}?version=1`, { token: owner.token }), params({ id }))).json());
    expect(page).toContain('select 7 * 1.0 / 2 as h');
    const db = await harness.db();
    expect((await db.query<{ marked: boolean }>("SELECT meta ? 'dataSyntax' AS marked FROM artifact_versions WHERE artifact_id=$1 AND version=1", [id])).rows).toEqual([{ marked: false }]);
  });

  it('never converts a version already in the current syntax', async () => {
    const { owner, id } = await history(false);
    const html = await (await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id }))).text();
    expect(html).toContain('select 7 / 2 as h');
    expect(html).not.toContain('* 1.0');
  });
});

describe('?version=N of a version the converter cannot carry over', () => {
  /** Needs a person: the _signals mutation computes from its own column. */
  const OLD = '<Helmet><Value name="step" type="number" default={0} /><Query name="steps">{`select $step as s`}</Query><Mutation name="next">{`update _signals set step = step + 1`}</Mutation></Helmet><DataTable data="$steps" /><Button run="$next">Next</Button>';
  const HEAD = '<Helmet><Query name="steps">{`select 424242 as s`}</Query></Helmet><DataTable data="$steps" />';

  async function manualHistory() {
    const owner = await mintToken('mxmx_test_archived_manual');
    const created = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: owner.token, json: { markup: HEAD } }));
    expect(created.status, await created.clone().text()).toBe(201);
    const id = (await created.json()).id as string;
    const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token, json: documentEditBody((await getArtifactById(id))!, { source: HEAD.replace('424242', '424243'), whole: true }) }), params({ id }));
    expect(replaced.status, await replaced.clone().text()).toBe(200);
    // Version 1 as the previous engine stored it: its source, no marker.
    const db = await harness.db();
    await db.query("UPDATE artifact_versions SET source=$2,document=NULL,meta='{}'::jsonb WHERE artifact_id=$1 AND version=1", [id, OLD]);
    return { owner, id };
  }

  it('answers every query with the previous-engine message instead of running anything', async () => {
    const { owner, id } = await manualHistory();
    const html = await (await serveArtifact(request(`/a/${id}/raw?version=1`, { token: owner.token }), params({ id }))).text();
    expect(html).toContain(PREVIOUS_ENGINE);
    expect(html).not.toContain('42424');
    const head = (await getArtifactById(id))!;
    const at = await archivedVersionForActor({ tokenId: owner.id, userId: null }, head, 1);
    if (at === 'not_found') throw new Error('version 1 should be readable');
    expect(at.previousEngine).toBe(true);
    const ran = await dataflowForRow(await servedRow(head, at));
    expect(ran?.state).toMatchObject({ values: { step: 0 }, tables: {}, errors: { steps: PREVIOUS_ENGINE } });
    expect(JSON.stringify(ran)).not.toContain('42424');
  });
});
