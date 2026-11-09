/**
 * AN EXPORT SHOWS WHAT ITS REQUESTER MAY SEE, exactly like reading the page. The exporter photographs
 * `raw?chrome=0&key=…` in a browser with no session; the capture reads its page data straight from the page GraphQL
 * endpoint (html-runtime/domain-reads). Read as nobody, a private deck exported with no numbers for its own owner.
 * The key now carries who it was minted for, the capture reads as that requester (queries only), and the stored
 * image is kept per audience: an anonymous render may be shared, a requester's render is never served to another.
 *
 * The browser here is a stand-in that does what the capture page does: load the capture, then POST each read to the
 * page GraphQL endpoint from an opaque origin with the key from its own address (as the domain-read transport does).
 * The picture it returns encodes what that read saw: width = 1 + rows, height = 1 + (the `team` column was readable).
 */
import { afterEach, beforeEach, expect, it } from 'vitest';
import sharp from 'sharp';
import type { RenderRequest } from '@artifactbin/contracts';
import { mintAccountToken, request, setSession, useAppHarness } from './harness';
import { exportImage } from './export-helpers';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { getDb, setServices } from '@/lib/platform';
import { createArtifactFromBody } from '@/lib/publish';
import { exportCacheKey, exportKeyReader, mintExportKey, resetExportRenderer } from '@/lib/export';
import { GET as serveRaw } from '@/app/a/[id]/raw/route';
import { POST as graphql } from '@/app/api/artifacts/[id]/graphql/route';

useAppHarness();

const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Reply = { data?: Record<string, any> | null; errors?: Array<{ message: string }> };
const STAFF = [{ name: 'ada', team: 'red' }, { name: 'bo', team: 'blue' }];
const ROWS = { schema: 'public', name: 'rows' };
/** Signed-in readers see every column; anonymous readers see names only. */
const POLICY = { version: 3, tables: [{
  table: ROWS,
  select_permissions: [
    { role: 'signed_in', permission: { columns: '*', filter: {}, allow_aggregations: true } },
    { role: 'anonymous', permission: { columns: ['name'], filter: {} } },
  ],
  insert_permissions: [{ role: 'signed_in', permission: { columns: ['name', 'team'], check: {} } }],
}] };
const QUERY = '{staff(order_by:{name:asc}){name team}}';
const NAMES = '{staff(order_by:{name:asc}){name}}';

async function account(name: string) {
  const minted = await mintAccountToken(name);
  return { token: minted.token, actor: identityForUser(minted.userId, minted.id, minted.email) as AccessActor & { tokenId: string } };
}

/** A deck page and the dataset it reads, both at `visibility`. */
async function deck(owner: Awaited<ReturnType<typeof account>>, visibility: 'private' | 'unlisted') {
  const dataset = await createArtifactFromBody({ dataset: STAFF, title: 'Staff', access: 'readwrite', visibility }, owner.actor, 'http://localhost:3000');
  expect(dataset.status).toBe(201);
  const staff = (await dataset.json() as { id: string }).id;
  await (await getDb()).query('UPDATE artifacts SET dataset_policy=$2::jsonb, policy_revision=policy_revision+1 WHERE id=$1', [staff, JSON.stringify(POLICY)]);
  const html = `<html><head><link rel="af-dataset" data-af-name="staff" href="ref:${staff}"></head><body><main id="deck"></main></body></html>`;
  const page = await createArtifactFromBody({ html, visibility }, owner.actor, 'http://localhost:3000');
  expect(page.status).toBe(201);
  return { page: (await page.json() as { id: string }).id, staff };
}

const runtime = (html: string) => JSON.parse(/<script type="application\/json" data-af="runtime">([^<]*)<\/script>/.exec(html)![1]!) as { domainReads?: true; revision: string };
/** One read as the capture page sends it: an opaque origin, no credentials, a text/plain body naming the key on its address. */
const captureRead = (page: string, revision: string, key: string | null, query: string) => graphql(request(`/api/artifacts/${page}/graphql`, {
  method: 'POST',
  headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'null' },
  body: JSON.stringify({ query, variables: {}, operation: /^\s*mutation\b/.test(query) ? 'mutation' : 'query', revision, ...(key ? { key } : {}) }),
}), params(page));

const picture = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#000' } }).png().toBuffer();
const renders: RenderRequest[] = [];
beforeEach(async () => {
  setSession(null);
  renders.length = 0;
  await resetExportRenderer();
  setServices({ browser: { render: async (asked) => {
    renders.push(asked);
    const url = new URL(asked.url);
    const id = url.pathname.split('/')[2]!;
    const capture = await serveRaw(request(`${url.pathname}${url.search}`), params(id));
    if (capture.status !== 200) return { ok: true, mime: 'image/png', bytes: await picture(1, 1) };
    const config = runtime(await capture.text());
    expect(config.domainReads).toBe(true);
    const reply = await (await captureRead(id, config.revision, url.searchParams.get('key'), QUERY)).json() as Reply;
    const named = reply.errors?.length ? await (await captureRead(id, config.revision, url.searchParams.get('key'), NAMES)).json() as Reply : reply;
    const rows = (named.data?.staff ?? []) as Array<{ team?: string }>;
    return { ok: true, mime: 'image/png', bytes: await picture(1 + rows.length, rows.some((row) => row.team) ? 2 : 1) };
  } } });
});
afterEach(async () => { await resetExportRenderer(); setServices({}); });

/** What the export answered: the image's size (what its capture read), or the refusal's status. */
async function exported(page: string, token?: string): Promise<{ status: number; size?: [number, number] }> {
  const response = await exportImage(request(`/a/${page}/export`, token ? { token } : {}), params(page));
  if (response.status !== 200) return { status: response.status };
  const meta = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  return { status: 200, size: [meta.width!, meta.height!] };
}

it('exports a private deck with its data for its owner, and refuses a reader who cannot read the page', async () => {
  const owner = await account('ea_owner'), stranger = await account('ea_stranger');
  const { page } = await deck(owner, 'private');
  expect(await exported(page, owner.token)).toEqual({ status: 200, size: [3, 2] });
  // The capture key the owner's render carried names the owner; nothing anonymous rendered it.
  const key = new URL(renders[0]!.url).searchParams.get('key')!;
  expect(exportKeyReader(page, key)).toMatchObject({ userId: owner.actor.userId, tokenId: owner.actor.tokenId });
  expect(await exported(page, stranger.token)).toEqual({ status: 404 });
  expect(await exported(page)).toEqual({ status: 404 });
  expect(renders).toHaveLength(1);
});

it('keeps the anonymous render shared and every signed-in requester\'s render their own', async () => {
  const owner = await account('ea_owner2'), reader = await account('ea_reader2');
  const { page } = await deck(owner, 'unlisted');
  // Today's behaviour for an unlisted page: anonymous readers see names only, rendered once and served from the cache.
  expect(await exported(page)).toEqual({ status: 200, size: [3, 1] });
  expect(await exported(page)).toEqual({ status: 200, size: [3, 1] });
  expect(renders).toHaveLength(1);
  expect(exportKeyReader(page, new URL(renders[0]!.url).searchParams.get('key')!)).toMatchObject({ userId: null, tokenId: null });
  // The owner reads every column: a render of their own, which the anonymous audience never receives.
  expect(await exported(page, owner.token)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(2);
  expect(await exported(page)).toEqual({ status: 200, size: [3, 1] });
  // Another signed-in reader is rendered for, not handed the owner's image.
  expect(await exported(page, reader.token)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(3);
  expect(exportKeyReader(page, new URL(renders[2]!.url).searchParams.get('key')!)).toMatchObject({ userId: reader.actor.userId });
  expect(await exported(page, owner.token)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(3);
});

it('re-renders a requester\'s stored image when their access to its data changes, never serving what they lost', async () => {
  const owner = await account('ea_owner3'), reader = await account('ea_reader3');
  const { page, staff } = await deck(owner, 'unlisted');
  expect(await exported(page, reader.token)).toEqual({ status: 200, size: [3, 2] });
  // The dataset goes private: the page is still readable, its data no longer is (for the reader, and for nobody).
  await (await getDb()).query("UPDATE artifacts SET visibility='private' WHERE id=$1", [staff]);
  expect(await exported(page, reader.token)).toEqual({ status: 200, size: [1, 1] });
  expect(await exported(page)).toEqual({ status: 200, size: [1, 1] });
  expect(await exported(page, owner.token)).toEqual({ status: 200, size: [3, 2] });
});

it('reads as the key\'s requester from an opaque origin, never more, and still refuses every write', async () => {
  const owner = await account('ea_owner4'), stranger = await account('ea_stranger4');
  const { page } = await deck(owner, 'private');
  const ownerKey = mintExportKey(page, undefined, undefined, owner.actor);
  const read = await captureRead(page, '1', ownerKey, QUERY);
  expect(read.status).toBe(200);
  expect(read.headers.get('access-control-allow-origin')).toBe('*');
  expect((await read.json() as Reply).data?.staff).toEqual(STAFF);
  // No key, an anonymous key, a stranger's key, another page's key: the private page is refused to all of them.
  for (const key of [null, mintExportKey(page), mintExportKey(page, undefined, undefined, stranger.actor), mintExportKey('ffffffffffff', undefined, undefined, owner.actor), `${ownerKey.slice(0, -1)}${ownerKey.endsWith('0') ? '1' : '0'}`]) {
    const refused = await captureRead(page, '1', key, QUERY);
    expect((await refused.json() as Reply).data?.staff, String(key)).toBeUndefined();
  }
  const write = await captureRead(page, '1', ownerKey, 'mutation{insert_staff_one(object:{name:"cy",team:"red"}){name}}');
  expect(write.status).toBe(403);
  expect((await (await captureRead(page, '1', ownerKey, NAMES)).json() as Reply).data?.staff).toEqual([{ name: 'ada' }, { name: 'bo' }]);
});

it('splits the cache key by audience and leaves the anonymous key where it was', () => {
  const artifact = { id: 'abc123', version: 4 };
  const anonymous = exportCacheKey(artifact, 'png', 'full');
  expect(exportCacheKey(artifact, 'png', 'full', 0, '', null, null)).toBe(anonymous);
  const ada = exportCacheKey(artifact, 'png', 'full', 0, '', null, { userId: 'u_ada', tokenId: 't1' });
  expect(ada).not.toBe(anonymous);
  expect(exportCacheKey(artifact, 'png', 'full', 0, '', null, { userId: 'u_ada', tokenId: 't2' })).toBe(ada);
  expect(exportCacheKey(artifact, 'png', 'full', 0, '', null, { userId: 'u_bo', tokenId: 't1' })).not.toBe(ada);
  expect(exportCacheKey(artifact, 'png', 'full', 0, '', null, { userId: null, tokenId: 't1' })).not.toBe(ada);
  expect(ada).not.toContain('u_ada');
});

async function emailFixture(suffix: string, claimOnly: boolean) {
  const owner = await account('scope_email_owner_' + suffix), reader = await account('scope_email_reader_' + suffix);
  const { page, staff } = await deck(owner, 'unlisted');
  const db = await getDb();
  const current = (await db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [reader.actor.userId])).rows[0]!.email;
  const email = claimOnly ? 'scope_claim_' + suffix + '@example.test' : current;
  await db.query("UPDATE artifacts SET visibility='private',dataset_policy=$2::jsonb,policy_revision=policy_revision+1 WHERE id=$1", [staff, JSON.stringify({ version: 3, tables: [{ table: ROWS, select_permissions: [{ role: 'viewer', permission: { columns: '*', filter: {} } }] }] })]);
  await db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'viewer')", [staff, email]);
  setSession({ user: { id: reader.actor.userId!, email } });
  const ordinary = async () => await (await graphql(request(`/api/artifacts/${page}/graphql`, { method: 'POST', json: { query: QUERY, revision: '1' } }), params(page))).json() as Reply;
  return { page, staff, reader, email, current, db, ordinary };
}
it('unresolved account-email share matches capture and cache, then revocation invalidates', async () => {
  const f = await emailFixture('account', false);
  // Export first: neither an earlier ordinary read nor another surface has resolved the invitation.
  expect(await exported(f.page)).toEqual({ status: 200, size: [3, 2] });
  expect((await f.ordinary()).data?.staff).toEqual(STAFF);
  expect(await exported(f.page)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(1);
  await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1', [f.staff]);
  expect((await f.ordinary()).data?.staff).toBeUndefined();
  expect(await exported(f.page)).toEqual({ status: 200, size: [1, 1] });
  expect(renders).toHaveLength(2);
});
it('credential-only email share survives capture and revocation invalidates cache', async () => {
  const f = await emailFixture('claim', true);
  expect(f.email).not.toBe(f.current);
  expect((await f.ordinary()).data?.staff).toEqual(STAFF);
  expect((await f.db.query('SELECT user_id FROM artifact_shares WHERE artifact_id=$1', [f.staff])).rows).toEqual([{ user_id: null }]);
  expect(await exported(f.page)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(1);
  expect(await exported(f.page)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(1);
  await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1', [f.staff]);
  expect((await f.ordinary()).data?.staff).toBeUndefined();
  expect(await exported(f.page)).toEqual({ status: 200, size: [1, 1] });
  expect(renders).toHaveLength(2);
});

for (const mode of ['session', 'bearer'] as const) {
  it(`proxy ${mode} synchronizes changed email and preserves export parity`, async () => {
    const f = await emailFixture('proxy_' + mode, true);
    setSession(null);
    const actor = { credential: mode, userId: f.reader.actor.userId!, email: f.email, emailVerified: true, ...(mode === 'bearer' ? { tokenId: f.reader.actor.tokenId } : {}) };
    const auth = { actor, ...(mode === 'bearer' ? { headers: { authorization: 'Bearer ' + f.reader.token } } : {}) };
    const read = async () => await (await graphql(request(`/api/artifacts/${f.page}/graphql`, { ...auth, method: 'POST', json: { query: QUERY, revision: '1' } }), params(f.page))).json() as Reply;
    const capture = async () => {
      const res = await exportImage(request(`/a/${f.page}/export`, auth), params(f.page));
      expect(res.status).toBe(200);
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata(); return [meta.width, meta.height];
    };
    expect(await capture()).toEqual([3, 2]);
    expect((await f.db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [f.reader.actor.userId])).rows[0]?.email).toBe(f.email);
    expect((await read()).data?.staff).toEqual(STAFF);
    await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1', [f.staff]);
    expect((await read()).data?.staff).toBeUndefined();
    expect(await capture()).toEqual([1, 1]);
    expect(renders).toHaveLength(2);
  });
}
it('explicit bearer duplicate-profile fallback preserves ordinary claim in export', async () => {
  const f = await emailFixture('duplicate_bearer', true);
  setSession(null);
  const holder = await account('mxmx_test_claim_holder');
  await f.db.query('UPDATE users SET email=$2 WHERE id=$1', [holder.actor.userId, f.email]);
  const auth = { headers: { authorization: 'Bearer ' + f.reader.token }, actor: { credential: 'bearer' as const, userId: f.reader.actor.userId!, tokenId: f.reader.actor.tokenId, email: f.email, emailVerified: true } };
  const read = await (await graphql(request(`/api/artifacts/${f.page}/graphql`, { ...auth, method: 'POST', json: { query: QUERY, revision: '1' } }), params(f.page))).json() as Reply;
  expect(read.data?.staff).toEqual(STAFF);
  expect((await f.db.query<{ email: string }>('SELECT email FROM users WHERE id=$1', [f.reader.actor.userId])).rows[0]?.email).toBe(f.current);
  const res = await exportImage(request(`/a/${f.page}/export`, auth), params(f.page));
  expect(res.status).toBe(200);
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  expect([meta.width, meta.height]).toEqual([3, 2]);
  const key = new URL(renders[0]!.url).searchParams.get('key')!;
  expect(exportKeyReader(f.page, key)).toMatchObject({ userId: f.reader.actor.userId, email: f.email, documentEditor: false });
  await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1', [f.staff]);
  expect((await (await captureRead(f.page, '1', key, QUERY)).json() as Reply).data?.staff).toBeUndefined();
  const revoked = await exportImage(request(`/a/${f.page}/export`, auth), params(f.page));
  expect(revoked.status).toBe(200);
  const after = await sharp(Buffer.from(await revoked.arrayBuffer())).metadata();
  expect([after.width, after.height]).toEqual([1, 1]);
  expect(renders).toHaveLength(2);
});

it('isolates same-account claim audiences and never stores or transports an exposed address', async () => {
  const f = await emailFixture('cache_claim', true);
  expect(await exported(f.page)).toEqual({ status: 200, size: [3, 2] });
  setSession({ user: { id: f.reader.actor.userId!, email: f.current } });
  expect(await exported(f.page)).toEqual({ status: 200, size: [1, 1] });
  expect(renders).toHaveLength(2);
  setSession({ user: { id: f.reader.actor.userId!, email: f.email } });
  expect(await exported(f.page)).toEqual({ status: 200, size: [3, 2] });
  expect(renders).toHaveLength(2);
  const key = new URL(renders[0]!.url).searchParams.get('key')!;
  expect(exportKeyReader(f.page, key)).toMatchObject({ email: f.email, documentEditor: false });
  const cacheKeys = (await f.db.query<{ cache_key: string }>('SELECT cache_key FROM export_image_cache')).rows;
  expect(cacheKeys).toHaveLength(2);
  for (const value of [renders[0]!.url, key, Buffer.from(key.split('.')[1]!, 'base64url').toString('utf8'), ...cacheKeys.map(row => row.cache_key)]) {
    expect(value).not.toContain(f.email);
    expect(value).not.toContain(Buffer.from(f.email).toString('base64url'));
  }
  // A key minted before revocation rechecks access, and the old cached pixels are no longer served.
  await f.db.query('DELETE FROM artifact_shares WHERE artifact_id=$1', [f.staff]);
  expect((await (await captureRead(f.page, '1', key, QUERY)).json() as Reply).data?.staff).toBeUndefined();
  expect(await exported(f.page)).toEqual({ status: 200, size: [1, 1] });
  expect(renders).toHaveLength(3);
});

it('seals the admitted email without inheriting the host document-editor grant', () => {
  const actor = { userId: 'u_ada', tokenId: 't_1', email: 'mxmx_test_claim@example.test', documentEditor: true };
  const key = mintExportKey('abc123', undefined, undefined, actor);
  expect(exportKeyReader('abc123', key)).toEqual({ ...actor, documentEditor: false });
  expect(mintExportKey('abc123', undefined, undefined, actor)).not.toBe(key);
  const cache = (email: string) => exportCacheKey({ id: 'abc123', version: 1 }, 'png', 'full', 0, '', null, { ...actor, email });
  expect(cache(actor.email)).not.toBe(cache('mxmx_test_other@example.test'));
});
