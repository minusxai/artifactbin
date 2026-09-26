/**
 * THE SERVER HALF OF THE OFFLINE FILE — assembleArtifactFile, against real
 * isolated state: the read ACL decides, the snapshot and its variants run as
 * the downloader, fonts and images travel as data: URIs, and nothing in the
 * island names a server door.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { PUT as replaceRoute } from '@/app/api/artifacts/[id]/route';
import { documentEditBody } from '@/__tests__/prepared-document';
import { actOnAnnotationFor, createAnnotationFor, deleteAnnotationFor, type AnnotationAuthor } from '@/lib/annotations';
import { getArtifactById, type RoleActor } from '@/lib/artifacts';
import { setDatasetPolicy } from '@/lib/datasets/policy';
import { getDb } from '@/lib/db';
import { objectKey, objectStore } from '@/lib/object-store';
import { urlHash } from '@/lib/story/asset-url';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import type { TableResult } from '@/lib/story/dataflow';
import { assembleArtifactFile } from '../assemble.server';
import { parseArtifactFile, type ArtifactFile } from '../file-format';

useAppHarness();

const ORIGIN = 'https://app.artifactbin.test';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = `data:image/png;base64,${PNG_B64}`;
const WEB_IMAGE = 'https://example.test/pic.png';
const AUTHOR: AnnotationAuthor = { kind: 'human', label: 'Owner', transport: 'browser' };

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function account(name: string) {
  const user = await createUser({ email: `mxmx_test_offline_${name}@example.com` });
  const token = await mintToken(`mxmx_test_offline_${name}`);
  await claimToken(user.id, token.token);
  const actor: RoleActor = { userId: user.id, tokenId: token.id, email: user.email };
  return { user, token, actor };
}

async function create(token: string, body: Record<string, unknown>): Promise<string> {
  const res = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token, json: body }));
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** Our copy of a web image, as publish would have stored it (lib/web-assets). */
async function seedWebImage() {
  const bytes = Buffer.from(PNG_B64, 'base64');
  const key = objectKey('webasset', bytes);
  await objectStore().put(key, bytes, 'image/png');
  await (await getDb()).query(
    'insert into web_assets (url_hash, url, object_key, content_type, bytes, width, height) values ($1,$2,$3,$4,$5,1,1)',
    [urlHash(WEB_IMAGE), WEB_IMAGE, key, 'image/png', bytes.length],
  );
}

const DASHBOARD = (ds: string, secret: string, img: string) =>
  '<Helmet><Value name="region" type="string" /><Value name="note" type="string" />'
  + `<Import name="regions_data" src="ref:${ds}" /><Query name="regions">{\`select distinct region from regions_data.rows order by 1\`}</Query>`
  + `<Import name="sales_data" src="ref:${ds}" /><Query name="sales">{\`select sum(revenue) as revenue from sales_data.rows where $region is null or region = $region\`}</Query>`
  + `<Import name="noted_data" src="ref:${ds}" /><Query name="noted">{\`select count(*) as n from noted_data.rows where $note is null or region = $note\`}</Query>`
  + `<Import name="mine_data" src="ref:${ds}" /><Query name="mine">{\`select sum(revenue) as revenue from mine_data.rows where who = $_me.id and ($region is null or region = $region)\`}</Query>`
  + `<Import name="secrets_data" src="ref:${secret}" /><Query name="secrets">{\`select * from secrets_data.rows\`}</Query>`
  + '</Helmet>'
  + '<h1>Sales</h1><p>Quarterly numbers.</p>'
  + '<Select label="Region" value="$region" options="$regions" placeholder="All regions" />'
  + '<Input label="Note" value="$note" />'
  + '<Question data="$sales" viz={{"kind":"table"}} />'
  + `<img src="ref:${img}" alt="logo" />`
  + `<img src="${WEB_IMAGE}" alt="web" />`;

/** An owner, a reader and a stranger around one unlisted dashboard and one private one. */
async function world() {
  const owner = await account('owner');
  const bob = await account('bob');
  const stranger = await account('stranger');
  const ds = await create(owner.token.token, {
    dataset: [
      { region: 'west', revenue: 100, who: owner.user.id },
      { region: 'east', revenue: 200, who: owner.user.id },
      { region: 'west', revenue: 7, who: bob.user.id },
    ],
  });
  const secret = await create(owner.token.token, { dataset: [{ code: 'owner-only' }] });
  expect(await setDatasetPolicy({ userId: owner.user.id, tokenId: owner.token.id }, secret, { version: 2, allow: [{ actions: ['read'], from: { user: '$owner' } }] }, 0)).toMatchObject({ revision: 1 });
  const img = await create(owner.token.token, { image: PNG });
  await seedWebImage();
  const doc = await create(owner.token.token, { markup: DASHBOARD(ds, secret, img), visibility: 'unlisted' });
  const privateDoc = await create(owner.token.token, { markup: '<p>Only mine.</p>', visibility: 'private' });
  return { owner, bob, stranger, ds, secret, img, doc, privateDoc };
}

const reader = (a: { user: { id: string; email: string } }): RoleActor => ({ userId: a.user.id, tokenId: null, email: a.user.email });

async function download(id: string, actor: RoleActor, extra: { version?: number; maxFileBytes?: number } = {}): Promise<ArtifactFile> {
  const file = await assembleArtifactFile({ id, actor, origin: ORIGIN, ...extra });
  if ('refused' in file) throw new Error(`refused: ${file.refused} ${file.message}`);
  return file;
}

const revenue = (t: TableResult | undefined) => (t?.rows[0] as { revenue?: unknown } | undefined)?.revenue;
const variantFor = (file: ArtifactFile, region: string) => file.snapshot.variants.find((v) => v.values.region === region);

describe('access', () => {
  it('admits the owner, a reader of an unlisted document, and refuses strangers, missing ids and other formats', async () => {
    const w = await world();
    expect((await download(w.privateDoc, w.owner.actor)).source).toMatch(/<p[^>]*>Only mine\.<\/p>/);
    expect((await download(w.doc, reader(w.bob))).artifactId).toBe(w.doc);
    expect(await assembleArtifactFile({ id: w.privateDoc, actor: reader(w.stranger), origin: ORIGIN })).toMatchObject({ refused: 'forbidden' });
    expect(await assembleArtifactFile({ id: w.privateDoc, actor: { userId: null, tokenId: null }, origin: ORIGIN })).toMatchObject({ refused: 'forbidden' });
    expect(await assembleArtifactFile({ id: 'Zz9Zz9', actor: w.owner.actor, origin: ORIGIN })).toMatchObject({ refused: 'not_found' });
    const notADocument = await assembleArtifactFile({ id: w.ds, actor: w.owner.actor, origin: ORIGIN });
    expect(notADocument).toMatchObject({ refused: 'not_found' });
    expect((notADocument as { message: string }).message).toMatch(/only documents/i);
  });

  it('serves an archived version only to someone who may read the history', async () => {
    const owner = await account('history');
    const bob = await account('history_bob');
    const id = await create(owner.token.token, { markup: '<p>Version one</p>', visibility: 'unlisted' });
    const head = (await getArtifactById(id))!;
    const replaced = await replaceRoute(request(`/api/artifacts/${id}`, { method: 'PUT', token: owner.token.token, json: documentEditBody(head, { source: '<p>Version two</p>', whole: true }) }), params({ id }));
    expect(replaced.status, await replaced.clone().text()).toBe(200);

    const old = await download(id, owner.actor, { version: 1 });
    expect(old.source).toMatch(/>Version one</);
    expect(old.base).toMatchObject({ version: 1, source: old.source });
    expect(old.island.readOnly).toMatch(/Version 1 is read-only/);
    expect((await download(id, reader(bob))).source).toMatch(/>Version two</);
    expect(await assembleArtifactFile({ id, actor: reader(bob), version: 1, origin: ORIGIN })).toMatchObject({ refused: 'not_found' });
  });
});

describe('the snapshot', () => {
  it('carries the rows of every import the downloader may hold, so their queries run live and nothing is precomputed for them', async () => {
    const w = await world();
    const file = await download(w.doc, w.owner.actor);
    expect(file.snapshot.state.values).toMatchObject({ region: null, note: null });
    expect(file.snapshot.state.tables.regions?.rows).toEqual([{ region: 'east' }, { region: 'west' }]);
    expect(revenue(file.snapshot.state.tables.sales)).toBe(307);
    expect(file.island.dataflow?.hold).toEqual(['regions_data', 'sales_data', 'noted_data', 'mine_data', 'secrets_data']);
    expect(file.snapshot.held?.sales_data?.rows?.rows).toHaveLength(3);
    expect(file.snapshot.held?.secrets_data?.rows?.rows).toEqual([{ code: 'owner-only' }]);
    // Every query runs in the file's own engine: no combination is precomputed, no filter frozen.
    expect(file.snapshot.variants).toEqual([]);
    expect(file.snapshot.frozen).toEqual([]);
    expect(file.metadata).toMatchObject({ title: 'Sales' });
    expect(file).toMatchObject({ origin: ORIGIN, liveUrl: `${ORIGIN}/a/${w.doc}`, journal: [], localIds: [], bundle: 'core' });
    expect(file.base.source).toBe(file.source);
    expect(file.downloadedBy).not.toContain('@');
  });

  it('precomputes one variant per region only for the queries that stay on the server, and freezes their free-text filter', async () => {
    const w = await world();
    // Rows the document reads by its owner's reach, which its reader may not hold.
    const legacy = await create(w.owner.token.token, {
      dataset: [{ region: 'west', revenue: 100, who: w.owner.user.id }, { region: 'east', revenue: 200, who: w.owner.user.id }, { region: 'west', revenue: 7, who: w.bob.user.id }],
      visibility: 'private', access: 'read',
    });
    const doc = await create(w.owner.token.token, { markup: DASHBOARD(legacy, w.secret, w.img), visibility: 'unlisted' });
    const file = await download(doc, reader(w.bob));
    expect(file.island.dataflow?.hold).toEqual([]);
    expect(file.snapshot.held ?? {}).toEqual({});
    expect(file.snapshot.variants.map((v) => v.values.region).sort()).toEqual(['east', 'west']);
    expect(revenue(variantFor(file, 'west')?.tables.sales)).toBe(107);
    expect(revenue(variantFor(file, 'east')?.tables.sales)).toBe(200);
    // Only the queries a region changes travel in its variant.
    expect(Object.keys(variantFor(file, 'west')!.tables).sort()).toEqual(['mine', 'sales']);
    expect(revenue(variantFor(file, 'west')?.tables.mine)).toBe(7);
    expect(file.snapshot.frozen).toEqual(['note']);
  });

  it('contains only the rows the downloader may see, in the base, the held imports and every variant', async () => {
    const w = await world();
    const mine = await download(w.doc, w.owner.actor);
    const theirs = await download(w.doc, reader(w.bob));
    expect(revenue(mine.snapshot.state.tables.mine)).toBe(300);
    expect(revenue(theirs.snapshot.state.tables.mine)).toBe(7);
    // A dataset whose read grant names only its owner never reaches anyone else's file.
    expect(mine.snapshot.state.tables.secrets?.rows).toEqual([{ code: 'owner-only' }]);
    expect(theirs.snapshot.state.tables.secrets).toBeUndefined();
    expect(theirs.snapshot.state.errors.secrets).toBeTruthy();
    expect(theirs.island.dataflow?.hold).not.toContain('secrets_data');
    expect(JSON.stringify(theirs)).not.toContain('owner-only');
  });
});

describe('a self-contained file', () => {
  it('inlines every font and image, and names no server door', async () => {
    const w = await world();
    const file = await download(w.doc, w.owner.actor);
    const css = [file.css.base, file.css.compiled, file.css.author].join('\n');
    expect(file.css.base).toContain('data:font/woff2;base64,');
    expect(css).not.toMatch(/url\(\s*['"]?\//);
    const island = JSON.stringify(file.island);
    expect(island).toContain(`data:image/png;base64,${PNG_B64}`);
    expect(island).not.toContain('/assets/');
    expect(island).not.toContain(`/a/${w.img}/raw`);
    expect(island).not.toMatch(/srcSet/);
    const refImage = file.island.refData[w.img] as { url: string };
    expect(refImage.url).toMatch(/^data:image\/[a-z]+;base64,/);
    for (const door of [`/a/${w.doc}/query`, '/mutate', '/events', '/api/']) expect(island).not.toContain(door);
    expect(file.island).not.toHaveProperty('queryUrl');
    expect(file.island).not.toHaveProperty('assetsUrl');
    expect(file.island).not.toHaveProperty('managedAssets');
  });

  it('says a Mermaid document needs the mermaid bundle', async () => {
    const owner = await account('mermaid');
    const id = await create(owner.token.token, { markup: '<Mermaid title="Flow" code={"flowchart TD\\n A[Draft] --> B[Saved]"} />' });
    expect((await download(id, owner.actor)).bundle).toBe('mermaid');
  });

  it('refuses a file past the size cap with the size in the message', async () => {
    const w = await world();
    const refused = await assembleArtifactFile({ id: w.doc, actor: w.owner.actor, origin: ORIGIN, maxFileBytes: 1000 });
    expect(refused).toMatchObject({ refused: 'too_large' });
    expect((refused as { message: string }).message).toMatch(/^This document is too large to download for offline use \(\d+(\.\d+)? MB\)\. Remove large images or open it online\.$/);
  });
});

describe('threads', () => {
  it('carries open and resolved threads the downloader may see, and no deleted or unseeable ones', async () => {
    const w = await world();
    const tokenActor = { userId: w.owner.user.id, tokenId: w.owner.token.id };
    const open = await createAnnotationFor(tokenActor, w.doc, { body: 'Check the west number', quote: 'Quarterly numbers.' }, AUTHOR);
    const resolved = await createAnnotationFor(tokenActor, w.doc, { body: 'Title ok?', quote: 'Sales' }, AUTHOR);
    const gone = await createAnnotationFor(tokenActor, w.doc, { body: 'Never mind', quote: 'Quarterly numbers.' }, AUTHOR);
    for (const made of [open, resolved, gone]) expect(made).toHaveProperty('id');
    const id = (x: typeof open) => (x as { id: string }).id;
    expect(await actOnAnnotationFor(tokenActor, w.doc, id(resolved), { resolve: true }, AUTHOR)).toMatchObject({ status: 'resolved' });
    expect(await deleteAnnotationFor(tokenActor, w.doc, id(gone))).toBe(true);

    const file = await download(w.doc, w.owner.actor);
    expect(file.threads.map((t) => [t.id, t.status]).sort()).toEqual([[id(open), 'open'], [id(resolved), 'resolved']].sort());
    // A viewer-role reader may not see the discussion at all.
    expect((await download(w.doc, reader(w.bob))).threads).toEqual([]);
  });
});

describe('the file contract', () => {
  it('passes parseArtifactFile', async () => {
    const w = await world();
    const file = await download(w.doc, w.owner.actor);
    expect(parseArtifactFile(JSON.parse(JSON.stringify(file)))).toEqual(JSON.parse(JSON.stringify(file)));
  });
});
