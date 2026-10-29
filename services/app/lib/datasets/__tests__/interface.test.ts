/**
 * lib/datasets' interface beyond execution: connection shapes and sealed credentials (only their owner or their
 * dataset may open them), stored catalogs and rows, user-typed columns (self, membership and unknown users refused),
 * the stored file, image, PDF and viz tiers with their size and type refusals, the viewer mutation policy, the
 * public mutation throttle and the JSON door's error mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DatasetColumn } from '@artifactbin/contracts';
import { mintAccountToken, useAppHarness } from '@/__tests__/harness';
import { createUser, identityForUser } from '@/lib/accounts';
import { objectStore, prepareObjects } from '@/lib/object-store';
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, getDb } from '@/lib/platform';
import { seedOwnerJoin } from '@/lib/social';
import {
  DatasetError, catalogOf, executeDocumentQueries, claimPendingDatasetSecret, connectionShape, createDatasetSecret, datasetResponse, importedRows, importedTables, loadDatasetRows,
  openDatasetSecret, placeholderSession, policySession, publicCatalogOf, publishDataset, publishFile, publishImage, publishPdf, publishVizRecipe,
  readFileUpload, resolveDatasetConnection, resolveUserColumnScope, retainUserScope, schemaLoaderFor, sealDatasetSecret, secretTargetShape, serveStoredFile,
  storeDatasetRows, storeFileContent, storeImageContent, storePdfContent, storedMediaReferences, storedRowStats, throttlePublicMutation, uploadedSha256,
  userOptions, validateDatasetPolicyForRow, validateUserContent, validateUserWrites, viewerMutationPolicy, type DatasetCatalog,
} from '@/lib/datasets';

useAppHarness();

const TARGET = { host: 'db.example.test', port: 5432, database: 'app', username: 'reader', ssl: true };
const failure = async (result: unknown) => (result instanceof Response ? { status: result.status, ...(await result.json()) } : result);

describe('connections and sealed credentials', () => {
  it('accepts exactly the connection fields, and a target without the secret id', () => {
    const secret = `sec_${'a'.repeat(24)}`;
    expect(connectionShape.parse({ ...TARGET, passwordSecretId: secret })).toEqual({ ...TARGET, passwordSecretId: secret });
    for (const bad of [{ ...TARGET, passwordSecretId: 'sec_x' }, { ...TARGET, passwordSecretId: secret, password: 'p' }, { ...TARGET, port: 0, passwordSecretId: secret }, { ...TARGET, host: ' ', passwordSecretId: secret }]) {
      expect(connectionShape.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(secretTargetShape.parse(TARGET)).toEqual(TARGET);
  });

  it('opens a sealed secret only with the same id, target and signing secret', () => {
    const sealed = sealDatasetSecret('hunter2', 'sec_1', 'hash_1', 'auth');
    expect(sealed).not.toContain('hunter2');
    expect(openDatasetSecret({ id: 'sec_1', target_hash: 'hash_1', ciphertext: sealed }, 'auth')).toBe('hunter2');
    expect(() => openDatasetSecret({ id: 'sec_2', target_hash: 'hash_1', ciphertext: sealed }, 'auth')).toThrow();
    expect(() => openDatasetSecret({ id: 'sec_1', target_hash: 'hash_2', ciphertext: sealed }, 'auth')).toThrow();
    expect(() => openDatasetSecret({ id: 'sec_1', target_hash: 'hash_1', ciphertext: sealed }, 'other')).toThrow();
  });

  it('lets only its creator use a pending secret, and only its dataset once claimed', async () => {
    const owner = await mintAccountToken('owner'), stranger = await mintAccountToken('stranger');
    const ownerActor = identityForUser(owner.userId, owner.id), strangerActor = identityForUser(stranger.userId, stranger.id);
    await expect(createDatasetSecret(ownerActor, '', TARGET)).rejects.toThrow('Secret value is required');
    await expect(createDatasetSecret(ownerActor, 'x'.repeat(4097), TARGET)).rejects.toBeInstanceOf(DatasetError);
    const { id } = await createDatasetSecret(ownerActor, 'pw', TARGET);
    const connection = { ...TARGET, passwordSecretId: id };
    expect(await resolveDatasetConnection(connection, ownerActor)).toEqual({ ...TARGET, password: 'pw' });
    await expect(resolveDatasetConnection(connection, strangerActor)).rejects.toMatchObject({ status: 403 });
    await expect(resolveDatasetConnection({ ...connection, host: 'elsewhere.example' }, ownerActor)).rejects.toMatchObject({ status: 403 });
    const db = await getDb();
    await expect(claimPendingDatasetSecret(connection, strangerActor, 'ds_1', db)).rejects.toMatchObject({ status: 403 });
    await claimPendingDatasetSecret(connection, ownerActor, 'ds_1', db);
    expect(await resolveDatasetConnection(connection, undefined, 'ds_1')).toEqual({ ...TARGET, password: 'pw' });
    await expect(resolveDatasetConnection(connection, ownerActor)).rejects.toMatchObject({ status: 403 });
    await expect(resolveDatasetConnection(connection, undefined, 'ds_2')).rejects.toMatchObject({ status: 403 });
    await expect(claimPendingDatasetSecret(connection, ownerActor, 'ds_2', db)).rejects.toMatchObject({ status: 403 });
  });
});

describe('stored catalogs and rows', () => {
  it('stores rows by content, reads them back, counts them once, and refuses to parse an object past the cap', async () => {
    const rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const { objectKey } = await storeDatasetRows(rows);
    expect(await loadDatasetRows({ meta: { objectKey } })).toEqual(rows);
    expect(await loadDatasetRows({ meta: null })).toEqual([]);
    expect(await storedRowStats(objectKey, 1_000_000)).toEqual({ rows: 3, bytes: JSON.stringify(rows).length });
    const big = await storeDatasetRows([{ text: 'x'.repeat(100) }]);
    expect(await storedRowStats(big.objectKey, 10)).toEqual({ rows: Number.POSITIVE_INFINITY, bytes: expect.any(Number) });
  });

  it('exposes only the default schema\'s stored tables to an import, empty when never written, and hides internals from readers', async () => {
    const { objectKey } = await storeDatasetRows([{ n: 1 }]);
    const catalog: DatasetCatalog = {
      kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
      connection: { ...TARGET, passwordSecretId: 'sec_x' },
      tables: [
        { schema: 'public', name: 'rows', columns: [{ name: 'n', type: 'number' }], objectKey },
        { schema: 'public', name: 'empty', columns: [] },
        { schema: 'public', name: 'model', columns: [], sql: 'select 1' },
        { schema: 'other', name: 'hidden', columns: [] },
      ],
    };
    expect(importedTables(catalog).map(t => t.name)).toEqual(['rows', 'empty']);
    expect(importedTables({ ...catalog, kind: 'postgres' })).toEqual([]);
    expect(await importedRows(catalog)).toEqual({ rows: { rows: [{ n: 1 }], columns: [{ name: 'n', type: 'number' }] }, empty: { rows: [], columns: [] } });
    expect(catalogOf({ meta: { catalog } })).toBe(catalog);
    expect(catalogOf({ meta: [] })).toBeNull();
    const reader = publicCatalogOf({ meta: { catalog } })!;
    expect(reader).not.toHaveProperty('connection');
    expect(reader.tables[0]).toEqual({ schema: 'public', name: 'rows', columns: [{ name: 'n', type: 'number' }] });
    expect(publicCatalogOf({ meta: {} })).toBeNull();
  });

  it('finds every image a stored dataset\'s cells reference, and none for a connected one', async () => {
    const id = 'IMGabc123';
    const { objectKey } = await storeDatasetRows([{ photo: `ref:${id}` }, { photo: `/a/${id}` }, { photo: null }]);
    const catalog = { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [{ schema: 'public', name: 'rows', columns: [], objectKey }] };
    const refs = await storedMediaReferences({ meta: { catalog } });
    expect(refs).toEqual(new Set([id]));
    expect(await storedMediaReferences({ meta: { catalog: { ...catalog, kind: 'postgres' } } })).toEqual(new Set());
  });

  it('loads a schema for datasets and folders and nothing for other formats or missing refs', async () => {
    const loader = schemaLoaderFor(async id => id === 'ds' ? { format: 'dataset', columns: [{ name: 'a', type: 'string' }] } as never
      : id === 'folder' ? { format: 'folder', columns: [] } as never : id === 'doc' ? { format: 'html' } as never : null);
    expect(await loader('ds')).toMatchObject({ kind: 'dataset', tables: [{ name: 'rows', columns: [{ name: 'a', type: 'string' }] }] });
    expect(await loader('folder')).toMatchObject({ kind: 'folder' });
    expect(await loader('doc')).toBeNull();
    expect(await loader('missing')).toBeNull();
  });
});

describe('user columns', () => {
  const person = async (name: string) => (await createUser({ email: `${name}@example.test` })).id;
  const column = (constraints?: DatasetColumn['constraints']): DatasetColumn => ({ name: 'who', type: 'user', ...(constraints ? { constraints } : {}) }) as DatasetColumn;

  it('accepts known users, and refuses non-ids, unknown users, someone else for a self field, and non-members', async () => {
    const db = await getDb();
    const alice = await person('alice'), bob = await person('bob'), carol = await person('carol');
    await db.query('INSERT INTO artifacts (id, user_id, token_id) VALUES ($1, $2, $3)', ['doc_m', alice, 'tok_x']);
    await seedOwnerJoin(db, 'doc_m', bob);
    await validateUserWrites(db, [column()], [{ who: alice }, { who: null }, { other: 1 }], null);
    await expect(validateUserWrites(db, [column()], [{ who: 7 }], null)).rejects.toThrow('requires a user ID');
    await expect(validateUserWrites(db, [column()], [{ who: 'usr_missing' }], null)).rejects.toThrow('unknown user');
    await validateUserWrites(db, [column({ self: true })], [{ who: alice }], alice);
    await expect(validateUserWrites(db, [column({ self: true })], [{ who: bob }], alice)).rejects.toMatchObject({ status: 403 });
    await expect(validateUserWrites(db, [column({ self: true })], [{ who: alice }], null)).rejects.toThrow('logged-in user');
    await validateUserWrites(db, [column({ memberOf: ['ref:doc_m'] })], [{ who: alice }, { who: bob }], null);
    await expect(validateUserWrites(db, [column({ memberOf: ['ref:doc_m'] })], [{ who: carol }], null)).rejects.toThrow('membership');
    await expect(validateUserWrites(db, [column({ memberOf: ['current'] })], [{ who: alice }], null)).rejects.toThrow('remain unset');
    expect((await userOptions(db, column({ memberOf: ['ref:doc_m'] }), null)).map(o => o.value).sort()).toEqual([alice, bob].sort());
    expect(await userOptions(db, column({ memberOf: ['ref:doc_m'], self: true }), carol)).toEqual([]);
    expect((await userOptions(db, column({ self: true }), carol)).map(o => o.value)).toEqual([carol]);
    expect(await userOptions(db, column(), alice)).toEqual([]);
    const stored = await storeDatasetRows([{ who: 'usr_missing' }]);
    await expect(validateUserContent(db, { meta: { catalog: { tables: [{ columns: [column()], objectKey: stored.objectKey }] } } }, null, async () => loadDatasetRows({ meta: { objectKey: stored.objectKey } }))).rejects.toThrow('unknown user');
    await validateUserContent(db, { meta: {} }, null, async () => []);
  });

  it('resolves the current document scope, and keeps a previous scope across a replacement', () => {
    const columns = [column({ memberOf: ['current', 'ref:x'] }), { name: 'n', type: 'number' } as DatasetColumn];
    expect(resolveUserColumnScope(columns, 'doc_1')[0]!.constraints!.memberOf).toEqual(['ref:doc_1', 'ref:x']);
    expect(resolveUserColumnScope(columns, 'doc_1')[1]).toBe(columns[1]);
    const input = { meta: { columns } };
    expect(retainUserScope(input, { meta: {} })).toBe(input);
    const kept = retainUserScope(input, { meta: { userScopeDocument: 'doc_2' } });
    expect(kept.meta).toMatchObject({ userScopeDocument: 'doc_2', columns: [{ constraints: { memberOf: ['ref:doc_2', 'ref:x'] } }, { name: 'n' }] });
  });
});

describe('content tiers', () => {
  const staged = () => prepareObjects(objectStore());

  it('stores a named file under its extension\'s type and refuses bad names, types and sizes', async () => {
    const bytes = Buffer.from('a,b\n1,2\n');
    const stored = await storeFileContent(bytes, 'application/octet-stream', 'data.csv', staged().store);
    expect(stored).toMatchObject({ format: 'file', meta: { contentType: expect.stringContaining('csv'), filename: 'data.csv', sha256: uploadedSha256(bytes), bytes: bytes.length } });
    expect(uploadedSha256(Buffer.from(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await failure(await storeFileContent(bytes, 'text/csv', '../x.csv'))).toMatchObject({ status: 400, error: 'invalid_filename' });
    expect(await failure(await storeFileContent(bytes, 'text/csv', ''))).toMatchObject({ error: 'invalid_filename' });
    expect(await failure(await storeFileContent(bytes, 'not a type', 'x.csv'))).toMatchObject({ error: 'invalid_content_type' });
    expect(await failure(await storeFileContent(bytes, 'text/plain', 'x.exe'))).toMatchObject({ error: 'unsupported_file_type' });
    expect(await failure(await storeFileContent(Buffer.alloc(MAX_FILE_BYTES + 1), 'text/csv', 'x.csv'))).toMatchObject({ status: 413 });
    expect(await failure(await publishFile({ filename: 'x.csv', contentType: 'text/csv', base64: 'not base64!' }))).toMatchObject({ error: 'invalid_file' });
    expect(await failure(await publishFile(null))).toMatchObject({ error: 'invalid_file' });
    expect(await publishFile({ filename: 'x.csv', contentType: 'text/csv', base64: bytes.toString('base64') }, staged().store)).toMatchObject({ format: 'file' });
  });

  it('reads a raw upload up to the cap and refuses past it by header or by bytes', async () => {
    expect((await readFileUpload(new Request('http://x/', { method: 'POST', body: 'hello' }))) as Buffer).toEqual(Buffer.from('hello'));
    expect(await readFileUpload(new Request('http://x/', { method: 'POST' }))).toEqual(Buffer.alloc(0));
    expect(await failure(await readFileUpload(new Request('http://x/', { method: 'POST', body: 'x', headers: { 'content-length': String(MAX_FILE_BYTES + 1) } })))).toMatchObject({ status: 413 });
    expect(await failure(await readFileUpload(new Request('http://x/', { method: 'POST', body: 'x'.repeat(MAX_FILE_BYTES + 1) })))).toMatchObject({ status: 413 });
  });

  it('serves a stored file as an inert attachment, and 404s a row without an object', async () => {
    const stored = await storeFileContent(Buffer.from('a,b\n'), 'text/csv', 'résumé.csv') as { meta: Record<string, unknown> };
    const served = await serveStoredFile(new Request('http://x/'), { id: 'f1', meta: stored.meta }, true);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-disposition')).toBe(`attachment; filename="r_sum_.csv"; filename*=UTF-8''r%C3%A9sum%C3%A9.csv`);
    expect(served.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(served.headers.get('access-control-allow-origin')).toBe('*');
    expect(await served.text()).toBe('a,b\n');
    expect((await serveStoredFile(new Request('http://x/', { method: 'HEAD' }), { id: 'f1', meta: stored.meta })).body).toBeNull();
    expect((await serveStoredFile(new Request('http://x/'), { id: 'f1', meta: {} })).status).toBe(404);
  });

  it('stores images and PDFs by their bytes, refusing empty, oversized, mistyped and non-PDF payloads', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f7a3a90000000049454e44ae426082', 'hex');
    expect(await storeImageContent(png, 'image/png', staged().store)).toMatchObject({ format: 'image' });
    expect(await failure(await storeImageContent(png, 'image/bmp'))).toMatchObject({ error: 'invalid_image' });
    expect(await failure(await storeImageContent(Buffer.alloc(0), 'image/png'))).toMatchObject({ error: 'invalid_image' });
    expect(await failure(await storeImageContent(Buffer.alloc(MAX_IMAGE_BYTES + 1), 'image/png'))).toMatchObject({ status: 413 });
    expect(await publishImage({}, `data:image/png;base64,${png.toString('base64')}`, staged().store)).toMatchObject({ format: 'image' });
    expect(await failure(await publishImage({}, 'https://x/y.png'))).toMatchObject({ error: 'invalid_image' });
    expect(await failure(await storePdfContent(Buffer.alloc(0)))).toMatchObject({ error: 'invalid_pdf' });
    expect(await failure(await storePdfContent(Buffer.from('not a pdf at all')))).toMatchObject({ error: 'invalid_pdf' });
    expect(await failure(await publishPdf({}, 'data:text/plain;base64,eA=='))).toMatchObject({ error: 'invalid_pdf' });
    expect(await failure(await publishPdf({}, `data:application/pdf;base64,${Buffer.from('nope').toString('base64')}`))).toMatchObject({ error: 'invalid_pdf' });
  });

  it('publishes rows as a stored dataset and refuses anything but an array', async () => {
    const published = await publishDataset({}, [{ a: 1 }, { a: 2 }], staged().store);
    expect(published).toMatchObject({ format: 'dataset' });
    expect(await failure(await publishDataset({}, { a: 1 }))).toMatchObject({ status: 400, error: 'invalid_dataset' });
  });

  it('accepts a viz recipe whose template tokens all name a binding or param', async () => {
    const recipe = { description: 'bars', engine: 'vega-lite', bindings: [{ name: 'x', label: 'X', accepts: ['nominal'] }], template: { encoding: { x: { field: '{{x}}' } } } };
    expect(publishVizRecipe({}, recipe)).toMatchObject({ format: 'viz', meta: { slots: [{ name: 'x', accepts: ['nominal'] }] } });
    expect(await failure(publishVizRecipe({}, null))).toMatchObject({ error: 'invalid_viz' });
    expect(await failure(publishVizRecipe({}, { ...recipe, engine: 'd3' }))).toMatchObject({ error: 'invalid_viz' });
    expect(await failure(publishVizRecipe({}, { ...recipe, bindings: [{ name: 'x', label: 'X', accepts: ['ordinal'] }] }))).toMatchObject({ error: 'invalid_viz' });
    expect(await failure(publishVizRecipe({}, { ...recipe, template: { y: '{{undeclared}}' } }))).toMatchObject({ error: 'invalid_viz', details: [expect.stringContaining('undeclared')] });
  });
});

describe('viewer policy', () => {
  it('builds the viewer session, with placeholders for every claim a policy names', () => {
    expect(policySession(null)).toEqual({ 'x-hasura-role': 'viewer' });
    expect(policySession('u1')).toEqual({ 'x-hasura-role': 'viewer', 'x-hasura-user-id': 'u1' });
    const policy = { version: 1, tables: [{ table: { schema: 'public', name: 'rows' }, insert_permissions: [{ role: 'viewer', permission: { check: { team: { _eq: 'X-Hasura-Team-Id' } } } }] }] } as never;
    expect(placeholderSession(policy)).toEqual({ 'x-hasura-role': 'viewer', 'x-hasura-team-id': '' });
    expect(viewerMutationPolicy(policy, { schema: 'public', name: 'rows' }, { a: 1 })).toMatchObject({ role: 'viewer', session: { a: 1 }, operations: ['insert', 'update', 'delete'] });
    expect(viewerMutationPolicy(policy, { schema: 'public', name: 'other' }, {})).toBeUndefined();
  });

  it('validates a policy only for a stored dataset, and never downgrades a version 2 policy', () => {
    const row = { format: 'dataset', meta: { columns: [{ name: 'a' }] }, dataset_policy: null } as never;
    expect(validateDatasetPolicyForRow(row, null)).toBeNull();
    expect(() => validateDatasetPolicyForRow({ format: 'html', meta: {}, dataset_policy: null } as never, null)).toThrow('Policies require a stored dataset');
    expect(() => validateDatasetPolicyForRow({ format: 'dataset', meta: { catalog: { kind: 'postgres', tables: [] } }, dataset_policy: null } as never, null)).toThrow('stored dataset');
    expect(() => validateDatasetPolicyForRow({ format: 'dataset', meta: {}, dataset_policy: { version: 2, allow: [] } } as never, null)).toThrow('Keep version 2');
  });
});

describe('the public mutation throttle and the JSON door', () => {
  it('allows thirty public mutations per dataset per minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let i = 0; i < 30; i++) await throttlePublicMutation('ds_t');
      await expect(throttlePublicMutation('ds_t')).rejects.toThrow('Public mutation limit reached');
      await throttlePublicMutation('ds_other');
      vi.setSystemTime(Date.now() + 60_000);
      await throttlePublicMutation('ds_t');
    } finally { vi.useRealTimers(); }
  });

  it('answers work as JSON, a dataset error with its status, and anything else as 400', async () => {
    expect(await failure(await datasetResponse(async () => ({ ok: true }), 201))).toEqual({ status: 201, ok: true });
    expect(await failure(await datasetResponse(async () => { throw new DatasetError('nope', 403); }))).toEqual({ status: 403, error: 'dataset_error', details: ['nope'] });
    expect(await failure(await datasetResponse(async () => { throw 'string'; }))).toEqual({ status: 400, error: 'dataset_error', details: ['Dataset request failed'] });
  });
});

describe('document queries', () => {
  const query = (name: string, sql: string, imports: string[]) => ({ name, engine: 'sqlite', sql, params: [], reads: { imports, queries: [], values: [], builtins: [] }, columns: [{ name: 'n', type: 'number' }], start: 0, end: 0 });
  const flow = {
    imports: [{ name: 'data', ref: 'DSabc123', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
    values: [], mutations: [], queries: [query('total', 'select sum(n) as n from data.rows', ['data']), query('constant', 'select 7 as n', [])],
  } as never;

  it('resolves only the imports the selected queries read, and reports their sources', async () => {
    const asked: string[] = [];
    const resolve = async (ref: string) => { asked.push(ref); return { tables: { rows: { rows: [{ n: 2 }, { n: 3 }], columns: [{ name: 'n', type: 'number' }] } } } as never; };
    const all = await executeDocumentQueries(flow, resolve);
    expect((all.state as { tables: Record<string, { rows: unknown[] }> }).tables.total!.rows).toEqual([{ n: 5 }]);
    expect(all.sourceIds).toEqual(['DSabc123']);
    asked.length = 0;
    const only = await executeDocumentQueries(flow, resolve, { only: ['constant'] });
    expect(asked).toEqual([]);
    expect((only.state as { tables: Record<string, { rows: unknown[] }> }).tables.constant!.rows).toEqual([{ n: 7 }]);
  });
});
