/**
 * lib/document-data's reader-side interface, through its index: what a stored document's imports may hand a reader
 * (held rows only for a reader of the dataset, never a stranger of a private one or a deleted one), the artifacts
 * its refs reach, the dataset resolver an actor reads through, the people a reader may see named, the mutation
 * door's refusals for documents without that mutation, and the dataset file doors' refusals.
 */
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from '@/__tests__/harness';
import { ANONYMOUS_ACTOR, identityForUser } from '@/lib/accounts';
import { getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { getDb } from '@/lib/platform';
import {
  datasetResolverForActor, holdImport, nameablePeople, readFileRequest, refDataForRow, referencedArtifactForRow, registeredQueryImportForRow,
  runDocumentMutation, uploadFileRequest,
} from '@/lib/document-data';
import { account, datasetFixture } from './dataset-fixture';

useAppHarness();

/** A stored markup document owned by `owner`, importing `datasetId` as `data`, with these refs. */
async function documentImporting(owner: { id: string; tokenId: string }, datasetId: string, refs: Array<{ id: string; kind: string }> = []) {
  const id = `doc${Math.random().toString(36).slice(2, 8)}`;
  const source = `<Helmet><Import name="data" src="ref:${datasetId}" /><Query name="all">{\`select * from data.rows\`}</Query></Helmet><p>Doc</p>`;
  await (await getDb()).query("INSERT INTO artifacts (id, token_id, user_id, format, source, meta, visibility) VALUES ($1,$2,$3,'markup',$4,$5::jsonb,'public')",
    [id, owner.tokenId, owner.id, source, JSON.stringify({ refs })]);
  return (await getArtifactById(id))!;
}

describe('held imports', () => {
  it('hands a public dataset\'s rows to anyone, and nothing for an import the document does not declare', async () => {
    const f = await datasetFixture();
    const doc = await documentImporting(f.owner, f.id);
    expect(await holdImport(doc, 'data', null)).toEqual({ rows: { rows: [{ n: 1 }], columns: expect.any(Array) } });
    expect(await holdImport(doc, 'missing', null)).toBeNull();
  });

  it('hands a private dataset only to a reader of it, and nothing once it is deleted', async () => {
    const f = await datasetFixture({ visibility: 'private' });
    const doc = await documentImporting(f.owner, f.id);
    const stranger = await account('stranger');
    expect(await holdImport(doc, 'data', null)).toBeNull();
    expect(await holdImport(doc, 'data', stranger.actor)).toBeNull();
    expect(await holdImport(doc, 'data', f.owner.actor)).toMatchObject({ rows: { rows: [{ n: 1 }] } });
    await f.db.query('UPDATE artifacts SET deleted_at = now() WHERE id = $1', [f.id]);
    expect(await holdImport(doc, 'data', f.owner.actor)).toBeNull();
  });

  it('answers a registered query\'s dataset and catalog, and refuses a source that is not a readable dataset', async () => {
    const f = await datasetFixture();
    const doc = await documentImporting(f.owner, f.id);
    expect(await registeredQueryImportForRow(doc, f.id, f.owner.actor)).toMatchObject({ artifact: { id: f.id, format: 'dataset' }, catalog: { kind: 'stored' } });
    await expect(registeredQueryImportForRow(doc, doc.id, f.owner.actor)).rejects.toThrow('query_source_unavailable');
    await expect(registeredQueryImportForRow(doc, 'nosuchid', f.owner.actor)).rejects.toThrow('query_source_unavailable');
  });
});

describe('refs', () => {
  it('reaches only an artifact the document declares, and draws a viz ref and skips a deleted or dataset ref', async () => {
    const f = await datasetFixture();
    const recipe = { description: 'r', engine: 'vega-lite', bindings: [], template: {} };
    await f.db.query("INSERT INTO artifacts (id, token_id, user_id, format, source, visibility) VALUES ('vizabc', $1, $2, 'viz', $3, 'private'), ('vizgone', $1, $2, 'viz', $3, 'private')", [f.owner.tokenId, f.owner.id, JSON.stringify(recipe)]);
    await f.db.query("UPDATE artifacts SET deleted_at = now() WHERE id = 'vizgone'");
    const doc = await documentImporting(f.owner, f.id, [{ id: 'vizabc', kind: 'viz' }, { id: 'vizgone', kind: 'viz' }, { id: f.id, kind: 'dataset' }]);
    expect(await referencedArtifactForRow(doc, 'vizabc')).toMatchObject({ id: 'vizabc' });
    expect(await referencedArtifactForRow(doc, f.id)).toMatchObject({ id: f.id });
    expect(await referencedArtifactForRow(doc, 'undeclared')).toBeNull();
    expect(await refDataForRow(doc)).toEqual({ vizabc: { kind: 'viz', recipe } });
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

describe('people a reader may see named', () => {
  it('names the signed-in reader when asked, and nobody for an anonymous reader', async () => {
    const f = await datasetFixture();
    const doc = await documentImporting(f.owner, f.id);
    const reader = await account('reader');
    expect(Object.keys(await nameablePeople(doc, reader.actor))).toEqual([reader.id]);
    expect(await nameablePeople(doc, reader.actor, ['someone-else'])).toEqual({});
    expect(await nameablePeople(doc, null)).toEqual({});
    expect(await nameablePeople(doc, identityForUser(null, reader.tokenId))).toEqual({});
  });
});

describe('the mutation door', () => {
  it('refuses a mutation the document does not declare, and any on a document that is not markup', async () => {
    const f = await datasetFixture();
    const doc = await documentImporting(f.owner, f.id);
    expect(await runDocumentMutation(doc, { mutation: 'nope' } as never, f.owner.actor)).toEqual({ ok: false, reason: 'unknown_mutation' });
    expect(await runDocumentMutation({ ...doc, format: 'html' } as ArtifactRow, { mutation: 'all' } as never)).toEqual({ ok: false, reason: 'unknown_mutation' });
    expect(await runDocumentMutation({ ...doc, source: null } as ArtifactRow, { mutation: 'all' } as never)).toEqual({ ok: false, reason: 'unknown_mutation' });
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
