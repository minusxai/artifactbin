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
import { getArtifactById } from '@/lib/artifacts';
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
