/** Stored dataset raw reads describe the role's catalog, never the legacy row array or storage keys. */
import { expect, it } from 'vitest';
import { mintAccountToken, request, useAppHarness } from '@/__tests__/harness';
import { identityForUser } from '@/lib/accounts';
import { createArtifactFromBody } from '@/lib/publish';
import { getDb } from '@/lib/platform';
import { getArtifactById } from '@/lib/artifacts';
import { serveRawDocument } from '@/lib/document-serving';
import { loadDatasetRows } from '@/lib/datasets';
import { seedShares, setArtifact } from '@/__tests__/rows';

useAppHarness();

it('describes old single-table storage and preserves owner, viewer and denied-role access', async () => {
  const owner = await mintAccountToken('raw_owner'), viewer = await mintAccountToken('raw_viewer');
  const actor = identityForUser(owner.userId, owner.id, owner.email);
  const created = await createArtifactFromBody({ dataset: [{ name: 'Ada', salary: 10 }], visibility: 'unlisted' }, actor, 'http://localhost:3000');
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const db = await getDb();
  await seedShares(db, { artifact_id: id, user_id: viewer.userId, email: viewer.email, role: 'viewer' });
  await setArtifact(db, id, { dataset_policy: JSON.stringify({ version: 3, tables: [{ table: { schema: 'public', name: 'rows' }, select_permissions: [{ role: 'viewer', permission: { columns: ['name'], filter: {} } }] }] }) });
  const read = (token?: string) => serveRawDocument(request(`/a/${id}/raw`, token ? { token } : {}), { id });
  const own = await read(owner.token);
  expect(own.status).toBe(200);
  expect(own.headers.get('cache-control')).toBe('no-store');
  const whole = await own.json();
  expect(whole).toMatchObject({ catalog: { kind: 'stored', tables: [{ schema: 'public', name: 'rows', columns: [{ name: 'name' }, { name: 'salary' }] }] } });
  expect(JSON.stringify(whole)).not.toMatch(/objectKey|Ada/);
  const shared = await read(viewer.token);
  expect(shared.status).toBe(200);
  expect((await shared.json()).catalog.tables[0].columns.map((c: { name: string }) => c.name)).toEqual(['name']);
  expect((await read()).status).toBe(404);
  // Response removal never migrates or deletes the stored rows.
  expect(await loadDatasetRows((await getArtifactById(id))!)).toEqual([{ name: 'Ada', salary: 10 }]);
});

it('keeps a live connection summary and the artifact access boundary', async () => {
  const owner = await mintAccountToken('raw_live_owner');
  const actor = identityForUser(owner.userId, owner.id, owner.email);
  const created = await createArtifactFromBody({ dataset: [{ n: 1 }], visibility: 'private' }, actor, 'http://localhost:3000');
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const connection = { connector: 'postgres', name: 'Example connection' };
  await setArtifact((await getDb()), id, { meta: JSON.stringify({ connection }) });
  const response = await serveRawDocument(request(`/a/${id}/raw`, { token: owner.token }), { id });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ connection, message: expect.stringContaining('rows stay in its database') });
  expect((await serveRawDocument(request(`/a/${id}/raw`), { id })).status).toBe(404);
});

// pr fast budget probe: an edit of many node test files (closed unmerged)
