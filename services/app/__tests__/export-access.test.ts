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
