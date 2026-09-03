/**
 * GET /assets/<hash> — our copy of a URL a document names.
 *
 * The address is derived from the URL, not from the bytes, so `immutable` is
 * what the cache header says and `refresh_asset` is how a changed source is
 * taken up. Everything else here is R15, the hole the spike measured: a stored
 * SVG is a DOCUMENT the moment someone navigates to it, and served plainly it
 * ran with this app's origin — reachable storage, reachable cookies. Three
 * headers close it (`Content-Security-Policy: sandbox`, `Content-Disposition:
 * attachment`, `X-Content-Type-Options: nosniff`) and none of them stops an
 * `<img>`, a `<link>` or an `@font-face` from using the same bytes — which is
 * what the browser gate proves and this file pins on the wire.
 */
import { describe, expect, it } from 'vitest';
import { useAppHarness, request } from '@/__tests__/harness';
import { GET } from '@/app/assets/[hash]/route';
import { getDb } from '@/lib/db';
import { objectKey, objectStore } from '@/lib/object-store';
import { assetUrlFor, urlHash } from '@/lib/story/asset-url';

useAppHarness();

const BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const URL_A = 'https://example.test/logo.svg';

const seed = async (contentType = 'image/svg+xml') => {
  const key = objectKey('webasset', BYTES);
  await objectStore().put(key, BYTES, contentType);
  const db = await getDb();
  await db.query(
    `insert into web_assets (url_hash, url, object_key, content_type, bytes) values ($1,$2,$3,$4,$5)`,
    [urlHash(URL_A), URL_A, key, contentType, BYTES.length],
  );
  return urlHash(URL_A);
};

const asset = (hash: string, search = '') =>
  GET(request(`/assets/${hash}${search}`), { params: Promise.resolve({ hash }) });

describe('GET /assets/<hash>', () => {
  it('serves the stored bytes with all five headers', async () => {
    const hash = await seed();
    const res = await asset(hash);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    expect(res.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect(res.headers.get('Content-Disposition')).toBe('attachment');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    // The document has an OPAQUE origin, so its own-origin font fetch is a CORS
    // request — /webfonts carries this for the same reason.
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('404s an unknown hash, and a malformed one before it reads anything', async () => {
    expect((await asset('a'.repeat(64))).status).toBe(404);
    expect((await asset('not-a-hash')).status).toBe(404);
    expect((await asset('../../etc/passwd')).status).toBe(404);
    expect((await asset('A'.repeat(64))).status).toBe(404); // hex is lowercase; a near miss is still a miss
  });

  /*
   * `?v=` IS A CACHE KEY AND NOTHING ELSE (R19). The address is served
   * `immutable` and cannot move — a stored document names the URL and every
   * rendering derives the address from it — so a refresh changes what the
   * mapping EMITS, and the route must answer the current bytes at every
   * version anyone was ever served, including none at all.
   */
  it('ignores the version the mapping puts on it', async () => {
    const hash = await seed();
    for (const search of ['', '?v=1a2b3c4d', '?v=anything at all', '?v=', '?w=99999']) {
      const res = await asset(hash, search);
      expect([search, res.status]).toEqual([search, 200]);
      expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
    }
  });

  it('serves the address the mapping actually emits for a row', async () => {
    await seed();
    const db = await getDb();
    const row = (await db.query('select * from web_assets where url_hash = $1', [urlHash(URL_A)])).rows[0] as any;
    const mapped = assetUrlFor(URL_A, row);
    expect(mapped).toMatch(/\?v=[0-9a-f]{8}$/);
    const [path, search] = mapped.split('?');
    const res = await asset(path.split('/').pop()!, `?${search}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
  });

  it('404s a row whose object the store will not give', async () => {
    const hash = await seed();
    const db = await getDb();
    await db.query('update web_assets set object_key = $1 where url_hash = $2', ['webasset/gone', hash]);
    expect((await asset(hash)).status).toBe(404);
  });
});
