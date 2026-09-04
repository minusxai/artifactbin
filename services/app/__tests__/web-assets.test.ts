/**
 * THE GLOBAL URL CACHE (lib/web-assets) — what an imported web URL becomes.
 *
 * The rules this pins, each of which the design rests on:
 *  - ONE object per URL for everyone. Two documents naming the same image cost
 *    one fetch and one row; the second importer is not billed for bytes that
 *    were already stored, and the upstream host is not asked twice.
 *  - The box travels. `width`/`height`/`placeholder` are recorded at import,
 *    because a URL-kept `<img>` that carries none is a layout-shift regression
 *    against the `ref:` path (R2).
 *  - SVG is not re-encoded — text that scales, byte-identical through the store.
 *  - A refusal has a NAME. The publish door turns it into a warning naming the
 *    URL, so an agent can act on it.
 *  - A FONT is not an image: sniffed as a font, stored untouched, and never put
 *    through the WebP optimiser.
 *  - `refreshWebAsset` re-fetches and REPOINTS the row (R13) — first-cached
 *    wins until someone asks for it again.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { useAppHarness } from '@/__tests__/harness';
import { withHttpServer, type RunningServer } from '@/__tests__/net';
import { setWebIngestPolicyForTests } from '@/lib/web-ingest/fetch';
import { mintToken } from '@/lib/tokens';
import { createUser } from '@/lib/users';
import { getDb } from '@/lib/db';
import { objectStore } from '@/lib/object-store';
import { setAssetByteQuotaForTests } from '@/lib/asset-quota';
import { importWebAsset, refreshWebAsset, refreshWebAssets, lookupWebAssets, webAssetByHash, WebAssetRefused } from '@/lib/web-assets';
import { assetBytesForToken } from '@/lib/asset-quota';
import { assetUrlFor } from '@/lib/story/asset-url';
import { webIngestRateLimited } from '@/lib/auth';
import { WEB_INGEST_MAX_PER_HOUR } from '@/lib/config';

useAppHarness();

const png = (size: number, colour: string) =>
  sharp({ create: { width: size, height: size, channels: 3, background: colour } }).png().toBuffer();

/**
 * A wide image that earns a second, narrower copy — and fits under the suite's
 * deliberately tiny 5 KB import cap (vitest.config IMAGES__MAX_BYTES), which is
 * why it is a lossy webp rather than the photograph the rule was written for.
 */
const wideImage = (width: number, height: number): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background: '#0a78c8' } }).webp({ quality: 50 }).toBuffer();

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(64, 7)]);

let server: RunningServer;
let base: string;
/** What the upstream host was actually asked for — the "one fetch per URL" evidence. */
let hits: string[] = [];
let photoColour = '#204080';

beforeAll(async () => {
  server = await withHttpServer(async (req, res) => {
    hits.push((req.url ?? '').split('?')[0]);
    // The path decides; a query string only makes a DIFFERENT cache key.
    switch ((req.url ?? '').split('?')[0]) {
      case '/photo.png':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(await png(64, photoColour));
        return;
      case '/wide.webp':
        res.writeHead(200, { 'Content-Type': 'image/webp' });
        res.end(await wideImage(1600, 1200));
        return;
      case '/logo.svg':
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(SVG);
        return;
      case '/face.woff2':
        res.writeHead(200, { 'Content-Type': 'font/woff2' });
        res.end(WOFF2);
        return;
      case '/not-an-image.png':
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end('<!doctype html><html><body>404</body></html>');
        return;
      case '/gone.png':
        res.writeHead(404);
        res.end();
        return;
      default:
        res.writeHead(500);
        res.end();
    }
  });
  base = server.base;
});

afterAll(async () => {
  setWebIngestPolicyForTests(null);
  await server.close();
});

afterEach(() => setAssetByteQuotaForTests(null));

const anonToken = async () => {
  const { id } = await mintToken('t');
  return { tokenId: id, userId: null };
};

// Every test in this file reaches a loopback server, which the guard refuses
// outside dev; the policy hook is the same one the ingest tests use.
const allowLocal = () => setWebIngestPolicyForTests({ allowPrivate: true, allowHttp: true });

describe('importWebAsset', () => {
  it('stores one object per URL, however many documents name it', async () => {
    allowLocal();
    hits = [];
    const a = await anonToken();
    const b = await anonToken();
    const first = await importWebAsset(`${base}/photo.png`, a);
    const second = await importWebAsset(`${base}/photo.png`, b);

    expect(second.url_hash).toBe(first.url_hash);
    expect(second.object_key).toBe(first.object_key);
    expect(hits.filter((h) => h === '/photo.png')).toHaveLength(1);
    const db = await getDb();
    const rows = await db.query<{ n: string }>('select count(*)::text as n from web_assets');
    expect(rows.rows[0].n).toBe('1');
    // The FIRST importer owns the row — a cache hit changes nothing about it.
    expect(first.fetched_by_token_id).toBe(a.tokenId);
    expect(second.fetched_by_token_id).toBe(a.tokenId);
  });

  it('records the box and the blur, and optimises the bytes', async () => {
    allowLocal();
    const row = await importWebAsset(`${base}/photo.png`, await anonToken());
    expect(row.content_type).toBe('image/webp');
    expect(row.width).toBe(64);
    expect(row.height).toBe(64);
    expect(row.placeholder?.startsWith('data:image/')).toBe(true);
    expect(row.bytes).toBeGreaterThan(0);
    expect((await objectStore().get(row.object_key)).length).toBe(row.bytes);
  });

  /*
   * THE NARROW COPY (lib/images/optimise) travels with the row, because the
   * row is what the mapping reads to write a `srcset` — and it is CHARGED with
   * the original, once: a variant nobody asked for must not be a way to store
   * bytes off the books, and billing it separately would make the second copy
   * look like a second import.
   */
  it('stores the narrow copy beside the full one, charged together', async () => {
    allowLocal();
    const row = await importWebAsset(`${base}/wide.webp`, await anonToken());
    expect(row.small_object_key).toBeTruthy();
    expect(row.small_width).toBe(1280);
    expect(row.small_object_key).not.toBe(row.object_key);
    const full = (await objectStore().get(row.object_key)).length;
    const small = (await objectStore().get(row.small_object_key!)).length;
    expect(small).toBeLessThan(full);
    expect(row.bytes).toBe(full + small);
  });

  it('records no narrow copy for an image that never needed one', async () => {
    allowLocal();
    const row = await importWebAsset(`${base}/photo.png`, await anonToken());
    expect(row.small_object_key).toBeNull();
    expect(row.small_width).toBeNull();
    expect(row.bytes).toBe((await objectStore().get(row.object_key)).length);
  });

  it('leaves an SVG byte-identical', async () => {
    allowLocal();
    const row = await importWebAsset(`${base}/logo.svg`, await anonToken());
    expect(row.content_type).toBe('image/svg+xml');
    expect(await objectStore().get(row.object_key)).toEqual(SVG);
  });

  it('imports a FONT as a font — sniffed, stored untouched, never optimised', async () => {
    allowLocal();
    const row = await importWebAsset(`${base}/face.woff2`, await anonToken(), 'font');
    expect(row.content_type).toBe('font/woff2');
    expect(row.width).toBeNull();
    expect(await objectStore().get(row.object_key)).toEqual(WOFF2);
  });

  it('refuses by NAME, and stores nothing', async () => {
    allowLocal();
    const actor = await anonToken();
    await expect(importWebAsset(`${base}/gone.png`, actor)).rejects.toMatchObject({ code: 'bad_status' });
    await expect(importWebAsset(`${base}/not-an-image.png`, actor)).rejects.toMatchObject({ code: 'unsupported_type' });
    await expect(importWebAsset('https://169.254.169.254/latest/meta-data', actor)).rejects.toBeInstanceOf(WebAssetRefused);
    const db = await getDb();
    expect((await db.query<{ n: string }>('select count(*)::text as n from web_assets')).rows[0].n).toBe('0');
  });

  it('charges the importer once — never a cache hit', async () => {
    allowLocal();
    const payer = await anonToken();
    await importWebAsset(`${base}/photo.png`, payer);
    // A cap the payer's own import has already blown: REFERENCING what is
    // cached still works (nothing is fetched or stored, so nothing is charged),
    // while the next URL that would actually cost bytes is refused by name.
    setAssetByteQuotaForTests(1);
    await expect(importWebAsset(`${base}/photo.png`, payer)).resolves.toBeTruthy();
    await expect(importWebAsset(`${base}/logo.svg`, payer)).rejects.toMatchObject({ code: 'quota_exceeded' });
  });

  it('stamps the ACCOUNT when the token has one', async () => {
    allowLocal();
    const user = await createUser({ email: 'mxmx_test_assets@example.com' });
    const { id } = await mintToken('owned', user.id);
    const row = await importWebAsset(`${base}/photo.png`, { tokenId: id, userId: user.id });
    expect(row.fetched_by_user_id).toBe(user.id);
  });
});

describe('lookupWebAssets', () => {
  it('answers the rows for the urls we hold, keyed by the canonical url', async () => {
    allowLocal();
    await importWebAsset(`${base}/photo.png`, await anonToken());
    const found = await lookupWebAssets([`${base}/photo.png`, `${base}/never-seen.png`]);
    expect([...found.keys()]).toEqual([`${base}/photo.png`]);
    expect(found.get(`${base}/photo.png`)?.width).toBe(64);
  });
});

describe('refreshWebAsset', () => {
  it('re-fetches and repoints the row, keeping its address', async () => {
    allowLocal();
    const actor = await anonToken();
    photoColour = '#204080';
    const before = await importWebAsset(`${base}/photo.png`, actor);
    photoColour = '#ff0000';
    const after = await refreshWebAsset(`${base}/photo.png`, actor);

    expect(after.url_hash).toBe(before.url_hash); // the served address never moves
    expect(after.object_key).not.toBe(before.object_key);
    expect((await webAssetByHash(before.url_hash))?.object_key).toBe(after.object_key);
    photoColour = '#204080';
  });

  /*
   * R19 — the half a repointed row cannot do on its own. `/assets/<hash>` is
   * served `immutable` for a year, so a reader who already fetched the old
   * bytes never asks again; what a refresh changes is the URL the next RENDER
   * emits, and the change has to come from the row, since nothing else about
   * the document moved.
   */
  it('changes the url every later render emits, at the same address', async () => {
    allowLocal();
    const actor = await anonToken();
    photoColour = '#0b7a3c';
    const before = await importWebAsset(`${base}/photo.png`, actor);
    photoColour = '#c21807';
    const after = await refreshWebAsset(`${base}/photo.png`, actor);

    expect(assetUrlFor(`${base}/photo.png`, after)).not.toBe(assetUrlFor(`${base}/photo.png`, before));
    expect(assetUrlFor(`${base}/photo.png`, after).split('?')[0])
      .toBe(assetUrlFor(`${base}/photo.png`, before).split('?')[0]);
    // …and a refresh that finds the SAME bytes emits the same url: the point is
    // to invalidate a change, not to make every render a cache miss.
    photoColour = '#c21807';
    const again = await refreshWebAsset(`${base}/photo.png`, actor);
    expect(assetUrlFor(`${base}/photo.png`, again)).toBe(assetUrlFor(`${base}/photo.png`, after));
    photoColour = '#204080';
  });

  it('imports a url nobody has held yet', async () => {
    allowLocal();
    const row = await refreshWebAsset(`${base}/logo.svg`, await anonToken());
    expect(row.content_type).toBe('image/svg+xml');
  });
});

/**
 * S1 — REFRESH IS A DOOR THAT STORES BYTES, so it asks the cap exactly as
 * import does, and the bytes it stores are charged to whoever asked for them.
 *
 * The review measured the hole: `refreshWebAsset` stored a new object without
 * asking the quota, and the row's `bytes` moved while its payer did not — so a
 * token already over its cap could keep causing objects to be stored for ever,
 * against a host it controls.
 */
describe('a refresh is charged', () => {
  it('refuses a refresher who is already over the cap', async () => {
    allowLocal();
    const payer = await anonToken();
    await importWebAsset(`${base}/photo.png`, payer);
    setAssetByteQuotaForTests(1);
    photoColour = '#0f0f0f';
    await expect(refreshWebAsset(`${base}/photo.png`, payer)).rejects.toMatchObject({ code: 'quota_exceeded' });
    photoColour = '#204080';
  });

  it("charges the REFRESHER the new object's bytes when the object moves", async () => {
    allowLocal();
    const first = await anonToken();
    const second = await anonToken();
    photoColour = '#204080';
    await importWebAsset(`${base}/photo.png`, first);
    expect(await assetBytesForToken(first.tokenId)).toBeGreaterThan(0);
    expect(await assetBytesForToken(second.tokenId)).toBe(0);

    photoColour = '#aa1111';
    await refreshWebAsset(`${base}/photo.png`, second);
    // The row now holds the bytes the SECOND token caused, so they are the
    // second token's to answer for.
    expect(await assetBytesForToken(second.tokenId)).toBeGreaterThan(0);
    expect(await assetBytesForToken(first.tokenId)).toBe(0);
    photoColour = '#204080';
  });

  it('charges nothing when the source is the same bytes — an unchanged key is free', async () => {
    allowLocal();
    const first = await anonToken();
    const second = await anonToken();
    photoColour = '#204080';
    await importWebAsset(`${base}/photo.png`, first);
    const before = await assetBytesForToken(first.tokenId);

    await refreshWebAsset(`${base}/photo.png`, second);
    expect(await assetBytesForToken(second.tokenId)).toBe(0);
    expect(await assetBytesForToken(first.tokenId)).toBe(before);
  });
});

/**
 * S2 — the hourly web-import allowance is per ATTEMPT, and a refresh of N urls
 * is N attempts. One call was buying N fetches for one slot, which is the
 * publish door's rule inverted at the door publish shares a bucket with.
 */
describe('refreshWebAssets charges the hourly bucket PER URL', () => {
  it('reports the URLs it could not pay for, rather than fetching them all on one slot', async () => {
    allowLocal();
    const actor = await anonToken();
    for (const n of [1, 2, 3]) await importWebAsset(`${base}/photo.png?n=${n}`, actor);
    // Two slots left in this token's hour.
    for (let i = 0; i < WEB_INGEST_MAX_PER_HOUR - 2; i++) webIngestRateLimited(`ingest:${actor.tokenId}`);

    const out = await refreshWebAssets([1, 2, 3].map((n) => `${base}/photo.png?n=${n}`), actor);
    expect(out.failed).toEqual([expect.objectContaining({ code: 'rate_limited', url: `${base}/photo.png?n=3` })]);
    expect(out.refreshed.length + out.unchanged.length).toBe(2);
  });
});
