import {restoreDocument} from './prepared-document';
import {artifactQuery} from '@/lib/artifact-document';
import { expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { mintToken } from '@/lib/tokens';
import { POST as create } from '@/app/api/artifacts/route';
import { runDatasetCatalogMigrationBatch } from '@/lib/datasets/migrate';
import { refLoaderForActor, writerFor, type ArtifactRow } from '@/lib/artifacts';
import { checkDocumentData } from '@/lib/story/data-checks';
import { POST as addComment, GET as listComments } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as query } from '@/app/a/[id]/query/route';

const harness = useAppHarness();
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

it('rehearses dry-run, apply, joined query execution and reverting migrated history after an in-process migration', async () => {
  const owner = await mintToken('migration-rehearsal');
  const publish = async (body: Record<string, unknown>) => {
    const response = await create(request('/api/artifacts', { method: 'POST', token: owner.token, json: body }));
    expect(response.status, await response.clone().text()).toBe(201);
    return response.json();
  };
  const orders = await publish({ dataset: [{ id: 1, amount: 12 }, { id: 2, amount: 8 }] });
  const labels = await publish({ dataset: [{ id: 1, label: 'first' }, { id: 2, label: 'second' }] });
  const legacySource = `<Helmet><Query name="joined">{\`select o.amount, l.label from ref_${orders.id} o join ref_${labels.id} l on o.id=l.id order by o.id\`}</Query></Helmet><h1 id="stable-heading">Original</h1><DataTable data="$joined" />`;
  const doc = await publish({markup:'<h1 id="stable-heading">Original</h1>'});
  const comment=await addComment(request(`/api/artifacts/${doc.id}/annotations`,{method:'POST',token:owner.token,json:{node_id:'stable-heading',body:'Keep this heading attached'}}),ctx(doc.id));
  expect(comment.status,await comment.clone().text()).toBe(201);
  const createdComment=await comment.json();
  const db = await harness.db();
  await artifactQuery(db,'UPDATE artifacts SET document=NULL,source=$2 WHERE id=$1',[doc.id,legacySource]);
  // Seed the exact pre-cutover storage shape, retaining a real published source.
  await artifactQuery(db,"UPDATE artifacts SET meta=meta-'catalog' WHERE id=ANY($1::text[])", [[orders.id, labels.id]]);
  await artifactQuery(db,`INSERT INTO artifact_versions (artifact_id,version,title,description,format,source,meta)
    SELECT id,version,title,description,format,source,meta FROM artifacts WHERE id=$1`, [doc.id]);
  await artifactQuery(db,"UPDATE artifacts SET document=NULL,version=2,source=replace(source,'Original','Current') WHERE id=$1", [doc.id]);
  const before = (await artifactQuery<{ source: string; edit_id: string }>(db,'SELECT document,source,edit_id FROM artifacts WHERE id=$1', [doc.id])).rows[0];
  const runQuery = async () => {
    const response = await query(request(`/a/${doc.id}/query`, { method: 'POST', token: owner.token, json: {} }), ctx(doc.id));
    expect(response.status, await response.clone().text()).toBe(200);
    return (await response.json()).tables.joined.rows;
  };
  const expected = [{ amount: 12, label: 'first' }, { amount: 8, label: 'second' }];
  const migration = async (dryRun: boolean) => {
    const validate: NonNullable<Parameters<typeof runDatasetCatalogMigrationBatch>[1]['validate']> = async (source, row) => {
      const checked = await checkDocumentData(source, refLoaderForActor(writerFor(row as unknown as ArtifactRow)));
      return checked.ok ? [] : checked.details;
    };
    const preview = await runDatasetCatalogMigrationBatch(db, { batchSize: 10, dryRun: true, validate });
    const expected = Object.fromEntries(preview.plans.map(plan => [plan.artifactId, plan.fingerprint]));
    const report = await runDatasetCatalogMigrationBatch(db, { batchSize: 10, dryRun, validate, ...(dryRun ? {} : { expected }) });
    expect(report.conflicts).toEqual([]);
    return report;
  };
  expect(await migration(true)).toMatchObject({ changed: 3, versions: 1, dryRun: true });
  expect((await artifactQuery(db,'SELECT document,source,edit_id FROM artifacts WHERE id=$1', [doc.id])).rows[0]).toEqual(before);
  expect(await migration(false)).toMatchObject({ changed: 3, versions: 1, done: true });
  expect(await runQuery()).toEqual(expected);
  const comments=await listComments(request(`/api/artifacts/${doc.id}/annotations`,{token:owner.token}),ctx(doc.id));
  expect((await comments.json()).annotations).toEqual(expect.arrayContaining([expect.objectContaining({id:createdComment.id,anchor:expect.objectContaining({nodeId:'stable-heading'}),orphaned:false})]));
  const saved = (await artifactQuery<{ source: string }>(db,'SELECT document,source FROM artifact_versions WHERE artifact_id=$1', [doc.id])).rows[0];
  expect(saved.source).toContain(`source="ref:${orders.id}"`);
  expect(saved.source).not.toContain(`ref_${orders.id}`);
  const restored = await restoreDocument(owner.token,doc.id,1);
  expect(restored.status, await restored.clone().text()).toBe(200);
  expect((await restored.json()).markup).toContain('Original');
  expect(await runQuery()).toEqual(expected);
  expect(await migration(false)).toMatchObject({ changed: 0, done: true });
});
