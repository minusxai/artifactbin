/** Dataset reference resolution, read authorization and dataset file door refusals through the public interface. */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from '@/__tests__/harness';
import { ANONYMOUS_ACTOR } from '@/lib/accounts';
import { getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import {
  datasetResolverForActor, readFileRequest, referencedArtifactForRow,
  uploadFileRequest,
} from '@/lib/document-data';
import { account, datasetFixture } from './dataset-fixture';
import { seedArtifacts, setArtifact } from '@/__tests__/rows';

useAppHarness();

/** A stored markup document owned by `owner`, importing `datasetId` as `data`, with these refs. */
async function documentImporting(owner: { id: string; tokenId: string }, _datasetId: string, refs: Array<{ id: string; kind: string }> = []) {
  const id = `doc${Math.random().toString(36).slice(2, 8)}`;
  const source = `<html><body>Doc</body></html>`;
  await seedArtifacts((await getDb()), { id, token_id: owner.tokenId, user_id: owner.id, format: 'html', source, meta: JSON.stringify({ refs }), visibility: 'public' });
  return (await getArtifactById(id))!;
}

describe('refs', () => {
  it('reaches only an artifact the document declares, and draws a viz ref and skips a deleted or dataset ref', async () => {
    const f = await datasetFixture();
    const recipe = { description: 'r', engine: 'vega-lite', bindings: [], template: {} };
    await seedArtifacts(f.db, { id: 'vizabc', token_id: f.owner.tokenId, user_id: f.owner.id, format: 'viz', source: JSON.stringify(recipe), visibility: 'private' }, { id: 'vizgone', token_id: f.owner.tokenId, user_id: f.owner.id, format: 'viz', source: JSON.stringify(recipe), visibility: 'private' });
    await setArtifact(f.db, 'vizgone', { deleted_at: { sql: 'now()' } });
    const doc = await documentImporting(f.owner, f.id, [{ id: 'vizabc', kind: 'viz' }, { id: 'vizgone', kind: 'viz' }, { id: f.id, kind: 'dataset' }]);
    expect(await referencedArtifactForRow(doc, 'vizabc')).toMatchObject({ id: 'vizabc' });
    expect(await referencedArtifactForRow(doc, f.id)).toMatchObject({ id: f.id });
    expect(await referencedArtifactForRow(doc, 'undeclared')).toBeNull();
  });
});

describe('the actor\'s dataset resolver', () => {
  it('resolves what the actor can read, and nothing of a stranger\'s private dataset', async () => {
    const f = await datasetFixture({ visibility: 'private' });
    const stranger = await account('stranger');
    expect(await datasetResolverForActor(f.owner.actor)(f.id)).toMatchObject({ tables: { rows: { rows: [{ n: 1 }] } } });
    expect(await datasetResolverForActor(stranger.actor)(f.id)).toBeNull();
    expect(await datasetResolverForActor(ANONYMOUS_ACTOR)(f.id)).toBeNull();
  });
});

describe('dataset file doors', () => {
  it('refuses an anonymous upload, a cookie upload from another site, and an undecodable filename', async () => {
    const f = await datasetFixture();
    const upload = (init: Parameters<typeof request>[1]) => uploadFileRequest(request('/x', { method: 'POST', body: 'a,b', ...init }), 'doc', f.id);
    const anonymous = await upload({});
    expect([anonymous.status, (await anonymous.json()).error]).toEqual([403, 'dataset_file_upload_failed']);
    const crossSite = await upload({ actor: { credential: 'session', userId: f.owner.id, email: f.owner.email, emailVerified: true }, origin: 'https://evil.example' });
    expect([crossSite.status, await crossSite.json()]).toEqual([403, { error: 'forbidden' }]);
    const badName = await upload({ actor: { credential: 'session', userId: f.owner.id, email: f.owner.email, emailVerified: true }, headers: { 'X-Filename': '%E0%A4%A' } });
    expect([badName.status, await badName.json()]).toEqual([400, { error: 'invalid_filename' }]);
    expect(badName.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers 404 for a file nobody can read', async () => {
    const f = await datasetFixture();
    const missing = await readFileRequest(request('/x'), 'doc', f.id, 'file_missing');
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not_found' }]);
  });
});
